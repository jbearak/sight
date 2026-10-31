const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = process.env.SIGHT_DEBUG_RESULT;
function record(text) { fs.appendFileSync(result, `${new Date().toISOString()} ${text}\n`); }
async function waitFor(predicate, label, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
}
function logFiles() {
    const root = path.join(process.env.SIGHT_CONSOLE_TMPDIR, 'sight-console');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).map(name => path.join(root, name, 'out.log'))
        .filter(name => fs.existsSync(name));
}
async function run() {
    let terminal;
    let closedStatus;
    const closeListener = vscode.window.onDidCloseTerminal(t => {
        if (t.name === 'Stata') closedStatus = t.exitStatus || { closed: true };
    });
    try {
        record('starting integrated extension test');
        const extension = vscode.extensions.getExtension('jbearak.sight');
        assert.ok(extension);
        await extension.activate();
        const config = vscode.workspace.getConfiguration('sight.sendToStata');
        await config.update('target', 'integrated', vscode.ConfigurationTarget.Global);
        await config.update('workingDirectory', 'none', vscode.ConfigurationTarget.Global);
        await config.update('saveBeforeSend', false, vscode.ConfigurationTarget.Global);
        await config.update('advanceCursorOnSend', false, vscode.ConfigurationTarget.Global);
        const document = await vscode.workspace.openTextDocument({ language: 'stata',
            content: 'sysuse auto, clear\ndisplay 553311\n' });
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        await vscode.commands.executeCommand('sight.doLineOrSelection');
        editor.selection = new vscode.Selection(1, 0, 1, 0);
        await vscode.commands.executeCommand('sight.doLineOrSelection');
        terminal = await waitFor(() => vscode.window.terminals.find(t => t.name === 'Stata'), 'Stata terminal');
        record(`terminal created; process=${await terminal.processId}`);
        const logfile = await waitFor(() => {
            if (closedStatus) throw new Error(`Terminal closed: ${JSON.stringify(closedStatus)}`);
            return logFiles()[0];
        }, 'Stata log');
        record(`log=${logfile}`);
        const text = await waitFor(() => {
            try {
                const content = fs.readFileSync(logfile, 'utf8');
                return content.includes('553311') ? content : null;
            } catch { return null; }
        }, 'queued display');
        record(`log contents=${JSON.stringify(text)}`);
        assert.match(text, /1978 automobile data/);
        assert.strictEqual((text.match(/display 553311/g) || []).length, 1);
        const closed = new Promise(resolve => {
            const disposable = vscode.window.onDidCloseTerminal(t => {
                if (t === terminal) { disposable.dispose(); resolve(t.exitStatus); }
            });
        });
        terminal.dispose();
        const status = await Promise.race([closed, sleep(10000).then(() => { throw new Error('terminal did not close'); })]);
        record(`terminal closed: ${JSON.stringify(status)}`);
        record('PASS integrated queue and terminal disposal');
    } catch (error) {
        record(`FAIL ${error.stack || error}`);
        if (terminal) terminal.dispose();
        throw error;
    } finally {
        closeListener.dispose();
    }
}
module.exports = { run };
