/**
 * `sight console` on Windows: start the COM bridge, connect to Stata
 * (asking before taking over an open one), then run the interactive
 * front end on the Automation backend.
 *
 * Before any COM call, failing is harmless. After it, the console ends
 * only when the user, Stata, or the bridge ends it, and ending closes
 * that Stata.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import type { ColorOutputMode } from '../output-colorizer';
import { AutomationBackend } from './automation-backend';
import { BridgeClient } from './bridge';
import { BRIDGE_SCRIPT } from './bridge-script';
import { connect_to_stata, NOT_REGISTERED_MESSAGE } from './connect';
import {
    EXIT_AUTOMATION_NOT_REGISTERED,
    EXIT_BRIDGE_BLOCKED,
    EXIT_TERMINAL_UNSUPPORTED,
} from './exit-codes';
import { LogTail } from './log-tail';
import { start_powershell_bridge } from './process-transport';

export interface AutomationConsoleOptions {
    color_output: ColorOutputMode;
    history: boolean;
    yes: boolean;
    env: NodeJS.ProcessEnv;
}

const STALE_DIR_HOURS = 24;
const SIGINT_STATUS = 130;

/** Raw mode is required; check it before touching Stata (code 86). */
function terminal_supports_raw_mode(): boolean {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return false;
    }
    try {
        process.stdin.setRawMode(true);
        process.stdin.setRawMode(false);
        return true;
    } catch {
        return false;
    }
}

function console_root(env: NodeJS.ProcessEnv): string {
    const base = env.SIGHT_CONSOLE_TMPDIR || os.tmpdir();
    return path.join(base, 'sight-console');
}

function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
        rl.on('SIGINT', () => {
            rl.close();
            process.emit('SIGINT');
        });
    });
}

export async function run_automation_console(options: AutomationConsoleOptions): Promise<number> {
    if (!terminal_supports_raw_mode()) {
        console.error('Error: sight console needs a terminal that supports raw input.');
        return EXIT_TERMINAL_UNSUPPORTED;
    }

    const root = console_root(options.env);
    const token = crypto.randomBytes(16).toString('hex');
    const dir = path.join(root, token);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
        console.error(`Error: could not create ${dir}: ${(error as Error).message}`);
        return 1;
    }
    const script_path = path.join(dir, 'bridge.ps1');
    fs.writeFileSync(script_path, BRIDGE_SCRIPT, 'utf8');

    const transport = start_powershell_bridge(script_path);
    const bridge = new BridgeClient(transport);
    const remove_dir = (): void => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Stata may still hold the log for a moment; the sweep at
            // a later startup removes it.
        }
    };

    // Ctrl+C before the interactive front end starts: end the bridge,
    // which releases any reference (closing that Stata, as the
    // waiting notices say).
    let cancelled = false;
    const on_sigint = (): void => {
        cancelled = true;
        transport.kill();
    };
    process.on('SIGINT', on_sigint);
    const stop_listening = (): void => {
        process.off('SIGINT', on_sigint);
    };

    const self_test = await bridge.request('self_test', { dir });
    if (!self_test.ok) {
        stop_listening();
        transport.kill();
        const fatal = transport.fatal();
        const reason = fatal === 'constrained_language'
            ? 'PowerShell runs in Constrained Language Mode here (a security policy), which '
                + 'blocks the COM access sight console needs.'
            : 'PowerShell could not run sight console\'s helper script (a security policy may '
                + 'block it).';
        console.error(`Error: ${reason}`);
        remove_dir();
        return EXIT_BRIDGE_BLOCKED;
    }
    await bridge.request('sweep', { root, max_age_hours: STALE_DIR_HOURS });
    const registered = await bridge.request('registered');
    if (!registered.ok) {
        stop_listening();
        bridge.close();
        console.error(`Error: ${NOT_REGISTERED_MESSAGE('StataMP-64.exe (or your edition\'s exe)')}`);
        remove_dir();
        return EXIT_AUTOMATION_NOT_REGISTERED;
    }

    const result = await connect_to_stata({
        bridge,
        ask,
        say: (text) => console.error(text),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        file_size: (file_path) => fs.statSync(file_path).size,
        dir,
        root,
        token,
        yes: options.yes,
        from_editor: options.env.SIGHT_CONSOLE_FROM_EDITOR === '1',
        columns: process.stdout.columns || 80,
    });
    stop_listening();
    if (cancelled) {
        remove_dir();
        return SIGINT_STATUS;
    }
    if (!result.ok) {
        bridge.close();
        await Promise.race([transport.ended, new Promise((resolve) => setTimeout(resolve, 3000))]);
        transport.kill();
        if (result.message) {
            console.error(result.message);
        }
        remove_dir();
        return result.exit_code;
    }

    const ready_file = options.env.SIGHT_CONSOLE_READY_FILE;
    const { run_interactive } = await import('../interactive');
    let log_rc_reported = false;
    const status = await run_interactive({
        color_output: options.color_output,
        history: options.history,
        start_backend: (events) => {
            const backend = new AutomationBackend({
                bridge,
                log: new LogTail(result.log_path, result.start_size),
                clock: {
                    now: () => Date.now(),
                    set_timeout: (callback, delay_ms) => setTimeout(callback, delay_ms),
                    clear_timeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
                },
                events,
                start_size: result.start_size,
                start_lost: result.log_rc !== 0,
            });
            if (result.log_rc !== 0 && !log_rc_reported) {
                log_rc_reported = true;
                events.on_sight_text('Stata couldn\'t open Sight\'s log, so output shows only in '
                    + 'the Stata window. You can still type commands here, save, and exit.');
            }
            backend.start();
            if (ready_file) {
                try {
                    fs.writeFileSync(ready_file, String(process.pid), 'utf8');
                } catch {
                    // The editor falls back to its own handling.
                }
            }
            return backend.handle();
        },
    });
    await Promise.race([transport.ended, new Promise((resolve) => setTimeout(resolve, 3000))]);
    remove_dir();
    return status;
}
