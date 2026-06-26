import * as vscode from 'vscode';
import { StataCommand, VALID_COMMANDS } from './index.js';
import { detect_stata_cli, clear_stata_cli_cache } from './stata-cli-detector.js';
import { wrap_path_for_stata_terminal } from './terminal.js';

const PROFILE_ID = 'sight.stataTerminal';
const TERMINAL_NAME = 'Stata';
const TERMINAL_READY_TIMEOUT_MS = 5000;
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
    // No interactive Stata CLI on Windows (batch mode only).
    // Skip profile registration on local Windows; remote sessions
    // (SSH, WSL, Dev Container) connect to a host that may have one.
    const is_local_windows = process.platform === 'win32'
        && !vscode.env.remoteName;
    if (is_local_windows) {
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

    const baked = initial_command !== undefined;
    creation_in_flight = create_stata_terminal(initial_command).finally(() => {
        creation_in_flight = null;
    });
    const terminal = await creation_in_flight;
    return { terminal, created_with_initial_command: baked };
}

async function create_stata_terminal(
    initial_command?: InitialCommand
): Promise<vscode.Terminal> {
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
 */
export async function send_to_stata_terminal(
    command: StataCommand,
    temp_file_path: string
): Promise<void> {
    if (!VALID_COMMANDS.includes(command)) {
        throw new Error(
            `Invalid command: "${command}". ` +
            `Must be one of: ${VALID_COMMANDS.join(', ')}`
        );
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

export function reset_stata_terminal_manager_for_tests(): void {
    the_profile_terminals.clear();
    the_activation_order.length = 0;
    the_terminal_ready_promises.clear();
    last_active_profile_terminal = null;
    pending_profile_creation_count = 0;
    creation_in_flight = null;
}
