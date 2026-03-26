/**
 * SMCL Preview Module
 *
 * Registers commands and keybindings for the SMCL preview feature.
 * Entry point called from extension.ts.
 */

import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { SmclPanelManager } from './panel-manager';

/**
 * Resolve the source file URI from the command argument (explorer/title
 * context menu) or the currently active text editor.
 */
function resolve_source_uri(arg: unknown): vscode.Uri | undefined {
    if (arg instanceof vscode.Uri) {
        return arg;
    }
    return vscode.window.activeTextEditor?.document.uri;
}

export function register_smcl_preview(
    context: vscode.ExtensionContext,
    get_client: () => LanguageClient | null
): void {
    const my_manager = new SmclPanelManager(get_client);
    context.subscriptions.push(my_manager);

    // Side-by-side preview (default)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.openSmclPreview',
            (arg: unknown) => {
                const my_uri = resolve_source_uri(arg);
                if (!my_uri) {
                    vscode.window.showErrorMessage(
                        'No SMCL file selected. Open an SMCL or sthlp file first.'
                    );
                    return;
                }
                my_manager.open_or_reveal(
                    my_uri,
                    vscode.ViewColumn.Beside
                );
            }
        )
    );

    // Full-width preview (Alt/Option held)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.openSmclPreviewFull',
            (arg: unknown) => {
                const my_uri = resolve_source_uri(arg);
                if (!my_uri) {
                    vscode.window.showErrorMessage(
                        'No SMCL file selected. Open an SMCL or sthlp file first.'
                    );
                    return;
                }
                my_manager.open_or_reveal(
                    my_uri,
                    vscode.ViewColumn.Active
                );
            }
        )
    );
}
