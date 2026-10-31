$ErrorActionPreference = 'Stop'
if (Get-Process Stata* -ErrorAction SilentlyContinue) { throw 'Existing Stata; refusing to touch it' }
$repo = 'C:\sight-debug'
$dir = Join-Path $env:TEMP 'sight-pane-dialog'
New-Item -ItemType Directory -Force $dir | Out-Null
$ready = "$dir\ready"
Remove-Item $ready -ErrorAction SilentlyContinue
$do = "$dir\start.do"
@"
set more off
sysuse auto, clear
cls
file open ready using "$ready", write replace
file close ready
"@ | Set-Content -Encoding ASCII $do
$stata = Start-Process 'C:\Program Files\Stata18\StataMP-64.exe' -ArgumentList @('do', $do) -PassThru
Set-Content "$dir\stata.pid" $stata.Id
for ($i = 0; $i -lt 120 -and !(Test-Path $ready); $i++) { Start-Sleep -Milliseconds 250 }
if (!(Test-Path $ready)) { throw 'Stata did not start' }
$original = "$repo\client\dist\extension.uninstrumented.js"
$prefix = [IO.File]::ReadAllText("$PSScriptRoot\pane-instrument.cjs")
$trigger = @'
setTimeout(async () => {
    try {
        const config = probeVscode.workspace.getConfiguration('sight.sendToStata');
        await config.update('target', 'integrated', true);
        await config.update('saveBeforeSend', false, true);
        const doc = await probeVscode.workspace.openTextDocument({language:'stata', content:'display 553311\n'});
        await probeVscode.window.showTextDocument(doc);
        await probeVscode.commands.executeCommand('sight.doLineOrSelection');
    } catch (error) { probeRecord('trigger_error', String(error)); }
}, 4000);
'@
[IO.File]::WriteAllText("$repo\client\dist\extension.js", $prefix + "`n" + $trigger + "`n" + [IO.File]::ReadAllText($original), (New-Object Text.UTF8Encoding($false)))
$env:SIGHT_PANE_MODAL = 'real'
$env:SIGHT_PANE_OFFER = 'Cancel'
$env:SIGHT_PANE_TRACE = 'Y:\sight\scripts\spike\windows-com\results\pane-dialog-writes.jsonl'
$env:SIGHT_CONSOLE_TMPDIR = $dir
[IO.File]::WriteAllText($env:SIGHT_PANE_TRACE, '')
$exe = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
$code = Start-Process $exe -ArgumentList @('--new-window', "--user-data-dir=$dir\user", "--extensions-dir=$dir\extensions", '--disable-extensions', '--skip-welcome', '--skip-release-notes', "--extensionDevelopmentPath=$repo\client", $repo) -PassThru
Set-Content "$dir\code.pid" $code.Id
Write-Output "Test-owned Stata=$($stata.Id); Code=$($code.Id); trace=$env:SIGHT_PANE_TRACE"
