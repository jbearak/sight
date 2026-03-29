import * as vscode from 'vscode';
import * as path from 'path';
import { compute_cd_menu_visible, format_cd_command } from './cd-commands';
import {
    WorkingDirectoryOption,
    resolve_effective_target
} from './commands';
import {
    create_temp_file,
    detect_stata_app,
    send_to_stata_app,
    send_to_terminal,
    send_to_stata_terminal
} from './index';

const CONTEXT_KEY = 'sight.cdMenuVisible';

/**
 * Initialize context variable based on current configuration.
 * Called during extension activation.
 */
export function initialize_cd_context(context: vscode.ExtensionContext): void {
    const config = vscode.workspace.getConfiguration('sight.sendToStata');
    const current_value = config.get<WorkingDirectoryOption>(
        'workingDirectory', 'lsp'
    );
    update_cd_context(current_value);
    
    const listener = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('sight.sendToStata.workingDirectory')) {
            const new_config = vscode.workspace.getConfiguration('sight.sendToStata');
            const new_value = new_config.get<WorkingDirectoryOption>(
                'workingDirectory', 'lsp'
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
export function update_cd_context(new_value: WorkingDirectoryOption): void {
    const visible = compute_cd_menu_visible(new_value);
    vscode.commands.executeCommand('setContext', CONTEXT_KEY, visible);
}

/**
 * Register CD commands with VS Code.
 * @param context - Extension context for subscriptions
 */
export function register_cd_commands(context: vscode.ExtensionContext): void {
    const the_commands = [
        {
            id: 'sight.cdWorkspace',
            handler: () => execute_cd_command('workspace', 'app', context)
        },
        {
            id: 'sight.cdFile',
            handler: () => execute_cd_command('file', 'app', context)
        },
        {
            id: 'sight.terminal.cdWorkspace',
            handler: () => execute_cd_command('workspace', 'terminal', context)
        },
        {
            id: 'sight.terminal.cdFile',
            handler: () => execute_cd_command('file', 'terminal', context)
        }
    ];
    
    for (const my_command of the_commands) {
        const disposable = vscode.commands.registerCommand(
            my_command.id,
            my_command.handler
        );
        context.subscriptions.push(disposable);
    }
}

/**
 * Execute a CD command to change Stata's working directory.
 * @param directory_type - 'workspace' or 'file'
 * @param target - 'app' or 'terminal'
 * @param context - Extension context for Windows support
 */
export async function execute_cd_command(
    directory_type: 'workspace' | 'file',
    target: 'app' | 'terminal',
    context: vscode.ExtensionContext
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

    // Resolve effective target using same logic as send commands
    const effective_target = resolve_effective_target(target);

    if (effective_target === null) {
        return;
    }

    const temp_file_path = await create_temp_file(cd_command);

    try {
        if (effective_target === 'integrated') {
            await send_to_stata_terminal('do', temp_file_path);
        } else if (effective_target === 'app') {
            if (process.platform === 'darwin') {
                const stata_app = await detect_stata_app();
                if (!stata_app) {
                    vscode.window.showErrorMessage(
                        'Stata not found. Install Stata in ' +
                        '/Applications/Stata/ or configure ' +
                        'sight.sendToStata.stataApp setting.'
                    );
                    return;
                }

                const config = vscode.workspace.getConfiguration(
                    'sight.sendToStata'
                );
                const focus_stata = config.get<boolean>(
                    'focusStataWindow', false
                );
                await send_to_stata_app(
                    stata_app, 'do', temp_file_path, focus_stata
                );
            } else if (process.platform === 'win32') {
                const { send_to_stata_windows } =
                    await import('./windows-sender');
                await send_to_stata_windows(
                    'do', temp_file_path, context
                );
            } else {
                vscode.window.showErrorMessage(
                    'Stata application mode is only available on ' +
                    'macOS and Windows. Use terminal mode instead.'
                );
                return;
            }
        } else {
            await send_to_terminal('do', temp_file_path);
        }
    } catch (my_error) {
        vscode.window.showErrorMessage(
            `Error: ${my_error instanceof Error ? my_error.message : my_error}`);
    }
}
