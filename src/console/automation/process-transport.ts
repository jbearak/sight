/**
 * Runs the PowerShell bridge as a child process and exchanges JSON
 * lines with it. The child is an ordinary (not detached) child: what
 * ends it is EOF on its stdin, which happens whenever the console
 * exits, or a kill. Only its three stdio pipes are passed, so nothing
 * else holds the write end of its stdin.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import type { BridgeTransport } from './bridge';

export interface ProcessTransport extends BridgeTransport {
    /** A fatal line the script printed before exiting, if any. */
    readonly fatal: () => string | null;
}

export function start_powershell_bridge(script_path: string): ProcessTransport {
    const child: ChildProcessWithoutNullStreams = spawn('powershell.exe', [
        '-Sta', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script_path,
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    let fatal: string | null = null;
    const stderr_parts: string[] = [];
    const listeners: Array<(line: string) => void> = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => stderr_parts.push(chunk));
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
        if (line.startsWith('{"fatal"')) {
            try {
                const parsed = JSON.parse(line) as { fatal?: unknown };
                fatal = typeof parsed.fatal === 'string' ? parsed.fatal : 'unknown';
            } catch {
                fatal = 'unknown';
            }
            return;
        }
        for (const my_listener of listeners) {
            my_listener(line);
        }
    });
    const ended = new Promise<string>((resolve) => {
        let done = false;
        const finish = (): void => {
            if (!done) {
                done = true;
                resolve(stderr_parts.join(''));
            }
        };
        child.on('exit', finish);
        child.on('error', (error) => {
            stderr_parts.push(error.message);
            finish();
        });
    });
    child.stdin.on('error', () => undefined);

    return {
        send: (line) => {
            child.stdin.write(`${line}\n`);
        },
        on_line: (callback) => {
            listeners.push(callback);
        },
        ended,
        close: () => {
            child.stdin.end();
        },
        kill: () => {
            try {
                child.kill();
            } catch {
                // Already gone.
            }
        },
        fatal: () => fatal,
    };
}
