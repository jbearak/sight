/**
 * The COM bridge's PowerShell side (Windows PowerShell 5.1). Sight
 * writes it to the console's temp directory and runs it with
 * `powershell.exe -Sta -NoProfile -NonInteractive -ExecutionPolicy
 * Bypass -File`. It holds the one `stata.StataOLEApp` reference and
 * answers JSON-lines requests on stdin/stdout, one at a time. Closing
 * stdin makes it release the reference (which quits Stata) and exit.
 *
 * `connect` starts the console's own Stata without taking one the user
 * has open. A plain `CreateObject` would hand out an open Stata nobody
 * holds. Each Stata registers one single-use class factory; taking it
 * with `CoGetClassObject` (and never calling `CreateInstance`) leaves
 * that Stata running with its data but no longer handed out. With
 * `CLSCTX_DISABLE_AAA` the call returns open Statas' factories and,
 * once none is left, fails with `E_ACCESSDENIED` without starting a
 * Stata, so `connect` takes them all ("the drain"), then gets a new
 * Stata's factory and creates the Automation object from that exact
 * factory. Measured on Windows 11 with Stata 18; see
 * docs/superpowers/plans/2026-11-07-windows-console-fresh-stata.md.
 *
 * The script contains no backticks and no dollar-brace, so it can live
 * in a template literal; PowerShell escapes are avoided on purpose. It
 * is ASCII only: PowerShell 5.1 reads the BOM-less file as ANSI.
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
$script:native_ready = $false
$script:error_detail = @{}

# Errors Invoke-Request throws as a bare quoted name, so the message is
# exactly the name; details go in $script:error_detail.
$NAMED_ERRORS = @('not_registered', 'native_unavailable', 'unsupported_registration',
    'drain_failed', 'drain_limit', 'drain_launched', 'session_failed')
$E_ACCESSDENIED = -2147024891
# CLSCTX_LOCAL_SERVER, alone and with CLSCTX_DISABLE_AAA.
$CONTEXT_SESSION = 0x4
$CONTEXT_DRAIN = 0x8004
$DRAIN_LIMIT = 16
$READY_WAIT_MS = 10000
$READY_POLL_MS = 250
$STATA_NAME = '^Stata(Now)?(MP|SE|BE|IC)?(-64)?$'

# Compiled by the prepare op. C# 5 (the .NET Framework compiler that
# Add-Type uses in PowerShell 5.1). Expected failures come back as
# HRESULTs, never as exceptions, which PowerShell would wrap.
$NATIVE_SOURCE = @'
using System;
using System.Runtime.InteropServices;

public static class SightConsoleCom {
    /** CreateInstance worked but its IDispatch couldn't be wrapped. */
    public const int WRAP_FAILED = unchecked((int)0xA0E10001);

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int CoGetClassObject(ref Guid clsid, uint context,
        IntPtr server_info, ref Guid iid, out IntPtr factory);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int CreateInstanceFunction(IntPtr self, IntPtr outer,
        ref Guid iid, out IntPtr result);

    public static int GetFactory(string clsid, uint context, out IntPtr factory) {
        Guid class_id = new Guid(clsid);
        Guid iid = new Guid("00000001-0000-0000-C000-000000000046");
        int hr = CoGetClassObject(ref class_id, context, IntPtr.Zero, ref iid, out factory);
        if (hr < 0) {
            factory = IntPtr.Zero;
        }
        return hr;
    }

    /** IClassFactory::CreateInstance (vtable slot 3) on this factory. */
    public static int CreateExact(IntPtr factory, out object stata) {
        stata = null;
        IntPtr vtable = Marshal.ReadIntPtr(factory);
        IntPtr entry = Marshal.ReadIntPtr(vtable, 3 * IntPtr.Size);
        CreateInstanceFunction create = (CreateInstanceFunction)
            Marshal.GetDelegateForFunctionPointer(entry, typeof(CreateInstanceFunction));
        Guid iid = new Guid("00020400-0000-0000-C000-000000000046");
        IntPtr dispatch;
        int hr = create(factory, IntPtr.Zero, ref iid, out dispatch);
        if (hr < 0) {
            return hr;
        }
        if (dispatch == IntPtr.Zero) {
            return WRAP_FAILED;
        }
        try {
            stata = Marshal.GetObjectForIUnknown(dispatch);
        } catch (Exception) {
            stata = null;
            Marshal.Release(dispatch);
            return WRAP_FAILED;
        }
        Marshal.Release(dispatch);
        return hr;
    }

    public static void Release(IntPtr pointer) {
        if (pointer != IntPtr.Zero) {
            Marshal.Release(pointer);
        }
    }
}
'@

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

function Format-HResult([int]$hr) {
    return ('0x{0:X8}' -f $hr)
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
            batch = ($command_line -match '(^|\s)[/-][bes](\s|$)')
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

function Get-Clsid {
    return [string](Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\stata.StataOLEApp\CLSID' -ErrorAction Stop).'(default)'
}

function Get-RegisteredExe {
    $clsid = Get-Clsid
    $server = (Get-ItemProperty -LiteralPath ('Registry::HKEY_CLASSES_ROOT\CLSID\' + $clsid + '\LocalServer32') -ErrorAction Stop).'(default)'
    return [string]$server
}

# The registry key at $path under $root, or null when it doesn't exist.
# Any other failure (access denied) refuses: fail closed.
function Open-Key([Microsoft.Win32.RegistryKey]$root, [string]$path) {
    try {
        return $root.OpenSubKey($path, $false)
    } catch {
        $script:error_detail['key'] = $root.Name + '\' + $path
        $script:error_detail['value'] = ''
        throw 'unsupported_registration'
    }
}

function Assert-NoValues([Microsoft.Win32.RegistryKey]$key, [string[]]$names) {
    if ($null -eq $key) { return }
    $present = @($key.GetValueNames())
    foreach ($name in $names) {
        if ($present -contains $name) {
            $script:error_detail['key'] = $key.Name
            $script:error_detail['value'] = $name
            throw 'unsupported_registration'
        }
    }
}

# The drain's no-launch behavior was measured with no AppID settings.
# A server that runs as another user, as a service or remotely could be
# started by the drain itself, so those registrations are refused. COM
# reads some of these values (RunAs) from HKLM only and the merged HKCR
# view can hide machine keys, so each hive is read separately, in the
# native view that 64-bit activation uses.
function Test-Registration {
    $clsid = Get-Clsid
    $exe = ''
    if ((Get-RegisteredExe) -match '([^\\"]+\.exe)') { $exe = $Matches[1] }
    $roots = @(
        [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64'),
        [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64'))
    $paths = @('SOFTWARE\Classes', 'Software\Classes')
    $appids = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $roots.Count; $i++) {
        $class = Open-Key $roots[$i] ($paths[$i] + '\CLSID\' + $clsid)
        Assert-NoValues $class @('RunAs', 'LocalService', 'ServiceParameters')
        if ($null -ne $class) {
            $appid = [string]$class.GetValue('AppID', '')
            if ($appid) { [void]$appids.Add($appid) }
        }
        if ($exe) {
            $mapping = Open-Key $roots[$i] ($paths[$i] + '\AppID\' + $exe)
            if ($null -ne $mapping) {
                $appid = [string]$mapping.GetValue('AppID', '')
                if ($appid) { [void]$appids.Add($appid) }
            }
        }
    }
    foreach ($appid in $appids) {
        for ($i = 0; $i -lt $roots.Count; $i++) {
            $settings = Open-Key $roots[$i] ($paths[$i] + '\AppID\' + $appid)
            Assert-NoValues $settings @('RunAs', 'LocalService', 'RemoteServerName', 'ActivateAtStorage')
        }
    }
}

# pid|start of each Stata process in this session (no CIM: cheap).
function Get-StataIds {
    $session = (Get-Process -Id $PID).SessionId
    $ids = @{}
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $STATA_NAME })) {
        if ($process.SessionId -ne $session) { continue }
        try { $ids[[string]$process.Id + '|' + (Get-StartText $process)] = [int]$process.Id } catch { }
    }
    return $ids
}

# A Stata that COM started since $known was taken, or null. Adds every
# new process to $known.
function Find-Launched([hashtable]$known) {
    $found = $null
    $now = Get-StataIds
    foreach ($id in @($now.Keys)) {
        if ($known.ContainsKey($id)) { continue }
        $known[$id] = $now[$id]
        $candidate = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $now[$id]) -ErrorAction SilentlyContinue
        if ($null -ne $candidate -and ([string]$candidate.CommandLine) -match '[/-](Automation|Embedding)\b') {
            $found = $now[$id]
        }
    }
    return $found
}

# A Stata the user started just before the console may not have
# registered its factory yet; give one without a window a moment. A
# heuristic: a window can appear before the factory registers.
function Wait-StataReady([string]$root) {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $READY_WAIT_MS) {
        # Assign first: the function returns its list as one object.
        $listed = Get-StataProcesses $false $root
        $starting = @($listed | Where-Object {
            -not $_.has_window -and -not $_.com_started -and -not $_.batch
        })
        if ($starting.Count -eq 0) { return }
        Start-Sleep -Milliseconds $READY_POLL_MS
    }
}

# Take every open Stata's factory, then create the console's own Stata
# from the exact factory of a new one. Every raw factory pointer is
# released at the end; the Statas whose factories were taken keep
# running and stay out of COM's hands (measured).
function Connect-OwnStata([string]$root) {
    $clsid = Get-Clsid
    Wait-StataReady $root
    $before = Get-StataProcesses $false $root
    $pointers = New-Object System.Collections.ArrayList
    $drained = 0
    try {
        $known = Get-StataIds
        $draining = $true
        while ($draining) {
            if ($drained -ge $DRAIN_LIMIT) {
                $script:error_detail['count'] = $drained
                throw 'drain_limit'
            }
            $factory = [IntPtr]::Zero
            $hr = [SightConsoleCom]::GetFactory($clsid, $CONTEXT_DRAIN, [ref]$factory)
            if ($hr -eq $E_ACCESSDENIED) {
                $draining = $false
            } elseif ($hr -lt 0) {
                $script:error_detail['hresult'] = Format-HResult $hr
                throw 'drain_failed'
            } else {
                [void]$pointers.Add($factory)
                $drained++
                # The registration launched a Stata despite
                # DISABLE_AAA (or another program did): never guess
                # whose factory this is.
                $launched = Find-Launched $known
                if ($null -ne $launched) {
                    $script:error_detail['stray_pid'] = $launched
                    throw 'drain_launched'
                }
            }
        }
        $session = [IntPtr]::Zero
        $hr = [SightConsoleCom]::GetFactory($clsid, $CONTEXT_SESSION, [ref]$session)
        if ($hr -lt 0) {
            $script:error_detail['hresult'] = Format-HResult $hr
            throw 'session_failed'
        }
        [void]$pointers.Add($session)
        $created = $null
        $hr = [SightConsoleCom]::CreateExact($session, [ref]$created)
        if ($hr -lt 0) {
            $script:error_detail['hresult'] = Format-HResult $hr
            $script:error_detail['wrap_failed'] = ($hr -eq [SightConsoleCom]::WRAP_FAILED)
            $stray = Find-Launched $known
            if ($null -ne $stray) { $script:error_detail['stray_pid'] = $stray }
            throw 'session_failed'
        }
        $script:stata = $created
    } finally {
        foreach ($pointer in $pointers) { [SightConsoleCom]::Release($pointer) }
    }
    # Nothing below may throw: Sight now holds Stata, and an error reply
    # would end the bridge, closing it.
    $after = @()
    try { $after = Get-StataProcesses $false $root } catch { $after = @() }
    return @{ before = $before; after = $after; drained = $drained }
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
        'prepare' {
            if (-not $script:native_ready) {
                try {
                    Add-Type -TypeDefinition $NATIVE_SOURCE -Language CSharp
                } catch {
                    throw 'native_unavailable'
                }
                $script:native_ready = $true
            }
            return @{}
        }
        'registered' {
            try {
                return @{ exe = (Get-RegisteredExe) }
            } catch {
                throw 'not_registered'
            }
        }
        'check_registration' {
            Test-Registration
            return @{}
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
            if (-not $script:native_ready) { throw 'native_unavailable' }
            return (Connect-OwnStata ([string]$request.root))
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
                if ($candidate.title -like $pattern) {
                    return @{ pid = $candidate.pid; start = $candidate.start }
                }
            }
            return @{ pid = $null; start = $null }
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
    $script:error_detail = @{}
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
        $reply = @{ id = $id; ok = $false; error = 'error'; message = $message; hresult = (Get-HResult $_.Exception) }
        if ($NAMED_ERRORS -ccontains $message) {
            $reply.error = $message
            $reply.hresult = $null
            foreach ($key in $script:error_detail.Keys) { $reply[$key] = $script:error_detail[$key] }
        }
        Send-Message $reply
    }
}

if ($null -ne $script:stata) {
    try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($script:stata) } catch { }
    $script:stata = $null
}
Unlock-Connect
exit 0
`;
