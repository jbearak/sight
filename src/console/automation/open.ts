/**
 * Opens an Automation connection to Stata for a console on Windows:
 * starts the COM bridge, checks it and the registration, and connects
 * (asking before taking over an open Stata). Shared by the `sight
 * console` CLI and the VS Code extension's console pane.
 *
 * Before any COM call, failing is harmless. After it, ending closes
 * that Stata.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BackendEvents, BackendHandle } from '../backend';
import { AutomationBackend } from './automation-backend';
import { BridgeClient } from './bridge';
import { BRIDGE_SCRIPT } from './bridge-script';
import {
    connect_to_stata,
    NOT_REGISTERED_MESSAGE,
    type ConnectAnswer,
    type ConnectQuestion,
} from './connect';
import { EXIT_AUTOMATION_NOT_REGISTERED, EXIT_BRIDGE_BLOCKED } from './exit-codes';
import { LogTail } from './log-tail';
import { start_powershell_bridge } from './process-transport';

export interface OpenOptions {
    env: NodeJS.ProcessEnv;
    yes: boolean;
    /** Offer "send code from the editor instead" at the take-over question. */
    from_editor: boolean;
    columns: number;
    ask(question: ConnectQuestion): Promise<ConnectAnswer>;
    /** A progress line for the user, before the session starts. */
    say(text: string): void;
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

export interface OpenHandle {
    readonly result: Promise<OpenResult>;
    /**
     * Stop connecting. Ends the bridge, which releases any reference
     * already taken (closing that Stata, as the waiting notices say).
     */
    cancel(): void;
}

const STALE_DIR_HOURS = 24;
const BRIDGE_END_GRACE_MS = 3000;
/** Status when connecting was cancelled (as for SIGINT). */
export const CANCELLED_STATUS = 130;

function console_root(env: NodeJS.ProcessEnv): string {
    const base = env.SIGHT_CONSOLE_TMPDIR || os.tmpdir();
    return path.join(base, 'sight-console');
}

export function open_automation_console(options: OpenOptions): OpenHandle {
    let cancel_now: () => void = () => undefined;
    let cancelled = false;
    const result = open(options, (cancel) => {
        cancel_now = cancel;
    }, () => cancelled);
    return {
        result,
        cancel: () => {
            cancelled = true;
            cancel_now();
        },
    };
}

async function open(
    options: OpenOptions,
    set_cancel: (cancel: () => void) => void,
    is_cancelled: () => boolean,
): Promise<OpenResult> {
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

    const transport = start_powershell_bridge(script_path);
    const bridge = new BridgeClient(transport);
    set_cancel(() => transport.kill());
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
    await bridge.request('sweep', { root, max_age_hours: STALE_DIR_HOURS });
    const registered = await bridge.request('registered');
    if (!registered.ok) {
        return give_up(EXIT_AUTOMATION_NOT_REGISTERED,
            `Error: ${NOT_REGISTERED_MESSAGE('StataMP-64.exe (or your edition\'s exe)')}`);
    }

    const connected = await connect_to_stata({
        bridge,
        ask: options.ask,
        say: options.say,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        file_size: (file_path) => fs.statSync(file_path).size,
        dir,
        root,
        token,
        yes: options.yes,
        from_editor: options.from_editor,
        columns: options.columns,
    });
    if (is_cancelled()) {
        return give_up(CANCELLED_STATUS, null);
    }
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
                remove_dir();
            },
        },
    };
}
