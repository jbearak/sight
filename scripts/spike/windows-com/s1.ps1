param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Results | Out-Null
Start-Transcript -Path "$Results\s1.txt" -Force | Out-Null
function Processes($label) {
    Write-Output "$(Get-Date -Format o) $label"
    Get-Process Stata* -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, StartTime, MainWindowTitle |
        Format-List | Out-String | Write-Output
}
$exe = 'C:\Program Files\Stata18\StataMP-64.exe'
$dir = Join-Path $env:TEMP 'sight-com-spike-s1'
New-Item -ItemType Directory -Force $dir | Out-Null
$startup = Join-Path $dir 'start.do'
@"
sysuse auto, clear
global SIGHT_SPIKE_MARK "direct_s1"
file open ready using "$dir\ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII $startup
Processes 'before direct launch'
if (Get-Process Stata* -ErrorAction SilentlyContinue) {
    throw 'Existing Stata detected; stop before COM contact.'
}
Remove-Item "$dir\ready" -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -ArgumentList @('do', ('"' + $startup + '"')) -PassThru
Write-Output "launched PID $($p.Id)"
$deadline = (Get-Date).AddSeconds(30)
while (!(Test-Path "$dir\ready") -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
}
if (!(Test-Path "$dir\ready")) { throw 'Startup did not signal ready.' }
Processes 'direct ready; capture screenshot now'
Start-Sleep -Seconds 8
$refs = @()
for ($i = 1; $i -le 2; $i++) {
    Write-Output "$(Get-Date -Format o) CreateObject $i begin"
    $ref = New-Object -ComObject stata.StataOLEApp
    $refs += $ref
    Write-Output "$(Get-Date -Format o) MacroValue $i = [$($ref.MacroValue('SIGHT_SPIKE_MARK'))]"
    Processes "after CreateObject $i"
}
foreach ($ref in $refs) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
}
$refs = @()
[GC]::Collect()
[GC]::WaitForPendingFinalizers()
Start-Sleep -Seconds 3
Processes 'after release'
Stop-Transcript | Out-Null
