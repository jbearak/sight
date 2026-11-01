import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StataCommand, VALID_COMMANDS } from './index.js';
import { detect_stata_cli, clear_stata_cli_cache } from './stata-cli-detector.js';
import { wrap_path_for_stata_terminal } from './terminal.js';
import { schedule_temp_file_cleanup } from './temp-file.js';
import { send_to_stata_windows } from './windows-sender.js';
import {
    ask_with_dialog,
    create_console_pane,
    load_console_module,
    type ConsolePane,
    type ConsoleAnswer,
    type ConsoleQuestion,
    type EditorConsoleModule,
    type EditorConsolePty,
    type PaneEnd,
} from './console-pane.js';
import {
    ConsoleExit,
    ConsoleQueueTimings,
    ConsoleTerminalQueue,
    OFFER_CHOICE_ALWAYS,
    OFFER_CHOICE_CANCEL,
    OFFER_CHOICE_SESSION,
    OfferAnswer,
    PendingSend,
} from './console-terminal-core.js';
import type {
    PerchApiErrorCode,
    PerchApiV1,
    PerchCreateOptions,
    PerchSessionInfo,
} from './perch-api.js';
import {
    build_perch_launch,
    candidate_sessions,
    console_mode_of,
    PERCH_CONSOLE_EDITOR,
    PERCH_CONSOLE_STATA,
    PERCH_END_FILE,
    PERCH_EXTENSION_ID,
    PERCH_READY_FILE,
    PerchConnection,
    type PerchConsoleMode,
    type PerchTracked,
} from './perch-core.js';

const PROFILE_ID = 'sight.stataTerminal';
const TERMINAL_NAME = 'Stata';
const TERMINAL_READY_TIMEOUT_MS = 5000;
// Best-effort readiness heuristic for commands that must be TYPED into the
// terminal (a reused terminal, a rapid second send, or a user-opened
// profile terminal). VS Code exposes no signal for when an arbitrary REPL
// has finished initializing its tty, so we wait for the process to exist
// plus a short grace. The primary first-send path avoids this race
// entirely by baking the command into the launch args (see
// create_stata_terminal), where Stata runs it itself after init.
const TERMINAL_STARTUP_GRACE_MS = 150;

/**
 * Set of terminals created via our Stata terminal profile.
 * Used for profile-match identification (not name-match).
 */
const the_profile_terminals = new Set<vscode.Terminal>();

/**
 * The most recently activated terminal from our profile.
 */
let last_active_profile_terminal: vscode.Terminal | null = null;

/**
 * Tracks profile terminals in most-recently-activated order (last = most recent).
 * Used to pick the correct fallback when the active terminal is closed.
 */
const the_activation_order: vscode.Terminal[] = [];

/**
 * Flag set before provideTerminalProfile returns, cleared by
 * onDidOpenTerminal. Used to correlate the opened terminal with
 * our profile (VS Code does not expose a terminal-to-profile link).
 */
let pending_profile_creation_count = 0;

/**
 * In-flight creation promise, used to prevent concurrent calls from
 * creating multiple terminals.
 */
let creation_in_flight: Promise<vscode.Terminal> | null = null;
const the_terminal_ready_promises = new Map<vscode.Terminal, Promise<void>>();

// The Stata terminal is an extension terminal (a pane) running `sight
// console` inside the extension process (console-pane.ts): always on
// local Windows, and on macOS and Linux when the sight-pty helper for
// this platform is present and sight.sendToStata.console isn't off.
// Otherwise it runs the Stata CLI directly.
const TARGET_SETTING_SECTION = 'sight.sendToStata';
const TARGET_SETTING_KEY = 'target';
const CONSOLE_SETTING_KEY = 'console';
const PTY_HELPER_NAME = 'sight-pty';

let extension_context: vscode.ExtensionContext | null = null;

/** What happened to a pane before its terminal was known. */
interface PaneState {
    terminal: vscode.Terminal | null;
    is_ready: boolean;
    end: PaneEnd | null;
    /** Console Stata through sight-pty (macOS, Linux). */
    is_pty: boolean;
}

interface PaneEntry extends PaneState {
    pane: ConsolePane;
}

/** Panes from the profile list, until onDidOpenTerminal claims them. */
const the_pending_profile_panes = new Map<vscode.Pseudoterminal, PaneEntry>();
const the_console_panes = new Map<vscode.Terminal, ConsolePane>();

// Test hooks: a fake console runtime and question answers.
let console_module_override: (() => Promise<EditorConsoleModule>) | null = null;
let console_ask_override:
    ((question: ConsoleQuestion) => Promise<ConsoleAnswer>) | null = null;

let console_queue: ConsoleTerminalQueue<vscode.Terminal> | null = null;
let console_queue_timings: Partial<ConsoleQueueTimings> = {};
let pending_status_item: vscode.StatusBarItem | null = null;

/**
 * Set when the user chose send-to-stata for this session (This
 * session, or the console's `s` answer): `integrated` then resolves to
 * the Stata app. Holds the target setting as it was then, so a change
 * to the setting clears it but the extension's own Always write
 * doesn't.
 */
let session_override_snapshot: string | null = null;

/**
 * Set when the sight-pty helper failed this session: Stata panes then
 * run the Stata CLI directly until VS Code reloads the window.
 */
let helper_fallback_reason: string | null = null;
let console_stata_cli: Promise<string | null> | null = null;
let helper_path_override: string | null | undefined = undefined;

/** VS Code runs here on Windows, not connected to a remote host. */
export function is_local_windows(): boolean {
    return process.platform === 'win32' && !vscode.env.remoteName;
}

/** The user chose send-to-stata instead of the console this session. */
export function is_console_session_override_set(): boolean {
    return session_override_snapshot !== null;
}

function snapshot_target_setting(): string {
    const my_config = vscode.workspace.getConfiguration(
        TARGET_SETTING_SECTION
    );
    const inspected = my_config.inspect?.(TARGET_SETTING_KEY);
    return JSON.stringify([
        inspected?.globalValue,
        inspected?.workspaceValue,
        inspected?.workspaceFolderValue,
        my_config.get(TARGET_SETTING_KEY),
    ]);
}

function set_session_override(): void {
    session_override_snapshot = snapshot_target_setting();
}

function handle_target_setting_changed(): void {
    if (
        session_override_snapshot !== null
        && snapshot_target_setting() !== session_override_snapshot
    ) {
        session_override_snapshot = null;
    }
}

function get_effective_target_setting(): string | undefined {
    return vscode.workspace
        .getConfiguration(TARGET_SETTING_SECTION)
        .get<string>(TARGET_SETTING_KEY);
}

function is_console_setting_off(): boolean {
    return vscode.workspace
        .getConfiguration(TARGET_SETTING_SECTION)
        .get<string>(CONSOLE_SETTING_KEY, 'auto') === 'off';
}

/**
 * The sight-pty helper for this platform and architecture, made
 * executable if packaging lost the mode, or null if there is none.
 */
function find_pty_helper(): string | null {
    if (helper_path_override !== undefined) {
        return helper_path_override;
    }
    if (!extension_context) {
        return null;
    }
    const helper_path = path.join(
        extension_context.extensionPath,
        'pty-helper',
        'bin',
        `${process.platform}-${process.arch}`,
        PTY_HELPER_NAME
    );
    if (!fs.existsSync(helper_path)) {
        return null;
    }
    try {
        fs.accessSync(helper_path, fs.constants.X_OK);
        return helper_path;
    } catch {
        // Fall through to restore the mode.
    }
    try {
        fs.chmodSync(helper_path, 0o755);
        fs.accessSync(helper_path, fs.constants.X_OK);
        return helper_path;
    } catch {
        return null;
    }
}

type PaneKind = 'automation' | 'pty';

/** Whether a new Stata terminal is a console pane, and which kind. */
function console_pane_kind(): PaneKind | null {
    if (is_local_windows()) {
        return 'automation';
    }
    if (
        (process.platform !== 'darwin' && process.platform !== 'linux')
        || helper_fallback_reason !== null
        || is_console_setting_off()
    ) {
        return null;
    }
    return find_pty_helper() ? 'pty' : null;
}

/** One detection shared by concurrent sends, so they keep order. */
function detect_console_stata_cli(): Promise<string | null> {
    console_stata_cli ??= detect_stata_cli();
    return console_stata_cli;
}

const STATA_CLI_NOT_FOUND_MESSAGE =
    'Stata CLI not found. Ensure stata-mp, stata-se, ' +
    'or stata is on your PATH, or configure ' +
    'sight.sendToStata.stataApp.';

/**
 * What a new Stata terminal runs: a console pane (with the helper and
 * Stata for a `pty` pane) or, for null, the Stata CLI directly.
 * Throws if a `pty` pane can't find Stata.
 */
async function resolve_new_pane(): Promise<
    { kind: PaneKind; pty?: EditorConsolePty } | null
> {
    const kind = console_pane_kind();
    if (kind !== 'pty') {
        return kind === null ? null : { kind };
    }
    const helper_path = find_pty_helper();
    // The helper runs Stata with execvp and the extension's PATH,
    // where the detector found it, so a bare name is enough.
    const stata_path = await detect_console_stata_cli();
    if (!stata_path) {
        throw new Error(STATA_CLI_NOT_FOUND_MESSAGE);
    }
    if (!helper_path || console_pane_kind() !== 'pty') {
        return null;
    }
    return { kind, pty: { helper_path, stata_path } };
}

function load_module(): Promise<EditorConsoleModule> {
    if (console_module_override) {
        return console_module_override();
    }
    if (!extension_context) {
        return Promise.reject(new Error(
            'The Sight extension is not activated; cannot start sight '
            + 'console.'
        ));
    }
    return load_console_module(extension_context.extensionPath);
}

function create_pane_entry(pty?: EditorConsolePty): PaneEntry {
    const state: PaneState = {
        terminal: null,
        is_ready: false,
        end: null,
        is_pty: pty !== undefined,
    };
    const pane = create_console_pane({
        load_module,
        ask: question => (console_ask_override ?? ask_with_dialog)(question),
        working_directory:
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        pty,
        on_ready: () => {
            state.is_ready = true;
            if (state.terminal) {
                get_console_queue().mark_ready(state.terminal);
            }
        },
        on_end: end => {
            state.end = end;
            if (state.terminal) {
                handle_pane_end(state.terminal, end, state);
            }
        },
    });
    return Object.assign(state, { pane });
}

/** Start managing a pane's terminal, replaying what already happened. */
function adopt_pane(terminal: vscode.Terminal, entry: PaneEntry): void {
    entry.terminal = terminal;
    the_profile_terminals.add(terminal);
    track_activation(terminal);
    last_active_profile_terminal = terminal;
    the_console_panes.set(terminal, entry.pane);
    get_console_queue().track(terminal);
    if (entry.end) {
        handle_pane_end(terminal, entry.end, entry);
    } else if (entry.is_ready) {
        get_console_queue().mark_ready(terminal);
    }
}

function handle_pane_end(
    terminal: vscode.Terminal,
    end: PaneEnd,
    state: PaneState
): void {
    if (
        state.is_pty
        && end.reason === 'process'
        && end.helper_failed
        && !state.is_ready
    ) {
        fall_back_from_helper(terminal);
        return;
    }
    const backend = state.is_pty ? 'pty' : 'automation';
    const exit: ConsoleExit = end.reason === 'user'
        ? { reason: 'user', code: undefined, backend }
        : { reason: 'process', code: end.code, backend };
    // A finished console no longer takes sends; the next send starts
    // a new pane.
    forget_console_terminal(terminal);
    get_console_queue().handle_closed(terminal, exit).catch(my_error => {
        vscode.window.showErrorMessage(
            `Error: ${my_error instanceof Error ? my_error.message : my_error}`
        );
    });
}

/**
 * The sight-pty helper couldn't run (for example, the system blocked
 * it): use the Stata CLI for the rest of the session, and send what
 * waited for the pane there, in order.
 */
function fall_back_from_helper(terminal: vscode.Terminal): void {
    const the_sends = get_console_queue().take_pending(terminal);
    forget_console_terminal(terminal);
    note_helper_fallback();
    void resend_without_console(the_sends);
}

/** Use the Stata CLI for new Stata panes until the window reloads. */
function note_helper_fallback(): void {
    if (helper_fallback_reason !== null) {
        return;
    }
    helper_fallback_reason = 'helper failed';
    vscode.window.showWarningMessage(
        'Sight couldn\'t start sight console (its pseudo-terminal '
        + 'helper failed; the Stata pane says why). Stata panes run '
        + 'the Stata CLI directly until the window reloads.'
    );
}

async function resend_without_console(
    the_sends: PendingSend[]
): Promise<void> {
    for (let i = 0; i < the_sends.length; i++) {
        const my_send = the_sends[i];
        if (!my_send) {
            continue;
        }
        try {
            const is_queued = await send_to_stata_terminal(
                my_send.command, my_send.temp_file_path
            );
            // A queued send's temp file belongs to its queue.
            if (!is_queued) {
                schedule_temp_file_cleanup(my_send.temp_file_path);
            }
        } catch (my_error) {
            vscode.window.showErrorMessage(
                `Error: ${my_error instanceof Error
                    ? my_error.message : my_error}`
            );
            for (const my_rest of the_sends.slice(i)) {
                fs.promises.unlink(my_rest.temp_file_path).catch(() => {});
            }
            return;
        }
    }
}

function forget_console_terminal(terminal: vscode.Terminal): void {
    the_console_panes.delete(terminal);
    the_profile_terminals.delete(terminal);
    the_terminal_ready_promises.delete(terminal);
    const idx = the_activation_order.indexOf(terminal);
    if (idx !== -1) {
        the_activation_order.splice(idx, 1);
    }
    if (last_active_profile_terminal === terminal) {
        last_active_profile_terminal = the_activation_order.at(-1) ?? null;
    }
}

function update_pending_status(): void {
    if (!pending_status_item) {
        return;
    }
    const count = (console_queue?.pending_count() ?? 0)
        + (perch_queue?.pending_count() ?? 0);
    if (count === 0) {
        pending_status_item.hide();
        return;
    }
    pending_status_item.text = count === 1
        ? '$(clock) Stata: 1 send waiting'
        : `$(clock) Stata: ${count} sends waiting`;
    pending_status_item.show();
}

function to_offer_answer(choice: string | undefined): OfferAnswer {
    if (
        choice === OFFER_CHOICE_SESSION
        || choice === OFFER_CHOICE_ALWAYS
        || choice === OFFER_CHOICE_CANCEL
    ) {
        return choice;
    }
    return undefined;
}

function type_send(terminal: vscode.Terminal, send: PendingSend): void {
    const pane = the_console_panes.get(terminal);
    if (!pane) {
        throw new Error('The Stata pane has closed.');
    }
    const escaped_path = wrap_path_for_stata_terminal(send.temp_file_path);
    pane.type_line(`${send.command} ${escaped_path}`);
}

/** What both queues (panes, and Perch sessions) need from VS Code. */
function queue_host_without_typing() {
    return {
        dispatch_to_app: async (send: PendingSend) => {
            if (!extension_context) {
                throw new Error('The Sight extension is not activated.');
            }
            await send_to_stata_windows(
                send.command,
                send.temp_file_path,
                extension_context
            );
        },
        show_offer: async (message: string) => to_offer_answer(
            await vscode.window.showWarningMessage(
                message,
                OFFER_CHOICE_SESSION,
                OFFER_CHOICE_ALWAYS,
                OFFER_CHOICE_CANCEL
            )
        ),
        show_notice: (message: string) => {
            vscode.window.showInformationMessage(message);
        },
        show_error: (message: string) => {
            vscode.window.showErrorMessage(message);
        },
        schedule_cleanup: (file_path: string) => {
            schedule_temp_file_cleanup(file_path);
        },
        delete_file: (file_path: string) => {
            fs.promises.unlink(file_path).catch(() => {});
        },
        is_fallback_in_effect: () => {
            return is_console_session_override_set()
                || get_effective_target_setting() === 'external';
        },
        set_session_override,
        write_always: async () => {
            await vscode.workspace
                .getConfiguration(TARGET_SETTING_SECTION)
                .update(
                    TARGET_SETTING_KEY,
                    'external',
                    vscode.ConfigurationTarget.Global
                );
            return get_effective_target_setting() === 'external';
        },
        on_pending_count_changed: update_pending_status,
    };
}

function get_console_queue(): ConsoleTerminalQueue<vscode.Terminal> {
    console_queue ??= new ConsoleTerminalQueue<vscode.Terminal>(
        { ...queue_host_without_typing(), type_send },
        console_queue_timings
    );
    return console_queue;
}

// ---- Perch sessions ----
//
// In a remote window with Perch installed on the remote host (see
// perch-core.ts), a new Stata console runs in a Perch session, which
// outlives a closed window or a dropped connection: the editor console
// (console-runtime/tty.js) under the extension host's Node, or, with
// sight.sendToStata.console off or after a helper failure, the Stata
// CLI. Sends go through Perch (`send`), never `terminal.sendText`,
// which reaches nothing while the session is detached.
//
// A session's terminal closing is a detach: the session stays this
// window's console. It ends on Perch's onDidEndSession (or when the
// console reports its end, or Perch says it is gone).

/** How often to look for the console's ready file, then its end file. */
const PERCH_READY_POLL_MS = 100;
const PERCH_END_POLL_MS = 1000;
const PERCH_NEW_CONSOLE_LABEL = '$(add) Start a new Stata console';

interface PerchConsole {
    id: string;
    api: PerchApiV1;
    mode: PerchConsoleMode;
    /** The session directory. */
    dir: string;
    /** Its Perch terminal in this window, if one is open. */
    terminal: vscode.Terminal | null;
    /** Sends to the session, one after another. */
    chain: Promise<void>;
    is_ready: boolean;
    ended: boolean;
}

/** Sessions this window sends to, by ID. */
const the_perch_consoles = new Map<string, PerchConsole>();
const the_perch_terminals = new Map<vscode.Terminal, string>();
/** This window's sessions whose terminal closed, oldest first. */
const the_detached_perch_ids: string[] = [];
let perch_queue: ConsoleTerminalQueue<string> | null = null;
let perch_connection: PerchConnection<PerchApiV1, vscode.Terminal> | null =
    null;
/** A new session (or a picked one) on its way; null if cancelled. */
let perch_creation_in_flight: Promise<string | null> | null = null;
let log_line: (message: string) => void = () => {};

function describe_error(my_error: unknown): string {
    return my_error instanceof Error ? my_error.message : String(my_error);
}

/**
 * The window is remote and Sight runs in its remote (workspace)
 * extension host, next to Perch. A user who set Sight's
 * remote.extensionKind to UI runs it locally, where Perch's API can't
 * be reached. SIGHT_TEST_PERCH_REMOTE=1 treats a local window as remote
 * in extension tests only (the end-to-end test of this path).
 */
function is_remote_workspace(): boolean {
    if (!extension_context) {
        return false;
    }
    if (
        process.env.SIGHT_TEST_PERCH_REMOTE === '1'
        && extension_context.extensionMode === vscode.ExtensionMode.Test
    ) {
        return true;
    }
    return Boolean(vscode.env.remoteName)
        // `extension` is absent in some test hosts.
        && extension_context.extension?.extensionKind
            === vscode.ExtensionKind.Workspace;
}

/** Perch's API, if `getApi` gave one with the members Sight uses. */
function to_perch_api(value: unknown): PerchApiV1 | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const the_members = value as Record<string, unknown>;
    const the_functions = [
        'available', 'prepareLaunch', 'createSession', 'listSessions',
        'terminals', 'attach', 'send', 'onDidAttach', 'onDidEndSession',
    ];
    if (
        the_members.version !== 1
        || the_functions.some(
            my_name => typeof the_members[my_name] !== 'function'
        )
    ) {
        return undefined;
    }
    // Checked above: version 1 with every member Sight calls.
    return value as PerchApiV1;
}

function perch_error_code(my_error: unknown): PerchApiErrorCode | undefined {
    if (typeof my_error !== 'object' || my_error === null) {
        return undefined;
    }
    const code = (my_error as { code?: unknown }).code;
    return code === 'queue_full' || code === 'outcome_unknown'
        || code === 'no_session' || code === 'unavailable'
        ? code
        : undefined;
}

function create_perch_connection():
    PerchConnection<PerchApiV1, vscode.Terminal> {
    return new PerchConnection<PerchApiV1, vscode.Terminal>({
        is_remote_workspace,
        find_extension: () => vscode.extensions.getExtension(
            PERCH_EXTENSION_ID
        ),
        to_api: to_perch_api,
        log: message => log_line(message),
        on_connected: handle_perch_connected,
        on_attach: (session, terminal) => {
            const api = perch_connection?.api;
            if (api) {
                bind_perch_terminal(api, session, terminal);
            }
        },
        on_end: session => {
            end_perch_console(session.id, {
                reason: 'process',
                code: session.exit?.code,
                backend: 'pty',
            });
        },
    });
}

/**
 * Perch's API for a new console, or undefined to start one as before.
 * Without Perch only synchronous checks run.
 */
async function perch_for_new_console(): Promise<PerchApiV1 | undefined> {
    if (!perch_connection?.may_use_perch()) {
        return undefined;
    }
    await perch_connection.settled();
    return perch_connection.api;
}

function handle_perch_connected(
    api: PerchApiV1 | undefined,
    tracked: PerchTracked<vscode.Terminal>
): void {
    if (api === undefined) {
        // Perch went away (or was never here): new consoles start as
        // before, and its sessions are no longer sent to.
        for (const my_id of [...the_perch_consoles.keys()]) {
            end_perch_console(my_id, {
                reason: 'process', code: undefined, backend: 'pty',
            });
        }
        return;
    }
    // Sessions with a Perch terminal in this window (restored after a
    // reload, say) are this window's consoles again.
    for (const [my_id, my_terminal] of tracked.terminals) {
        const session = tracked.sessions.get(my_id);
        if (session) {
            bind_perch_terminal(api, session, my_terminal);
        }
    }
}

function get_perch_queue(): ConsoleTerminalQueue<string> {
    perch_queue ??= new ConsoleTerminalQueue<string>(
        { ...queue_host_without_typing(), type_send: type_perch_send },
        console_queue_timings
    );
    return perch_queue;
}

/** Start tracking a session, with the send its command line carries. */
function track_perch_console(
    api: PerchApiV1,
    session: PerchSessionInfo,
    baked?: PendingSend
): PerchConsole {
    const existing = the_perch_consoles.get(session.id);
    if (existing) {
        // Perch's onDidAttach can come before createSession resolves.
        if (baked) {
            get_perch_queue().carry(existing.id, baked);
        }
        return existing;
    }
    const record: PerchConsole = {
        id: session.id,
        api,
        mode: console_mode_of(session),
        dir: session.dir,
        terminal: null,
        chain: Promise.resolve(),
        is_ready: false,
        ended: false,
    };
    the_perch_consoles.set(record.id, record);
    get_perch_queue().track(record.id, baked ? [baked] : []);
    void watch_perch_console(
        record, session.degraded.includes('directory-recreated')
    );
    return record;
}

function mark_perch_ready(record: PerchConsole): void {
    if (record.ended || record.is_ready) {
        return;
    }
    record.is_ready = true;
    get_perch_queue().mark_ready(record.id);
}

function file_exists(file_path: string): Promise<boolean> {
    return fs.promises.access(file_path).then(() => true, () => false);
}

/**
 * Wait for a session to take sends. The editor console writes a ready
 * file in the session directory at its first prompt (and an end file
 * if it ends on its own); the Stata CLI gets the same startup grace as
 * a terminal.
 */
async function watch_perch_console(
    record: PerchConsole,
    is_directory_recreated: boolean
): Promise<void> {
    if (record.mode === PERCH_CONSOLE_STATA) {
        await delay(TERMINAL_STARTUP_GRACE_MS);
        mark_perch_ready(record);
        return;
    }
    if (is_directory_recreated) {
        // The console's files are gone; it was running already.
        mark_perch_ready(record);
    }
    const ready_path = path.join(record.dir, PERCH_READY_FILE);
    const end_path = path.join(record.dir, PERCH_END_FILE);
    while (!record.ended) {
        if (await file_exists(end_path)) {
            await handle_perch_console_end(record, end_path);
            return;
        }
        if (!record.is_ready && await file_exists(ready_path)) {
            mark_perch_ready(record);
        }
        await delay(record.is_ready ? PERCH_END_POLL_MS : PERCH_READY_POLL_MS);
    }
}

/** The editor console ended on its own (its terminal may still show why). */
async function handle_perch_console_end(
    record: PerchConsole,
    end_path: string
): Promise<void> {
    let code: number | undefined;
    let helper_failed = false;
    try {
        const end: unknown = JSON.parse(
            await fs.promises.readFile(end_path, 'utf8')
        );
        if (typeof end === 'object' && end !== null) {
            const fields = end as { code?: unknown; helper_failed?: unknown };
            code = typeof fields.code === 'number' ? fields.code : undefined;
            helper_failed = fields.helper_failed === true;
        }
    } catch (my_error) {
        log_line(`Could not read ${end_path}: ${describe_error(my_error)}`);
    }
    if (record.ended) {
        return;
    }
    if (helper_failed && !record.is_ready) {
        // As for a pane: run the Stata CLI instead, here a new session.
        const the_sends = get_perch_queue().take_pending(record.id);
        end_perch_console(record.id, null);
        note_helper_fallback();
        void resend_without_console(the_sends);
        return;
    }
    end_perch_console(record.id, { reason: 'process', code, backend: 'pty' });
}

/** A Perch terminal of this window shows `session`: send there. */
function bind_perch_terminal(
    api: PerchApiV1,
    session: PerchSessionInfo,
    terminal: vscode.Terminal
): void {
    if (terminal.exitStatus !== undefined) {
        return;
    }
    const record = track_perch_console(api, session);
    if (record.ended || record.terminal === terminal) {
        return;
    }
    if (record.terminal) {
        the_perch_terminals.delete(record.terminal);
        forget_console_terminal(record.terminal);
    }
    record.terminal = terminal;
    the_perch_terminals.set(terminal, record.id);
    remove_detached_perch_id(record.id);
    the_profile_terminals.add(terminal);
    track_activation(terminal);
    last_active_profile_terminal = terminal;
}

function remove_detached_perch_id(id: string): void {
    const idx = the_detached_perch_ids.indexOf(id);
    if (idx !== -1) {
        the_detached_perch_ids.splice(idx, 1);
    }
}

/**
 * A Perch terminal closed: a detach. The session keeps running and
 * stays this window's console.
 */
function detach_perch_terminal(terminal: vscode.Terminal, id: string): void {
    the_perch_terminals.delete(terminal);
    forget_console_terminal(terminal);
    const record = the_perch_consoles.get(id);
    if (!record || record.terminal !== terminal) {
        return;
    }
    record.terminal = null;
    remove_detached_perch_id(id);
    the_detached_perch_ids.push(id);
}

/**
 * A session ended (or Sight stops using it). Sends still waiting for
 * it are dropped with a notice (`exit`), or were taken (null).
 */
function end_perch_console(id: string, exit: ConsoleExit | null): void {
    const record = the_perch_consoles.get(id);
    if (!record) {
        return;
    }
    record.ended = true;
    the_perch_consoles.delete(id);
    remove_detached_perch_id(id);
    if (record.terminal) {
        the_perch_terminals.delete(record.terminal);
        forget_console_terminal(record.terminal);
        record.terminal = null;
    }
    if (exit) {
        get_perch_queue().handle_closed(id, exit).catch(my_error => {
            vscode.window.showErrorMessage(`Error: ${describe_error(my_error)}`);
        });
    }
}

/**
 * The session this window sends to: the last-used Stata terminal's,
 * or, with no Stata terminal open, the last one detached here. Null
 * means the old path (a non-Perch Stata terminal, or none at all).
 */
function current_perch_target(): PerchConsole | null {
    const terminal = last_active_profile_terminal;
    if (terminal) {
        const id = the_perch_terminals.get(terminal);
        return id === undefined
            ? null
            : the_perch_consoles.get(id) ?? null;
    }
    const id = the_detached_perch_ids.at(-1);
    return id === undefined ? null : the_perch_consoles.get(id) ?? null;
}

function type_perch_send(id: string, send: PendingSend): void {
    const record = the_perch_consoles.get(id);
    if (!record) {
        throw new Error('The Stata session has ended.');
    }
    const line = `${send.command} `
        + wrap_path_for_stata_terminal(send.temp_file_path);
    record.chain = record.chain.then(() => deliver_perch_send(record, line));
}

/** Hand one line to the session; report a failure (never resend). */
async function deliver_perch_send(
    record: PerchConsole,
    line: string
): Promise<void> {
    try {
        await record.api.send(record.id, line, { submit: true });
    } catch (my_error) {
        const code = perch_error_code(my_error);
        if (code === 'outcome_unknown') {
            vscode.window.showWarningMessage(
                'Sight couldn\'t confirm that the Stata session received '
                + 'your code, so it may not have run. Sight won\'t send '
                + 'it again.'
            );
            return;
        }
        if (code === 'no_session') {
            end_perch_console(record.id, {
                reason: 'process', code: undefined, backend: 'pty',
            });
            vscode.window.showErrorMessage(
                'The Stata session has ended, so nothing was sent. Send '
                + 'again to start a new one.'
            );
            return;
        }
        vscode.window.showErrorMessage(
            `Could not send to the Stata session: ${describe_error(my_error)}`
        );
    }
}

/**
 * Send to a Perch session: typed (through Perch) when it is ready,
 * else queued. Returns true if queued (the queue owns the temp file).
 */
async function send_to_perch_console(
    record: PerchConsole,
    send: PendingSend
): Promise<boolean> {
    record.terminal?.show(true);
    const queued = get_perch_queue().send(record.id, send);
    if (!queued) {
        await record.chain;
    }
    return queued;
}

function format_session_detail(session: PerchSessionInfo): string {
    const where = session.attached
        ? 'open in another window'
        : 'not open in any window';
    const started_ms = Date.parse(session.createdAt);
    return Number.isNaN(started_ms)
        ? where
        : `${where}; started ${new Date(started_ms).toLocaleString()}`;
}

/**
 * Sight's sessions from other windows can be picked, never sent to on
 * their own. Resolves to 'new', a session, or undefined (dismissed).
 */
async function pick_perch_session(
    the_candidates: PerchSessionInfo[]
): Promise<'new' | PerchSessionInfo | undefined> {
    interface SessionItem extends vscode.QuickPickItem {
        session?: PerchSessionInfo;
    }
    const the_items: SessionItem[] = [
        { label: PERCH_NEW_CONSOLE_LABEL },
        ...the_candidates.map(my_session => ({
            label: `$(terminal) ${my_session.name || TERMINAL_NAME}`,
            description: my_session.cwd,
            detail: format_session_detail(my_session),
            session: my_session,
        })),
    ];
    const picked = await vscode.window.showQuickPick(the_items, {
        title: 'Sight has Stata sessions from other windows. Send code to '
            + 'one of them, or start a new console?',
    });
    if (!picked) {
        return undefined;
    }
    return picked.session ?? 'new';
}

/** The launch of a new session, with `send` on its command line. */
async function perch_launch_options(
    send?: PendingSend
): Promise<PerchCreateOptions> {
    const working_directory =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const first_send = send
        ? {
            command: send.command,
            quoted_path: wrap_path_for_stata_terminal(send.temp_file_path),
        }
        : undefined;
    const new_pane = await resolve_new_pane();
    if (new_pane?.pty && extension_context) {
        return build_perch_launch({
            mode: PERCH_CONSOLE_EDITOR,
            stata_path: new_pane.pty.stata_path,
            working_directory,
            first_send,
            editor: {
                node_path: process.execPath,
                tty_script: path.join(
                    extension_context.extensionPath,
                    'console-runtime',
                    'tty.js'
                ),
                helper_path: new_pane.pty.helper_path,
            },
        });
    }
    const stata_cli = await detect_stata_cli();
    if (!stata_cli) {
        throw new Error(STATA_CLI_NOT_FOUND_MESSAGE);
    }
    return build_perch_launch({
        mode: PERCH_CONSOLE_STATA,
        stata_path: stata_cli,
        working_directory,
        first_send,
    });
}

/**
 * Start a session for `send` (or use one the user picks). Resolves to
 * its ID and whether `send` rode on its command line; null if the user
 * dismissed the choice.
 */
async function open_perch_console(
    api: PerchApiV1,
    send: PendingSend
): Promise<{ id: string; carried_send: boolean } | null> {
    const tracked = perch_connection?.tracked;
    const the_candidates = tracked
        ? candidate_sessions(tracked, my_id => the_perch_consoles.has(my_id))
        : [];
    if (the_candidates.length > 0) {
        const choice = await pick_perch_session(the_candidates);
        if (choice === undefined) {
            return null;
        }
        if (choice !== 'new') {
            const terminal = await api.attach(choice.id, { show: true });
            bind_perch_terminal(api, choice, terminal);
            return { id: choice.id, carried_send: false };
        }
    }
    const options = await perch_launch_options(send);
    const { session, terminal } = await api.createSession({
        ...options,
        terminal: { iconPath: create_terminal_icon() },
        show: false,
    });
    track_perch_console(api, session, send);
    bind_perch_terminal(api, session, terminal);
    terminal.show(true);
    return { id: session.id, carried_send: true };
}

/** Send through Perch to the session a new console became. */
async function send_to_new_perch_console(
    api: PerchApiV1,
    send: PendingSend
): Promise<boolean> {
    const opening = open_perch_console(api, send);
    const creation = opening.then(
        my_opened => my_opened?.id ?? null,
        () => null
    );
    perch_creation_in_flight = creation;
    void creation.finally(() => {
        if (perch_creation_in_flight === creation) {
            perch_creation_in_flight = null;
        }
    });
    const opened = await opening;
    if (!opened) {
        return false;
    }
    if (opened.carried_send) {
        // The session's queue owns the temp file.
        return true;
    }
    const record = the_perch_consoles.get(opened.id);
    if (!record) {
        throw new Error('The Stata session has ended.');
    }
    return send_to_perch_console(record, send);
}

/**
 * Send through Perch if this window uses it for the send: returns
 * whether the send was queued, or null for the old path.
 */
async function send_with_perch(send: PendingSend): Promise<boolean | null> {
    const target = current_perch_target();
    if (target) {
        return send_to_perch_console(target, send);
    }
    if (last_active_profile_terminal || creation_in_flight) {
        return null;
    }
    if (perch_creation_in_flight) {
        return join_perch_creation(send);
    }
    const api = await perch_for_new_console();
    if (!api) {
        return null;
    }
    // A send made meanwhile may have started one.
    const started = current_perch_target();
    if (started) {
        return send_to_perch_console(started, send);
    }
    if (perch_creation_in_flight) {
        return join_perch_creation(send);
    }
    if (last_active_profile_terminal || creation_in_flight) {
        return null;
    }
    return send_to_new_perch_console(api, send);
}

/**
 * Send to `terminal`'s session if it is one of Sight's Perch terminals
 * (the "active terminal" commands): returns whether the send was
 * queued, or null if it isn't one.
 */
export async function send_to_perch_terminal(
    terminal: vscode.Terminal | undefined,
    command: StataCommand,
    temp_file_path: string
): Promise<boolean | null> {
    const id = terminal ? the_perch_terminals.get(terminal) : undefined;
    const record = id === undefined ? undefined : the_perch_consoles.get(id);
    if (!record) {
        return null;
    }
    return send_to_perch_console(record, { command, temp_file_path });
}

/** Queue behind a session being opened; dropped if that failed. */
async function join_perch_creation(send: PendingSend): Promise<boolean> {
    const id = await perch_creation_in_flight;
    const record = id === null || id === undefined
        ? undefined
        : the_perch_consoles.get(id);
    if (!record) {
        return false;
    }
    return send_to_perch_console(record, send);
}

function delay(time_ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, time_ms);
    });
}

function create_terminal_icon(): vscode.ThemeIcon | undefined {
    if (typeof vscode.ThemeIcon !== 'function') {
        return undefined;
    }
    return new vscode.ThemeIcon('terminal');
}

function track_activation(terminal: vscode.Terminal): void {
    const idx = the_activation_order.indexOf(terminal);
    if (idx !== -1) {
        the_activation_order.splice(idx, 1);
    }
    the_activation_order.push(terminal);
}

function handle_terminal_opened(terminal: vscode.Terminal): void {
    if (the_profile_terminals.has(terminal)) {
        return;
    }
    const options = terminal.creationOptions;
    const pty = options && 'pty' in options ? options.pty : undefined;
    const entry = pty ? the_pending_profile_panes.get(pty) : undefined;
    if (pty && entry) {
        the_pending_profile_panes.delete(pty);
        // Sends made before the console's first prompt are queued.
        adopt_pane(terminal, entry);
        return;
    }
    if (
        pending_profile_creation_count > 0
        && terminal.name === TERMINAL_NAME
        && !the_profile_terminals.has(terminal)
    ) {
        pending_profile_creation_count--;
        the_profile_terminals.add(terminal);
        track_activation(terminal);
        last_active_profile_terminal = terminal;
        // A profile terminal the user opened from the dropdown carries no
        // command we can bake into launch args, so its first send must be
        // typed. Track readiness so that send waits out Stata's startup
        // stdin flush instead of racing it.
        track_terminal_ready(terminal);
    }
}

/**
 * Begin tracking when `terminal` is ready to receive typed input, storing
 * the promise so the next send can await it.
 *
 * The profile-opened path installs this eagerly, before any send, so the
 * promise may have no awaiter when it settles. wait_for_terminal_ready
 * rejects if the terminal closes or times out before it is ready, so we
 * attach a no-op catch to avoid an unhandled rejection in that case; an
 * actual send still awaits the stored promise and observes the rejection.
 */
function track_terminal_ready(terminal: vscode.Terminal): void {
    const ready_promise = wait_for_terminal_ready(terminal).finally(() => {
        the_terminal_ready_promises.delete(terminal);
    });
    ready_promise.catch(() => {});
    the_terminal_ready_promises.set(terminal, ready_promise);
}

function handle_terminal_closed(terminal: vscode.Terminal): void {
    const perch_id = the_perch_terminals.get(terminal);
    if (perch_id !== undefined) {
        detach_perch_terminal(terminal, perch_id);
        return;
    }
    the_console_panes.delete(terminal);
    if (console_queue?.is_tracked(terminal)) {
        // Normally the pane reported its end already; this covers a
        // pane VS Code disposed without closing it.
        console_queue
            .handle_closed(terminal, { reason: 'user', code: undefined })
            .catch(my_error => {
                vscode.window.showErrorMessage(
                    `Error: ${my_error instanceof Error
                        ? my_error.message : my_error}`
                );
            });
    }
    the_profile_terminals.delete(terminal);
    the_terminal_ready_promises.delete(terminal);
    const idx = the_activation_order.indexOf(terminal);
    if (idx !== -1) {
        the_activation_order.splice(idx, 1);
    }
    if (last_active_profile_terminal === terminal) {
        // Fall back to the most recently activated profile terminal
        last_active_profile_terminal =
            the_activation_order.length > 0
                ? the_activation_order[the_activation_order.length - 1]
                : null;
    }
}

function handle_active_terminal_changed(
    terminal: vscode.Terminal | undefined
): void {
    if (terminal && the_profile_terminals.has(terminal)) {
        track_activation(terminal);
        last_active_profile_terminal = terminal;
    }
}

/**
 * Register the Stata terminal profile and lifecycle listeners.
 * Call once during extension activation.
 */
export function register_stata_terminal(
    context: vscode.ExtensionContext,
    log?: (message: string) => void
): void {
    extension_context = context;
    if (log) {
        log_line = log;
    }
    // The profile opens a console pane (see the top of this file) or,
    // where there is none, the Stata CLI. Remote sessions (SSH, WSL,
    // Dev Container) run this on the remote host, with its platform.
    const provider: vscode.TerminalProfileProvider = {
        async provideTerminalProfile(
            token: vscode.CancellationToken
        ): Promise<vscode.TerminalProfile | undefined> {
            let new_pane: Awaited<ReturnType<typeof resolve_new_pane>>;
            try {
                new_pane = await resolve_new_pane();
            } catch (my_error) {
                if (!token.isCancellationRequested) {
                    vscode.window.showErrorMessage(
                        my_error instanceof Error
                            ? my_error.message : String(my_error)
                    );
                }
                return undefined;
            }
            if (token.isCancellationRequested) {
                return undefined;
            }
            const perch_profile = await perch_terminal_profile();
            if (token.isCancellationRequested) {
                return undefined;
            }
            if (perch_profile) {
                return perch_profile;
            }
            if (new_pane) {
                const entry = create_pane_entry(new_pane.pty);
                the_pending_profile_panes.set(entry.pane.pty, entry);
                return new vscode.TerminalProfile({
                    name: TERMINAL_NAME,
                    pty: entry.pane.pty,
                    iconPath: create_terminal_icon(),
                });
            }
            const stata_cli = await detect_stata_cli();
            if (token.isCancellationRequested || !stata_cli) {
                if (!token.isCancellationRequested && !stata_cli) {
                    vscode.window.showErrorMessage(
                        STATA_CLI_NOT_FOUND_MESSAGE
                    );
                }
                return undefined;
            }
            pending_profile_creation_count++;
            return new vscode.TerminalProfile({
                name: TERMINAL_NAME,
                shellPath: stata_cli,
                shellArgs: [],
                isTransient: false,
                iconPath: create_terminal_icon(),
            });
        }
    };

    pending_status_item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
    );
    pending_status_item.tooltip =
        'Sends to Stata waiting for sight console to be ready, or for ' +
        'your answer to its offer';

    context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider(PROFILE_ID, provider),
        vscode.window.onDidOpenTerminal(handle_terminal_opened),
        vscode.window.onDidCloseTerminal(handle_terminal_closed),
        vscode.window.onDidChangeActiveTerminal(
            handle_active_terminal_changed
        ),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(
                `${TARGET_SETTING_SECTION}.${TARGET_SETTING_KEY}`
            )) {
                handle_target_setting_changed();
            }
            if (event.affectsConfiguration('sight.sendToStata.stataApp')) {
                clear_stata_cli_cache();
                console_stata_cli = null;
            }
        }),
        pending_status_item,
        { dispose: () => console_queue?.dispose() },
        { dispose: () => perch_queue?.dispose() },
    );

    // Perch: looked up now and whenever extensions change. Outside a
    // remote window this does nothing more.
    const connection = create_perch_connection();
    perch_connection = connection;
    context.subscriptions.push(
        vscode.extensions.onDidChange(() => {
            void connection.connect();
        }),
        { dispose: () => connection.dispose() },
    );
    void connection.connect();
}

/**
 * With Perch, the profile list's Stata terminal is a new session too;
 * Sight adopts it when Perch attaches it (onDidAttach).
 */
async function perch_terminal_profile():
    Promise<vscode.TerminalProfile | undefined> {
    const api = await perch_for_new_console();
    if (!api) {
        return undefined;
    }
    try {
        const { options } = api.prepareLaunch({
            ...await perch_launch_options(),
            terminal: { iconPath: create_terminal_icon() },
        });
        return new vscode.TerminalProfile(options);
    } catch (my_error) {
        log_line(`Perch couldn't prepare a Stata session: `
            + describe_error(my_error));
        throw my_error;
    }
}

/**
 * A command to run as the terminal's very first action, baked into the
 * Stata CLI launch arguments instead of typed into the REPL.
 */
interface InitialCommand {
    command: StataCommand;
    temp_file_path: string;
}

/**
 * Result of resolving the Stata terminal for a send.
 * `created_with_initial_command` is true only for the call that created
 * a brand-new terminal carrying `initial_command` in its launch args;
 * such a send must NOT also type the command (Stata runs it itself).
 */
interface ResolvedStataTerminal {
    terminal: vscode.Terminal;
    created_with_initial_command: boolean;
}

/**
 * Get an existing Stata profile terminal, or create a new one.
 * Returns the last-activated profile terminal if one exists.
 * Serializes concurrent calls so only one terminal is created.
 *
 * When a new terminal is created and `initial_command` is provided, the
 * command is baked into the CLI launch args so Stata runs it itself
 * after initialization. Only that initiating call reports
 * `created_with_initial_command: true`; reused terminals and calls that
 * merely join an in-flight creation report false and must type their
 * command via sendText.
 */
export async function get_or_create_stata_terminal(
    initial_command?: InitialCommand
): Promise<ResolvedStataTerminal> {
    if (last_active_profile_terminal) {
        return {
            terminal: last_active_profile_terminal,
            created_with_initial_command: false,
        };
    }
    if (creation_in_flight) {
        const terminal = await creation_in_flight;
        return { terminal, created_with_initial_command: false };
    }

    const bakes_command = initial_command !== undefined
        && !is_local_windows();
    creation_in_flight = create_stata_terminal(
        bakes_command ? initial_command : undefined
    ).finally(() => {
        creation_in_flight = null;
    });
    const terminal = await creation_in_flight;
    return {
        terminal,
        created_with_initial_command: bakes_command,
    };
}

/**
 * Open a new Stata pane running sight console. Sends wait in its queue
 * until the console shows its first prompt.
 */
function create_console_terminal(pty?: EditorConsolePty): vscode.Terminal {
    const entry = create_pane_entry(pty);
    const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        pty: entry.pane.pty,
        iconPath: create_terminal_icon(),
    });
    adopt_pane(terminal, entry);
    terminal.show(false);
    return terminal;
}

async function create_stata_terminal(
    initial_command?: InitialCommand
): Promise<vscode.Terminal> {
    if (is_local_windows()) {
        return create_console_terminal();
    }
    const stata_cli = await detect_stata_cli();
    if (!stata_cli) {
        throw new Error(
            'Stata CLI not found. Ensure stata-mp, stata-se, ' +
            'or stata is on your PATH, or configure ' +
            'sight.sendToStata.stataApp.'
        );
    }

    // Bake the first command into the launch args so Stata executes it
    // itself once fully initialized. Typing it into the just-spawned
    // REPL would race Stata's startup stdin flush and be discarded (the
    // "first console launch" bug). The path is wrapped in Stata's
    // compound-quote form because Stata joins launch argv with spaces
    // and re-parses them as a single command line.
    const shell_args = initial_command
        ? [
            initial_command.command,
            wrap_path_for_stata_terminal(initial_command.temp_file_path),
        ]
        : [];

    const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        shellPath: stata_cli,
        shellArgs: shell_args,
        isTransient: false,
        iconPath: create_terminal_icon(),
    });

    // Track immediately so sendText can be called before
    // onDidOpenTerminal fires (which would skip this terminal
    // since pending_profile_creation_count is 0).
    the_profile_terminals.add(terminal);
    track_activation(terminal);
    last_active_profile_terminal = terminal;
    track_terminal_ready(terminal);

    return terminal;
}

async function wait_for_terminal_ready(
    terminal: vscode.Terminal
): Promise<void> {
    let reject_close!: (reason?: unknown) => void;
    let timeout_id: ReturnType<typeof setTimeout> | null = null;
    const close_promise = new Promise<never>((_resolve, reject) => {
        reject_close = reject;
    });
    const close_listener_disposable = vscode.window.onDidCloseTerminal(
        closed_terminal => {
            if (closed_terminal === terminal) {
                reject_close(new Error(
                    'The integrated Stata terminal closed before it ' +
                    'was ready.'
                ));
            }
        }
    );

    const timeout_promise = new Promise<never>((_resolve, reject) => {
        timeout_id = setTimeout(() => {
            reject(new Error(
                'Timed out waiting for the integrated Stata terminal ' +
                'to be ready.'
            ));
        }, TERMINAL_READY_TIMEOUT_MS);
    });

    const process_id_promise = (async () => {
        const process_id = await terminal.processId;
        if (process_id === undefined) {
            throw new Error(
                'The integrated Stata terminal did not provide a ' +
                'process id.'
            );
        }
        await delay(TERMINAL_STARTUP_GRACE_MS);
    })();

    try {
        await Promise.race([
            process_id_promise,
            close_promise,
            timeout_promise,
        ]);
    } finally {
        close_listener_disposable?.dispose();
        if (timeout_id !== null) {
            clearTimeout(timeout_id);
        }
    }
}

/**
 * Send a command to the Stata profile terminal.
 * Creates a new Stata terminal if none exists.
 *
 * Returns true if the send was queued for a sight console terminal
 * that isn't ready yet. The queue then owns `temp_file_path` and
 * schedules its deletion; the caller must not.
 */
export async function send_to_stata_terminal(
    command: StataCommand,
    temp_file_path: string
): Promise<boolean> {
    if (!VALID_COMMANDS.includes(command)) {
        throw new Error(
            `Invalid command: "${command}". ` +
            `Must be one of: ${VALID_COMMANDS.join(', ')}`
        );
    }

    // In a remote window with Perch, sends go to a Perch session (see
    // "Perch sessions" above).
    const perch_queued = await send_with_perch({ command, temp_file_path });
    if (perch_queued !== null) {
        return perch_queued;
    }

    // Sends go to the last-used Stata terminal, of either kind. A new
    // one is a console pane where possible (see the top of this file).
    let pane_terminal = last_active_profile_terminal;
    if (!pane_terminal && !creation_in_flight) {
        const kind = console_pane_kind();
        if (kind === 'automation') {
            // No await before the send is queued, so concurrent sends
            // queue in the order they were made.
            pane_terminal = create_console_terminal();
        } else if (kind === 'pty') {
            const new_pane = await resolve_new_pane();
            // An earlier send may have opened one meanwhile.
            pane_terminal = last_active_profile_terminal
                ?? (new_pane ? create_console_terminal(new_pane.pty) : null);
        }
    }
    if (pane_terminal && console_queue?.is_tracked(pane_terminal)) {
        // Readiness can take minutes (Windows' take-over question,
        // Stata's startup), so no timeout applies: the send waits in
        // the terminal's queue.
        const queued = console_queue.send(
            pane_terminal,
            { command, temp_file_path }
        );
        // Focus a terminal still starting so its question is seen.
        pane_terminal.show(!queued);
        return queued;
    }

    const { terminal, created_with_initial_command } =
        await get_or_create_stata_terminal({ command, temp_file_path });
    terminal.show(true);  // Reveal without stealing focus
    // Always await readiness: even a baked first command relies on the
    // process actually launching, and this surfaces a terminal that
    // closes before it is ready. It also serializes a rapid follow-up
    // send so it does not type into a still-starting Stata.
    const ready_promise = the_terminal_ready_promises.get(terminal);
    if (ready_promise) {
        await ready_promise;
    }
    // A freshly-created terminal already runs this command via its launch
    // args; typing it again would run it twice.
    if (!created_with_initial_command) {
        const escaped_path = wrap_path_for_stata_terminal(temp_file_path);
        terminal.sendText(`${command} ${escaped_path}`);
    }
    return false;
}

/**
 * Test seam: simulate the user opening a Stata profile terminal from the
 * dropdown. In production VS Code calls provideTerminalProfile (which
 * increments the pending-creation counter) and then fires
 * onDidOpenTerminal; this drives the same handle_terminal_opened path,
 * including its readiness tracking, without a full VS Code mock.
 */
export function simulate_profile_terminal_opened_for_tests(
    terminal: vscode.Terminal
): void {
    pending_profile_creation_count++;
    handle_terminal_opened(terminal);
}

/** Test seam: the Perch terminals sends go through, by session. */
export function perch_terminals_for_tests(): vscode.Terminal[] {
    return [...the_perch_terminals.keys()];
}

export function reset_stata_terminal_manager_for_tests(
    options: {
        context?: vscode.ExtensionContext | null;
        timings?: Partial<ConsoleQueueTimings>;
        load_console_module?: () => Promise<EditorConsoleModule>;
        ask?: (question: ConsoleQuestion) => Promise<ConsoleAnswer>;
        /**
         * The sight-pty helper to report (null: none); by default it
         * is looked up in the extension.
         */
        pty_helper_path?: string | null;
    } = {}
): void {
    console_queue?.dispose();
    console_queue = null;
    perch_queue?.dispose();
    perch_queue = null;
    perch_connection?.dispose();
    perch_connection = null;
    perch_creation_in_flight = null;
    the_perch_consoles.clear();
    the_perch_terminals.clear();
    the_detached_perch_ids.length = 0;
    log_line = () => {};
    console_queue_timings = options.timings ?? {};
    extension_context = options.context ?? null;
    console_module_override = options.load_console_module ?? null;
    console_ask_override = options.ask ?? null;
    the_pending_profile_panes.clear();
    the_console_panes.clear();
    pending_status_item = null;
    session_override_snapshot = null;
    helper_fallback_reason = null;
    console_stata_cli = null;
    helper_path_override = options.pty_helper_path;
    the_profile_terminals.clear();
    the_activation_order.length = 0;
    the_terminal_ready_promises.clear();
    last_active_profile_terminal = null;
    pending_profile_creation_count = 0;
    creation_in_flight = null;
}
