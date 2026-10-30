param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) {
    throw 'Close existing Stata instances before running this script.'
}
Start-Transcript -Path "$Results\s4-s9-s12-polls.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-com-spike-timing'
New-Item -ItemType Directory -Force $dir | Out-Null
$log = Join-Path $dir 'timing.log'
$ref = New-Object -ComObject stata.StataOLEApp
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$ref.DoCommand('sysuse auto, clear') | Out-Null
$ref.DoCommand('set more off') | Out-Null
$ref.DoCommand("log using `"$log`", text replace") | Out-Null
function PollCommand($label, $command, $timeout_seconds) {
    Write-Output "$(Get-Date -Format o) $label submit [$command]"
    $ref.DoCommandAsync($command) | Out-Null
    $deadline = (Get-Date).AddSeconds($timeout_seconds)
    $free_count = 0
    do {
        $free = $ref.UtilIsStataFree()
        $size = (Get-Item $log).Length
        Write-Output "$(Get-Date -Format o) $label free=$free size=$size"
        if ($free) { $free_count++ } else { $free_count = 0 }
        Start-Sleep -Milliseconds 10
    } while (($free_count -lt 20) -and ((Get-Date) -lt $deadline))
}
PollCommand 'fast' 'display 12345' 10
@'
forvalues i=1/20 {
    display `i'
    sleep 500
}
'@ | Set-Content -Encoding ASCII (Join-Path $dir 'loop.do')
@'
sleep 1000
list in 1/74
'@ | Set-Content -Encoding ASCII (Join-Path $dir 'burst.do')
PollCommand 'loop' ("do `"$dir\loop.do`"") 20
PollCommand 'burst' ("do `"$dir\burst.do`"") 10
$ref.DoCommand('set obs 100000') | Out-Null
PollCommand 'large-list' 'list price in 1/100000' 120
$ref.DoCommand('log close') | Out-Null
Copy-Item $log "$Results\s4-s9-s12.log" -Force
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Start-Sleep -Seconds 2
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
Stop-Transcript | Out-Null
