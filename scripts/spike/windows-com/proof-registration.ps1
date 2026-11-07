param([ValidateSet('setup','exercise','cleanup','sync')][string]$Action,[ValidateSet('HKLM','HKCU')][string]$Hive,[string]$Directory='')
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
$results="$PSScriptRoot\results\production-proof"
if($Action -eq 'setup') {
    $run='proof-registration-'+$Hive+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
    $dir=Join-Path $env:TEMP $run
    New-Item -ItemType Directory -Force $dir,$results|Out-Null
} else {$dir=$Directory;$run=Split-Path $dir -Leaf}
$evidence="$results\$run.jsonl";$owned=@{};$originals=@();$drivers=@();$passed=$false
. "$PSScriptRoot\strategy-common.ps1"
. "$PSScriptRoot\proof-common.ps1"
if($Action -ne 'setup') {
    $context=Get-Content "$dir\context.json" -Raw|ConvertFrom-Json
    foreach($item in $context.originals){$original=@{identity=@{pid=[int]$item.identity.pid;start=[string]$item.identity.start};token=[string]$item.token};$originals+=$original;$owned[$original.identity.pid]=$original.identity}
}
try {
    if($Action -eq 'setup') {
        Note 'initial_inventory' @(Inventory)
        Assert (@(Inventory).Count -eq 0) 'No unrelated Stata before registry test'
        $originals+=Fixture 'original0';$originals+=Fixture 'original1'
        $identities=@($originals|ForEach-Object {@{identity=$_.identity;token=$_.token}})
        $context=@{directory=$dir;run=$run;hive=$Hive;originals=$identities}
        [IO.File]::WriteAllText("$dir\context.json",($context|ConvertTo-Json -Depth 6))
        [IO.File]::WriteAllText("$results\registration-$Hive-context.json",($context|ConvertTo-Json -Depth 6))
        Copy-Item "$PSScriptRoot\proof-registry.ps1" 'C:\sight-target-proof\scripts\spike\windows-com\proof-registry.ps1' -Force
        Note 'registry_setup' $context
    } elseif($Action -eq 'sync') {
        Copy-Item "$PSScriptRoot\proof-registry.ps1" 'C:\sight-target-proof\scripts\spike\windows-com\proof-registry.ps1' -Force
        Note 'registry_helper_synced' $dir
    } elseif($Action -eq 'exercise') {
        Note 'before_case' @(Inventory)
        Check-Originals 'unsupported-registration-before'
        $a=Driver 'consoleA';$drivers+=$a
        Assert ($a.process.WaitForExit(30000)) 'Unsupported registration returns promptly'
        $done=Get-Content ($a.folder+'\done.json') -Raw|ConvertFrom-Json
        Note 'unsupported_result' @{hive=$Hive;driver_exit=$a.process.ExitCode;result=$done;inventory=@(Inventory)}
        Assert ($a.process.ExitCode -eq 87 -and $done.exit_code -eq 87) 'Unsupported registration exits 87'
        $trace=Read-SharedText ($a.folder+'\trace.jsonl')
        Assert (!$trace.Contains('"op":"connect"')) 'Unsupported registration never reaches COM connect'
        Assert (@(Inventory).Count -eq $originals.Count) 'Unsupported registration starts no Stata'
        Check-Originals 'unsupported-registration-after'
        Note 'verdict' @{case='unsupported-registration';hive=$Hive;status='PASS'}
    } else {
        $restored=Get-Content "$dir\registry-restored.json" -Raw|ConvertFrom-Json
        Assert ($restored.class_matches_backup -and $restored.temporary_appid_absent) 'Registry matches exported backup'
        Check-Originals 'registry-restored-originals-intact'
        foreach($identity in $owned.Values){$p=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue;if($p -and $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start){$p.Kill();$p.WaitForExit()}}
        foreach($file in @(Get-ChildItem "$dir\registry-*.json","$dir\class-backup*")) {Copy-Item $file.FullName "$results\$run-$($file.Name)" -Force}
        Note 'registry_restored' @{hive=$Hive;verified=$restored}
        Note 'final_inventory' @(Inventory)
    }
    $passed=$true
} catch {Note 'registry_error' @{action=$Action;hive=$Hive;message=$_.Exception.Message;stack=$_.ScriptStackTrace;inventory=@(Inventory)}}
finally {
    foreach($driver in $drivers){if(!$driver.process.HasExited){$driver.process.Kill();$driver.process.WaitForExit()};Copy-Item $driver.folder "$results\$run-$($driver.name)" -Recurse -Force}
}
if(!$passed){exit 1}
