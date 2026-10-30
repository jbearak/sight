param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
Start-Transcript -Path "$Results\s13.txt" -Force | Out-Null
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
Write-Output "$(Get-Date -Format o) CreateObject begin"
$ref = New-Object -ComObject stata.StataOLEApp
Write-Output "$(Get-Date -Format o) MacroValue begin"
$value = $ref.MacroValue('SIGHT_SPIKE_MARK')
Write-Output "$(Get-Date -Format o) marker=[$value]"
for ($i=0; $i -lt 5; $i++) {
    Write-Output "$(Get-Date -Format o) free call begin"
    $free = $ref.UtilIsStataFree()
    Write-Output "$(Get-Date -Format o) free=$free"
}
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Start-Sleep -Seconds 2
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
Stop-Transcript | Out-Null
