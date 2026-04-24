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

    // Help topic preview. Invoked from hover/completion markdown
    // links (topic passed as argument) or from the command palette
    // (no argument — we prompt the user for a topic).
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sight.openHelpTopic',
            async (arg: unknown) => {
                let my_topic = extract_topic(arg);
                if (!my_topic) {
                    my_topic = await prompt_for_topic();
                }
                if (!my_topic) {
                    return;
                }
                await my_manager.open_topic(
                    my_topic,
                    vscode.ViewColumn.Beside
                );
            }
        )
    );
}

async function prompt_for_topic(): Promise<string | null> {
    const my_input = await vscode.window.showInputBox({
        title: 'Sight: Open Help Topic',
        prompt: 'Enter a Stata help topic (e.g. regress, frame create, display)',
        placeHolder: 'regress',
        ignoreFocusOut: true,
        validateInput: value => {
            if (!value || value.trim().length === 0) {
                return 'Please enter a help topic.';
            }
            return null;
        },
    });
    return my_input ? my_input.trim() : null;
}

function extract_topic(arg: unknown): string | null {
    if (typeof arg === 'string' && arg.length > 0) {
        return arg;
    }
    if (
        arg
        && typeof arg === 'object'
        && 'topic' in arg
        && typeof (arg as { topic: unknown }).topic === 'string'
    ) {
        const my_topic = (arg as { topic: string }).topic;
        return my_topic.length > 0 ? my_topic : null;
    }
    return null;
}
