param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s6-polls.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-com-spike-s6'
New-Item -ItemType Directory -Force $dir | Out-Null
$log = "$dir\break.log"
$ref = New-Object -ComObject stata.StataOLEApp
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$ref.DoCommand('sysuse auto, clear') | Out-Null
$ref.DoCommand('set more off') | Out-Null
$ref.DoCommand("log using `"$log`", text replace") | Out-Null
function State($name) { Write-Output "$(Get-Date -Format o) $name free=$($ref.UtilIsStataFree())" }
State 'idle before break'
$ref.UtilSetStataBreak() | Out-Null
State 'idle after break'
$ref.DoCommandAsync('display 111') | Out-Null
Start-Sleep -Milliseconds 300
State 'after idle-break next command'
$ref.DoCommandAsync('sleep 10000') | Out-Null
Start-Sleep -Milliseconds 500
State 'during sleep'
$ref.DoCommandAsync('display 222') | Out-Null
State 'after queueing display'
$ref.UtilSetStataBreak() | Out-Null
for ($i=0; $i -lt 20; $i++) { State "after busy break $i"; Start-Sleep -Milliseconds 100 }
$ref.DoCommandAsync('display 333') | Out-Null
Start-Sleep -Milliseconds 500
$ref.DoCommand('log close') | Out-Null
Copy-Item $log "$Results\s6.log" -Force
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Stop-Transcript | Out-Null
