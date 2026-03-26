/**
 * SMCL Preview Panel
 *
 * Manages a single webview panel displaying rendered SMCL content.
 * Handles file reading, rendering, debounced updates on file changes,
 * cross-reference navigation messages, and bidirectional scroll sync.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { smcl_to_html } from './smcl-to-html';
import { build_webview_html } from './webview-html';

const UPDATE_DEBOUNCE_MS = 300;
const SCROLL_SYNC_SUPPRESSION_MS = 80;

export class SmclPreviewPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    private source_uri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private debounce_timer: ReturnType<typeof setTimeout> | undefined;
    private on_navigate: (topic: string) => void;

    // Scroll sync state
    private scroll_sync_source: 'editor' | 'preview' | null = null;
    private scroll_sync_timeout: ReturnType<typeof setTimeout> | undefined;

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

        // Scroll sync: editor → preview
        this.disposables.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(event => {
                if (
                    event.textEditor.document.uri.toString() ===
                    this.source_uri.toString()
                ) {
                    this.sync_editor_to_preview(event.visibleRanges);
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
        if (this.scroll_sync_timeout !== undefined) {
            clearTimeout(this.scroll_sync_timeout);
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

        // Restore scroll position after full HTML replacement
        const my_editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === this.source_uri.toString()
        );
        if (my_editor) {
            this.sync_editor_to_preview(my_editor.visibleRanges);
        }
    }

    private read_content(): string | null {
        const my_open_doc = vscode.workspace.textDocuments.find(
            doc => doc.uri.toString() === this.source_uri.toString()
        );
        if (my_open_doc) {
            return my_open_doc.getText();
        }

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

    // ---------------------------------------------------------------
    // Scroll sync
    // ---------------------------------------------------------------

    private sync_editor_to_preview(
        visible_ranges: readonly vscode.Range[]
    ): void {
        if (this.scroll_sync_source === 'preview') return;
        if (visible_ranges.length === 0) return;

        const my_top_line = visible_ranges[0].start.line;
        this.set_scroll_source('editor');
        this.panel.webview.postMessage({
            type: 'scrollToLine',
            line: my_top_line,
        });
    }

    private sync_preview_to_editor(line: number): void {
        // Prevent feedback loop
        if (this.scroll_sync_source === 'editor') return;

        const my_editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === this.source_uri.toString()
        );
        if (!my_editor) return;

        this.set_scroll_source('preview');
        my_editor.revealRange(
            new vscode.Range(line, 0, line, 0),
            vscode.TextEditorRevealType.AtTop
        );
    }

    private set_scroll_source(source: 'editor' | 'preview'): void {
        this.scroll_sync_source = source;
        if (this.scroll_sync_timeout !== undefined) {
            clearTimeout(this.scroll_sync_timeout);
        }
        this.scroll_sync_timeout = setTimeout(() => {
            this.scroll_sync_source = null;
            this.scroll_sync_timeout = undefined;
        }, SCROLL_SYNC_SUPPRESSION_MS);
    }

    // ---------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------

    private handle_message(
        message: { type: string; [key: string]: unknown }
    ): void {
        switch (message.type) {
            case 'navigate':
                if (typeof message.topic === 'string') {
                    this.on_navigate(message.topic);
                }
                break;
            case 'openExternal':
                if (typeof message.url === 'string') {
                    vscode.env.openExternal(
                        vscode.Uri.parse(message.url)
                    );
                }
                break;
            case 'revealLine':
                if (typeof message.line === 'number') {
                    this.sync_preview_to_editor(message.line);
                }
                break;
        }
    }
}
