import * as vscode from 'vscode';
import * as fs from 'fs';
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

// On local Windows the Stata terminal is an extension terminal (a
// pane) running `sight console` inside the extension process; see
// console-pane.ts.
const TARGET_SETTING_SECTION = 'sight.sendToStata';
const TARGET_SETTING_KEY = 'target';

let extension_context: vscode.ExtensionContext | null = null;

/** What happened to a pane before its terminal was known. */
interface PaneState {
    terminal: vscode.Terminal | null;
    is_ready: boolean;
    end: PaneEnd | null;
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

function create_pane_entry(): PaneEntry {
    const state: PaneState = { terminal: null, is_ready: false, end: null };
    const pane = create_console_pane({
        load_module,
        ask: question => (console_ask_override ?? ask_with_dialog)(question),
        working_directory:
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        on_ready: () => {
            state.is_ready = true;
            if (state.terminal) {
                get_console_queue().mark_ready(state.terminal);
            }
        },
        on_end: end => {
            state.end = end;
            if (state.terminal) {
                handle_pane_end(state.terminal, end);
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
        handle_pane_end(terminal, entry.end);
    } else if (entry.is_ready) {
        get_console_queue().mark_ready(terminal);
    }
}

function handle_pane_end(terminal: vscode.Terminal, end: PaneEnd): void {
    const exit: ConsoleExit = end.reason === 'user'
        ? { reason: 'user', code: undefined }
        : { reason: 'process', code: end.code };
    // A finished console no longer takes sends; the next send starts
    // a new pane.
    forget_console_terminal(terminal);
    get_console_queue().handle_closed(terminal, exit).catch(my_error => {
        vscode.window.showErrorMessage(
            `Error: ${my_error instanceof Error ? my_error.message : my_error}`
        );
    });
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

function update_pending_status(count: number): void {
    if (!pending_status_item) {
        return;
    }
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

function get_console_queue(): ConsoleTerminalQueue<vscode.Terminal> {
    if (console_queue) {
        return console_queue;
    }
    console_queue = new ConsoleTerminalQueue<vscode.Terminal>({
        type_send,
        dispatch_to_app: async send => {
            if (!extension_context) {
                throw new Error('The Sight extension is not activated.');
            }
            await send_to_stata_windows(
                send.command,
                send.temp_file_path,
                extension_context
            );
        },
        show_offer: async message => to_offer_answer(
            await vscode.window.showWarningMessage(
                message,
                OFFER_CHOICE_SESSION,
                OFFER_CHOICE_ALWAYS,
                OFFER_CHOICE_CANCEL
            )
        ),
        show_notice: message => {
            vscode.window.showInformationMessage(message);
        },
        show_error: message => {
            vscode.window.showErrorMessage(message);
        },
        schedule_cleanup: file_path => {
            schedule_temp_file_cleanup(file_path);
        },
        delete_file: file_path => {
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
    }, console_queue_timings);
    return console_queue;
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
    if (is_local_windows()) {
        if (the_profile_terminals.has(terminal)) {
            return;
        }
        const options = terminal.creationOptions;
        const pty = options && 'pty' in options ? options.pty : undefined;
        const entry = pty ? the_pending_profile_panes.get(pty) : undefined;
        if (!pty || !entry) {
            return;
        }
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
    context: vscode.ExtensionContext
): void {
    extension_context = context;
    // Windows has no interactive Stata CLI, so on local Windows the
    // profile opens a pane running sight console, which drives the
    // Stata app. Remote
    // sessions (SSH, WSL, Dev Container) connect to a host that may
    // have a CLI and keep the CLI profile.
    if (is_local_windows()) {
        register_console_terminal(context);
        return;
    }

    const provider: vscode.TerminalProfileProvider = {
        async provideTerminalProfile(
            token: vscode.CancellationToken
        ): Promise<vscode.TerminalProfile | undefined> {
            const stata_cli = await detect_stata_cli();
            if (token.isCancellationRequested || !stata_cli) {
                if (!token.isCancellationRequested && !stata_cli) {
                    vscode.window.showErrorMessage(
                        'Stata CLI not found. Ensure stata-mp, ' +
                        'stata-se, or stata is on your PATH, or ' +
                        'configure sight.sendToStata.stataApp.'
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

    context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider(PROFILE_ID, provider),
        vscode.window.onDidOpenTerminal(handle_terminal_opened),
        vscode.window.onDidCloseTerminal(handle_terminal_closed),
        vscode.window.onDidChangeActiveTerminal(
            handle_active_terminal_changed
        ),
    );

    // Clear CLI cache when stataApp setting changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('sight.sendToStata.stataApp')) {
                clear_stata_cli_cache();
            }
        })
    );
}

function register_console_terminal(
    context: vscode.ExtensionContext
): void {
    const provider: vscode.TerminalProfileProvider = {
        provideTerminalProfile(): vscode.TerminalProfile {
            const entry = create_pane_entry();
            the_pending_profile_panes.set(entry.pane.pty, entry);
            return new vscode.TerminalProfile({
                name: TERMINAL_NAME,
                pty: entry.pane.pty,
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
        }),
        pending_status_item,
        { dispose: () => console_queue?.dispose() },
    );
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
 * Open a new Stata pane running sight console on local Windows. Sends
 * wait in its queue until the console shows its first prompt.
 */
function create_console_terminal(): vscode.Terminal {
    const entry = create_pane_entry();
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

    if (is_local_windows()) {
        // No await before the send is queued, so concurrent sends queue
        // in the order they were made.
        const terminal = last_active_profile_terminal
            ?? create_console_terminal();
        // Readiness can take minutes (the take-over question), so no
        // timeout applies: the send waits in the terminal's queue.
        const queued = get_console_queue().send(
            terminal,
            { command, temp_file_path }
        );
        // Focus a terminal still starting so its question is seen.
        terminal.show(!queued);
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

export function reset_stata_terminal_manager_for_tests(
    options: {
        context?: vscode.ExtensionContext | null;
        timings?: Partial<ConsoleQueueTimings>;
        load_console_module?: () => Promise<EditorConsoleModule>;
        ask?: (question: ConsoleQuestion) => Promise<ConsoleAnswer>;
    } = {}
): void {
    console_queue?.dispose();
    console_queue = null;
    console_queue_timings = options.timings ?? {};
    extension_context = options.context ?? null;
    console_module_override = options.load_console_module ?? null;
    console_ask_override = options.ask ?? null;
    the_pending_profile_panes.clear();
    the_console_panes.clear();
    pending_status_item = null;
    session_override_snapshot = null;
    the_profile_terminals.clear();
    the_activation_order.length = 0;
    the_terminal_ready_promises.clear();
    last_active_profile_terminal = null;
    pending_profile_creation_count = 0;
    creation_in_flight = null;
}
