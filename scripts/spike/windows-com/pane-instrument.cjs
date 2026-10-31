// Loaded only in the isolated test extension before its bundle.
const probeVscode = require('vscode');
const probeFs = require('fs');
const probeLog = process.env.SIGHT_PANE_TRACE;
function probeRecord(kind, value) {
    probeFs.appendFileSync(probeLog, JSON.stringify({ at: Date.now(), kind, value }) + '\n');
}
const probeChild = require('child_process');
const probeSpawn = probeChild.spawn;
probeChild.spawn = function(file, args, ...rest) {
    const result = probeSpawn.call(this, file, args, ...rest);
    if (/send-to-stata\.exe/i.test(file)) {
        probeRecord('send_spawn', { file, args });
        result.stderr.on('data', data => probeRecord('send_stderr', data.toString()));
        result.on('close', code => probeRecord('send_exit', code));
        result.on('error', error => probeRecord('send_error', String(error)));
    }
    return result;
};
const probeCreate = probeVscode.window.createTerminal.bind(probeVscode.window);
probeVscode.window.createTerminal = function(...args) {
    const options = args[0];
    if (options && options.pty) {
        probeRecord('pty', options.name);
        options.pty.onDidWrite(text => probeRecord('write', text));
    }
    return probeCreate(...args);
};
const probeWarning = probeVscode.window.showWarningMessage.bind(probeVscode.window);
probeVscode.window.showWarningMessage = function(message, ...args) {
    probeRecord('warning', { message, args });
    if (process.env.SIGHT_PANE_MODAL === 'real' && args[0] && args[0].modal) {
        return probeWarning(message, ...args);
    }
    const modal = args[0] && args[0].modal;
    if (modal && process.env.SIGHT_PANE_SCENARIO === 'send_focus') {
        const script = `
            Add-Type 'using System; using System.Runtime.InteropServices;
                public class SightFocus {
                    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
                    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
                }';
            $p = Get-Process Code | Where-Object {
                $_.MainWindowTitle -like '*Extension Development Host*'
            } | Select-Object -First 1;
            if (!$p) { throw 'Test Code window missing' }
            [void][SightFocus]::SetForegroundWindow($p.MainWindowHandle);
            if ([SightFocus]::GetForegroundWindow() -ne $p.MainWindowHandle) {
                throw 'Test Code window did not become foreground'
            }
            $p.MainWindowHandle
        `;
        probeRecord('focus_code', probeChild.execFileSync(
            'powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }
        ));
    }
    const answer = modal ? process.env.SIGHT_PANE_MODAL : process.env.SIGHT_PANE_OFFER;
    return Promise.resolve(answer === 'dismiss' ? undefined : answer);
};
const probeInformation = probeVscode.window.showInformationMessage.bind(probeVscode.window);
probeVscode.window.showInformationMessage = function(message, ...args) {
    probeRecord('information', { message, args });
    if (String(message).includes('requires downloading a helper')) return Promise.resolve('Download');
    if (String(message).includes('newer version')) return Promise.resolve('Skip');
    return probeInformation(message, ...args);
};
