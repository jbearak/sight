function Read-SharedText($file) {
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    $reader=New-Object IO.StreamReader($stream)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Fixture($name,[bool]$suspended=$false) {
    $token=$run+'_'+$name
    @"
set more off
log using "$dir\$name.log", text replace
sysuse auto, clear
global SIGHT_FACTORY_MARK "$token"
generate str80 factory_marker = "$token"
replace price = 918273 in 1
datasignature set, reset
file open ready using "$dir\$name.ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII "$dir\$name.do"
    $suspension=$null
    if ($suspended) {
        $suspension=New-Object ProofSuspended('C:\Program Files\Stata18\StataMP-64.exe',"do `"$dir\$name.do`"")
        $p=Get-Process -Id $suspension.Pid
    } else { $p=Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do',"`"$dir\$name.do`"" -PassThru }
    $identity=@{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o')}
    $owned[$p.Id]=$identity
    if (!$suspended) {
        Wait-File "$dir\$name.ready" 30000
        Check-State $identity $token 'original-baseline'
    }
    Note 'manual_original' @{identity=$identity;token=$token;inventory=@(Inventory)}
    return @{identity=$identity;token=$token;process=$p;suspension=$suspension}
}
function Check-Originals($stage) {
    foreach ($original in $originals) {
        if (!$original.expected_exit) { Check-State $original.identity $original.token $stage }
    }
}
function Start-HeldClient($original) {
    $folder="$dir\held-client"
    New-Item -ItemType Directory $folder | Out-Null
    $args=@('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSScriptRoot\proof-client.ps1`"",'-Directory',"`"$folder`"",'-Token',$original.token)
    $p=Start-Process powershell.exe -ArgumentList $args -PassThru
    [void]$p.Handle
    Wait-File "$folder\heartbeat.json" 30000
    return @{process=$p;folder=$folder;before=(Get-Content "$folder\heartbeat.json" -Raw|ConvertFrom-Json)}
}
function Driver($name,$cancel_stage='none',$cancel_count='1') {
    $folder="$dir\$name"
    New-Item -ItemType Directory $folder | Out-Null
    $bun=Join-Path $env:TEMP 'sight-bun\bun-windows-x64\bun.exe'
    $source='C:\sight-target-proof'
    # Copy only harness files; production files stay exactly as staged initially.
    Copy-Item "$PSScriptRoot\proof-driver.ts" "$source\scripts\spike\windows-com\proof-driver.ts" -Force
    $args=@("`"$source\scripts\spike\windows-com\proof-driver.ts`"","`"$folder`"","`"$dir`"",$cancel_stage,$cancel_count)
    $p=Start-Process $bun -ArgumentList $args -WorkingDirectory $source -PassThru -RedirectStandardOutput "$folder\stdout.txt" -RedirectStandardError "$folder\stderr.txt"
    [void]$p.Handle
    Note 'driver_started' @{name=$name;pid=$p.Id;folder=$folder;cancel_stage=$cancel_stage}
    return @{process=$p;folder=$folder;name=$name}
}
function Wait-Driver($driver,[bool]$allow_manual=$false) {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while (!(Test-Path ($driver.folder+'\ready.json')) -and !(Test-Path ($driver.folder+'\done.json')) -and !$driver.process.HasExited -and $clock.ElapsedMilliseconds -lt 45000) { Start-Sleep -Milliseconds 25 }
    if (Test-Path ($driver.folder+'\done.json')) { Note 'early_driver_result' (Get-Content ($driver.folder+'\done.json') -Raw|ConvertFrom-Json) }
    Assert (Test-Path ($driver.folder+'\ready.json')) 'Production console connected successfully'
    Wait-File ($driver.folder+'\ready.json')
    $ready=Get-Content ($driver.folder+'\ready.json') -Raw|ConvertFrom-Json
    $warnings=@($ready.notices|Where-Object { $_ -match "didn't start|couldn't confirm" })
    $identity=@(Inventory|Where-Object { $_.pid -eq $ready.own_pid })
    if ($allow_manual -and $identity.Count -eq 0) {
        $identity=@(Inventory|Where-Object { $_.title.Contains('sight console ') })
        Assert ($warnings.Count -gt 0) 'Unconfirmed identity is explicitly noticed'
    }
    Assert ($identity.Count -eq 1) 'Production title identifies one session Stata'
    $is_manual=$owned.ContainsKey($identity[0].pid)
    if ($allow_manual -and $is_manual) {
        Assert ($warnings.Count -gt 0) 'Manual selection is never silent'
    } else {
        Assert (!$is_manual) 'Console got a distinct new PID/start'
        Assert ($warnings.Count -eq 0) 'No not-own notice for normal owned session'
    }
    Assert (@($ready.notices|Where-Object { $_ -match 'take over' }).Count -eq 0) 'No takeover question'
    $owned[$identity[0].pid]=$identity[0]
    $driver.identity=$identity[0]
    $driver.manual_selected=$is_manual
    Note 'console_ready' @{name=$driver.name;identity=$identity[0];notices=$ready.notices;inventory=@(Inventory)}
}
function Command($driver,$line,$needle) {
    $nonce=[guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText(($driver.folder+'\command.json'),(@{nonce=$nonce;op='submit';line=$line}|ConvertTo-Json -Compress))
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $found=$false
    while ($clock.ElapsedMilliseconds -lt 15000 -and !$driver.process.HasExited) {
        if (Test-Path ($driver.folder+'\output.txt')) {
            try { $found=(Read-SharedText ($driver.folder+'\output.txt')).Contains($needle) } catch [IO.IOException] { }
        }
        if ($found) { break }
        Start-Sleep -Milliseconds 25
    }
    Assert $found ('Console command output: '+$needle)
    Note 'command_pass' @{name=$driver.name;line=$line;needle=$needle}
}
function End-Driver($driver) {
    [IO.File]::WriteAllText(($driver.folder+'\command.json'),(@{nonce=[guid]::NewGuid().ToString('N');op='submit';line='exit, clear'}|ConvertTo-Json -Compress))
    Assert ($driver.process.WaitForExit(15000)) 'Console exits after exit, clear'
    $done=Get-Content ($driver.folder+'\done.json') -Raw|ConvertFrom-Json
    Note 'exit_observation' @{driver_exit=$driver.process.ExitCode;backend_status=$done.status}
    Assert ($done.status -eq 0 -and $driver.process.ExitCode -eq 0) 'Console exit status is zero'
    Assert (!(Same-Process $driver.identity)) 'Only console-owned Stata closes'
    Note 'console_ended' @{name=$driver.name;done=$done;inventory=@(Inventory)}
}
