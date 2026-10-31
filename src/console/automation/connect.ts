/**
 * Connecting `sight console` to a Stata GUI instance on Windows.
 *
 * Releasing a COM reference quits that Stata, so the console never
 * takes a reference it doesn't keep, and asks before taking over a
 * Stata the user already has open. One rule governs everything after
 * `CreateObject`: once a reference may exist, no timeout ends the
 * console (ending would close Stata); the user can, with Ctrl+C.
 *
 * Sight's consoles take turns through a named mutex the bridge holds
 * from the first listing until this console's Stata is marked as its
 * own (a `pid` file), so a second console never claims it.
 */

import type { Bridge, BridgeReply } from './bridge';
import { reply_text } from './bridge';
import {
    EXIT_AUTOMATION_NOT_REGISTERED,
    EXIT_SEND_FROM_EDITOR,
    EXIT_SEVERAL_STATA_OPEN,
    EXIT_STATA_HELD_ELSEWHERE,
    EXIT_TAKEOVER_DECLINED,
} from './exit-codes';

export interface StataProcess {
    pid: number;
    start: string;
    title: string;
    has_window: boolean;
    com_started: boolean;
}

export type ConnectAnswer = 'yes' | 'no' | 'send';

export interface ConnectQuestion {
    /** Before connecting, or about a Stata that answered unexpectedly. */
    kind: 'take_over' | 'keep';
    text: string;
    /** Offer "send code from the editor instead" (editors only). */
    allow_send_instead: boolean;
}

export interface ConnectDeps {
    bridge: Bridge;
    /** Ask the user; a dismissed question counts as no. */
    ask(question: ConnectQuestion): Promise<ConnectAnswer>;
    /** Print a line for the user. */
    say(text: string): void;
    sleep(ms: number): Promise<void>;
    file_size(file_path: string): number;
    /** The console's own temp directory, and the root of all of them. */
    dir: string;
    root: string;
    token: string;
    yes: boolean;
    from_editor: boolean;
    columns: number;
}

export type ConnectResult =
    | {
        ok: true; log_path: string; start_size: number; pid: number | null; log_rc: number;
        /** Sight's `vview` is installed (see browse-alias.ts). */
        has_vview: boolean;
    }
    | { ok: false; exit_code: number; message: string | null };

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

function describe_stata(process: StataProcess | undefined): string {
    if (!process || process.title.length === 0) {
        return 'the open Stata';
    }
    return `the open Stata (${process.title})`;
}

/** Fail on an error reply, except for the ones the caller handles. */
function failure(reply: BridgeReply, what: string): ConnectResult {
    return { ok: false, exit_code: 1, message: `Error: ${what}: ${reply_text(reply)}` };
}

export async function connect_to_stata(deps: ConnectDeps): Promise<ConnectResult> {
    const bridge = deps.bridge;

    // Steps 1-3: decide with the user, connect, and re-decide if the
    // set of open Stata windows changed meanwhile.
    let consented: StataProcess | null = null;
    let before: StataProcess[] = [];
    let after: StataProcess[] = [];
    for (;;) {
        let waiting_said = false;
        const listing = await bridge.request('list_stata', { strict: true, acquire: true, root: deps.root }, {
            on_event: () => {
                if (!waiting_said) {
                    waiting_said = true;
                    deps.say('Another sight console is connecting; waiting. Ctrl+C cancels.');
                }
            },
        });
        if (!listing.ok) {
            return failure(listing, 'could not list Stata processes');
        }
        const open = as_processes(listing.value.processes);
        if (open.length >= 2) {
            return {
                ok: false,
                exit_code: EXIT_SEVERAL_STATA_OPEN,
                message: `${open.length} Stata windows are open, and sight console can't choose `
                    + 'among them. Close all but the one to use, or all of them for a new Stata.',
            };
        }
        consented = open[0] ?? null;
        if (consented && !deps.yes) {
            const answer = await deps.ask({
                kind: 'take_over',
                text: `sight console will take over ${describe_stata(consented)}. It closes `
                    + 'when the console ends, so unsaved work in it would be lost then.',
                allow_send_instead: deps.from_editor,
            });
            if (deps.from_editor && answer === 'send') {
                return { ok: false, exit_code: EXIT_SEND_FROM_EDITOR, message: null };
            }
            if (answer !== 'yes') {
                return { ok: false, exit_code: EXIT_TAKEOVER_DECLINED, message: null };
            }
        }
        const expect = consented ? [consented.pid] : [];
        const connected = await bridge.request('connect', { expect, root: deps.root }, {
            slow_ms: CONNECT_SLOW_MS,
            on_slow: () => deps.say('Waiting for Stata to answer. Ctrl+C cancels; if Stata has '
                + 'already answered, that closes it.'),
        });
        if (!connected.ok) {
            return failure(connected, 'could not connect to Stata');
        }
        if (connected.value.listing_changed === true) {
            continue;
        }
        before = as_processes(connected.value.before);
        after = as_processes(connected.value.after);
        break;
    }

    // Step 4: work out which Stata answered.
    const before_pids = new Set(before.map((my_process) => my_process.pid));
    const fresh = after.filter((my_process) => !before_pids.has(my_process.pid));
    const only_fresh = fresh.length === 1 ? fresh[0] : undefined;
    let pid: number | null = null;
    let unconsented: StataProcess | null = null;
    let identified_unknown = false;
    if (!consented && only_fresh && only_fresh.com_started) {
        pid = only_fresh.pid;
    } else if (consented && fresh.length === 0) {
        pid = consented.pid;
    } else if (consented && only_fresh && only_fresh.com_started) {
        return {
            ok: false,
            exit_code: EXIT_STATA_HELD_ELSEWHERE,
            message: 'The open Stata is in use by another program (such as Jupyter); close that '
                + 'program, or that Stata, and try again.',
        };
    } else if (only_fresh) {
        unconsented = only_fresh;
        pid = only_fresh.pid;
    } else {
        identified_unknown = true;
    }
    if (pid !== null) {
        await bridge.request('write_pid', { dir: deps.dir, pid });
    }
    const asked = new Set<number>();
    const ask_after_the_fact = async (process: StataProcess | null): Promise<boolean> => {
        if (process) {
            asked.add(process.pid);
        }
        const what = process
            ? `the Stata you just opened${process.title ? ` (${process.title})` : ''}`
            : 'a Stata it couldn\'t identify';
        const answer = await deps.ask({
            kind: 'keep',
            text: `sight console is now connected to ${what}. Keep using it here? It closes `
                + 'when the console ends; answering no closes it now, so save your work in it '
                + 'first if needed.',
            allow_send_instead: false,
        });
        return answer === 'yes';
    };
    if (unconsented && !deps.yes && !await ask_after_the_fact(unconsented)) {
        return { ok: false, exit_code: 0, message: 'Closed that Stata.' };
    }

    // Step 5: nothing is sent until Stata is free.
    const wait_started = Date.now();
    let wait_said = false;
    for (;;) {
        const reply = await bridge.request('is_free');
        if (!reply.ok) {
            return failure(reply, 'Stata stopped answering');
        }
        if (reply.value.free === true) {
            break;
        }
        if (!wait_said && Date.now() - wait_started >= WAIT_NOTE_MS) {
            wait_said = true;
            deps.say('Waiting for Stata to finish what it\'s doing (in its window). Ctrl+C ends '
                + 'the console and closes Stata, including anything running.');
        }
        await deps.sleep(FREE_POLL_MS);
    }

    // Step 6: mark the window and confirm the PID by its title.
    const short = token8(deps.token);
    const titled = await bridge.request('do_sync', {
        cmd: `window manage maintitle "Stata - sight console ${short}"`,
    }, { slow_ms: SETUP_SLOW_MS, on_slow: () => deps.say('Stata is slow to answer; waiting.') });
    if (titled.ok && titled.value.rc === 0) {
        const found = await bridge.request('title_pid', { token8: short });
        const title_pid = found.ok && typeof found.value.pid === 'number' ? found.value.pid : null;
        if (title_pid !== null && title_pid !== pid) {
            pid = title_pid;
            identified_unknown = false;
            await bridge.request('write_pid', { dir: deps.dir, pid });
            const is_consented = consented !== null && consented.pid === title_pid;
            if (!is_consented && !asked.has(title_pid) && !deps.yes) {
                const known = after.find((my_process) => my_process.pid === title_pid) ?? null;
                if (!await ask_after_the_fact(known)) {
                    return { ok: false, exit_code: 0, message: 'Closed that Stata.' };
                }
            }
        }
    }
    if (pid === null || identified_unknown) {
        // No reliable ownership marker: keep the mutex for the whole
        // session, so another console can't claim this Stata.
        if (!deps.yes && !await ask_after_the_fact(null)) {
            return { ok: false, exit_code: 0, message: 'Closed that Stata.' };
        }
    } else {
        await bridge.request('release_mutex');
    }

    // Step 7: setup. A failure keeps the console up without output.
    const short_dir = await bridge.request('short_path', { path: deps.dir });
    const dir_path = short_dir.ok && typeof short_dir.value.path === 'string'
        ? short_dir.value.path
        : deps.dir;
    const log_path = `${dir_path}\\out.log`;
    if (UNSAFE_PATH.test(log_path)) {
        deps.say(`Warning: the log path ${log_path} can't be passed to Stata; set `
            + 'SIGHT_CONSOLE_TMPDIR to a plain ASCII directory. Output will show only in the '
            + 'Stata window.');
        return { ok: true, log_path, start_size: 0, pid, log_rc: -1, has_vview: false };
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

    // Step 8: show the window; tail from where setup left the log.
    await bridge.request('show');
    await deps.sleep(SETUP_SETTLE_MS);
    let start_size = 0;
    try {
        start_size = deps.file_size(log_path);
    } catch {
        start_size = 0;
    }
    return { ok: true, log_path, start_size, pid, log_rc, has_vview };
}

/** Fails (r(111)) unless Sight's `vview` is on the ado-path. */
const WHICH_VVIEW = 'quietly which vview';

export const NOT_REGISTERED_MESSAGE = (exe_hint: string): string =>
    'Stata\'s Automation interface isn\'t registered, so sight console can\'t drive Stata. '
    + `Run ${exe_hint} /Register once as administrator (for example, from an administrator `
    + 'command prompt in the Stata folder), then try again.';

export { EXIT_AUTOMATION_NOT_REGISTERED };
