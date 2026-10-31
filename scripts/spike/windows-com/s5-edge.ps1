param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Stata is already open.' }
Start-Transcript -Path "$Results\s5-edge-polls.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-com-spike-s5-edge'
New-Item -ItemType Directory -Force $dir | Out-Null
$log = "$dir\edge.log"
@'
#delimit ;
display 321;
#delimit cr
'@ | Set-Content -Encoding ASCII "$dir\include.do"
$ref = New-Object -ComObject stata.StataOLEApp
Get-Process Stata* | Select-Object Id,MainWindowTitle | Format-List
$ref.DoCommand('sysuse auto, clear') | Out-Null
$ref.DoCommand('set more off') | Out-Null
$ref.DoCommand("log using `"$log`", text replace") | Out-Null
$commands = @("include `"$dir\include.do`"", 'mata', 'if (1) {', '', '1+1', '}', 'end', 'python', 'if True:', '    print(123)', '', 'end')
foreach ($command in $commands) {
    Write-Output "$(Get-Date -Format o) submit=[$command]"
    $ref.DoCommandAsync($command) | Out-Null
    Start-Sleep -Milliseconds 350
    Write-Output "$(Get-Date -Format o) free=$($ref.UtilIsStataFree()) size=$((Get-Item $log).Length)"
}
foreach ($command in @('_request(foo)', 'input x', 'pause on', 'pause', 'set more on', 'list')) {
    Write-Output "$(Get-Date -Format o) submit=[$command]"
    $ref.DoCommandAsync($command) | Out-Null
    Start-Sleep -Milliseconds 600
    $free = $ref.UtilIsStataFree()
    Write-Output "$(Get-Date -Format o) free=$free size=$((Get-Item $log).Length)"
    if (!$free) {
        $ref.UtilSetStataBreak() | Out-Null
        Start-Sleep -Milliseconds 500
        Write-Output "$(Get-Date -Format o) after break free=$($ref.UtilIsStataFree())"
    }
}
$ref.DoCommand('log close') | Out-Null
Copy-Item $log "$Results\s5-edge.log" -Force
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ref)
Stop-Transcript | Out-Null
