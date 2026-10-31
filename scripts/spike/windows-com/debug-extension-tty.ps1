$cli = 'C:\sight-debug\client\cli\cli.js'
Copy-Item ($cli + '.original') $cli -Force
$source = [IO.File]::ReadAllText($cli)
$prefix = @'
require('fs').writeFileSync('C:/sight-debug/tty.json', JSON.stringify({stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,stderr:process.stderr.isTTY,argv:process.argv,execPath:process.execPath}));
'@
[IO.File]::WriteAllText($cli, $source.Replace("#!/usr/bin/env node`n", "#!/usr/bin/env node`n" + $prefix + "`n"), (New-Object Text.UTF8Encoding($false)))
Copy-Item 'Y:\sight\scripts\spike\windows-com\debug-extension.cjs' 'C:\sight-debug\scripts\spike\windows-com\debug-extension.cjs' -Force
Set-Location 'C:\sight-debug'
node 'scripts\spike\windows-com\debug-extension-runner.cjs'
exit $LASTEXITCODE
