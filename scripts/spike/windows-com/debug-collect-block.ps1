param(
    [Parameter(Mandatory = $true)][int]$StataPid,
    [Parameter(Mandatory = $true)][string]$Token8
)
$ErrorActionPreference = 'Stop'
$stata = Get-Process -Id $StataPid -ErrorAction Stop
if ($stata.ProcessName -notlike 'Stata*' -or
    $stata.MainWindowTitle -notlike "*sight console $Token8*") {
    throw 'The PID and console title do not match the test instance.'
}
$root = Join-Path $env:TEMP 'sight-console'
$dirs = @(Get-ChildItem $root -Directory | Where-Object { $_.Name.StartsWith($Token8) })
if ($dirs.Count -ne 1) { throw 'Expected exactly one matching console directory.' }
$log = Join-Path $dirs[0].FullName 'out.log'
$inputStream = [IO.File]::Open($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$outputStream = [IO.File]::Create("$PSScriptRoot\results\debug-block.log")
$inputStream.CopyTo($outputStream)
$outputStream.Dispose()
$inputStream.Dispose()
Write-Output "$(Get-Date -Format o) closing test Stata PID=$StataPid title=$($stata.MainWindowTitle)"
[void]$stata.CloseMainWindow()
