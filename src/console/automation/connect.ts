/**
 * Connecting `sight console` to its own Stata on Windows.
 *
 * The bridge's `connect` takes every open Stata out of COM's hands
 * (their windows keep running with their data) and starts a new Stata
 * for the console; see bridge-script.ts. It never asks to take over an
 * open window. One race remains, accepted: a Stata the user opens by
 * hand while the console connects can become the console's. So after
 * connecting, the console marks the window's title and identifies the
 * Stata it got; if it isn't one COM started for the console, it says
 * so (that Stata closes when the console ends) and keeps it.
 *
 * Releasing a COM reference quits that Stata, so once a reference may
 * exist nothing here ends the console on its own except when that
 * Stata is known to be the console's new one, or is already gone.
 *
 * Sight's consoles take turns through a named mutex the bridge holds
 * from the first listing until this console has identified its Stata.
 */

import type { Bridge, BridgeFailure, BridgeReply } from './bridge';
import { is_server_gone, reply_text } from './bridge';
import { EXIT_AUTOMATION_NOT_REGISTERED } from './exit-codes';

export interface StataProcess {
    pid: number;
    start: string;
    title: string;
    has_window: boolean;
    com_started: boolean;
}

/**
 * `graceful` right before `connect` is sent: from then on, until
 * `connect_to_stata` returns, a cancel must not end the bridge at once
 * (see open.ts). `done` when it returns.
 */
export type ConnectStage = 'graceful' | 'done';

export interface ConnectDeps {
    bridge: Bridge;
    /** Print a line for the user. */
    say(text: string): void;
    sleep(ms: number): Promise<void>;
    file_size(file_path: string): number;
    /** The console's own temp directory, and the root of all of them. */
    dir: string;
    root: string;
    token: string;
    columns: number;
    /** True once the user asked to stop (Ctrl+C, a closed pane). */
    is_cancelled(): boolean;
    on_stage(stage: ConnectStage): void;
}

export type ConnectResult =
    | {
        ok: true; log_path: string; start_size: number; pid: number | null; log_rc: number;
        /** Sight's `vview` is installed (see browse-alias.ts). */
        has_vview: boolean;
    }
    | {
        ok: false; exit_code: number; message: string | null;
        /** Stopped on request; nothing of the user's is held. */
        cancelled?: true;
    };

/** Status when connecting was cancelled (as for SIGINT). */
export const CANCELLED_STATUS = 130;

const WAIT_NOTE_MS = 2000;
const FREE_POLL_MS = 250;
const CONNECT_SLOW_MS = 5000;
const SETUP_SLOW_MS = 10000;
const SETUP_SETTLE_MS = 300;

/** Characters that can't appear in a path inside Stata's quotes. */
const UNSAFE_PATH = /["`'$]|[^\x20-\x7e]/;

export function token8(token: string): string {
    return token.slice(0, 8);
}

function as_processes(value: unknown): StataProcess[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const result: StataProcess[] = [];
    for (const my_item of value) {
        if (typeof my_item !== 'object' || my_item === null) {
            continue;
        }
        const record = my_item as Record<string, unknown>;
        if (typeof record.pid !== 'number') {
            continue;
        }
        result.push({
            pid: record.pid,
            start: typeof record.start === 'string' ? record.start : '',
            title: typeof record.title === 'string' ? record.title : '',
            has_window: record.has_window === true,
            com_started: record.com_started === true,
        });
    }
    return result;
}

/** A process's identity: a pid alone can be reused. */
function identity(pid: number, start: string): string {
    return `${pid}|${start}`;
}

function failure(reply: BridgeReply, what: string): ConnectResult {
    return { ok: false, exit_code: 1, message: `Error: ${what}: ${reply_text(reply)}` };
}

function stray_text(detail: Record<string, unknown>): string {
    return typeof detail.stray_pid === 'number'
        ? ` A Stata started meanwhile (process ${detail.stray_pid}) may still be running `
            + 'without a window; if so, end it in Task Manager.'
        : '';
}

/** The message for a `connect` error reply (no reference is held). */
function connect_failure(failure_reply: BridgeFailure): ConnectResult {
    const detail = failure_reply.detail;
    const hresult = failure_reply.hresult ? ` (${failure_reply.hresult})` : '';
    let message: string;
    switch (failure_reply.error) {
        case 'drain_failed':
            message = 'sight console couldn\'t make sure that no open Stata is handed to it'
                + `${hresult}, so it stopped. Open Stata windows keep running; some may no `
                + 'longer be available to other Automation programs. Close open Stata '
                + 'windows and try again.';
            break;
        case 'drain_limit':
            message = `More than ${typeof detail.count === 'number' ? detail.count : 'a few'} `
                + 'Stata windows are open, so sight console stopped before making sure none '
                + 'of them is handed to it. Close the ones you don\'t need and try again.';
            break;
        case 'drain_launched':
            message = 'A Stata started while sight console was making sure that no open Stata '
                + 'is handed to it, so it stopped (Stata\'s Automation registration may start '
                + `Stata in a way sight console doesn't support).${stray_text(detail)}`;
            break;
        case 'session_failed':
            message = `could not start Stata${hresult}.`
                + (detail.wrap_failed === true
                    ? ' Stata started but couldn\'t be used, so it was closed.'
                    : '')
                + stray_text(detail);
            break;
        case 'native_unavailable':
            message = 'sight console\'s COM helper isn\'t available.';
            break;
        default:
            message = `could not connect to Stata: ${failure_reply.message ?? failure_reply.error}`;
    }
    return { ok: false, exit_code: 1, message: `Error: ${message}` };
}

export async function connect_to_stata(deps: ConnectDeps): Promise<ConnectResult> {
    try {
        return await connect_and_set_up(deps);
    } finally {
        deps.on_stage('done');
    }
}

async function connect_and_set_up(deps: ConnectDeps): Promise<ConnectResult> {
    const bridge = deps.bridge;
    const cancelled: ConnectResult = {
        ok: false, exit_code: CANCELLED_STATUS, message: null, cancelled: true,
    };

    // Step 1: take turns with other consoles.
    let waiting_said = false;
    const listing = await bridge.request('list_stata', { strict: true, acquire: true, root: deps.root }, {
        on_event: () => {
            if (!waiting_said) {
                waiting_said = true;
                deps.say('Another sight console is connecting; waiting. Ctrl+C cancels.');
            }
        },
    });
    // A cancel here (or a forced one later) ended the bridge.
    if (deps.is_cancelled() && (listing.ok || 'bridge_gone' in listing)) {
        return cancelled;
    }
    if (!listing.ok) {
        return failure(listing, 'could not list Stata processes');
    }

    // Step 2: connect to a new Stata. From here a reference may exist.
    deps.on_stage('graceful');
    const connected = await bridge.request('connect', { root: deps.root }, {
        slow_ms: CONNECT_SLOW_MS,
        on_slow: () => deps.say('Waiting for Stata to start. Ctrl+C stops once Stata answers.'),
    });
    if (!connected.ok) {
        if ('failure' in connected) {
            return connect_failure(connected.failure);
        }
        return deps.is_cancelled() ? cancelled : failure(connected, 'could not connect to Stata');
    }
    const before = as_processes(connected.value.before);
    const after = as_processes(connected.value.after);

    // Step 3: nothing is sent until Stata is free. A failure that isn't
    // Stata being gone leaves ownership unknown, and Stata is kept.
    const wait_started = Date.now();
    let wait_said = false;
    let reachable = true;
    for (;;) {
        const reply = await bridge.request('is_free');
        if (!reply.ok) {
            if ('bridge_gone' in reply && deps.is_cancelled()) {
                return cancelled;
            }
            if (is_server_gone(reply) || ('bridge_gone' in reply)) {
                return failure(reply, 'Stata stopped answering');
            }
            reachable = false;
            break;
        }
        if (reply.value.free === true) {
            break;
        }
        if (!wait_said && Date.now() - wait_started >= WAIT_NOTE_MS) {
            wait_said = true;
            deps.say('Waiting for Stata to finish what it\'s doing (in its window). Pressing '
                + 'Ctrl+C twice ends the console and closes Stata, including anything running.');
        }
        await deps.sleep(FREE_POLL_MS);
    }

    // Step 4: mark the window, find it by its title, and identify it.
    const short = token8(deps.token);
    let titled: StataProcess | undefined;
    if (reachable) {
        const marked = await bridge.request('do_sync', {
            cmd: `window manage maintitle "Stata - sight console ${short}"`,
        }, { slow_ms: SETUP_SLOW_MS, on_slow: () => deps.say('Stata is slow to answer; waiting.') });
        if (!marked.ok && 'bridge_gone' in marked) {
            // Nothing holds Stata any more: there's no session to keep.
            return deps.is_cancelled() ? cancelled : failure(marked, 'Stata stopped answering');
        }
        if (marked.ok && marked.value.rc === 0) {
            const found = await bridge.request('title_pid', { token8: short });
            if (!found.ok && 'bridge_gone' in found) {
                return deps.is_cancelled() ? cancelled : failure(found, 'Stata stopped answering');
            }
            if (found.ok && typeof found.value.pid === 'number'
                && typeof found.value.start === 'string') {
                const key = identity(found.value.pid, found.value.start);
                titled = after.find((my_process) => identity(my_process.pid, my_process.start) === key);
            }
        }
    }
    const before_keys = new Set(before.map((my_process) => identity(my_process.pid, my_process.start)));
    // Own: new since before the drain, and started by COM. Such a Stata
    // registers one single-use factory and stays hidden until a client
    // shows it; the console holds that factory's only object, so it
    // can't hold anyone's work, even if another program's activation
    // triggered its launch.
    const own = titled !== undefined && titled.com_started
        && !before_keys.has(identity(titled.pid, titled.start));
    const pid = titled?.pid ?? null;
    if (titled) {
        await bridge.request('write_pid', { dir: deps.dir, pid: titled.pid });
    }
    if (!own) {
        deps.say(titled
            ? `sight console is connected to a Stata it didn't start`
                + `${titled.title ? ` (${titled.title})` : ''}. It closes when the console `
                + 'ends, so save your work in it first if needed.'
            : 'sight console couldn\'t confirm which Stata window it is connected to. That '
                + 'Stata closes when the console ends, so save any work in it first if needed.');
    }
    await bridge.request('release_mutex');
    if (deps.is_cancelled()) {
        if (own) {
            return cancelled;
        }
        deps.say('Ctrl+C came while connecting, but this Stata wasn\'t started by the console, '
            + 'so it was kept; type exit to end the console.');
    }

    // Step 5: setup. A failure keeps the console up without output.
    const short_dir = await bridge.request('short_path', { path: deps.dir });
    const dir_path = short_dir.ok && typeof short_dir.value.path === 'string'
        ? short_dir.value.path
        : deps.dir;
    const log_path = `${dir_path}\\out.log`;
    if (UNSAFE_PATH.test(log_path)) {
        deps.say(`Warning: the log path ${log_path} can't be passed to Stata; set `
            + 'SIGHT_CONSOLE_TMPDIR to a plain ASCII directory. Output will show only in the '
            + 'Stata window.');
        return finish(deps, own, { ok: true, log_path, start_size: 0, pid, log_rc: -1, has_vview: false });
    }
    const linesize = Math.min(255, Math.max(40, deps.columns));
    const setup = [
        'set more off',
        WHICH_VVIEW,
        `set linesize ${linesize}`,
        `log using "${log_path}", text replace name(_sc${short})`,
    ];
    let log_rc = 0;
    let has_vview = false;
    for (const my_command of setup) {
        const reply = await bridge.request('do_sync', { cmd: my_command }, {
            slow_ms: SETUP_SLOW_MS,
            on_slow: () => deps.say('Stata is slow to answer; waiting.'),
        });
        const rc = reply.ok && typeof reply.value.rc === 'number' ? reply.value.rc : -1;
        if (my_command.startsWith('log using')) {
            log_rc = rc;
        } else if (my_command === WHICH_VVIEW) {
            has_vview = rc === 0;
        }
    }

    // Step 6: show the window; tail from where setup left the log.
    await bridge.request('show');
    await deps.sleep(SETUP_SETTLE_MS);
    let start_size = 0;
    try {
        start_size = deps.file_size(log_path);
    } catch {
        start_size = 0;
    }
    return finish(deps, own, { ok: true, log_path, start_size, pid, log_rc, has_vview });
}

/** A cancel during setup ends only the console's own new Stata. */
function finish(deps: ConnectDeps, own: boolean, result: ConnectResult): ConnectResult {
    if (own && deps.is_cancelled()) {
        return { ok: false, exit_code: CANCELLED_STATUS, message: null, cancelled: true };
    }
    return result;
}

/** Fails (r(111)) unless Sight's `vview` is on the ado-path. */
const WHICH_VVIEW = 'quietly which vview';

export const NOT_REGISTERED_MESSAGE = (exe_hint: string): string =>
    'Stata\'s Automation interface isn\'t registered, so sight console can\'t drive Stata. '
    + `Run ${exe_hint} /Register once as administrator (for example, from an administrator `
    + 'command prompt in the Stata folder), then try again.';

export { EXIT_AUTOMATION_NOT_REGISTERED };
