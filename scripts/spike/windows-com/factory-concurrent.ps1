param([string]$Directory, [string]$Token, [string]$Gate)
$ErrorActionPreference = 'Stop'
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Session 0 forbidden' }
[IO.File]::WriteAllText("$Directory\client.prepared",[string]$PID)
while (!(Test-Path $Gate)) { Start-Sleep -Milliseconds 10 }
$start = [DateTime]::UtcNow.ToString('o')
$ref = New-Object -ComObject stata.StataOLEApp
$before = [string]$ref.MacroValue('SIGHT_FACTORY_MARK')
if ($ref.DoCommand("global SIGHT_FACTORY_MARK $Token") -ne 0) { throw 'global failed' }
if ($ref.DoCommand("window manage maintitle `"$Token`"") -ne 0) { throw 'title failed' }
$record = @{pid=$PID;start=$start;returned=[DateTime]::UtcNow.ToString('o');
    before=$before;token=[string]$ref.MacroValue('SIGHT_FACTORY_MARK')}
[IO.File]::WriteAllText("$Directory\client.ready",($record | ConvertTo-Json -Compress))
while (!(Test-Path "$Directory\client.release")) { Start-Sleep -Milliseconds 50 }
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
[IO.File]::WriteAllText("$Directory\client.released",'released')
