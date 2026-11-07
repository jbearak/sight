param([ValidateSet('decode','noaaa-empty','noaaa-original','marshal')][string]$Mode='decode')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
Add-Type -Path "$PSScriptRoot\strategy-native.cs"
if ($Mode -eq 'marshal') { Add-Type -Path "$PSScriptRoot\strategy-marshal.cs" }
$run = 'api-'+$Mode+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$results = "$PSScriptRoot\results\factory-strategy"
$dir = Join-Path $env:TEMP ('sight-strategy-'+$run)
New-Item -ItemType Directory -Force $dir,$results | Out-Null
$evidence = "$results\$run.jsonl"
$owned = @{}
. "$PSScriptRoot\strategy-common.ps1"
$pointers = @()
$clsid = '{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}'
$passed = $false
try {
    Note 'initial_inventory' @(Inventory)
    Assert (@(Inventory).Count -eq 0) 'No preexisting Stata'
    Assert ((Get-Process -Id $PID).SessionId -ne 0) 'Desktop session'
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    Note 'helper' @{architecture=[string][Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture;
        powershell=$PSVersionTable.PSVersion.ToString();pid=$PID;session=(Get-Process -Id $PID).SessionId;
        elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
        server_information_size=[Runtime.InteropServices.Marshal]::SizeOf([type][StrategyNative+ServerInformation])}
    if ($Mode -ne 'noaaa-empty') {
        $token = $run
        @"
set more off
log using "$dir\original.log", text replace
sysuse auto, clear
global SIGHT_FACTORY_MARK "$token"
generate str60 factory_marker = "$token"
replace price = 918273 in 1
datasignature set, reset
file open ready using "$dir\original.ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII "$dir\original.do"
        $p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do',"`"$dir\original.do`"" -PassThru
        $identity = @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o')}
        $owned[$p.Id] = $identity
        Wait-File "$dir\original.ready" 30000
        Check-State $identity $token 'baseline'
    }
    $count = $(if ($Mode -eq 'noaaa-original') { 2 } else { 1 })
    for ($i=0; $i -lt $count; $i++) {
        Guard
        $before = @(Inventory)
        $context = $(if ($Mode -eq 'decode') { 4 } else { 0x8004 })
        $pointer = [IntPtr]::Zero
        $hr = [StrategyNative]::GetFactory($clsid,$context,[ref]$pointer)
        if ($pointer -ne [IntPtr]::Zero) { $pointers += $pointer }
        $after = @(Inventory)
        foreach ($item in $after) {
            if (!$owned.ContainsKey($item.pid)) {
                Assert ($item.command_line -match '-Embedding') 'API call created isolated embedding server'
                $owned[$item.pid] = $item
            }
        }
        Note 'api_acquisition' @{index=$i;context=('0x{0:X}' -f $context);hr=('0x{0:X8}' -f $hr);
            before=$before;after=$after;pointer_nonzero=($pointer -ne [IntPtr]::Zero)}
        if ($pointer -ne [IntPtr]::Zero) {
            $information = New-Object StrategyNative+ServerInformation
            $decode_hr = [StrategyNative]::Decode($pointer,[ref]$information)
            Note 'decode_result' @{hr=('0x{0:X8}' -f $decode_hr);server_pid=$information.dwServerPid;
                server_tid=$information.dwServerTid;server_address=('0x{0:X}' -f $information.ui64ServerAddress);
                before_any_createinstance=$true}
            if ($Mode -eq 'marshal') {
                foreach ($destination in @(0,2)) {
                    Note 'marshal_result' @{destination_context=$destination;
                        result=[StrategyMarshal]::Inspect($pointer,$destination)}
                }
                try {
                    $tcp = @(Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.OwningProcess -eq $identity.pid } |
                        Select-Object State,LocalAddress,LocalPort,OwningProcess)
                    Note 'stata_tcp_connections' @($tcp)
                } catch { Note 'tcp_snapshot_error' $_.Exception.Message }
                Note 'optional_oxid_scope' @{resolveoxid2_attempted=$false;
                    reason='Bounded protocol implementation deferred; no PID inferred from OBJREF resolver addresses or TCP absence'}
            }
        }
        if ($Mode -ne 'noaaa-empty') { Check-State $identity $token ('after-api-'+$i) }
    }
    $passed = $true
    Note 'verdict' @{status='MEASURED';mode=$Mode}
} catch { Note 'verdict' @{status='ERROR';message=$_.Exception.Message;stack=$_.ScriptStackTrace} }
finally {
    foreach ($pointer in $pointers) { [void][Runtime.InteropServices.Marshal]::Release($pointer) }
    foreach ($identity in $owned.Values) {
        if (Same-Process $identity) { Stop-Process -Id $identity.pid -Force }
    }
    if (Test-Path "$dir\original.log") { Copy-Item "$dir\original.log" "$results\$run-original.log" }
    Note 'final_inventory' @(Inventory)
}
if (!$passed) { exit 1 }
