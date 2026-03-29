import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from 'vscode-languageclient/node';
import {
    detect_statement,
    get_statement_text,
    get_upward_bounds,
    get_downward_bounds,
    create_temp_file,
    detect_stata_app,
    send_to_stata_app,
    send_to_terminal,
    send_to_stata_terminal,
    StataCommand
} from './index';
import { send_to_stata_windows } from './windows-sender';
import { compute_cursor_position } from './cursor-advance-core';
import { escape_path_for_stata } from './cd-commands';

export type WorkingDirectoryOption = 'none' | 'file' | 'workspace' | 'lsp';
export type SendTargetSetting = 'auto' | 'integrated' | 'external';

let language_client: LanguageClient | null = null;

/**
 * Set the language client for LSP requests.
 */
export function set_language_client(
    client: LanguageClient | null
): void {
    language_client = client;
}

/**
 * Get working directory from LSP server.
 * Returns null if request fails or no working directory is set.
 */
async function get_lsp_working_directory(uri: string): Promise<string | null> {
    if (!language_client) {
        return null;
    }
    try {
        const result = await language_client.sendRequest<{ workingDirectory: string | null }>(
            'sight/getWorkingDirectory',
            { uri }
        );
        return result.workingDirectory;
    } catch {
        return null;
    }
}

/**
 * Advances the cursor to the next line if conditions are met.
 * @param editor - The active text editor
 * @param statement_end_line - The last line of the sent statement (0-indexed)
 */
function advance_cursor_if_enabled(
    editor: vscode.TextEditor,
    statement_end_line: number
): void {
    const my_config = vscode.workspace.getConfiguration('sight.sendToStata');
    const setting_enabled = my_config.get<boolean>('advanceCursorOnSend', true);
    
    const result = compute_cursor_position(
        statement_end_line + 1,
        editor.document.lineCount,
        setting_enabled
    );
    
    if (!result) {
        return;
    }
    
    const new_position = new vscode.Position(result.line, result.column);
    editor.selection = new vscode.Selection(new_position, new_position);
    editor.revealRange(new vscode.Range(new_position, new_position));
}

/**
 * Prepends a cd command to the content based on workingDirectory setting.
 */
export async function prepare_content_with_cd(
    content: string,
    document: vscode.TextDocument,
    working_directory: WorkingDirectoryOption
): Promise<string> {
    if (working_directory === 'none') {
        return content;
    }
    
    let directory: string | null = null;
    
    if (working_directory === 'lsp') {
        directory = await get_lsp_working_directory(document.uri.toString());
        if (directory === null) {
            return content;  // Fall back to 'none' behavior
        }
    } else if (working_directory === 'file') {
        directory = path.dirname(document.uri.fsPath);
    } else {
        const workspace_folder = vscode.workspace.getWorkspaceFolder(document.uri);
        directory = workspace_folder?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    }
    
    // Escape path for Stata using proper escaping (handles backslashes and quotes)
    const { escaped, use_compound } = escape_path_for_stata(directory);
    if (use_compound) {
        return `cd \`"${escaped}"'\n${content}`;
    } else {
        return `cd "${escaped}"\n${content}`;
    }
}

/**
 * Resolve the effective send target based on the user's target setting
 * and whether VS Code is running in a remote environment.
 *
 * - 'app' commands respect the target setting (auto/integrated/external)
 * - 'terminal' commands always go to the active terminal (unchanged)
 */
export function resolve_effective_target(
    requested_target: 'app' | 'terminal'
): 'app' | 'integrated' | 'terminal' | null {
    if (requested_target === 'terminal') {
        return 'terminal';
    }

    const my_config = vscode.workspace.getConfiguration(
        'sight.sendToStata'
    );
    const setting = my_config.get<SendTargetSetting>(
        'target', 'auto'
    );
    const is_remote = vscode.env.remoteName !== undefined
        && vscode.env.remoteName !== '';

    if (setting === 'integrated') {
        // No interactive Stata CLI on Windows (batch mode only).
        // Fall back to GUI; remote sessions connect to a host
        // that may have an interactive CLI.
        if (process.platform === 'win32' && !is_remote) {
            vscode.window.showWarningMessage(
                'The integrated Stata terminal is not available ' +
                'on Windows (Stata has no interactive CLI on ' +
                'this platform). Falling back to the Stata GUI. ' +
                'Use a remote session (SSH, WSL) for integrated ' +
                'terminal support.'
            );
            return 'app';
        }
        return 'integrated';
    }

    if (setting === 'external') {
        if (is_remote) {
            vscode.window.showErrorMessage(
                'The "external" send target is not available ' +
                'in remote sessions. Change ' +
                'sight.sendToStata.target to "auto" or ' +
                '"integrated".'
            );
            return null;
        }
        return 'app';
    }

    // 'auto': remote → integrated, local macOS/Windows → app,
    // local Linux → integrated
    if (is_remote) {
        return 'integrated';
    }
    if (
        process.platform === 'darwin'
        || process.platform === 'win32'
    ) {
        return 'app';
    }
    return 'integrated';
}

async function handle_send_command(
    mode: 'statement' | 'upward' | 'downward' | 'file',
    command: StataCommand,
    target: 'app' | 'terminal',
    context: vscode.ExtensionContext
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
    let statement_end_line: number | null = null;
    
    if (mode === 'statement') {
        if (!my_editor.selection.isEmpty) {
            my_code = my_editor.document.getText(my_editor.selection);
        } else {
            const my_statement = detect_statement(my_editor.document, 
                my_editor.selection.active.line);
            my_code = get_statement_text(my_editor.document, my_statement);
            statement_end_line = my_statement.end_line;
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
    const working_dir = my_config.get<WorkingDirectoryOption>(
        'workingDirectory', 'lsp');
    my_code = await prepare_content_with_cd(my_code, my_editor.document, working_dir);

    try {
        const effective_target = resolve_effective_target(target);

        if (effective_target === null) {
            return;
        }

        const my_temp_file = await create_temp_file(my_code);

        if (effective_target === 'integrated') {
            await send_to_stata_terminal(command, my_temp_file);
        } else if (effective_target === 'app') {
            if (process.platform === 'win32') {
                await send_to_stata_windows(command, my_temp_file, context);
            } else if (process.platform !== 'darwin') {
                vscode.window.showErrorMessage(
                    'Stata application mode is only available on macOS ' +
                    'and Windows. Use terminal mode instead.');
                return;
            } else {
                const my_stata_app = await detect_stata_app();
                if (!my_stata_app) {
                    vscode.window.showErrorMessage(
                        'Stata not found. Install Stata in ' +
                        '/Applications/Stata/ or configure ' +
                        'sight.sendToStata.stataApp setting.');
                    return;
                }

                await send_to_stata_app(my_stata_app, command, my_temp_file,
                    my_config.get<boolean>('focusStataWindow', false));
            }
        } else {
            await send_to_terminal(command, my_temp_file);
        }
        
        // Advance cursor for single-line sends (statement mode without selection)
        if (statement_end_line !== null) {
            advance_cursor_if_enabled(my_editor, statement_end_line);
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
                my_target,
                context
            )
        );
        context.subscriptions.push(my_disposable);
    }
}
