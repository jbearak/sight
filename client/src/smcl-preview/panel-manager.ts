/**
 * SMCL Preview Panel Manager
 *
 * Manages the lifecycle of all open SMCL preview panels.
 * Ensures one panel per source file, handles reveal-if-already-open,
 * and routes cross-reference navigation to open new previews.
 */

import * as vscode from 'vscode';
import { SmclPreviewPanel } from './preview-panel';
import { LanguageClient } from 'vscode-languageclient/node';

const VIEW_TYPE = 'sightSmclPreview';

export class SmclPanelManager implements vscode.Disposable {
    private panels = new Map<string, SmclPreviewPanel>();
    private get_client: () => LanguageClient | null;

    constructor(get_client: () => LanguageClient | null) {
        this.get_client = get_client;
    }

    open_or_reveal(
        source_uri: vscode.Uri,
        column: vscode.ViewColumn,
        anchor?: string
    ): void {
        const my_key = source_uri.toString();
        const my_existing = this.panels.get(my_key);

        if (my_existing) {
            my_existing.reveal(column);
            if (anchor) {
                my_existing.scroll_to_anchor(anchor);
            }
            return;
        }

        const my_name = source_uri.fsPath.split(/[\\/]/).pop() || 'SMCL';
        const my_panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            `Preview ${my_name}`,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        const my_preview = new SmclPreviewPanel(
            source_uri,
            my_panel,
            (topic, anch) => this.handle_navigate(topic, anch),
            () => this.get_client()
        );

        my_preview.on_did_dispose(() => {
            this.panels.delete(my_key);
            my_preview.cleanup();
        });

        this.panels.set(my_key, my_preview);

        if (anchor) {
            setTimeout(() => {
                my_preview.scroll_to_anchor(anchor);
            }, 300);
        }
    }

    /**
     * Resolve a Stata help topic to a .sthlp file path via the LSP and
     * open the SMCL preview panel in the given column. Shows an
     * actionable info message when the topic cannot be resolved,
     * pointing the user at the `sight.adoPaths` setting which
     * controls the server-side help file search path.
     */
    async open_topic(
        topic: string,
        column: vscode.ViewColumn,
        anchor?: string
    ): Promise<void> {
        const my_client = this.get_client();
        if (!my_client) {
            vscode.window.showInformationMessage(
                'Language server not ready. Try again in a moment.'
            );
            return;
        }

        try {
            const my_result = await my_client.sendRequest<{
                file_path: string | null;
            }>('sight/resolveSthlpFile', { topic, anchor });

            if (my_result?.file_path) {
                const my_uri = vscode.Uri.file(my_result.file_path);
                this.open_or_reveal(my_uri, column, anchor);
            } else {
                await this.show_not_found_message(topic);
            }
        } catch (err) {
            console.error(
                `open_topic: sendRequest sight/resolveSthlpFile` +
                ` failed for topic="${topic}":`, err
            );
            await this.show_server_error_message(topic);
        }
    }

    private async show_server_error_message(
        topic: string
    ): Promise<void> {
        await vscode.window.showWarningMessage(
            `The language server encountered an error resolving` +
            ` help for '${topic}'. The server may still be` +
            ` starting up — try again in a moment.`
        );
    }

    private async show_not_found_message(topic: string): Promise<void> {
        const my_open_settings_label = 'Open Settings';
        const my_message =
            `Couldn't find a help file for '${topic}'.` +
            ` Sight searched your workspace and common Stata install` +
            ` locations (e.g. /Applications/Stata/ado, /usr/local/stata,` +
            ` C:\\Program Files\\Stata, and ~/ado). Add the directory` +
            ` containing the .sthlp file to sight.adoPaths if Sight is` +
            ` missing it.`;
        const my_choice = await vscode.window.showInformationMessage(
            my_message,
            my_open_settings_label
        );
        if (my_choice === my_open_settings_label) {
            await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'sight.adoPaths'
            );
        }
    }

    private handle_navigate(
        topic: string,
        anchor?: string
    ): Promise<void> {
        return this.open_topic(topic, vscode.ViewColumn.Active, anchor);
    }

    dispose(): void {
        for (const my_panel of this.panels.values()) {
            my_panel.dispose();
        }
        this.panels.clear();
    }
}
