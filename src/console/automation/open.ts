/**
 * Opens an Automation connection to Stata for a console on Windows:
 * starts the COM bridge, checks it and the registration, and connects
 * to a new Stata of the console's own. Shared by the `sight console`
 * CLI and the VS Code extension's console pane.
 *
 * Before `connect` is sent, failing or cancelling is harmless. After
 * it, ending closes whatever Stata the bridge holds, so a cancel then
 * waits for connect.ts to say whether that Stata is the console's own.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BackendEvents, BackendHandle } from '../backend';
import { AutomationBackend } from './automation-backend';
import { BridgeClient, reply_text } from './bridge';
import { BRIDGE_SCRIPT } from './bridge-script';
import { CANCELLED_STATUS, connect_to_stata, NOT_REGISTERED_MESSAGE } from './connect';
import {
    EXIT_AUTOMATION_NOT_REGISTERED,
    EXIT_AUTOMATION_UNSUPPORTED,
    EXIT_BRIDGE_BLOCKED,
} from './exit-codes';
import { LogTail } from './log-tail';
import { start_powershell_bridge, type ProcessTransport } from './process-transport';

export interface OpenOptions {
    env: NodeJS.ProcessEnv;
    columns: number;
    /** A progress line for the user, before the session starts. */
    say(text: string): void;
    /** Test seam: start the bridge (default: Windows PowerShell). */
    start_bridge?: (script_path: string) => ProcessTransport;
}

export interface AutomationConnection {
    /** Create and start the backend (shows the first prompt). */
    start_backend(events: BackendEvents): BackendHandle;
    /** After the session ends: let the bridge finish, then clean up. */
    finish(): Promise<void>;
}

export type OpenResult =
    | { ok: true; connection: AutomationConnection }
    | { ok: false; exit_code: number; message: string | null };

/**
 * What a cancel did: `killed` ended the bridge at once; `graceful`
 * only asked connect.ts to stop once Stata answers and is identified
 * (a second cancel kills).
 */
export type CancelOutcome = 'killed' | 'graceful';

export interface OpenHandle {
    readonly result: Promise<OpenResult>;
    /**
     * Stop connecting. Before `connect` is sent no Stata can be held,
     * so this ends the bridge at once. While connecting, ending the
     * bridge could leave a Stata starting with nobody holding it, or
     * close a window the user opened by hand in that moment, so the
     * first cancel only marks the console cancelled: connect.ts ends
     * the console once it knows the Stata is its own, and keeps one it
     * didn't start. A second cancel ends the bridge anyway.
     */
    cancel(): CancelOutcome;
}

const STALE_DIR_HOURS = 24;
const BRIDGE_END_GRACE_MS = 3000;
const PREPARE_SLOW_MS = 2000;

export { CANCELLED_STATUS };

function console_root(env: NodeJS.ProcessEnv): string {
    const base = env.SIGHT_CONSOLE_TMPDIR || os.tmpdir();
    return path.join(base, 'sight-console');
}

interface CancelState {
    cancelled: boolean;
    /** Set by connect.ts's stages: no killing at the first cancel. */
    graceful: boolean;
    kill: () => void;
}

export function open_automation_console(options: OpenOptions): OpenHandle {
    const state: CancelState = { cancelled: false, graceful: false, kill: () => undefined };
    const result = open(options, state);
    return {
        result,
        cancel: () => {
            const first = !state.cancelled;
            state.cancelled = true;
            if (first && state.graceful) {
                return 'graceful';
            }
            state.kill();
            return 'killed';
        },
    };
}

async function open(options: OpenOptions, state: CancelState): Promise<OpenResult> {
    const is_cancelled = (): boolean => state.cancelled;
    const root = console_root(options.env);
    const token = crypto.randomBytes(16).toString('hex');
    const dir = path.join(root, token);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
        return { ok: false, exit_code: 1, message: `Error: could not create ${dir}: ${(error as Error).message}` };
    }
    const remove_dir = (): void => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Stata may still hold the log for a moment; the sweep at
            // a later startup removes it.
        }
    };
    const script_path = path.join(dir, 'bridge.ps1');
    fs.writeFileSync(script_path, BRIDGE_SCRIPT, 'utf8');

    const transport = (options.start_bridge ?? start_powershell_bridge)(script_path);
    const bridge = new BridgeClient(transport);
    state.kill = () => transport.kill();
    const wait_for_bridge = async (): Promise<void> => {
        await Promise.race([
            transport.ended,
            new Promise((resolve) => setTimeout(resolve, BRIDGE_END_GRACE_MS)),
        ]);
    };
    const give_up = async (exit_code: number, message: string | null): Promise<OpenResult> => {
        bridge.close();
        await wait_for_bridge();
        transport.kill();
        remove_dir();
        return { ok: false, exit_code, message };
    };

    const self_test = await bridge.request('self_test', { dir });
    if (is_cancelled()) {
        return give_up(CANCELLED_STATUS, null);
    }
    if (!self_test.ok) {
        const reason = transport.fatal() === 'constrained_language'
            ? 'PowerShell runs in Constrained Language Mode here (a security policy), which '
                + 'blocks the COM access sight console needs.'
            : 'PowerShell could not run sight console\'s helper script (a security policy may '
                + 'block it).';
        return give_up(EXIT_BRIDGE_BLOCKED, `Error: ${reason}`);
    }
    // Add-Type runs the C# compiler, which policies sometimes block.
    const prepared = await bridge.request('prepare', {}, {
        slow_ms: PREPARE_SLOW_MS,
        on_slow: () => options.say('Preparing sight console\'s COM helper.'),
    });
    if (is_cancelled()) {
        return give_up(CANCELLED_STATUS, null);
    }
    if (!prepared.ok) {
        return give_up(EXIT_BRIDGE_BLOCKED, 'Error: PowerShell couldn\'t compile sight console\'s '
            + 'COM helper (a security policy may block it).');
    }
    await bridge.request('sweep', { root, max_age_hours: STALE_DIR_HOURS });
    const registered = await bridge.request('registered');
    if (!registered.ok) {
        return give_up(EXIT_AUTOMATION_NOT_REGISTERED,
            `Error: ${NOT_REGISTERED_MESSAGE('StataMP-64.exe (or your edition\'s exe)')}`);
    }
    const supported = await bridge.request('check_registration');
    if (!supported.ok) {
        if (!('failure' in supported) || supported.failure.error !== 'unsupported_registration') {
            return give_up(1, `Error: could not check Stata's Automation registration: `
                + `${reply_text(supported)}`);
        }
        const detail = supported.failure.detail;
        const key = typeof detail.key === 'string' ? detail.key : 'its registry key';
        const value = typeof detail.value === 'string' && detail.value ? ` sets ${detail.value}` : ' couldn\'t be read';
        return give_up(EXIT_AUTOMATION_UNSUPPORTED, `Error: Stata's Automation registration (${key})`
            + `${value}, which sight console doesn't support: it can't make sure an open Stata `
            + 'isn\'t handed to it.');
    }
    if (is_cancelled()) {
        return give_up(CANCELLED_STATUS, null);
    }

    // connect.ts decides about cancelling from here on.
    const connected = await connect_to_stata({
        bridge,
        say: options.say,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        file_size: (file_path) => fs.statSync(file_path).size,
        dir,
        root,
        token,
        columns: options.columns,
        is_cancelled,
        on_stage: (stage) => {
            state.graceful = stage === 'graceful';
        },
    });
    if (!connected.ok) {
        return give_up(connected.exit_code, connected.message);
    }

    return {
        ok: true,
        connection: {
            start_backend: (events) => {
                const log_failed = connected.log_rc !== 0;
                const backend = new AutomationBackend({
                    bridge,
                    log: new LogTail(connected.log_path, connected.start_size),
                    clock: {
                        now: () => Date.now(),
                        set_timeout: (callback, delay_ms) => setTimeout(callback, delay_ms),
                        clear_timeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
                    },
                    events,
                    start_size: connected.start_size,
                    start_lost: log_failed,
                    has_vview: connected.has_vview,
                });
                if (log_failed) {
                    events.on_sight_text('Stata couldn\'t open Sight\'s log, so output shows only '
                        + 'in the Stata window. You can still type commands here, save, and exit.');
                }
                backend.start();
                return backend.handle();
            },
            finish: async () => {
                await wait_for_bridge();
                // A bridge stuck in a COM call (Ctrl+C twice while Stata
                // stops responding) ignores stdin closing.
                transport.kill();
                remove_dir();
            },
        },
    };
}
