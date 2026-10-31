param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
Start-Transcript -Path "$Results\s5-polls.txt" -Force | Out-Null
if (Get-Process Stata* -ErrorAction SilentlyContinue) {
    throw 'Close existing Stata instances before running this script.'
}
$dir = Join-Path $env:TEMP 'sight-com-spike-s5'
New-Item -ItemType Directory -Force $dir | Out-Null
$log = Join-Path $dir 's5.log'
$ref = New-Object -ComObject stata.StataOLEApp
Write-Output "$(Get-Date -Format o) COM-created; processes:"
Get-Process Stata* | Select-Object Id,ProcessName,MainWindowTitle | Format-List
$ref.DoCommand('sysuse auto, clear')
$ref.DoCommand('set more off')
$ref.DoCommand('set linesize 40')
$ref.DoCommand("log using `"$log`", text replace")
$commands = @(
    '', 'foreach x in 1 2 {', 'display `x''', '}',
    'foreach x in 1 {', 'display no_such_variable', '}',
    'foreach x in 1 {', 'foreach y in 2 {', 'display `x'' + `y''', '}', '}',
    '#delimit ;', 'display 5;', '#delimit cr;',
    'mata', '1+1', 'undefined_function()', 'end',
    'program define spike_program', 'display 42', 'end',
    'spike_program',
    ('display "' + ('abcdefghij' * 10) + '"')
)
foreach ($command in $commands) {
    Write-Output "$(Get-Date -Format o) submit=[$command]"
    try { $ref.DoCommandAsync($command) | Out-Null } catch {
        Write-Output "$(Get-Date -Format o) submit error: $_"
        continue
    }
    $until = (Get-Date).AddSeconds(3)
    do {
        $free = $ref.UtilIsStataFree()
        $length = if (Test-Path $log) { (Get-Item $log).Length } else { -1 }
        Write-Output "$(Get-Date -Format o) free=$free size=$length"
        Start-Sleep -Milliseconds 100
    } while (!$free -and (Get-Date) -lt $until)
    Start-Sleep -Milliseconds 150
}
$ref.DoCommand('log close') | Out-Null
Copy-Item $log "$Results\s5.log" -Force
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Start-Sleep -Seconds 2
Write-Output "$(Get-Date -Format o) after release"
Get-Process Stata* -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List
Stop-Transcript | Out-Null
