param([ValidateSet('originals','empty','sequential','simultaneous','held','cancel-free','cancel-title','race-same','race-connect','race-before')][string]$Case='originals')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
$run='proof-'+$Case+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$results="$PSScriptRoot\results\production-proof"
$dir=Join-Path $env:TEMP $run
New-Item -ItemType Directory -Force $dir,$results | Out-Null
$evidence="$results\$run.jsonl"
$owned=@{}
$originals=@()
$drivers=@()
$client=$null
$passed=$false
. "$PSScriptRoot\strategy-common.ps1"
. "$PSScriptRoot\proof-common.ps1"

try {
    Note 'tested_commit' '2548950b8abb9d6f7f6c74727111a6ae6a58b04a'
    Note 'initial_inventory' @(Inventory)
    Assert (@(Inventory).Count -eq 0) 'No unrelated preexisting Stata in any session'
    Assert ((Get-Process -Id $PID).SessionId -ne 0) 'Desktop session 1, not session 0'
    if ($Case -like 'race-*') {
        if ($Case -eq 'race-before') {
            $originals+=Fixture 'manual-racer'
            $elapsed=([DateTime]::UtcNow-[DateTime]::Parse($originals[0].identity.start)).TotalMilliseconds
            if ($elapsed -lt 1000) { Start-Sleep -Milliseconds ([int](1000-$elapsed)) }
        }
        $a=Driver 'consoleA'
        $drivers+=$a
        if ($Case -eq 'race-connect') {
            $clock=[Diagnostics.Stopwatch]::StartNew()
            while ($clock.ElapsedMilliseconds -lt 30000) {
                if (Test-Path ($a.folder+'\trace.jsonl')) {
                    if ((Read-SharedText ($a.folder+'\trace.jsonl')).Contains('"op":"connect"')) { break }
                }
                Start-Sleep -Milliseconds 5
            }
            Assert ($clock.ElapsedMilliseconds -lt 30000) 'Observed real connect request before manual launch'
        }
        if ($Case -ne 'race-before') { $originals+=Fixture 'manual-racer' }
        Note 'race_inventory' @{driver_start=$a.process.StartTime.ToUniversalTime().ToString('o');manual=$originals[0].identity;inventory=@(Inventory)}
        Wait-Driver $a $true
        Command $a 'display 776000 + 66' '776066'
        Check-Originals 'race-session-active'
        End-Driver $a
        if ($a.manual_selected) { $originals[0].expected_exit=$true }
        Check-Originals 'race-session-ended'
        $expected=@($originals|Where-Object { !$_.expected_exit }).Count
        Assert (@(Inventory).Count -eq $expected) 'Race leaves no spare embedding Stata'
        Note 'race_result' @{manual_selected=$a.manual_selected;session=$a.identity;manual=$originals[0].identity}
        $passed=$true
        Note 'verdict' @{case=$Case;status='PASS'}
        return
    }
    if ($Case -eq 'held') {
        $originals+=Fixture 'held-original'
        $client=Start-HeldClient $originals[0]
        $originals+=Fixture 'original1'
    } elseif ($Case -ne 'empty') {
        $originals+=Fixture 'original0'
        $originals+=Fixture 'original1'
    }
    Note 'before_case' @(Inventory)
    $a=Driver 'consoleA'
    $drivers+=$a
    if ($Case -eq 'simultaneous') {
        $b=Driver 'consoleB'
        $drivers+=$b
    }
    Wait-Driver $a
    Command $a 'display 771000 + 11' '771011'
    @"
set obs 1
generate own_proof = 314159
global PROOF_CONSOLE_A "kept"
display 881000 + 122
"@ | Set-Content -Encoding ASCII "$dir\A-state.do"
    Command $a "do `"$dir\A-state.do`"" '881122'
    Check-Originals 'console-A-active'
    if ($Case -in @('sequential','simultaneous')) {
        if ($Case -eq 'sequential') { $b=Driver 'consoleB'; $drivers+=$b }
        Wait-Driver $b
        Command $b 'display 772000 + 22' '772022'
        Command $a 'display 773000 + 33' '773033'
        Command $a 'display cond(_N == 1 & own_proof[1] == 314159 & "$PROOF_CONSOLE_A" == "kept", 882000 + 233, 0)' '882233'
        Check-Originals 'both-consoles-active'
        End-Driver $b
        Command $a 'display 774000 + 44' '774044'
    }
    End-Driver $a
    Check-Originals 'consoles-ended'
    if ($null -ne $client) {
        Assert (!$client.process.HasExited) 'Existing Automation client stayed alive'
        $heartbeat=Get-Content ($client.folder+'\heartbeat.json') -Raw|ConvertFrom-Json
        Assert ($heartbeat.commands -gt $client.before.commands) 'Existing Automation client continued successful commands'
        Note 'held_client_progress' @{before=$client.before;after=$heartbeat}
    }
    Assert (@(Inventory).Count -eq $originals.Count) 'NO_SPARE_EMBEDDING after console exit'
    Note 'after_case' @(Inventory)
    $passed=$true
    Note 'verdict' @{case=$Case;status='PASS'}
} catch { Note 'verdict' @{case=$Case;status='FAIL';message=$_.Exception.Message;stack=$_.ScriptStackTrace;inventory=@(Inventory)} }
finally {
    foreach ($driver in $drivers) {
        if (!$driver.process.HasExited) { $driver.process.Kill(); $driver.process.WaitForExit() }
        if (Test-Path $driver.folder) { Copy-Item $driver.folder "$results\$run-$($driver.name)" -Recurse -Force }
    }
    if ($null -ne $client -and !$client.process.HasExited) {
        [IO.File]::WriteAllText(($client.folder+'\release'),'release')
        if (!$client.process.WaitForExit(5000)) { $client.process.Kill(); $client.process.WaitForExit() }
        Copy-Item $client.folder "$results\$run-held-client" -Recurse -Force
    }
    foreach ($identity in $owned.Values) {
        $p=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start) { $p.Kill(); $p.WaitForExit() }
    }
    Get-ChildItem "$dir\*.log"|ForEach-Object { Copy-Item $_.FullName "$results\$run-$($_.Name)" }
    Note 'final_inventory' @(Inventory)
}
if (!$passed) { exit 1 }
