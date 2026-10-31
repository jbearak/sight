param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
Start-Transcript -Path "$Results\debug-stata-close.txt" -Force | Out-Null
$deadline = (Get-Date).AddSeconds(30)
do {
    $stata = @(Get-Process Stata* -ErrorAction SilentlyContinue)
    if ($stata.Count -eq 1 -and $stata[0].MainWindowTitle -like '*sight console*') { break }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if ($stata.Count -ne 1 -or $stata[0].MainWindowTitle -notlike '*sight console*') { throw 'Expected one owned Stata' }
$console = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'bun.exe' -and $_.CommandLine -like '*sight-debug\src\cli.ts*console*' })
if ($console.Count -ne 1) { throw "Expected one console, found $($console.Count)" }
$consolePid = $console[0].ProcessId
Write-Output "$(Get-Date -Format o) close Stata PID=$($stata[0].Id), console PID=$consolePid"
[void]$stata[0].CloseMainWindow()
for ($i=0; $i -lt 40; $i++) {
    $alive = [bool](Get-Process -Id $consolePid -ErrorAction SilentlyContinue)
    Write-Output "$(Get-Date -Format o) console alive=$alive"
    if (!$alive) { break }
    Start-Sleep -Milliseconds 250
}
Stop-Transcript | Out-Null
