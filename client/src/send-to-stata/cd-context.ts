import * as vscode from 'vscode';
import * as path from 'path';
import { compute_cd_menu_visible, format_cd_command } from './cd-commands';
import { create_temp_file, send_to_stata_app, send_to_terminal } from './index';

const CONTEXT_KEY = 'sight.cdMenuVisible';

/**
 * Initialize context variable based on current configuration.
 * Called during extension activation.
 */
export function initialize_cd_context(context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const current_value = config.get<'none' | 'file' | 'workspace'>(
        'workingDirectory', 'none'
    );
    update_cd_context(current_value);
    
    const listener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('sight.sendToStata.workingDirectory')) {
            const new_config = vscode.workspace.getConfiguration('sight.sendToStata');
            const new_value = new_config.get<'none' | 'file' | 'workspace'>(
                'workingDirectory', 'none'
            );
            update_cd_context(new_value);
        }
    });
    
    context.subscriptions.push(listener);
}

/**
 * Update context variable when configuration changes.
 * @param new_value - The new workingDirectory setting value
 */
export function update_cd_context(new_value: 'none' | 'file' | 'workspace'): void {
    const visible = compute_cd_menu_visible(new_value);
    vscode.commands.executeCommand('setContext', CONTEXT_KEY, visible);
}

/**
 * Execute a CD command to change Stata's working directory.
 * @param directory_type - 'workspace' or 'file'
 * @param target - 'app' or 'terminal'
 */
export async function execute_cd_command(
    directory_type: 'workspace' | 'file',
    target: 'app' | 'terminal'
): Promise<void> {
    let directory_path: string;
    
    if (directory_type === 'workspace') {
        const workspace_folder = vscode.workspace.workspaceFolders?.[0];
        if (!workspace_folder) {
            vscode.window.showErrorMessage(
                'No workspace folder is open. Please open a folder or workspace first.'
            );
            return;
        }
        directory_path = workspace_folder.uri.fsPath;
    } else {
        const active_editor = vscode.window.activeTextEditor;
        if (!active_editor) {
            vscode.window.showErrorMessage(
                'No file is currently open. Please open a Stata file first.'
            );
            return;
        }
        directory_path = path.dirname(active_editor.document.uri.fsPath);
    }
    
    const cd_command = format_cd_command(directory_path);
    const temp_file_path = await create_temp_file(cd_command);
    
    if (target === 'app') {
        await send_to_stata_app(temp_file_path, 'do');
    } else {
        await send_to_terminal(temp_file_path, 'do');
    }
}
