import * as vscode from 'vscode';
import { compute_cd_menu_visible } from './cd-commands';

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
