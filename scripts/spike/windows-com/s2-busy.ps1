param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s2-busy.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-com-spike-busy'
New-Item -ItemType Directory -Force $dir | Out-Null
Remove-Item "$dir\ready" -ErrorAction SilentlyContinue
@"
sysuse auto, clear
global SIGHT_SPIKE_MARK "busy_s2"
file open ready using "$dir\ready", write replace
file close ready
sleep 10000
"@ | Set-Content -Encoding ASCII "$dir\busy.do"
$p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$dir\busy.do`"" -PassThru
$deadline = (Get-Date).AddSeconds(30)
while (!(Test-Path "$dir\ready") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 10 }
if (!(Test-Path "$dir\ready")) { throw 'ready not found' }
Write-Output "$(Get-Date -Format o) PID=$($p.Id) ready; CreateObject begin"
$ref = New-Object -ComObject stata.StataOLEApp
Write-Output "$(Get-Date -Format o) MacroValue begin"
$value = $ref.MacroValue('SIGHT_SPIKE_MARK')
Write-Output "$(Get-Date -Format o) marker=[$value] free=$($ref.UtilIsStataFree())"
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Start-Sleep -Seconds 2
Write-Output "$(Get-Date -Format o) process alive=$([bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue))"
Stop-Transcript | Out-Null
