param(
    [ValidateSet('release','activate','factory-first','availability','kill','exit','multi','client-control','client-reserved','concurrent','excess')]
    [string]$Case = 'release',
    [ValidateSet('vbscript','vbnet')][string]$Client = 'vbscript',
    [ValidateRange(1,3)][int]$Originals = 1,
    [string]$Results = "$PSScriptRoot\results\factory-reservation"
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
$mutex = New-Object Threading.Mutex($false,'Local\SightFactoryReservationProbe')
try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
if (!$locked) { $mutex.Dispose(); throw 'Another factory probe is running' }
$run = $Case + '-' + [guid]::NewGuid().ToString('N').Substring(0,12)
$dir = Join-Path $env:TEMP ('sight-factory-' + $run)
New-Item -ItemType Directory -Force $dir,$Results | Out-Null
$evidence = Join-Path $Results ($run + '.jsonl')
$owned = @{}
$factories = New-Object 'System.Collections.Generic.List[IntPtr]'
$automation = $null
$worker = $null
$clients = @()
$passed = $false
function Note($event, $data) {
    $line = @{utc=[DateTime]::UtcNow.ToString('o');run=$run;event=$event;data=$data} |
        ConvertTo-Json -Depth 8 -Compress
    Add-Content -LiteralPath $evidence -Value $line -Encoding UTF8
    Write-Output $line
}
function Assert($condition, $message) {
    Note 'assert' @{ok=[bool]$condition;message=$message}
    if (!$condition) { throw $message }
}
function Inventory {
    @(Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'" | ForEach-Object {
        $p = Get-Process -Id $_.ProcessId -ErrorAction Stop
        @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o');
            session=$_.SessionId;command_line=$_.CommandLine;title=$p.MainWindowTitle}
    })
}
function Same-Process($identity) {
    $p = Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
    return ($null -ne $p -and
        $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start)
}
function Guard {
    $all = @(Inventory)
    foreach ($item in $all) {
        if (!$owned.ContainsKey($item.pid) -or
            $owned[$item.pid].start -cne $item.start) {
            Note 'unexpected_process' $item
            throw 'Unrelated Stata detected: no further COM calls allowed'
        }
    }
    Note 'pre_com_inventory' @($all)
}
function Wait-File($path, [int]$timeout_ms = 15000) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($clock.ElapsedMilliseconds -lt $timeout_ms) {
        if (Test-Path -LiteralPath $path) {
            try {
                $stream = [IO.File]::Open($path,[IO.FileMode]::Open,
                    [IO.FileAccess]::Read,[IO.FileShare]::None)
                $stream.Dispose()
                $ready = $true
                break
            } catch [IO.IOException] { }
        }
        Start-Sleep -Milliseconds 50
    }
    Assert $ready ('closed ready/response: ' + (Split-Path $path -Leaf))
}
function Check-State($identity, $token, $stage) {
    Assert (Same-Process $identity) "$stage original PID/start survives"
    $nonce = [guid]::NewGuid().ToString('N')
    $response = "$dir\$nonce.ok"
    $check = "$dir\$nonce.do"
    @"
assert _N == 74
assert price[1] == 918273
assert make[1] == "AMC Concord"
assert "`$SIGHT_FACTORY_MARK" == "$token"
assert factory_marker == "$token"
assert c(changed) == 1
datasignature confirm
file open verification using "$response", write replace
file write verification "$nonce|STATE_OK|N=74|price1=918273|changed=1|marker=$token" _n
file close verification
"@ | Set-Content -Encoding ASCII $check
    $p = Get-Process -Id $identity.pid
    $the_controls = @([FactoryNative]::Children($p.MainWindowHandle) | Where-Object {
        [FactoryNative]::Class($_) -ceq 'Scintilla' -and
        [FactoryNative]::Text([FactoryNative]::GetParent($_)) -ceq 'Command'
    })
    Assert ($the_controls.Count -eq 1) "$stage one PID-targeted Command control"
    # WM_CHAR carries characters by value; no cross-process Scintilla pointer.
    foreach ($char in "do `"$check`"".ToCharArray()) {
        if (![FactoryNative]::PostMessage($the_controls[0],0x102,[IntPtr][int]$char,[IntPtr]::Zero)) {
            throw 'WM_CHAR failed'
        }
    }
    [void][FactoryNative]::PostMessage($the_controls[0],0x100,[IntPtr]13,[IntPtr]::Zero)
    [void][FactoryNative]::PostMessage($the_controls[0],0x101,[IntPtr]13,[IntPtr]::Zero)
    Wait-File $response
    $text = [IO.File]::ReadAllText($response).Trim()
    Assert ($text -ceq "$nonce|STATE_OK|N=74|price1=918273|changed=1|marker=$token") "$stage state and nonce match"
    Note 'original_state' @{stage=$stage;pid=$identity.pid;start=$identity.start;response=$text}
}
function Acquire-Factory {
    Guard
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $pointer = [FactoryNative]::Acquire($script:clsid)
    $factories.Add($pointer)
    Note 'factory_acquired' @{index=$factories.Count-1;elapsed_ms=$clock.ElapsedMilliseconds;inventory=@(Inventory)}
}
function Release-Factories {
    for ($i=0; $i -lt $factories.Count; $i++) {
        if ($factories[$i] -ne [IntPtr]::Zero) {
            $count = [FactoryNative]::Release($factories[$i])
            $factories[$i] = [IntPtr]::Zero
            Note 'factory_released' @{index=$i;return_count=$count}
        }
    }
}
function Release-Automation {
    if ($null -ne $script:automation) {
        $count = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($script:automation)
        $script:automation = $null
        Note 'new_automation_released' @{return_count=$count}
    }
}
try {
    $initial = @(Inventory)
    Note 'initial_inventory' @($initial)
    Assert ($initial.Count -eq 0) 'No preexisting Stata in any session'
    $session = (Get-Process -Id $PID).SessionId
    Assert ($session -ne 0) 'Desktop session, not session 0'
    $key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey('stata.StataOLEApp\CLSID')
    $script:clsid = [string]$key.GetValue(''); $key.Close()
    $key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey("CLSID\$clsid\LocalServer32")
    $server = [string]$key.GetValue(''); $key.Close()
    $exe = $server.Trim('"')
    $bytes = [IO.File]::ReadAllBytes($exe)
    $pe = [BitConverter]::ToInt32($bytes,0x3c)
    $machine = '0x{0:X4}' -f [BitConverter]::ToUInt16($bytes,$pe+4)
    $os = Get-CimInstance Win32_OperatingSystem
    Note 'environment' @{clsid=$clsid;local_server=$server;stata_file_version=(Get-Item $exe).VersionInfo.FileVersion;
        stata_pe_machine=$machine;windows=$os.Caption;windows_version=$os.Version;build=$os.BuildNumber;
        os_architecture=[string][Runtime.InteropServices.RuntimeInformation]::OSArchitecture;
        helper_architecture=[string][Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture;
        powershell=$PSVersionTable.PSVersion.ToString();clr=[Environment]::Version.ToString();
        helper_pid=$PID;session=$session;apartment=[string][Threading.Thread]::CurrentThread.ApartmentState}
    Note 'script_hashes' @(Get-ChildItem "$PSScriptRoot\factory-*" -File |
        Where-Object { $_.Extension -in @('.ps1','.cs','.vb','.vbs','.ts') } |
        Get-FileHash -Algorithm SHA256 | Select-Object @{n='file';e={Split-Path $_.Path -Leaf}},Hash)
    if ($Case -in @('client-control','client-reserved') -and $Client -eq 'vbnet') {
        & "$PSScriptRoot\factory-build-client.ps1" -Directory $dir
        Note 'vbnet_compiler' @{version=(Get-Item 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\vbc.exe').VersionInfo.FileVersion;interop='registered Stata typelib 1.1; namespace stata'}
    }
    $the_originals = @()
    for ($i=0; $i -lt $Originals; $i++) {
        $token = $run + '_original_' + $i
        $startup = "$dir\original$i.do"
        @"
set more off
log using "$dir\original$i.log", text replace
sysuse auto, clear
global SIGHT_FACTORY_MARK "$token"
generate str60 factory_marker = "$token"
replace price = 918273 in 1
datasignature set, reset
window manage maintitle "$token"
file open version_info using "$dir\version$i.txt", write replace
file write version_info "Stata=" (c(stata_version)) "|born=" (c(born_date)) "|machine=" (c(machine_type)) _n
file close version_info
file open ready using "$dir\original$i.ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII $startup
        $p = Start-Process -FilePath $exe -ArgumentList 'do', "`"$startup`"" -PassThru
        $identity = @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o')}
        $owned[$p.Id] = $identity
        Wait-File "$dir\original$i.ready" 30000
        $the_originals += @{identity=$identity;token=$token}
        Note 'manual_original' @{identity=$identity;token=$token;
            architecture=[FactoryNative]::ProcessMachine($p.Id);
            version=[IO.File]::ReadAllText("$dir\version$i.txt");inventory=@(Inventory)}
        Check-State $identity $token 'baseline'
    }
    if ($Case -in @('kill','exit')) {
        Guard
        $args = @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',
            "`"$PSScriptRoot\factory-worker.ps1`"",'-Directory',"`"$dir`"",'-Clsid',$clsid)
        $worker = Start-Process powershell.exe -ArgumentList $args -PassThru
        Wait-File "$dir\worker.ready" 30000
        Note 'worker_ready' @{pid=$worker.Id;start=$worker.StartTime.ToUniversalTime().ToString('o');evidence=[IO.File]::ReadAllText("$dir\worker.ready")}
    } elseif ($Case -ne 'client-control') {
        for ($i=0; $i -lt $Originals; $i++) { Acquire-Factory }
    }
    Assert (@(Inventory).Count -eq $Originals) 'Factory acquisition started no extra Stata'
    foreach ($original in $the_originals) { Check-State $original.identity $original.token 'factory-held' }
    if ($Case -in @('client-control','client-reserved')) {
        Guard
        $client_token = $run + '_' + $Client
        if ($Client -eq 'vbscript') {
            $client_process = Start-Process cscript.exe -ArgumentList '//nologo',
                "`"$PSScriptRoot\factory-client.vbs`"", "`"$dir`"", $client_token -PassThru
        } else {
            $client_process = Start-Process "$dir\factory-client.exe" -ArgumentList "`"$dir`"", $client_token -PassThru
        }
        $clients += @{process=$client_process;directory=$dir}
        Wait-File "$dir\client.ready" 30000
        $lines = [IO.File]::ReadAllLines("$dir\client.ready")
        $returned = @(Inventory | Where-Object { $_.title.Contains($client_token) })
        Assert ($returned.Count -eq 1) 'External client returned object PID identified'
        $owned[$returned[0].pid] = $returned[0]
        $client_exe = (Get-Process -Id $client_process.Id).Path
        Note 'external_client_result' @{client=$Client;reserved=($Case -eq 'client-reserved');
            client_exe=$client_exe;client_file_version=(Get-Item $client_exe).VersionInfo.FileVersion;
            client_architecture=[FactoryNative]::ProcessMachine($client_process.Id);
            marker_before=$lines[0];marker_after=$lines[1];helper_version=@($lines | Select-Object -Skip 2);
            returned_identity=$returned[0];inventory=@(Inventory)}
        Assert ($lines[1] -ceq $client_token) 'External client marker roundtrip'
        if ($Case -eq 'client-control') {
            Assert ($lines[0] -ceq $the_originals[0].token) 'Unreserved documented client claims original'
            Assert ($returned[0].pid -eq $the_originals[0].identity.pid) 'Control returned original PID'
        } else {
            Assert ($lines[0] -ceq '') 'Reserved documented client got blank marker'
            Assert ($returned[0].pid -ne $the_originals[0].identity.pid) 'Reserved documented client got new PID'
            foreach ($original in $the_originals) { Check-State $original.identity $original.token 'external-client-held' }
        }
        [IO.File]::WriteAllText("$dir\client.release",'release')
        Assert ($client_process.WaitForExit(15000)) 'External client exits after releasing object'
        Wait-File "$dir\client.released"
        Start-Sleep -Seconds 2
        Assert (!(Same-Process $returned[0])) 'External client release closed returned Stata'
    }
    if ($Case -eq 'concurrent') {
        Guard
        $gate = "$dir\activate.gate"
        for ($i=0; $i -lt 2; $i++) {
            $client_dir = "$dir\client$i"
            New-Item -ItemType Directory $client_dir | Out-Null
            $args = @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',
                "`"$PSScriptRoot\factory-concurrent.ps1`"",'-Directory',"`"$client_dir`"",
                '-Token',($run+'_CONCURRENT_'+$i),'-Gate',"`"$gate`"")
            $process = Start-Process powershell.exe -ArgumentList $args -PassThru
            $clients += @{process=$process;directory=$client_dir}
            Wait-File "$client_dir\client.prepared"
        }
        [IO.File]::WriteAllText($gate,'go')
        foreach ($client_item in $clients) {
            Wait-File ($client_item.directory+'\client.ready') 30000
            $record = Get-Content ($client_item.directory+'\client.ready') -Raw | ConvertFrom-Json
            $returned = @(Inventory | Where-Object { $_.title.Contains($record.token) })
            Assert ($record.before -ceq '' -and $returned.Count -eq 1) 'Concurrent client got blank, identifiable object'
            Assert (!$owned.ContainsKey($returned[0].pid)) 'Concurrent object is distinct new PID'
            $owned[$returned[0].pid] = $returned[0]
            Note 'concurrent_result' @{client=$record;identity=$returned[0]}
        }
        Assert (@(Inventory).Count -eq $Originals+2) 'Two concurrent activations made exactly two new servers'
        foreach ($original in $the_originals) { Check-State $original.identity $original.token 'two-concurrent-objects-held' }
        foreach ($client_item in $clients) {
            [IO.File]::WriteAllText(($client_item.directory+'\client.release'),'release')
            Assert ($client_item.process.WaitForExit(15000)) 'Concurrent client released and exited'
        }
        Start-Sleep -Seconds 2
        Assert (@(Inventory).Count -eq $Originals) 'Only originals remain after concurrent client release'
    }
    if ($Case -eq 'excess') {
        Acquire-Factory
        $extra = @(Inventory | Where-Object { !$owned.ContainsKey($_.pid) })
        Assert ($extra.Count -eq 1 -and $extra[0].command_line -match '-Embedding') 'One excess factory acquisition started one extra server'
        $owned[$extra[0].pid] = $extra[0]
        Note 'excess_factory_server' $extra[0]
    }
    if ($Case -in @('activate','factory-first','multi')) {
        Guard
        $script:automation = New-Object -ComObject stata.StataOLEApp
        Note 'normal_activation_returned' @{api='PowerShell New-Object -ComObject';inventory=@(Inventory)}
        $marker = [string]$automation.MacroValue('SIGHT_FACTORY_MARK')
        Assert ($marker -ceq '') 'Returned Automation object has no original marker'
        Assert ($automation.DoCommand('assert _N == 0') -eq 0) 'New object initially has an empty dataset'
        Assert ($automation.DoCommand('set obs 3') -eq 0) 'New object owns separate three-row data'
        Assert ($automation.DoCommand('generate new_value = 314159') -eq 0) 'Set distinct new data'
        Assert ($automation.DoCommand('assert _N == 3 & new_value[1] == 314159') -eq 0) 'Verify distinct new dataset'
        $new_token = $run + '_NEW'
        Assert ($automation.DoCommand("global SIGHT_FACTORY_MARK $new_token") -eq 0) 'Set new object marker'
        Assert ($automation.DoCommand("window manage maintitle `"$new_token`"") -eq 0) 'Set new object title'
        Assert ($automation.MacroValue('SIGHT_FACTORY_MARK') -ceq $new_token) 'Read back distinct new marker'
        $new = @(Inventory | Where-Object { $_.title.Contains($new_token) })
        Assert ($new.Count -eq 1) 'One PID identified by returned object title'
        Assert (!$owned.ContainsKey($new[0].pid)) 'Returned object belongs to a genuinely new process'
        $owned[$new[0].pid] = $new[0]
        Note 'new_object_identity' $new[0]
        Assert (@(Inventory).Count -eq $Originals+1) 'Exactly one new Stata appeared'
        foreach ($original in $the_originals) { Check-State $original.identity $original.token 'new-object-held' }
        if ($Case -eq 'factory-first') {
            Release-Factories
            Start-Sleep -Seconds 2
            foreach ($original in $the_originals) { Check-State $original.identity $original.token 'factory-released-new-held' }
        }
        Release-Automation
        Start-Sleep -Seconds 2
        Assert (!(Same-Process $new[0])) 'New Automation server exited on release'
        foreach ($original in $the_originals) { Check-State $original.identity $original.token 'new-released' }
    }
    if ($Case -eq 'kill') {
        Stop-Process -Id $worker.Id -Force
        Note 'worker_terminated' @{pid=$worker.Id;method='Stop-Process -Force; no Release/CoUninitialize'}
        $worker.WaitForExit()
    } elseif ($Case -eq 'exit') {
        [IO.File]::WriteAllText("$dir\worker.release", 'release')
        Assert ($worker.WaitForExit(15000)) 'Orderly factory worker exits'
        Note 'worker_orderly_exit' @{code=$worker.ExitCode;release=[IO.File]::ReadAllText("$dir\worker.released")}
    } else { Release-Factories }
    Start-Sleep -Seconds 3
    if ($Case -ne 'client-control') {
        foreach ($original in $the_originals) { Check-State $original.identity $original.token 'factory-released-or-worker-gone' }
    }
    if ($Case -eq 'excess') { Note 'excess_server_after_factory_release' @{alive=(Same-Process $extra[0]);identity=$extra[0]} }
    Note 'after_release_inventory' @(Inventory)
    if ($Case -eq 'excess') {
        Assert (@(Inventory).Count -eq $Originals) 'NO_UNWANTED_EXTRA_SERVERS after factory release'
    }
    if ($Case -in @('availability','kill','exit')) {
        # Separate endpoint experiment: normal activation determines availability.
        # If it returns an original, this intentionally owns that disposable
        # instance; never use this endpoint merely to inspect preservation.
        if ($Case -eq 'kill') {
            Start-Sleep -Seconds 27
            foreach ($original in $the_originals) { Check-State $original.identity $original.token '30s-after-kill' }
        }
        Guard
        $script:automation = New-Object -ComObject stata.StataOLEApp
        $marker = [string]$automation.MacroValue('SIGHT_FACTORY_MARK')
        $endpoint_token = $run + '_AVAILABILITY'
        Assert ($automation.DoCommand("window manage maintitle `"$endpoint_token`"") -eq 0) 'Availability endpoint title'
        $endpoint = @(Inventory | Where-Object { $_.title.Contains($endpoint_token) })
        Assert ($endpoint.Count -eq 1) 'Availability endpoint PID identified'
        $owned[$endpoint[0].pid] = $endpoint[0]
        Note 'availability_result' @{returned_marker=$marker;returned_identity=$endpoint[0];
            original_available=($marker -ceq $the_originals[0].token);inventory=@(Inventory)}
        $restored = $marker -ceq $the_originals[0].token
        Note 'availability_verdict' @{hypothesis='Factory release restores original availability';
            status=$(if ($restored) { 'PASS' } else { 'FAIL' })}
        Release-Automation
        Start-Sleep -Seconds 2
        foreach ($original in $the_originals) {
            if ($marker -cne $original.token) { Check-State $original.identity $original.token 'after-availability-new-release' }
        }
    }
    $passed = $true
    Note 'verdict' @{status='PASS';case=$Case;originals=$Originals}
} catch {
    Note 'verdict' @{status='FAIL';message=$_.Exception.Message;stack=$_.ScriptStackTrace;inventory=@(Inventory)}
} finally {
    Release-Automation
    Release-Factories
    if ($null -ne $worker -and !$worker.HasExited) {
        [IO.File]::WriteAllText("$dir\worker.release", 'release')
        if (!$worker.WaitForExit(5000)) { Stop-Process -Id $worker.Id -Force }
    }
    foreach ($client_item in $clients) {
        if (!$client_item.process.HasExited) {
            [IO.File]::WriteAllText(($client_item.directory+'\client.release'),'release')
            if (!$client_item.process.WaitForExit(5000)) { Stop-Process -Id $client_item.process.Id -Force }
        }
    }
    foreach ($identity in $owned.Values) {
        if (Same-Process $identity) {
            Stop-Process -Id $identity.pid -Force
            Note 'owned_cleanup' $identity
        }
    }
    # Logs begin at startup do-file, after Stata's license banner.
    Get-ChildItem "$dir\original*.log" | ForEach-Object {
        $text = [IO.File]::ReadAllText($_.FullName).Replace("`r`n","`n")
        [IO.File]::WriteAllText((Join-Path $Results ($run+'-'+$_.Name)), $text)
    }
    $remaining = @(Inventory)
    Note 'final_inventory' @($remaining)
    if ($remaining.Count -ne 0) {
        $passed = $false
        Note 'cleanup_failure' 'Stata remains; inspect identities before any more tests'
    }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
if (!$passed) { exit 1 }
