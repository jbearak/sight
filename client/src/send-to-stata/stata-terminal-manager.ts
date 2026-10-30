import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StataCommand, VALID_COMMANDS } from './index.js';
import { detect_stata_cli, clear_stata_cli_cache } from './stata-cli-detector.js';
import { wrap_path_for_stata_terminal } from './terminal.js';
import { schedule_temp_file_cleanup } from './temp-file.js';
import { send_to_stata_windows } from './windows-sender.js';
import {
    ConsoleCloseReason,
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

// On local Windows the Stata terminal runs `sight console` from the
// extension's CLI bundle (client/cli/cli.js) under VS Code's own
// runtime. Without ELECTRON_RUN_AS_NODE, Code.exe would open another
// editor window instead of running the script.
const CONSOLE_CLI_RELATIVE_PATH = path.join('cli', 'cli.js');
const CONSOLE_READY_FILE_DIR_NAME = 'sight-console';
const TARGET_SETTING_SECTION = 'sight.sendToStata';
const TARGET_SETTING_KEY = 'target';

let extension_context: vscode.ExtensionContext | null = null;

/**
 * Ready-file paths handed to profile-created console terminals, oldest
 * first, until onDidOpenTerminal claims them.
 */
const the_pending_profile_ready_paths: string[] = [];

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

function create_ready_file_path(): string {
    const ready_dir = path.join(os.tmpdir(), CONSOLE_READY_FILE_DIR_NAME);
    fs.mkdirSync(ready_dir, { recursive: true });
    const random_hex = crypto.randomBytes(16).toString('hex');
    return path.join(ready_dir, `ready-${random_hex}`);
}

/** Options for a terminal running `sight console` on local Windows. */
function create_console_terminal_options(
    ready_file_path: string
): vscode.TerminalOptions {
    if (!extension_context) {
        throw new Error(
            'The Sight extension is not activated; cannot start ' +
            'sight console.'
        );
    }
    return {
        name: TERMINAL_NAME,
        shellPath: process.execPath,
        shellArgs: [
            path.join(
                extension_context.extensionPath,
                CONSOLE_CLI_RELATIVE_PATH
            ),
            'console',
        ],
        env: {
            ELECTRON_RUN_AS_NODE: '1',
            SIGHT_CONSOLE_FROM_EDITOR: '1',
            SIGHT_CONSOLE_READY_FILE: ready_file_path,
        },
        isTransient: false,
        iconPath: create_terminal_icon(),
    };
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
    const escaped_path = wrap_path_for_stata_terminal(send.temp_file_path);
    terminal.sendText(`${send.command} ${escaped_path}`);
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
        file_exists: async file_path => {
            try {
                await fs.promises.access(file_path);
                return true;
            } catch {
                return false;
            }
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

function to_console_exit(
    exit_status: vscode.TerminalExitStatus | undefined
): ConsoleExit {
    // TerminalExitReason needs VS Code 1.77; older hosts report none.
    const the_reasons = vscode.TerminalExitReason;
    let reason: ConsoleCloseReason = 'unknown';
    if (the_reasons && exit_status) {
        if (exit_status.reason === the_reasons.Process) {
            reason = 'process';
        } else if (exit_status.reason === the_reasons.User) {
            reason = 'user';
        } else if (exit_status.reason === the_reasons.Shutdown) {
            reason = 'shutdown';
        } else if (exit_status.reason === the_reasons.Extension) {
            reason = 'extension';
        }
    }
    return { reason, code: exit_status?.code };
}

/**
 * Claim the ready-file path for a console terminal the user opened
 * from the profile list: by its environment when VS Code exposes the
 * creation options, otherwise the oldest unclaimed path.
 */
function take_profile_ready_path(
    terminal: vscode.Terminal
): string | undefined {
    const options = terminal.creationOptions;
    const env_path = options && 'env' in options
        ? options.env?.SIGHT_CONSOLE_READY_FILE
        : undefined;
    if (typeof env_path === 'string') {
        const idx = the_pending_profile_ready_paths.indexOf(env_path);
        if (idx !== -1) {
            the_pending_profile_ready_paths.splice(idx, 1);
            return env_path;
        }
    }
    if (
        terminal.name === TERMINAL_NAME
        && the_pending_profile_ready_paths.length > 0
    ) {
        return the_pending_profile_ready_paths.shift();
    }
    return undefined;
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
        const ready_file_path = take_profile_ready_path(terminal);
        if (ready_file_path === undefined) {
            return;
        }
        the_profile_terminals.add(terminal);
        track_activation(terminal);
        last_active_profile_terminal = terminal;
        // Sends made before the console's first prompt are queued.
        get_console_queue().track(terminal, ready_file_path);
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
    if (console_queue?.is_tracked(terminal)) {
        console_queue
            .handle_closed(terminal, to_console_exit(terminal.exitStatus))
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
    // profile runs sight console, which drives the Stata app. Remote
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
            const ready_file_path = create_ready_file_path();
            the_pending_profile_ready_paths.push(ready_file_path);
            return new vscode.TerminalProfile(
                create_console_terminal_options(ready_file_path)
            );
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
 * Start `sight console` in a new terminal on local Windows. Sends wait
 * in its queue until the console shows its first prompt; nothing is
 * baked into its arguments.
 */
function create_console_terminal(): vscode.Terminal {
    const ready_file_path = create_ready_file_path();
    const terminal = vscode.window.createTerminal(
        create_console_terminal_options(ready_file_path)
    );
    the_profile_terminals.add(terminal);
    track_activation(terminal);
    last_active_profile_terminal = terminal;
    get_console_queue().track(terminal, ready_file_path);
    // With focus, so the console's take-over question is seen.
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

    const { terminal, created_with_initial_command } =
        await get_or_create_stata_terminal({ command, temp_file_path });
    if (console_queue?.is_tracked(terminal)) {
        // Readiness can take minutes (the take-over question), so no
        // timeout applies: the send waits in the terminal's queue.
        const queued = console_queue.send(
            terminal,
            { command, temp_file_path }
        );
        // Focus a terminal still starting so its question is seen.
        terminal.show(!queued);
        return queued;
    }
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
    } = {}
): void {
    console_queue?.dispose();
    console_queue = null;
    console_queue_timings = options.timings ?? {};
    extension_context = options.context ?? null;
    the_pending_profile_ready_paths.length = 0;
    pending_status_item = null;
    session_override_snapshot = null;
    the_profile_terminals.clear();
    the_activation_order.length = 0;
    the_terminal_ready_promises.clear();
    last_active_profile_terminal = null;
    pending_profile_creation_count = 0;
    creation_in_flight = null;
}
