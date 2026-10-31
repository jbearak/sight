param([string]$Results = "$PSScriptRoot\results", [string]$Case = "idle")
$ErrorActionPreference = 'Stop'
Start-Transcript -Path "$Results\s2-$Case.txt" -Force | Out-Null
function Processes($label) {
    Write-Output "$(Get-Date -Format o) $label"
    Get-Process Stata* -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, StartTime, MainWindowTitle |
        Format-List | Out-String | Write-Output
}
Processes 'before contact'
Write-Output "$(Get-Date -Format o) CreateObject begin"
$ref = New-Object -ComObject stata.StataOLEApp
Write-Output "$(Get-Date -Format o) CreateObject returned; MacroValue begin"
$value = $ref.MacroValue('SIGHT_SPIKE_MARK')
Write-Output "$(Get-Date -Format o) MacroValue returned [$value]"
Processes 'before release'
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
$ref = $null
[GC]::Collect()
[GC]::WaitForPendingFinalizers()
Start-Sleep -Seconds 3
Processes 'after release'
Stop-Transcript | Out-Null
