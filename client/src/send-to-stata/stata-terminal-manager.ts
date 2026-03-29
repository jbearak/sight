import * as vscode from 'vscode';
import { StataCommand, VALID_COMMANDS } from './index';
import { detect_stata_cli, clear_stata_cli_cache } from './stata-cli-detector';
import { wrap_path_for_stata_terminal } from './terminal';

const PROFILE_ID = 'sight.stataTerminal';
const TERMINAL_NAME = 'Stata';

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
    }
}

function handle_terminal_closed(terminal: vscode.Terminal): void {
    the_profile_terminals.delete(terminal);
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

    const terminal = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        shellPath: stata_cli,
        shellArgs: [],
        isTransient: false,
        iconPath: new vscode.ThemeIcon('terminal'),
    });

    // Track immediately so sendText can be called before
    // onDidOpenTerminal fires (which would skip this terminal
    // since pending_profile_creation_count is 0).
    the_profile_terminals.add(terminal);
    track_activation(terminal);
    last_active_profile_terminal = terminal;

    return terminal;
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
