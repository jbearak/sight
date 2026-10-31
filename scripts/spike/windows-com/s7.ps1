param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s7.txt" -Force | Out-Null
$ref = New-Object -ComObject stata.StataOLEApp
$ref.DoCommand('sysuse auto, clear') | Out-Null
$rc = $ref.DoCommand('window manage maintitle "Stata - sight spike s7"')
Write-Output "$(Get-Date -Format o) title command rc=$rc"
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$ref.DoCommand('cls') | Out-Null
$ref.UtilShowStata(0) | Out-Null
Write-Output 'Capture the visible window while the reference is held.'
Start-Sleep -Seconds 10
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Stop-Transcript | Out-Null
