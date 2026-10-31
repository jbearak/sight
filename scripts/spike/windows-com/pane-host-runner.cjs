const fs = require('fs');
const os = require('os');
const path = require('path');
const root = 'C:\\sight-debug';
const { runTests } = require(path.join(root, 'node_modules', '@vscode', 'test-electron'));
const scenario = process.argv[2] || 'basic';
const user = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-pane-user-'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-pane-test-'));
const results = 'Y:\\sight\\scripts\\spike\\windows-com\\results';
process.env.SIGHT_CONSOLE_TMPDIR = temp;
process.env.SIGHT_PANE_SCENARIO = scenario;
process.env.SIGHT_PANE_TRACE = path.join(results, `pane-${scenario}-writes.jsonl`);
process.env.SIGHT_PANE_RESULT = path.join(results, `pane-${scenario}-test.txt`);
const answers = { real_dialog: 'real', takeover: 'Take over', send: 'Send code to it instead',
    cancel: 'dismiss', two_session: 'dismiss', two_always: 'dismiss' };
process.env.SIGHT_PANE_MODAL = answers[scenario] || 'dismiss';
process.env.SIGHT_PANE_OFFER = scenario === 'two_session' ? 'This session'
    : scenario === 'two_always' ? 'Always' : 'Cancel';
fs.writeFileSync(process.env.SIGHT_PANE_TRACE, '');
fs.writeFileSync(process.env.SIGHT_PANE_RESULT, '');
runTests({
    vscodeExecutablePath: path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    extensionDevelopmentPath: path.join(root, 'client'),
    extensionTestsPath: path.join(root, 'scripts', 'spike', 'windows-com', 'pane-host-test.cjs'),
    launchArgs: [root, '--user-data-dir', user, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
}).then(() => console.log(`pane ${scenario}: passed`)).catch(error => { console.error(error); process.exitCode = 1; });
