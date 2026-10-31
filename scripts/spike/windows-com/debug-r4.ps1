param([string]$Results = "$PSScriptRoot\results")
$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; stopping.' }
Start-Transcript -Path "$Results\debug-r4.txt" -Force | Out-Null
$dir = Join-Path $env:TEMP 'sight-debug-r4'
New-Item -ItemType Directory -Force $dir | Out-Null
@"
sysuse auto, clear
global SIGHT_SPIKE_MARK "r4_owned"
"@ | Set-Content -Encoding ASCII "$dir\start.do"
$stata = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList 'do', "`"$dir\start.do`"" -PassThru
Start-Sleep -Seconds 3
$evidence = "$dir\helper.txt"
Remove-Item $evidence -ErrorAction SilentlyContinue
$args = @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',
    "`"$PSScriptRoot\s3-keeper.ps1`"",'-StataPid',$stata.Id,'-Marker','r4_owned','-Evidence',"`"$evidence`"")
$helper = Start-Process powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(20)
$ready = $false
while (!$ready -and (Get-Date) -lt $deadline) {
    try { $ready = (Test-Path $evidence) -and (Select-String -Path $evidence -SimpleMatch 'holding reference' -Quiet) } catch { }
    if (!$ready) { Start-Sleep -Milliseconds 100 }
}
if (!$ready) {
    throw 'Helper did not establish the reference.'
}
Write-Output "$(Get-Date -Format o) Stata PID=$($stata.Id), helper PID=$($helper.Id); killing helper"
Stop-Process -Id $helper.Id
for ($i=0; $i -lt 120; $i++) {
    $alive = [bool](Get-Process -Id $stata.Id -ErrorAction SilentlyContinue)
    Write-Output "$(Get-Date -Format o) Stata alive=$alive"
    if (!$alive) { break }
    Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $stata.Id -ErrorAction SilentlyContinue) {
    Write-Output "$(Get-Date -Format o) cleaning up with CloseMainWindow"
    [void]$stata.CloseMainWindow()
}
Copy-Item $evidence "$Results\debug-r4-helper.txt" -Force
Stop-Transcript | Out-Null
