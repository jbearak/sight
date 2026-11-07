param([string]$Output = "$PSScriptRoot\results\factory-reservation\inventory.json")
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$all = @(Get-CimInstance Win32_Process -Filter "Name LIKE 'Stata%'" | ForEach-Object {
    $p = Get-Process -Id $_.ProcessId
    @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().ToString('o');
        session=$_.SessionId;command_line=$_.CommandLine}
})
$record = @{utc=[DateTime]::UtcNow.ToString('o');session=(Get-Process -Id $PID).SessionId;stata=$all;
    experiment_helpers=@(Get-CimInstance Win32_Process | Where-Object {
        $_.ProcessId -ne $PID -and ($_.CommandLine -match '(factory-(probe|worker|concurrent|client)|strategy-(probe|client|reserver))' -or
            ($_.Name -eq 'identity-server.exe' -and $_.CommandLine -match 'sight-strategy-'))
    } | Select-Object ProcessId,CreationDate,CommandLine)}
$json = $record | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($Output,$json)
Write-Output $json
if ($all.Count -ne 0 -or $record.experiment_helpers.Count -ne 0) { exit 1 }
