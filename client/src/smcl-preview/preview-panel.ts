/**
 * SMCL Preview Panel
 *
 * Manages a single webview panel displaying rendered SMCL content.
 * Handles file reading, rendering, debounced updates on file changes,
 * and cross-reference navigation messages from the webview.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { smcl_to_html } from './smcl-to-html';
import { build_webview_html } from './webview-html';

const UPDATE_DEBOUNCE_MS = 300;

export class SmclPreviewPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    private source_uri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private debounce_timer: ReturnType<typeof setTimeout> | undefined;
    private on_navigate: (topic: string) => void;

    constructor(
        source_uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        on_navigate: (topic: string) => void
    ) {
        this.source_uri = source_uri;
        this.panel = panel;
        this.on_navigate = on_navigate;

        // Handle messages from the webview
        this.disposables.push(
            panel.webview.onDidReceiveMessage(
                message => this.handle_message(message)
            )
        );

        // Update when the source document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.toString() === this.source_uri.toString()) {
                    this.schedule_update();
                }
            })
        );

        // Also update on save (for files edited outside VS Code)
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(document => {
                if (document.uri.toString() === this.source_uri.toString()) {
                    this.refresh();
                }
            })
        );

        // Initial render
        this.refresh();
    }

    get uri_string(): string {
        return this.source_uri.toString();
    }

    reveal(column: vscode.ViewColumn): void {
        this.panel.reveal(column);
    }

    on_did_dispose(callback: () => void): void {
        this.disposables.push(this.panel.onDidDispose(callback));
    }

    dispose(): void {
        if (this.debounce_timer !== undefined) {
            clearTimeout(this.debounce_timer);
        }
        for (const my_disposable of this.disposables) {
            my_disposable.dispose();
        }
        this.panel.dispose();
    }

    private schedule_update(): void {
        if (this.debounce_timer !== undefined) {
            clearTimeout(this.debounce_timer);
        }
        this.debounce_timer = setTimeout(() => {
            this.debounce_timer = undefined;
            this.refresh();
        }, UPDATE_DEBOUNCE_MS);
    }

    private refresh(): void {
        // Try to get content from open editor first; fall back to disk
        const my_content = this.read_content();
        if (my_content === null) return;

        const my_result = smcl_to_html(my_content);
        const my_nonce = crypto.randomBytes(16).toString('hex');
        const my_title = this.get_title();

        this.panel.webview.html = build_webview_html(
            my_result,
            my_nonce,
            my_title
        );
    }

    private read_content(): string | null {
        // Check if the file is open in an editor (may have unsaved changes)
        const my_open_doc = vscode.workspace.textDocuments.find(
            doc => doc.uri.toString() === this.source_uri.toString()
        );
        if (my_open_doc) {
            return my_open_doc.getText();
        }

        // Read from disk
        try {
            return fs.readFileSync(this.source_uri.fsPath, 'utf-8');
        } catch {
            return null;
        }
    }

    private get_title(): string {
        const my_path = this.source_uri.fsPath;
        const my_name = my_path.split(/[\\/]/).pop() || 'SMCL Preview';
        return `Preview ${my_name}`;
    }

    private handle_message(message: { type: string; [key: string]: string }): void {
        switch (message.type) {
            case 'navigate':
                if (message.topic) {
                    this.on_navigate(message.topic);
                }
                break;
            case 'openExternal':
                if (message.url) {
                    vscode.env.openExternal(
                        vscode.Uri.parse(message.url)
                    );
                }
                break;
        }
    }
}
