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
        column: vscode.ViewColumn
    ): void {
        const my_key = source_uri.toString();
        const my_existing = this.panels.get(my_key);

        if (my_existing) {
            my_existing.reveal(column);
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
            topic => this.handle_navigate(topic)
        );

        my_preview.on_did_dispose(() => {
            this.panels.delete(my_key);
        });

        this.panels.set(my_key, my_preview);
    }

    private async handle_navigate(topic: string): Promise<void> {
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
            }>('sight/resolveSthlpFile', { topic });

            if (my_result?.file_path) {
                const my_uri = vscode.Uri.file(my_result.file_path);
                this.open_or_reveal(my_uri, vscode.ViewColumn.Beside);
            } else {
                vscode.window.showInformationMessage(
                    `Help file not found for: ${topic}`
                );
            }
        } catch {
            vscode.window.showInformationMessage(
                `Could not resolve help file for: ${topic}`
            );
        }
    }

    dispose(): void {
        for (const my_panel of this.panels.values()) {
            my_panel.dispose();
        }
        this.panels.clear();
    }
}
