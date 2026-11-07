param([ValidateSet('basic','readiness','after-drain')][string]$Case='basic',[ValidateRange(1,2)][int]$Count=1,[switch]$VerifyTaskManager)
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
Add-Type -Path "$PSScriptRoot\factory-native.cs"
Add-Type -Path "$PSScriptRoot\proof-native.cs"
Add-Type -Path "$PSScriptRoot\proof-pty.cs"
$run='proof-pty-'+$Case+'-'+$Count+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$results="$PSScriptRoot\results\production-proof"; $dir=Join-Path $env:TEMP $run
New-Item -ItemType Directory -Force $dir,$results|Out-Null
$evidence="$results\$run.jsonl"; $owned=@{}; $originals=@(); $passed=$false; $pty=$null
$old_tmp=$env:SIGHT_CONSOLE_TMPDIR
. "$PSScriptRoot\strategy-common.ps1"
. "$PSScriptRoot\proof-common.ps1"
try {
    Note 'initial_inventory' @(Inventory)
    Assert (@(Inventory).Count -eq 0) 'No unrelated Stata'
    if ($Case -eq 'readiness') { $originals+=Fixture 'original0' $true }
    else { $originals+=Fixture 'original0' }
    $originals+=Fixture 'original1'
    $env:SIGHT_CONSOLE_TMPDIR=$dir
    $bun=Join-Path $env:TEMP 'sight-bun\bun-windows-x64\bun.exe'
    $pty=New-Object ProofPty(('"'+$bun+'" "C:\sight-target-proof\src\cli.ts" console --no-history'),'C:\sight-target-proof')
    Note 'cli_started' @{pid=$pty.Pid;case=$Case;count=$Count;inventory=@(Inventory)}
    $clock=[Diagnostics.Stopwatch]::StartNew()
    if ($Case -eq 'basic') {
        while (!$pty.Snapshot().Contains('. ') -and !$pty.HasExited -and $clock.ElapsedMilliseconds -lt 30000) { Start-Sleep -Milliseconds 25 }
        Assert (!$pty.HasExited -and $clock.ElapsedMilliseconds -lt 30000) 'Real CLI prompt appears'
        $session=@(Inventory|Where-Object { !$owned.ContainsKey($_.pid) })
        Assert ($session.Count -eq 1 -and $session[0].title.Contains('sight console ')) 'Real CLI owns exactly one new titled Stata'
        $owned[$session[0].pid]=$session[0]
        $pty.Send("display 887000 + 77`r")
        $clock.Restart()
        while (!$pty.Snapshot().Contains('887077') -and !$pty.HasExited -and $clock.ElapsedMilliseconds -lt 15000) { Start-Sleep -Milliseconds 25 }
        Assert ($pty.Snapshot().Contains('887077')) 'Real CLI command runs in owned session'
        Check-Originals 'real-cli-active'
        $pty.Send("exit, clear`r")
        Assert ($pty.WaitExit(15000) -and $pty.ExitCode -eq 0) 'Real CLI exit, clear returns zero'
    } else {
        if ($Case -eq 'readiness') {
            while (!$pty.Snapshot().Contains('Waiting for Stata to start') -and !$pty.HasExited -and $clock.ElapsedMilliseconds -lt 30000) { Start-Sleep -Milliseconds 25 }
            Assert ($pty.Snapshot().Contains('Waiting for Stata to start')) 'Actual CLI is waiting on suspended original readiness'
        } else {
            $found=$null
            while (!$pty.HasExited -and $clock.ElapsedMilliseconds -lt 30000) {
                $fresh=@(Get-Process Stata* -ErrorAction SilentlyContinue|Where-Object { !$owned.ContainsKey($_.Id) })
                if ($fresh.Count -gt 0) { $found=$fresh[0]; break }
                Start-Sleep -Milliseconds 5
            }
            Assert ($null -ne $found) 'Observed production session process birth after drain'
            $owned[$found.Id]=@{pid=$found.Id;start=$found.StartTime.ToUniversalTime().ToString('o')}
        }
        Note 'before_ctrl_c' @{stage=$Case;count=$Count;inventory=@(Inventory);elapsed_ms=$clock.ElapsedMilliseconds}
        $pty.Send([string][char]3)
        $clock.Restart()
        while (!$pty.Snapshot().Contains('Stopping after Stata answers') -and !$pty.HasExited -and $clock.ElapsedMilliseconds -lt 3000) { Start-Sleep -Milliseconds 5 }
        Assert ($pty.Snapshot().Contains('Stopping after Stata answers')) 'Actual Ctrl+C invokes graceful production cancellation'
        if ($Count -eq 2) { $pty.Send([string][char]3) }
        if ($Case -eq 'readiness') {
            $originals[0].suspension.Resume()
            Wait-File "$dir\original0.ready" 30000
        }
        Assert ($pty.WaitExit(30000)) 'Real CLI cancellation completes'
        Note 'cancel_exit' @{exit=$pty.ExitCode;count=$Count;stage=$Case;inventory=@(Inventory)}
        Assert ($pty.ExitCode -eq 130) 'Real CLI cancellation status 130'
    }
    Check-Originals 'real-cli-ended'
    $after=@(Inventory)
    if ($VerifyTaskManager) {
        $leftovers=@($after|Where-Object {$_.command_line -match '-Embedding'})
        Assert ($leftovers.Count -eq 1) 'Exactly one known owned leftover for Task Manager check'
        $row=& "$PSScriptRoot\proof-task-manager.ps1" -ProcessId $leftovers[0].pid -Start $leftovers[0].start
        Note 'task_manager_leftover' $row
    }
    if ($Count -eq 1 -or $Case -eq 'basic') { Assert ($after.Count -eq $originals.Count) 'Real CLI leaves no spare or stray Stata' }
    Assert (!$pty.Snapshot().Contains("didn't start") -and !$pty.Snapshot().Contains("couldn't confirm")) 'No unexpected not-own notice'
    Note 'after_case' @($after)
    $passed=$true; Note 'verdict' @{case=$Case;count=$Count;status='PASS'}
} catch { Note 'verdict' @{case=$Case;count=$Count;status='FAIL';message=$_.Exception.Message;stack=$_.ScriptStackTrace;inventory=@(Inventory)} }
finally {
    if ($null -ne $pty) {
        if (!$pty.HasExited) { $pty.Kill() }
        $pty.Save("$results\$run.bin")
        $pty.Dispose()
    }
    foreach ($original in $originals) { if ($original.suspension) { $original.suspension.Dispose() } }
    foreach ($identity in $owned.Values) {
        $p=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToUniversalTime().ToString('o') -ceq $identity.start) { $p.Kill(); $p.WaitForExit() }
    }
    foreach ($extra in @(Inventory)) {
        if ($extra.command_line -match '-Embedding' -and [DateTime]::Parse($extra.start).ToUniversalTime() -gt (Get-Item $dir).CreationTimeUtc) {
            Note 'owned_stray_cleanup' $extra
            $p=Get-Process -Id $extra.pid
            if ($p.StartTime.ToUniversalTime().ToString('o') -ceq $extra.start) { $p.Kill(); $p.WaitForExit() }
        }
    }
    $env:SIGHT_CONSOLE_TMPDIR=$old_tmp
    Note 'final_inventory' @(Inventory)
}
if (!$passed) { exit 1 }
