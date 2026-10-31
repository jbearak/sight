param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; stopping.' }
Start-Transcript -Path "$Results\debug-r1.txt" -Force | Out-Null
$p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -PassThru
$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 100
    $p.Refresh()
} while ($p.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
if ($p.MainWindowHandle -eq 0) { throw 'No Stata window' }
Write-Output "$(Get-Date -Format o) no-argument launch PID=$($p.Id)"
Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Stata*' } |
    Select-Object ProcessId,CommandLine | Format-List
$ref = New-Object -ComObject stata.StataOLEApp
Write-Output "$(Get-Date -Format o) CreateObject returned"
$ref.DoCommand('sysuse auto, clear') | Out-Null
$rc = $ref.DoCommand('window manage maintitle "Sight R1 no-argument"')
Write-Output "$(Get-Date -Format o) title rc=$rc free=$($ref.UtilIsStataFree())"
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$p.Refresh()
Write-Output "$(Get-Date -Format o) close-window result=$($p.CloseMainWindow())"
Start-Sleep -Seconds 2
Write-Output "$(Get-Date -Format o) alive=$([bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue))"
try { Write-Output "$(Get-Date -Format o) free=$($ref.UtilIsStataFree())" } catch {
    Write-Output "$(Get-Date -Format o) COM error=$($_.Exception.Message)"
}
try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref) } catch { }
Stop-Transcript | Out-Null
