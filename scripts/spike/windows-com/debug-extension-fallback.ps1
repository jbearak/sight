Copy-Item 'Y:\sight\src\console\index.ts' 'C:\sight-debug\src\console\index.ts' -Force
Copy-Item 'Y:\sight\scripts\spike\windows-com\debug-extension*.cjs' 'C:\sight-debug\scripts\spike\windows-com\' -Force
$bin = Join-Path $env:TEMP 'sight-bun\bun-windows-x64'
$env:PATH = "$bin;$env:PATH"
Set-Location 'C:\sight-debug\client'
bun run copy-cli
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:SIGHT_DEBUG_EXTENSION_TEST = 'debug-extension-fallback.cjs'
Set-Location 'C:\sight-debug'
node 'scripts\spike\windows-com\debug-extension-runner.cjs'
exit $LASTEXITCODE
