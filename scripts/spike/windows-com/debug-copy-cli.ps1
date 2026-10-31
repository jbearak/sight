$bin = Join-Path $env:TEMP 'sight-bun\bun-windows-x64'
$env:PATH = "$bin;$env:PATH"
Set-Location 'C:\sight-debug\client'
bun run copy-cli
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item 'cli\cli.js' 'cli\cli.js.original' -Force
