const assert = require('assert');
const fs = require('fs');
const path = require('path');
const child = require('child_process');
const vscode = require('vscode');
const scenario = process.env.SIGHT_PANE_SCENARIO;
const result = process.env.SIGHT_PANE_RESULT;
const trace = process.env.SIGHT_PANE_TRACE;
const temp = process.env.SIGHT_CONSOLE_TMPDIR;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(text) { fs.appendFileSync(result, `${new Date().toISOString()} ${text}\n`); }
function messages() {
    try {
        return fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).flatMap(line => {
            try { return [JSON.parse(line)]; } catch { return []; }
        });
    } catch { return []; }
}
async function waitFor(predicate, label, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await sleep(150);
    }
    throw new Error(`Timed out waiting for ${label}`);
}
function stataProcesses() {
    const script = 'Get-Process Stata* -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }';
    return child.execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
        .trim().split(/\s+/).filter(Boolean).map(Number);
}
async function startStata(index) {
    const dir = path.join(temp, `foreign-${index}`);
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, 'stata.log');
    const ready = path.join(dir, 'ready');
    const script = path.join(dir, 'start.do');
    fs.writeFileSync(script, `set more off\nsysuse auto, clear\ncls\nlog using "${log}", text replace\nfile open ready using "${ready}", write replace\nfile close ready\n`);
    const process = child.spawn('C:\\Program Files\\Stata18\\StataMP-64.exe', ['do', script], { stdio: 'ignore' });
    process.unref();
    await waitFor(() => fs.existsSync(ready), 'foreign Stata ready');
    record(`started foreign test Stata ${process.pid}`);
    return { pid: process.pid, log };
}
function readLog(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function sightLogs() {
    const root = path.join(temp, 'sight-console');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).map(name => path.join(root, name, 'out.log')).filter(fs.existsSync);
}
function closePid(pid) {
    child.spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }`]);
}
async function run() {
    const owned = [];
    let terminal;
    try {
        assert.deepStrictEqual(stataProcesses(), [], 'Existing Stata must not be touched');
        const count = scenario.startsWith('two_') ? 2 : ['takeover','send','cancel','real_dialog'].includes(scenario) ? 1 : 0;
        for (let i = 0; i < count; i++) owned.push(await startStata(i));
        const extension = vscode.extensions.getExtension('jbearak.sight');
        assert.ok(extension);
        await extension.activate();
        const config = vscode.workspace.getConfiguration('sight.sendToStata');
        await config.update('target', 'integrated', vscode.ConfigurationTarget.Global);
        await config.update('workingDirectory', 'none', vscode.ConfigurationTarget.Global);
        await config.update('saveBeforeSend', false, vscode.ConfigurationTarget.Global);
        await config.update('advanceCursorOnSend', false, vscode.ConfigurationTarget.Global);
        const content = count ? 'display 553311\n' : 'sysuse auto, clear\ndisplay 553311\n';
        const doc = await vscode.workspace.openTextDocument({ language: 'stata', content });
        const editor = await vscode.window.showTextDocument(doc);
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        await vscode.commands.executeCommand('sight.doLineOrSelection');
        if (!count) {
            editor.selection = new vscode.Selection(1, 0, 1, 0);
            await vscode.commands.executeCommand('sight.doLineOrSelection');
        }
        terminal = await waitFor(() => vscode.window.terminals.find(t => t.name === 'Stata'), 'Stata pane');
        record('pane created');
        if (['basic','dispose','takeover'].includes(scenario)) {
            const logfile = await waitFor(() => sightLogs()[0], 'console log');
            const text = await waitFor(() => {
                const value = readLog(logfile);
                return value.includes('553311') ? value : null;
            }, 'queued send execution');
            assert.strictEqual((text.match(/display 553311/g) || []).length, 1);
            await waitFor(() => messages().some(m => m.kind === 'write' && m.value.includes('553311')), 'pane output');
            terminal.sendText('display 778822');
            await waitFor(() => readLog(logfile).includes('778822'), 'typed command');
            await waitFor(() => messages().some(m => m.kind === 'write' && m.value.includes('778822')), 'typed output');
            record('queued send and terminal.sendText observed in log and pane writes');
            await sleep(8000); // Allows an external screenshot of the real pane.
            const closed = new Promise(resolve => {
                const sub = vscode.window.onDidCloseTerminal(t => { if (t === terminal) { sub.dispose(); resolve(); } });
            });
            if (scenario === 'dispose') terminal.dispose(); else terminal.sendText('exit');
            await Promise.race([closed, sleep(12000).then(() => { throw new Error('pane did not close'); })]);
            await waitFor(() => stataProcesses().length === 0, 'Stata to close');
            record('pane and owned Stata closed');
        } else {
            const warning = await waitFor(() => messages().find(m => m.kind === 'warning'), 'dialog or offer');
            record(`observed warning ${JSON.stringify(warning.value)}`);
            if (scenario === 'real_dialog') {
                await waitFor(() => messages().some(m => m.kind === 'write' && m.value.includes('DialogService: refused')), 'test host modal refusal');
                record('UNVERIFIED: VS Code extension test host refused to show the real modal');
            } else if (scenario === 'cancel') {
                await waitFor(() => messages().filter(m => m.kind === 'warning').length >= 2, 'fallback offer');
                assert.ok(stataProcesses().includes(owned[0].pid));
                record('declined takeover and observed fallback offer');
            } else {
                if (scenario === 'two_always') {
                    await waitFor(() => vscode.workspace.getConfiguration('sight.sendToStata').get('target') === 'external', 'persistent external target', 10000);
                    record('Always persisted external target');
                }
                const target = await waitFor(() => owned.find(item => readLog(item.log).includes('553311')), 'send-to-stata dispatch', 25000);
                const output = readLog(target.log);
                record(`dispatch log=${JSON.stringify(output)}`);
                assert.strictEqual((output.match(/display 553311/g) || []).length, 1);
                if (scenario === 'two_always') {
                    assert.strictEqual(vscode.workspace.getConfiguration('sight.sendToStata').get('target'), 'external');
                }
                record('fallback dispatched exactly once');
            }
        }
        record('PASS');
    } catch (error) {
        record(`FAIL ${error.stack || error}`);
        throw error;
    } finally {
        if (terminal) terminal.dispose();
        for (const item of owned) closePid(item.pid);
        await sleep(1000);
        for (const item of owned) record(`foreign Stata ${item.pid} log: ${JSON.stringify(readLog(item.log))}`);
    }
}
module.exports = { run };
