param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s8-parent.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-com-spike-s8'
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($name in @('user','console_a','console_b')) {
    $ready = "$dir\$name.ready"
    Remove-Item $ready -ErrorAction SilentlyContinue
    @"
sysuse auto, clear
global SIGHT_SPIKE_MARK "$name"
file open ready using "$ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII "$dir\$name.do"
    $p = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$dir\$name.do`"" -PassThru
    Write-Output "$(Get-Date -Format o) started $name PID=$($p.Id)"
    $deadline = (Get-Date).AddSeconds(30)
    while (!(Test-Path $ready) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
    if (!(Test-Path $ready)) { throw "$name not ready" }
}
Write-Output "$(Get-Date -Format o) before workers"
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$workers = @()
foreach ($name in @('console_a','console_b')) {
    $args = @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',
        "`"$PSScriptRoot\s8-worker.ps1`"", '-Marker', $name,
        '-Evidence', "`"$Results\s8-$name.txt`"")
    $workers += Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden
}
$workers | Wait-Process -Timeout 90
Write-Output "$(Get-Date -Format o) after workers"
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
Stop-Transcript | Out-Null
