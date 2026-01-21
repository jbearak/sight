import * as vscode from 'vscode';
import { StataCommand } from './index';

const VALID_COMMANDS: readonly StataCommand[] = ['do', 'include'];

/**
 * Wraps a file path in Stata compound string syntax for terminal commands.
 * Uses `"..."' which handles all special characters including quotes and spaces.
 */
export function wrap_path_for_stata_terminal(path: string): string {
    // Compound strings `"..."' can contain any characters including quotes
    // No escaping needed inside compound strings
    return '`"' + path + `"'`;
}

export async function send_to_terminal(
    command: StataCommand, 
    temp_file_path: string
): Promise<void> {
    // Validate command against allowed values
    if (!VALID_COMMANDS.includes(command)) {
        throw new Error(
            `Invalid command: "${command}". Must be one of: ${VALID_COMMANDS.join(', ')}`
        );
    }
    
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
        throw new Error(
            'No active terminal. Open a terminal and start Stata first.'
        );
    }
    
    const escaped_path = wrap_path_for_stata_terminal(temp_file_path);
    const command_string = `${command} ${escaped_path}`;
    terminal.show(true);  // Reveal terminal without stealing focus
    terminal.sendText(command_string);
}