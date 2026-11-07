param(
    [ValidateSet('zero','one','multiple','mixed','repeated','helper-exit','helper-kill','original-exit','manual-race','external-race','two-new-race','bound','adaptive','adaptive-mixed','concurrent-manual','registration-refusal','identity-preflight')]
    [string]$Case='one',
    [ValidateSet('quiescent-diagnostic','strict')][string]$Policy='strict'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
Add-Type -Path "$PSScriptRoot\strategy-native.cs"
$mutex = New-Object Threading.Mutex($false,'Local\SightFactoryReservationProbe')
try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }
if (!$locked) { throw 'Another probe is running' }
$run = 'strategy-'+$Case+'-'+$Policy.Split('-')[0]+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$results = "$PSScriptRoot\results\factory-strategy"
$dir = Join-Path $env:TEMP ('sight-'+$run)
New-Item -ItemType Directory -Force $dir,$results | Out-Null
$evidence = "$results\$run.jsonl"
$owned = @{}
$originals = New-Object Collections.ArrayList
$factories = New-Object 'System.Collections.Generic.List[IntPtr]'
$actors = New-Object Collections.ArrayList
$automation = $null
$passed = $false
$refused = $false
$clsid = '{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}'
. "$PSScriptRoot\strategy-common.ps1"
function New-Fixture($name, [bool]$protect=$true, [bool]$wait_ready=$true) {
    $token = $run.Substring(0,[Math]::Min(40,$run.Length))+'_'+$name
    $path = "$dir\$name.do"
    @"
set more off
log using "$dir\$name.log", text replace
$(if (!$wait_ready) { 'sleep 1500' })
sysuse auto, clear
global SIGHT_FACTORY_MARK "$token"
generate str80 factory_marker = "$token"
replace price = 918273 in 1
datasignature set, reset
file open ready using "$dir\$name.ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII $path
    $p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do',"`"$path`"" -PassThru
    $identity = @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o')}
    $owned[$p.Id] = $identity
    # Retain the process object/handle: start-time snapshots are not PID locks.
    [void]$p.Handle
    if ($wait_ready) { Wait-File "$dir\$name.ready" 30000 }
    $fixture = @{identity=$identity;token=$token;name=$name;process=$p;expected_exit=$false}
    if ($protect) { [void]$originals.Add($fixture) }
    Note 'fixture' @{name=$name;protected=$protect;token=$token;identity=$identity;inventory=@(Inventory)}
    if ($wait_ready) { Check-State $identity $token ('ready-'+$name) }
    return $fixture
}
function Start-Client($fixture) {
    $actor_dir = "$dir\client"+$actors.Count
    New-Item -ItemType Directory $actor_dir | Out-Null
    Guard
    $args = @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',
        "`"$PSScriptRoot\strategy-client.ps1`"",'-Directory',"`"$actor_dir`"",'-Token',$fixture.token)
    $p = Start-Process powershell.exe -ArgumentList $args -PassThru
    $actor = @{process=$p;directory=$actor_dir;fixture=$fixture}
    [void]$actors.Add($actor)
    Wait-File "$actor_dir\client.ready" 30000
    Note 'existing_client' @{pid=$p.Id;fixture=$fixture.identity;token=$fixture.token}
}
function Check-All($stage) {
    foreach ($fixture in $originals) {
        if (!$fixture.expected_exit) { Check-State $fixture.identity $fixture.token $stage }
    }
    foreach ($actor in $actors) {
        Assert (!$actor.process.HasExited) "$stage existing client alive"
        $nonce = [guid]::NewGuid().ToString('N')
        [IO.File]::WriteAllText(($actor.directory+'\client.request'),$nonce)
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $ack = $false
        while ($clock.ElapsedMilliseconds -lt 10000) {
            if (Test-Path ($actor.directory+'\client.response')) {
                try { $ack = [IO.File]::ReadAllText(($actor.directory+'\client.response')) -ceq $nonce } catch [IO.IOException] { }
            }
            if ($ack) { break }
            Start-Sleep -Milliseconds 20
        }
        Assert $ack "$stage existing client ongoing command and signature check"
        Note 'client_ack' @{stage=$stage;client_pid=$actor.process.Id;nonce=$nonce;fixture=$actor.fixture.identity}
    }
}
function Get-Factory([uint32]$context) {
    Guard
    $pointer = [IntPtr]::Zero
    Note 'acquire_begin' @{context=('0x{0:X}' -f $context)}
    $hr = [StrategyNative]::GetFactory($clsid,$context,[ref]$pointer)
    if ($pointer -ne [IntPtr]::Zero) { $factories.Add($pointer) }
    Note 'acquire' @{context=('0x{0:X}' -f $context);hr=('0x{0:X8}' -f $hr);
        pointer=('0x{0:X}' -f $pointer.ToInt64());inventory=@(Inventory)}
    return @{hr=$hr;pointer=$pointer}
}
function Drain([int]$limit=8) {
    $before = @(Inventory)
    $acquired = 0
    for ($i=0; $i -lt $limit; $i++) {
        $result = Get-Factory 0x8004
        Assert (@(Inventory).Count -eq $before.Count) 'NONLAUNCH_DRAIN no extra process'
        if ($result.hr -lt 0) {
            Assert ($result.hr -eq -2147024891) 'Observed drain stop is E_ACCESSDENIED; not universal exhaustion proof'
            Note 'drain_complete' @{acquired=$acquired;limit=$limit;hr='0x80070005';
                meaning='exhaustion only under measured registration/security assumptions'}
            return $true
        }
        Assert ($result.hr -eq 0 -and $result.pointer -ne [IntPtr]::Zero) 'Drain acquired raw factory'
        $acquired++
        if ($Case -eq 'original-exit' -and $i -eq 0) {
            $victim = $originals[0]
            $victim.process.Kill(); $victim.process.WaitForExit()
            $victim.expected_exit=$true
            $before = @(Inventory)
            Note 'controlled_original_exit' @{during='between bounded drain acquisitions';identity=$victim.identity}
        }
    }
    Note 'fail_closed' @{reason='DRAIN_BOUND_EXCEEDED';limit=$limit;createinstance_calls=0}
    Note 'strategy_result' @{ok=$false;code='DRAIN_BOUND_EXCEEDED';owned_session_created=$false}
    $script:refused=$true
    return $false
}
function Release-Raw {
    for ($i=0; $i -lt $factories.Count; $i++) {
        if ($factories[$i] -ne [IntPtr]::Zero) {
            [void][Runtime.InteropServices.Marshal]::Release($factories[$i])
            $factories[$i]=[IntPtr]::Zero
        }
    }
}
try {
    Note 'initial_inventory' @(Inventory)
    Assert (@(Inventory).Count -eq 0) 'No unrelated preexisting Stata in any session'
    Assert ((Get-Process -Id $PID).SessionId -ne 0) 'Desktop session'
    Note 'policy' @{case=$Case;policy=$Policy;max_factories=8;no_global_createobject_fallback=$true;
        diagnostic_assumption='quiescent-diagnostic permits CreateInstance for a controlled identity oracle, not production authorization'}
    $root = [Microsoft.Win32.Registry]::ClassesRoot
    $class_key = $root.OpenSubKey("CLSID\$clsid")
    $app_id = $class_key.GetValue('AppID')
    $remote_server = $class_key.GetValue('RemoteServerName')
    $local_service = $class_key.GetValue('LocalService')
    $class_key.Close()
    $server_key = $root.OpenSubKey("CLSID\$clsid\LocalServer32")
    $registered_server = [string]$server_key.GetValue(''); $server_key.Close()
    $exe_app_key = $root.OpenSubKey('AppID\StataMP-64.exe')
    $exe_app_present = $null -ne $exe_app_key
    if ($exe_app_key) { $exe_app_key.Close() }
    $app_values = @{}
    if ($app_id) {
        $app_key = $root.OpenSubKey("AppID\$app_id")
        if ($app_key) {
            foreach ($name in @('RunAs','LocalService','DllSurrogate')) { $app_values[$name]=$app_key.GetValue($name) }
            $app_key.Close()
        }
    }
    Note 'registration' @{clsid=$clsid;appid=$app_id;app_values=$app_values;
        local_server=$registered_server;remote_server=$remote_server;local_service=$local_service;
        exe_appid_key_present=$exe_app_present;
        machine_runas_service_absence_is_scoped=$true;helper_architecture=[string][Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture;
        session=(Get-Process -Id $PID).SessionId;powershell=$PSVersionTable.PSVersion.ToString()}
    $checked_app_id = $(if ($Case -eq 'registration-refusal') { '{UNSUPPORTED-TEST-FIXTURE}' } else { $app_id })
    $supported_registration = [string]::IsNullOrEmpty($checked_app_id) -and
        !$exe_app_present -and [string]::IsNullOrEmpty($remote_server) -and
        [string]::IsNullOrEmpty($local_service) -and
        $registered_server -ceq '"C:\Program Files\Stata18\StataMP-64.exe"'
    if (!$supported_registration) {
        Note 'fail_closed' @{reason='UNSUPPORTED_REGISTRATION';createinstance_calls=0;acquisition_calls=0;
            injected_snapshot_only=($Case -eq 'registration-refusal');no_registry_mutation=$true}
        Note 'strategy_result' @{ok=$false;code='UNSUPPORTED_REGISTRATION';owned_session_created=$false}
        $passed=$true
        Note 'verdict' @{status='PASS';case=$Case;policy=$Policy;interpretation='Unsupported registration refused before COM'}
        exit 3
    }
    Note 'source_hashes' @(Get-ChildItem "$PSScriptRoot\strategy-*" -File |
        Where-Object { $_.Extension -in @('.ps1','.cs') } | Get-FileHash -Algorithm SHA256 |
        Select-Object @{n='file';e={Split-Path $_.Path -Leaf}},Hash)
    if ($Case -eq 'identity-preflight') {
        . "$PSScriptRoot\strategy-identity-preflight.ps1"
        $capable=Test-IdentityCapability
        Note 'strategy_result' @{ok=$capable;code=$(if ($capable) { 'IDENTITY_AVAILABLE' } else { 'IDENTITY_PREREQUISITE_UNAVAILABLE' });owned_session_created=$false}
        $passed=$true
        Note 'verdict' @{status='PASS';case=$Case;policy=$Policy;capability=$capable}
        if (!$capable) { exit 3 }
        return
    }
    if ($Case -in @('mixed','adaptive-mixed')) {
        $held = New-Fixture 'held'
        Start-Client $held
        $blocked = New-Fixture 'blocked'
        $block = Get-Factory 0x8004
        Assert ($block.hr -eq 0) 'Reserve the sole available blocked original'
        Release-Raw
        [void](New-Fixture 'unclaimed')
    } elseif ($Case -ne 'zero') {
        [void](New-Fixture 'original0')
        if ($Case -in @('multiple','bound')) {
            [void](New-Fixture 'original1')
            [void](New-Fixture 'original2')
        }
    }
    if ($Case -in @('adaptive','adaptive-mixed')) {
        Assert ($Policy -eq 'quiescent-diagnostic') 'Adaptive PID-delta experiment is explicitly diagnostic-only'
        $known = New-Object 'System.Collections.Generic.HashSet[int]'
        foreach ($item in @(Inventory)) { [void]$known.Add($item.pid) }
        $created=$false
        for ($attempt=0; $attempt -lt 8; $attempt++) {
            $result = Get-Factory 4
            Assert ($result.hr -eq 0) 'Adaptive normal class-factory acquisition succeeds'
            $fresh = @(Inventory | Where-Object { !$known.Contains($_.pid) })
            Note 'adaptive_step' @{attempt=$attempt;fresh=$fresh;
                assumption='Only this harness creates/registers Stata during this diagnostic'}
            if ($fresh.Count -eq 0) { continue }
            Assert ($fresh.Count -eq 1) 'Quiescent adaptive acquisition made one new process'
            $owned[$fresh[0].pid]=$fresh[0]
            $information = New-Object StrategyNative+ServerInformation
            $decode_hr = [StrategyNative]::Decode($result.pointer,[ref]$information)
            Note 'adaptive_identity' @{decode_hr=('0x{0:X8}' -f $decode_hr);
                before_any_createinstance=$true;pid_delta_is_not_production_identity=$true}
            Note 'createinstance_call' @{factory=('0x{0:X}' -f $result.pointer.ToInt64());
                policy=$Policy;from_last_exact_factory=$true;global_activation_calls=0}
            $automation = [StrategyNative]::CreateExact($result.pointer)
            $marker = [string]$automation.MacroValue('SIGHT_FACTORY_MARK')
            Assert ($marker -ceq '') 'Adaptive exact factory returns a fresh blank marker in quiescent diagnostic'
            $token = 'adaptive_'+[guid]::NewGuid().ToString('N')
            Assert ($automation.DoCommand("global SIGHT_FACTORY_MARK $token") -eq 0) 'Adaptive owned marker'
            Assert ($automation.DoCommand("window manage maintitle `"$token`"") -eq 0) 'Adaptive owned title'
            $actual = @(Inventory | Where-Object { $_.title.Contains($token) })
            Assert ($actual.Count -eq 1 -and $actual[0].pid -eq $fresh[0].pid -and $actual[0].start -ceq $fresh[0].start) 'Adaptive object actual PID/start matches new process'
            Assert ($automation.MacroValue('SIGHT_FACTORY_MARK') -ceq $token) 'Adaptive distinct marker roundtrip'
            Check-All 'adaptive-owned-active'
            Assert (@(Inventory).Count -eq $originals.Count+1) 'ADAPTIVE exactly one own session, no spare server'
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($automation)
            $automation=$null
            Release-Raw
            $clock = [Diagnostics.Stopwatch]::StartNew()
            while ((Same-Process $fresh[0]) -and $clock.ElapsedMilliseconds -lt 5000) { Start-Sleep -Milliseconds 20 }
            Assert (!(Same-Process $fresh[0])) 'Adaptive owned server exited on release'
            Check-All 'adaptive-owned-released'
            Assert (@(Inventory).Count -eq $originals.Count) 'ADAPTIVE_NO_ORPHAN_EXTRA_SERVER'
            Note 'iteration_pass' @{algorithm='normal adaptive drain then exact last factory';attempts=$attempt+1;own_identity=$fresh[0]}
            $created=$true
            break
        }
        Assert $created 'Adaptive diagnostic completed within eight acquisitions'
        $passed=$true
        Note 'verdict' @{status='PASS';case=$Case;policy=$Policy;
            interpretation='Quiescent diagnostic only; PID delta does not authorize CreateInstance under races'}
        return
    }
    if ($Case -in @('helper-exit','helper-kill')) {
        $args = @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',
            "`"$PSScriptRoot\strategy-reserver.ps1`"",'-Directory',"`"$dir`"",'-Clsid',$clsid)
        $helper = Start-Process powershell.exe -ArgumentList $args -PassThru
        Wait-File "$dir\reserver.ready" 30000
        if ($Case -eq 'helper-kill') { $helper.Kill(); $helper.WaitForExit() }
        else {
            [IO.File]::WriteAllText("$dir\reserver.release",'release')
            Assert ($helper.WaitForExit(10000)) 'Reservation helper exits'
        }
        Note 'reservation_helper_gone' @{pid=$helper.Id;method=$Case}
        Check-All 'after-helper-gone'
    }
    $iterations = $(if ($Case -eq 'repeated') { 3 } else { 1 })
    for ($iteration=0; $iteration -lt $iterations; $iteration++) {
        $limit = $(if ($Case -eq 'bound') { 1 } else { 8 })
        $drained = Drain $limit
        Check-All 'after-drain'
        if (!$drained) {
            Assert ($Case -eq 'bound') 'Only deliberate bound scenario exhausts limit'
            break
        }
        if ($Policy -eq 'strict') {
            if ($Case -eq 'concurrent-manual') {
                $racer=New-Fixture 'manual_racer' $true $false
                Assert (!(Test-Path "$dir\manual_racer.ready")) 'Concurrent manual startup in flight during identity preflight'
                Note 'manual_startup_in_flight' $racer.identity
            }
            . "$PSScriptRoot\strategy-identity-preflight.ps1"
            $capable=Test-IdentityCapability
            if ($Case -eq 'concurrent-manual') { Wait-File "$dir\manual_racer.ready" 30000 }
            if (!$capable) {
                Note 'fail_closed' @{reason='IDENTITY_PREREQUISITE_UNAVAILABLE';createinstance_calls=0;owned_candidate_launches=0;global_fallback_calls=0}
                Note 'strategy_result' @{ok=$false;code='IDENTITY_PREREQUISITE_UNAVAILABLE';owned_session_created=$false}
                $refused=$true
                Check-All 'identity-preflight-refusal'
                break
            }
        }
        $before_candidate = @(Inventory)
        # Explicit launch supplies an owned process handle, rather than inferring
        # ownership from an arbitrary newly observed PID.
        $candidate = New-Fixture ('owned'+$iteration) $false
        if ($Case -in @('manual-race','two-new-race')) {
            # A competing manual original is registered before the owned
            # candidate is requested; order is made explicit below by holding
            # our candidate's factory, then registering the competitor.
            $candidate_factory = Get-Factory 0x8004
            Assert ($candidate_factory.hr -eq 0) 'Reserve candidate for controlled final-activation race'
            $racer = New-Fixture 'manual_racer'
        }
        if ($Case -eq 'concurrent-manual') {
            $racer = New-Fixture 'manual_racer' $true $false
            Assert (!(Test-Path "$dir\manual_racer.ready")) 'Manual startup is in flight before final factory acquisition'
            Note 'manual_startup_in_flight' $racer.identity
        }
        $result = Get-Factory 0x8004
        if ($Case -eq 'concurrent-manual') { Wait-File "$dir\manual_racer.ready" 30000 }
        if ($result.hr -lt 0) {
            Note 'fail_closed' @{reason='CANDIDATE_FACTORY_UNAVAILABLE';hr=('0x{0:X8}' -f $result.hr);createinstance_calls=0}
            Note 'strategy_result' @{ok=$false;code='CANDIDATE_FACTORY_UNAVAILABLE';owned_session_created=$false}
            $refused=$true
            break
        }
        $information = New-Object StrategyNative+ServerInformation
        $decode_hr = [StrategyNative]::Decode($result.pointer,[ref]$information)
        Note 'factory_identity' @{hr=('0x{0:X8}' -f $decode_hr);server_pid=$information.dwServerPid;
            expected_owned_identity=$candidate.identity;before_any_createinstance=$true}
        if ($Case -in @('external-race','two-new-race')) {
            $external_fixture = New-Fixture 'external_held'
            Start-Client $external_fixture
        }
        if ($Policy -eq 'strict' -and $decode_hr -ne 0) {
            Note 'fail_closed' @{reason='FACTORY_IDENTITY_UNAVAILABLE';hr=('0x{0:X8}' -f $decode_hr);
                createinstance_calls=0;global_fallback_calls=0;candidate_cleanup_by_owned_handle=$true}
            Note 'strategy_result' @{ok=$false;code='FACTORY_IDENTITY_UNAVAILABLE';owned_session_created=$false}
            $refused=$true
            Check-All 'strict-refusal'
            $candidate.process.Kill(); $candidate.process.WaitForExit()
            Release-Raw
            Assert (@(Inventory).Count -eq @($originals | Where-Object { !$_.expected_exit }).Count) 'STRICT_REFUSAL no orphan extra server'
            break
        }
        if ($Policy -eq 'strict') {
            Assert ($information.dwServerPid -eq $candidate.identity.pid -and (Same-Process $candidate.identity)) 'Decoded factory matches live owned process handle/start'
        }
        Note 'createinstance_call' @{factory=('0x{0:X}' -f $result.pointer.ToInt64());
            policy=$Policy;global_activation_calls=0}
        $automation = [StrategyNative]::CreateExact($result.pointer)
        $marker = [string]$automation.MacroValue('SIGHT_FACTORY_MARK')
        Note 'exact_factory_oracle' @{returned_marker=$marker;expected_owned_marker=$candidate.token;
            is_owned=($marker -ceq $candidate.token);candidate=$candidate.identity;
            manual_racer=$(if ($null -ne $racer) { $racer.identity } else { $null })}
        if ($marker -cne $candidate.token) {
            # Deliberately unsafe diagnostic oracle: retain the reference while
            # checking state, and release it only during experiment cleanup.
            Check-All 'wrong-factory-negative-control'
            Assert $false 'RED_FACTORY_IDENTITY: exact factory belongs to a manual original, not owned candidate'
        }
        Assert ($automation.DoCommand('clear') -eq 0) 'Initialize only positively measured own object'
        Assert ($automation.DoCommand('set obs 3') -eq 0) 'Own dataset has three rows'
        Assert ($automation.DoCommand('generate own_value = 314159') -eq 0) 'Own dataset marker'
        Assert ($automation.DoCommand('assert _N == 3 & own_value[1] == 314159') -eq 0) 'Own state verifies'
        $title = 'owned_'+[guid]::NewGuid().ToString('N')
        Assert ($automation.DoCommand("window manage maintitle `"$title`"") -eq 0) 'Title own object'
        $actual = @(Inventory | Where-Object { $_.title.Contains($title) })
        Assert ($actual.Count -eq 1 -and $actual[0].pid -eq $candidate.identity.pid -and $actual[0].start -ceq $candidate.identity.start) 'Exact object belongs to owned PID/start'
        Check-All 'own-object-active'
        Assert (@(Inventory).Count -eq @($originals | Where-Object { !$_.expected_exit }).Count+1) 'ONE_OWN_SESSION and NO_EXTRA_SERVER'
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($automation)
        $automation=$null
        Release-Raw
        Assert ($candidate.process.WaitForExit(5000)) 'Own server closes on object release'
        Check-All 'own-object-released'
        Assert (@(Inventory).Count -eq @($originals | Where-Object { !$_.expected_exit }).Count) 'NO_ORPHAN_EXTRA_SERVER after own object release'
        Note 'iteration_pass' @{iteration=$iteration;own_identity=$candidate.identity;existing_processes=@(Inventory)}
    }
    $passed=$true
    Note 'verdict' @{status='PASS';case=$Case;policy=$Policy;
        interpretation=$(if ($Policy -eq 'strict') { 'Fail-closed prerequisite handling; no claim of a fresh session when identity is unavailable' } else { 'Diagnostic under controlled quiescence; not a concurrency guarantee' })}
} catch { Note 'verdict' @{status='FAIL';case=$Case;policy=$Policy;message=$_.Exception.Message;stack=$_.ScriptStackTrace} }
finally {
    # Preserve original/client state checks before deliberate teardown.
    if ($null -ne $automation) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($automation) }
    Release-Raw
    foreach ($actor in $actors) {
        [IO.File]::WriteAllText(($actor.directory+'\client.release'),'release')
        if (!$actor.process.WaitForExit(5000)) { $actor.process.Kill(); $actor.process.WaitForExit() }
    }
    if ($null -ne $helper -and !$helper.HasExited) { $helper.Kill(); $helper.WaitForExit() }
    foreach ($identity in $owned.Values) {
        $p = Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start) { $p.Kill(); $p.WaitForExit() }
    }
    Get-ChildItem "$dir\*.log" | ForEach-Object { Copy-Item $_.FullName "$results\$run-$($_.Name)" }
    $remaining = @(Inventory)
    Note 'final_inventory' @($remaining)
    if ($remaining.Count -ne 0) { $passed=$false }
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
if (!$passed) { exit 1 }
if ($refused) { exit 3 }
