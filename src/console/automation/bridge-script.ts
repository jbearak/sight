/**
 * The COM bridge's PowerShell side (Windows PowerShell 5.1). Sight
 * writes it to the console's temp directory and runs it with
 * `powershell.exe -Sta -NoProfile -NonInteractive -ExecutionPolicy
 * Bypass -File`. It holds the one `stata.StataOLEApp` reference and
 * answers JSON-lines requests on stdin/stdout, one at a time. Closing
 * stdin makes it release the reference (which quits Stata) and exit.
 *
 * The script contains no backticks and no dollar-brace, so it can live
 * in a template literal; PowerShell escapes are avoided on purpose.
 */

export const BRIDGE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    Write-Output '{"fatal":"constrained_language"}'
    exit 3
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$writer.AutoFlush = $true
$newline = [Environment]::NewLine

$script:stata = $null
$script:mutex = $null
$script:mutex_held = $false

function Send-Message($message) {
    $writer.WriteLine(($message | ConvertTo-Json -Compress -Depth 6))
}

function Get-HResult($exception) {
    $current = $exception
    while ($null -ne $current) {
        if ($current -is [System.Runtime.InteropServices.COMException]) {
            return ('0x{0:X8}' -f $current.HResult)
        }
        $current = $current.InnerException
    }
    if ($null -ne $exception -and $exception.HResult -ne 0) {
        return ('0x{0:X8}' -f $exception.HResult)
    }
    return $null
}

function Get-StartText([System.Diagnostics.Process]$process) {
    return $process.StartTime.ToUniversalTime().ToString('o')
}

function Test-Running([int]$process_id, [string]$start) {
    $process = Get-Process -Id $process_id -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $false }
    try { return (Get-StartText $process) -eq $start } catch { return $false }
}

function Read-Identity([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    $lines = @(Get-Content -LiteralPath $file -ErrorAction SilentlyContinue)
    if ($lines.Count -lt 2) { return $null }
    return @{ pid = [int]$lines[0]; start = [string]$lines[1] }
}

function Write-Identity([string]$file, [int]$process_id, [string]$start) {
    [System.IO.File]::WriteAllText($file, ([string]$process_id) + $newline + $start + $newline, $utf8)
}

# A Stata is owned by a running console when some directory under the
# root has a pid file naming it and an owner file naming a live process.
function Get-OwnedPids([string]$root) {
    $owned = @{}
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { return $owned }
    foreach ($dir in Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue) {
        $stata = Read-Identity (Join-Path $dir.FullName 'pid')
        $owner = Read-Identity (Join-Path $dir.FullName 'owner')
        if ($null -eq $stata -or $null -eq $owner) { continue }
        if (Test-Running $owner.pid $owner.start) {
            $owned[[string]$stata.pid + '|' + $stata.start] = $true
        }
    }
    return $owned
}

function Get-StataProcesses([bool]$strict, [string]$root) {
    $session = (Get-Process -Id $PID).SessionId
    $owned = Get-OwnedPids $root
    $result = New-Object System.Collections.ArrayList
    $candidates = Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'" -ErrorAction SilentlyContinue
    foreach ($candidate in $candidates) {
        if ($candidate.Name -notmatch '^Stata(Now)?(MP|SE|BE|IC)?(-64)?\.exe$') { continue }
        if ($candidate.SessionId -ne $session) { continue }
        $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        $has_window = $process.MainWindowHandle -ne [IntPtr]::Zero
        if ($strict -and -not $has_window) { continue }
        $start = Get-StartText $process
        if ($owned.ContainsKey([string]$candidate.ProcessId + '|' + $start)) { continue }
        $command_line = [string]$candidate.CommandLine
        [void]$result.Add(@{
            pid = [int]$candidate.ProcessId
            start = $start
            title = [string]$process.MainWindowTitle
            has_window = $has_window
            com_started = ($command_line -match '[/-](Automation|Embedding)\b')
        })
    }
    return ,$result.ToArray()
}

function Lock-Connect([int]$id) {
    if ($script:mutex_held) { return }
    $script:mutex = New-Object System.Threading.Mutex($false, 'Local\SightConsoleConnect')
    while ($true) {
        try {
            if ($script:mutex.WaitOne(500)) { break }
        } catch [System.Threading.AbandonedMutexException] {
            break
        }
        Send-Message @{ id = $id; event = 'mutex_wait' }
    }
    $script:mutex_held = $true
}

function Unlock-Connect {
    if ($script:mutex_held) {
        try { $script:mutex.ReleaseMutex() } catch { }
        $script:mutex_held = $false
    }
}

function Get-RegisteredExe {
    $clsid = (Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\stata.StataOLEApp\CLSID' -ErrorAction Stop).'(default)'
    $server = (Get-ItemProperty -LiteralPath ('Registry::HKEY_CLASSES_ROOT\CLSID\' + $clsid + '\LocalServer32') -ErrorAction Stop).'(default)'
    return [string]$server
}

function Invoke-Request($request) {
    $id = [int]$request.id
    switch ([string]$request.op) {
        'self_test' {
            if ($request.dir) {
                $parent = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId
                $owner = Get-Process -Id $parent -ErrorAction SilentlyContinue
                if ($null -ne $owner) {
                    Write-Identity (Join-Path $request.dir 'owner') $parent (Get-StartText $owner)
                }
            }
            return @{ language_mode = [string]$ExecutionContext.SessionState.LanguageMode }
        }
        'registered' {
            try {
                return @{ exe = (Get-RegisteredExe) }
            } catch {
                throw 'not_registered'
            }
        }
        'short_path' {
            $fso = New-Object -ComObject Scripting.FileSystemObject
            return @{ path = [string]$fso.GetFolder([string]$request.path).ShortPath }
        }
        'sweep' {
            $root = [string]$request.root
            $removed = 0
            if ($root -and (Test-Path -LiteralPath $root)) {
                $cutoff = (Get-Date).AddHours(-[double]$request.max_age_hours)
                foreach ($dir in Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue) {
                    if ($dir.LastWriteTime -gt $cutoff) { continue }
                    $owner = Read-Identity (Join-Path $dir.FullName 'owner')
                    $stata = Read-Identity (Join-Path $dir.FullName 'pid')
                    $live = ($null -ne $owner -and (Test-Running $owner.pid $owner.start)) -or ($null -ne $stata -and (Test-Running $stata.pid $stata.start))
                    if (-not $live) {
                        Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
                        $removed++
                    }
                }
            }
            return @{ removed = $removed }
        }
        'list_stata' {
            if ($request.acquire) { Lock-Connect $id }
            return @{ processes = (Get-StataProcesses ([bool]$request.strict) ([string]$request.root)) }
        }
        'connect' {
            $root = [string]$request.root
            $listed = Get-StataProcesses $true $root
            $now = @($listed | ForEach-Object { [int]$_.pid } | Sort-Object)
            $expect = @()
            if ($null -ne $request.expect) {
                $expect = @($request.expect | ForEach-Object { [int]$_ } | Sort-Object)
            }
            if (($now -join ',') -ne ($expect -join ',')) {
                return @{ listing_changed = $true; processes = $listed }
            }
            $before = Get-StataProcesses $false $root
            $script:stata = New-Object -ComObject stata.StataOLEApp
            $after = Get-StataProcesses $false $root
            return @{ listing_changed = $false; before = $before; after = $after }
        }
        'release_mutex' { Unlock-Connect; return @{} }
        'write_pid' {
            $process = Get-Process -Id ([int]$request.pid) -ErrorAction Stop
            Write-Identity (Join-Path $request.dir 'pid') ([int]$request.pid) (Get-StartText $process)
            return @{}
        }
        'title_pid' {
            $pattern = '*' + [string]$request.token8 + '*'
            $listed = Get-StataProcesses $false ''
            foreach ($candidate in $listed) {
                if ($candidate.title -like $pattern) { return @{ pid = $candidate.pid } }
            }
            return @{ pid = $null }
        }
        'alive' {
            return @{ alive = ($null -ne (Get-Process -Id ([int]$request.pid) -ErrorAction SilentlyContinue)) }
        }
        'is_free' { return @{ free = [bool]$script:stata.UtilIsStataFree() } }
        'do_async' { [void]$script:stata.DoCommandAsync([string]$request.cmd); return @{} }
        'do_sync' { return @{ rc = [int]$script:stata.DoCommand([string]$request.cmd) } }
        'break' {
            $sent = $false
            if (-not [bool]$script:stata.UtilIsStataFree()) {
                [void]$script:stata.UtilSetStataBreak()
                $sent = $true
            }
            return @{ sent = $sent }
        }
        'error_code' { return @{ rc = [int]$script:stata.UtilStataErrorCode() } }
        'show' { [void]$script:stata.UtilShowStata(0); return @{} }
        default { throw ('unknown op ' + [string]$request.op) }
    }
}

while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        $value = Invoke-Request $request
        $reply = @{ id = [int]$request.id; ok = $true }
        foreach ($key in $value.Keys) { $reply[$key] = $value[$key] }
        Send-Message $reply
    } catch {
        $id = 0
        if ($null -ne $request) { $id = [int]$request.id }
        $message = [string]$_.Exception.Message
        $error_name = 'error'
        if ($message -eq 'not_registered') { $error_name = 'not_registered' }
        Send-Message @{ id = $id; ok = $false; error = $error_name; message = $message; hresult = (Get-HResult $_.Exception) }
    }
}

if ($null -ne $script:stata) {
    try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($script:stata) } catch { }
    $script:stata = $null
}
Unlock-Connect
exit 0
`;
