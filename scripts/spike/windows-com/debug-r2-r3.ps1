param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; stopping.' }
Start-Transcript -Path "$Results\debug-r2-r3.txt" -Force | Out-Null
$p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -PassThru
Start-Sleep -Seconds 3
Write-Output "$(Get-Date -Format o) before COM PID=$($p.Id)"
$first = New-Object -ComObject stata.StataOLEApp
$first.DoCommand('sysuse auto, clear') | Out-Null
$first.DoCommand('global SIGHT_SPIKE_MARK "r2_first"') | Out-Null
$first.DoCommand('replace price = price + 1 in 1') | Out-Null
Write-Output "$(Get-Date -Format o) first marker=[$($first.MacroValue('SIGHT_SPIKE_MARK'))]"
$second = New-Object -ComObject stata.StataOLEApp
Write-Output "$(Get-Date -Format o) second marker=[$($second.MacroValue('SIGHT_SPIKE_MARK'))]"
$second.DoCommand('sysuse auto, clear') | Out-Null
Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Stata*' } |
    Select-Object ProcessId,CommandLine | Format-List
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($first)
Start-Sleep -Seconds 2
Write-Output "$(Get-Date -Format o) changed-data PID=$($p.Id) alive=$([bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue))"
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($second)
Start-Sleep -Seconds 2
Write-Output "$(Get-Date -Format o) remaining processes"
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
Stop-Transcript | Out-Null
