const assert = require('assert');
const fs = require('fs');
const vscode = require('vscode');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = process.env.SIGHT_DEBUG_RESULT;
function record(text) { fs.appendFileSync(result, `${new Date().toISOString()} ${text}\n`); }
async function run() {
    const offers = [];
    const original = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = async (message, ...choices) => {
        offers.push({ message, choices });
        record(`offer ${JSON.stringify({ message, choices })}`);
        return 'Cancel';
    };
    try {
        const extension = vscode.extensions.getExtension('jbearak.sight');
        assert.ok(extension);
        await extension.activate();
        const config = vscode.workspace.getConfiguration('sight.sendToStata');
        await config.update('target', 'integrated', vscode.ConfigurationTarget.Global);
        await config.update('workingDirectory', 'none', vscode.ConfigurationTarget.Global);
        await config.update('saveBeforeSend', false, vscode.ConfigurationTarget.Global);
        const doc = await vscode.workspace.openTextDocument({ language: 'stata', content: 'display 553311\n' });
        await vscode.window.showTextDocument(doc);
        const closed = new Promise(resolve => {
            const disposable = vscode.window.onDidCloseTerminal(terminal => {
                if (terminal.name === 'Stata') { disposable.dispose(); resolve(terminal.exitStatus); }
            });
        });
        await vscode.commands.executeCommand('sight.doLineOrSelection');
        const status = await Promise.race([closed, sleep(30000).then(() => { throw new Error('No terminal close'); })]);
        record(`exit ${JSON.stringify(status)}`);
        assert.strictEqual(status.code, 86);
        const deadline = Date.now() + 10000;
        while (!offers.length && Date.now() < deadline) await sleep(100);
        assert.strictEqual(offers.length, 1);
        assert.match(offers[0].message, /terminal/i);
        record('PASS unsupported terminal fallback offered and cancelled');
    } catch (error) { record(`FAIL ${error.stack || error}`); throw error; }
    finally { vscode.window.showWarningMessage = original; }
}
module.exports = { run };
