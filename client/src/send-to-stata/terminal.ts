import * as vscode from 'vscode';
import { StataCommand } from './index';

export async function send_to_terminal(
    command: StataCommand, 
    temp_file_path: string
): Promise<void> {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
        throw new Error(
            'No active terminal. Open a terminal and start Stata first.'
        );
    }
    
    const command_string = `${command} "${temp_file_path}"`;
    terminal.show(true);  // Reveal terminal without stealing focus
    terminal.sendText(command_string);
}