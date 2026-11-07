param([int]$ProcessId,[string]$Start)
$ErrorActionPreference='Stop'
$p=Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if($p){
    if($p.StartTime.ToUniversalTime().ToString('o') -cne $Start){throw 'Refusing cleanup: PID/start identity differs'}
    $candidate=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ProcessId)
    if($candidate.Name -notlike 'Stata*'){throw 'Refusing cleanup: process is not Stata'}
    $record=@{pid=$ProcessId;start=$Start;command_line=$candidate.CommandLine;reason='Explicit experiment-owned identity from double-cancel transcript'}
    $p.Kill();$p.WaitForExit()
    [IO.File]::WriteAllText("$PSScriptRoot\results\production-proof\explicit-owned-cleanup-$ProcessId.json",($record|ConvertTo-Json))
}
Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'"|Select-Object ProcessId,CreationDate,CommandLine|ConvertTo-Json
