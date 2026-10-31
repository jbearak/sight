param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s3-release-com.txt" -Force | Out-Null
Write-Output "$(Get-Date -Format o) before CreateObject"
$ref = New-Object -ComObject stata.StataOLEApp
$ref.DoCommand('sysuse auto, clear') | Out-Null
$ref.DoCommand('global SIGHT_SPIKE_MARK "com_s3"') | Out-Null
$ref.DoCommand('cls') | Out-Null
$ref.UtilShowStata(0) | Out-Null
Write-Output "$(Get-Date -Format o) marker=[$($ref.MacroValue('SIGHT_SPIKE_MARK'))] free=$($ref.UtilIsStataFree())"
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
Start-Sleep -Seconds 8
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Start-Sleep -Seconds 3
Write-Output "$(Get-Date -Format o) after release"
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
Stop-Transcript | Out-Null
