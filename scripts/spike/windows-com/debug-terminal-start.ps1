$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; stopping.' }
$bun = Join-Path $env:TEMP 'sight-bun\bun-windows-x64\bun.exe'
$args = @('-w','new','new-tab','--title','SightDebugWT','--suppressApplicationTitle',
    "`"$bun`"", 'C:\sight-debug\src\cli.ts', 'console', '--yes')
Start-Process wt.exe -ArgumentList $args
Write-Output "$(Get-Date -Format o) started dedicated Windows Terminal"
