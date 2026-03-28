import * as vscode from 'vscode';
import { StataCommand } from './index';
import { detect_stata_cli, clear_stata_cli_cache } from './stata-cli-detector';
import { wrap_path_for_stata_terminal } from './terminal';

const PROFILE_ID = 'sight.stataTerminal';
const TERMINAL_NAME = 'Stata';
const VALID_COMMANDS: readonly StataCommand[] = ['do', 'include'];
const TERMINAL_CREATE_TIMEOUT_MS = 10_000;

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
 * Flag set before provideTerminalProfile returns, cleared by
 * onDidOpenTerminal. Used to correlate the opened terminal with
 * our profile (VS Code does not expose a terminal-to-profile link).
 */
let pending_profile_creation = false;

/**
 * Resolve function for the pending terminal creation promise.
 * Set by get_or_create_stata_terminal, called by onDidOpenTerminal.
 */
let pending_terminal_resolve: ((terminal: vscode.Terminal) => void) | null =
    null;

/**
 * In-flight creation promise, used to prevent concurrent calls from
 * creating multiple terminals.
 */
let creation_in_flight: Promise<vscode.Terminal> | null = null;

function handle_terminal_opened(terminal: vscode.Terminal): void {
    if (pending_profile_creation) {
        pending_profile_creation = false;
        the_profile_terminals.add(terminal);
        last_active_profile_terminal = terminal;
        if (pending_terminal_resolve) {
            pending_terminal_resolve(terminal);
            pending_terminal_resolve = null;
        }
    }
}

function handle_terminal_closed(terminal: vscode.Terminal): void {
    the_profile_terminals.delete(terminal);
    if (last_active_profile_terminal === terminal) {
        last_active_profile_terminal = null;
        // Pick the most recently seen profile terminal that's still open
        for (const my_terminal of the_profile_terminals) {
            last_active_profile_terminal = my_terminal;
        }
    }
}

function handle_active_terminal_changed(
    terminal: vscode.Terminal | undefined
): void {
    if (terminal && the_profile_terminals.has(terminal)) {
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
    const provider: vscode.TerminalProfileProvider = {
        async provideTerminalProfile(
            _token: vscode.CancellationToken
        ): Promise<vscode.TerminalProfile | undefined> {
            const stata_cli = await detect_stata_cli();
            if (!stata_cli) {
                vscode.window.showErrorMessage(
                    'Stata CLI not found. Ensure stata-mp, stata-se, ' +
                    'or stata is on your PATH, or configure ' +
                    'sight.sendToStata.stataApp.'
                );
                return undefined;
            }
            pending_profile_creation = true;
            return new vscode.TerminalProfile({
                name: TERMINAL_NAME,
                shellPath: stata_cli,
                shellArgs: [],
                isTransient: false,
                iconPath: new vscode.ThemeIcon('terminal'),
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
 * Get an existing Stata profile terminal, or create a new one.
 * Returns the last-activated profile terminal if one exists.
 * Serializes concurrent calls so only one terminal is created.
 */
export async function get_or_create_stata_terminal():
    Promise<vscode.Terminal> {
    if (last_active_profile_terminal) {
        return last_active_profile_terminal;
    }
    if (creation_in_flight) {
        return creation_in_flight;
    }

    creation_in_flight = create_stata_terminal().finally(() => {
        creation_in_flight = null;
    });
    return creation_in_flight;
}

async function create_stata_terminal(): Promise<vscode.Terminal> {
    const stata_cli = await detect_stata_cli();
    if (!stata_cli) {
        throw new Error(
            'Stata CLI not found. Ensure stata-mp, stata-se, ' +
            'or stata is on your PATH, or configure ' +
            'sight.sendToStata.stataApp.'
        );
    }

    pending_profile_creation = true;
    let timeout_handle: ReturnType<typeof setTimeout> | null = null;

    const terminal_promise = new Promise<vscode.Terminal>(
        (resolve, reject) => {
            timeout_handle = setTimeout(() => {
                pending_terminal_resolve = null;
                pending_profile_creation = false;
                reject(new Error(
                    'Timed out waiting for Stata terminal ' +
                    'to open.'
                ));
            }, TERMINAL_CREATE_TIMEOUT_MS);

            pending_terminal_resolve = (
                terminal: vscode.Terminal
            ) => {
                clearTimeout(timeout_handle!);
                resolve(terminal);
            };
        }
    );

    const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        shellPath: stata_cli,
        shellArgs: [],
        isTransient: false,
        iconPath: new vscode.ThemeIcon('terminal'),
    });

    // onDidOpenTerminal may fire synchronously. If so,
    // pending_profile_creation is already cleared.
    if (!pending_profile_creation) {
        clearTimeout(timeout_handle!);
        pending_terminal_resolve = null;
        return terminal;
    }

    return terminal_promise;
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

    const terminal = await get_or_create_stata_terminal();
    const escaped_path = wrap_path_for_stata_terminal(temp_file_path);
    const command_string = `${command} ${escaped_path}`;
    terminal.show(true);  // Reveal without stealing focus
    terminal.sendText(command_string);
}
