param([string]$Scenario = 'basic')
$ErrorActionPreference = 'Stop'
$repo = 'C:\sight-debug'
$extension = "$repo\client\dist\extension.js"
$original = "$repo\client\dist\extension.uninstrumented.js"
if (!(Test-Path $original)) { Copy-Item $extension $original }
$prelude = [IO.File]::ReadAllText("$PSScriptRoot\pane-instrument.cjs")
$source = [IO.File]::ReadAllText($original)
[IO.File]::WriteAllText($extension, $prelude + "`n" + $source, (New-Object Text.UTF8Encoding($false)))
Copy-Item "$PSScriptRoot\pane-*.cjs" "$repo\scripts\spike\windows-com\" -Force
Set-Location $repo
node 'scripts\spike\windows-com\pane-host-runner.cjs' $Scenario
exit $LASTEXITCODE
