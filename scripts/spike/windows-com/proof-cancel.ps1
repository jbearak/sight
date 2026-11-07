param([ValidateSet('free','title')][string]$Stage='free',[ValidateRange(1,2)][int]$Count=1)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
$run='proof-cancel-'+$Stage+'-'+$Count+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$results="$PSScriptRoot\results\production-proof"
$dir=Join-Path $env:TEMP $run
New-Item -ItemType Directory -Force $dir,$results | Out-Null
$evidence="$results\$run.jsonl"
$owned=@{}; $originals=@(); $drivers=@(); $passed=$false
. "$PSScriptRoot\strategy-common.ps1"
. "$PSScriptRoot\proof-common.ps1"
try {
    Note 'initial_inventory' @(Inventory)
    Assert (@(Inventory).Count -eq 0) 'No unrelated Stata'
    $originals+=Fixture 'original0'
    $originals+=Fixture 'original1'
    Note 'before_case' @(Inventory)
    $a=Driver 'consoleA' $Stage ([string]$Count)
    $drivers+=$a
    Assert ($a.process.WaitForExit(45000)) 'Cancellation completes'
    $done=Get-Content ($a.folder+'\done.json') -Raw|ConvertFrom-Json
    Note 'cancellation_result' @{method='OpenHandle.cancel at traced real transport request';stage=$Stage;count=$Count;result=$done;exit=$a.process.ExitCode;inventory=@(Inventory)}
    if ($Count -eq 1) {
        Assert ($a.process.ExitCode -eq 130 -and $done.exit_code -eq 130) 'Cancelled production open returns 130'
    }
    # Forced cancellation may interrupt ownership identification and reach the
    # backend with a dead bridge. Record its status and remaining server rather
    # than imposing the graceful cancellation status on this different path.
    $trace=Read-SharedText ($a.folder+'\trace.jsonl')
    Assert ($trace.Contains('"outcome":"graceful"')) 'First cancel was graceful'
    if ($Count -eq 2) { Assert ($trace.Contains('"outcome":"killed"')) 'Second cancel killed the bridge' }
    Check-Originals 'after-cancellation'
    if ($Count -eq 1) { Assert (@(Inventory).Count -eq $originals.Count) 'Single cancellation leaves no stray Stata' }
    Note 'verdict' @{status='PASS';stage=$Stage;count=$Count}
    $passed=$true
} catch { Note 'verdict' @{status='FAIL';message=$_.Exception.Message;stack=$_.ScriptStackTrace;inventory=@(Inventory)} }
finally {
    foreach ($driver in $drivers) {
        if (!$driver.process.HasExited) { $driver.process.Kill(); $driver.process.WaitForExit() }
        Copy-Item $driver.folder "$results\$run-$($driver.name)" -Recurse -Force
    }
    foreach ($identity in $owned.Values) {
        $p=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start) { $p.Kill(); $p.WaitForExit() }
    }
    # Any extra after double cancel was created only by this isolated production
    # activation. Record it before cleanup, then target its PID/start identity.
    foreach ($extra in @(Inventory)) {
        if ($extra.command_line -match '-Embedding' -and [DateTime]::Parse($extra.start).ToUniversalTime() -gt (Get-Item $dir).CreationTimeUtc) {
            Note 'owned_stray_cleanup' $extra
            $p=Get-Process -Id $extra.pid
            if ($p.StartTime.ToUniversalTime().ToString('o') -ceq $extra.start) { $p.Kill(); $p.WaitForExit() }
        }
    }
    Note 'final_inventory' @(Inventory)
}
if (!$passed) { exit 1 }
