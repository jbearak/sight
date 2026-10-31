$ErrorActionPreference = 'Stop'
$bin = Join-Path $env:TEMP 'sight-bun\bun-windows-x64'
Set-Content -Encoding ASCII -Path (Join-Path $bin 'bunx.cmd') -Value '@"%~dp0bun.exe" x %*'
$env:PATH = "$bin;$env:PATH"
Set-Location 'C:\sight-debug'
bunx tsc
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
New-Item -ItemType Directory -Force 'dist\command-database' | Out-Null
Copy-Item -Recurse -Force 'src\command-database\caches' 'dist\command-database\caches'
Set-Location 'C:\sight-debug\client'
bun run vscode:prepublish
exit $LASTEXITCODE
