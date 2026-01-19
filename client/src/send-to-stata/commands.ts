import * as vscode from 'vscode';
import * as path from 'path';
import {
    detect_statement,
    get_statement_text,
    get_upward_bounds,
    get_downward_bounds,
    create_temp_file,
    detect_stata_app,
    send_to_stata_app,
    send_to_terminal,
    StataCommand
} from './index';

/**
 * Prepends a cd command to the content based on workingDirectory setting.
 */
export function prepare_content_with_cd(
    content: string,
    document: vscode.TextDocument,
    working_directory: 'none' | 'file' | 'workspace'
): string {
    if (working_directory === 'none') {
        return content;
    }
    
    let directory: string;
    if (working_directory === 'file') {
        directory = path.dirname(document.uri.fsPath);
    } else {
        const workspace_folder = vscode.workspace.getWorkspaceFolder(document.uri);
        directory = workspace_folder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    }
    
    // Escape quotes in path for Stata
    const escaped_dir = directory.replace(/"/g, '\\"');
    return `cd "${escaped_dir}"\n${content}`;
}

async function handle_send_command(
    mode: 'statement' | 'upward' | 'downward' | 'file',
    command: StataCommand,
    target: 'app' | 'terminal'
): Promise<void> {
    const my_editor = vscode.window.activeTextEditor;
    if (!my_editor) {
        return;
    }

    const my_config = vscode.workspace.getConfiguration('sight.sendToStata');
    
    if (my_config.get<boolean>('saveBeforeSend', true)) {
        const saved = await my_editor.document.save();
        if (!saved) {
            vscode.window.showErrorMessage('Failed to save file before sending to Stata.');
            return;
        }
    }

    let my_code: string;
    
    if (mode === 'statement') {
        if (!my_editor.selection.isEmpty) {
            my_code = my_editor.document.getText(my_editor.selection);
        } else {
            const my_statement = detect_statement(my_editor.document, 
                my_editor.selection.active.line);
            my_code = get_statement_text(my_editor.document, my_statement);
        }
    } else if (mode === 'upward') {
        const my_bounds = get_upward_bounds(my_editor.document, 
            my_editor.selection.active.line);
        my_code = get_statement_text(my_editor.document, my_bounds);
    } else if (mode === 'downward') {
        const my_bounds = get_downward_bounds(my_editor.document, 
            my_editor.selection.active.line);
        my_code = get_statement_text(my_editor.document, my_bounds);
    } else {
        my_code = my_editor.document.getText();
    }

    // Apply working directory prefix if configured
    const working_dir = my_config.get<'none' | 'file' | 'workspace'>(
        'workingDirectory', 'none');
    my_code = prepare_content_with_cd(my_code, my_editor.document, working_dir);

    try {
        const my_temp_file = await create_temp_file(my_code);

        if (target === 'app') {
            if (process.platform === 'win32') {
                vscode.window.showErrorMessage(
                    'Windows support coming soon. Use terminal mode for now.');
                return;
            }
            if (process.platform !== 'darwin') {
                vscode.window.showErrorMessage(
                    'Stata application mode is only available on macOS. ' +
                    'Use terminal mode instead.');
                return;
            }
            
            const my_stata_app = await detect_stata_app();
            if (!my_stata_app) {
                vscode.window.showErrorMessage(
                    'Stata not found. Install Stata in /Applications/Stata/ or ' +
                    'configure sight.sendToStata.stataApp setting.');
                return;
            }
            
            await send_to_stata_app(my_stata_app, command, my_temp_file);
        } else {
            await send_to_terminal(command, my_temp_file);
        }
    } catch (my_error) {
        vscode.window.showErrorMessage(
            `Error: ${my_error instanceof Error ? my_error.message : my_error}`);
    }
}

export function register_send_to_stata_commands(
    context: vscode.ExtensionContext
): void {
    const my_commands: Array<[string, 'statement' | 'upward' | 'downward' | 'file', StataCommand, 'app' | 'terminal']> = [
        ['sight.doLineOrSelection', 'statement', 'do', 'app'],
        ['sight.doUpwardLines', 'upward', 'do', 'app'],
        ['sight.doDownwardLines', 'downward', 'do', 'app'],
        ['sight.doFile', 'file', 'do', 'app'],
        ['sight.includeLineOrSelection', 'statement', 'include', 'app'],
        ['sight.includeFile', 'file', 'include', 'app'],
        ['sight.terminal.doLineOrSelection', 'statement', 'do', 'terminal'],
        ['sight.terminal.doUpwardLines', 'upward', 'do', 'terminal'],
        ['sight.terminal.doDownwardLines', 'downward', 'do', 'terminal'],
        ['sight.terminal.doFile', 'file', 'do', 'terminal'],
        ['sight.terminal.includeLineOrSelection', 'statement', 'include', 
         'terminal'],
        ['sight.terminal.includeFile', 'file', 'include', 'terminal']
    ];

    for (const [my_cmd_name, my_mode, my_command, my_target] of my_commands) {
        const my_disposable = vscode.commands.registerCommand(my_cmd_name, 
            () => handle_send_command(
                my_mode,
                my_command,
                my_target
            )
        );
        context.subscriptions.push(my_disposable);
    }
}