const fs = require('fs');
const os = require('os');
const path = require('path');
const root = 'C:\\sight-debug';
const { runTests } = require(path.join(root, 'node_modules', '@vscode', 'test-electron'));
const user = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-vscode-debug-'));
const consoleTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-console-debug-'));
process.env.SIGHT_CONSOLE_TMPDIR = consoleTmp;
process.env.SIGHT_DEBUG_RESULT = 'Y:\\sight\\scripts\\spike\\windows-com\\results\\debug-extension.txt';
fs.writeFileSync(process.env.SIGHT_DEBUG_RESULT, '');
runTests({
    vscodeExecutablePath: path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    extensionDevelopmentPath: path.join(root, 'client'),
    extensionTestsPath: path.join(root, 'scripts', 'spike', 'windows-com', process.env.SIGHT_DEBUG_EXTENSION_TEST || 'debug-extension.cjs'),
    launchArgs: [root, '--user-data-dir', user, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
}).then(() => console.log('VS Code integration passed')).catch(error => { console.error(error); process.exitCode = 1; });
