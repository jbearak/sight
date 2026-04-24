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
import { LanguageClient } from 'vscode-languageclient/node';
import { smcl_to_html } from './smcl-to-html';
import { build_webview_html } from './webview-html';

const UPDATE_DEBOUNCE_MS = 300;
const SCROLL_SYNC_SUPPRESSION_MS = 80;

/**
 * Regex used to extract `{findalias <alias>}` directives from raw
 * SMCL before handing off to the renderer. We only need a best-effort
 * scan to collect unique aliases for parallel LSP resolution; the
 * canonical parse happens later inside `smcl_to_html`.
 */
const FINDALIAS_RE = /\{\s*findalias\s+([^}]+?)\s*\}/g;

export class SmclPreviewPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel;
    private source_uri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private debounce_timer: ReturnType<typeof setTimeout> | undefined;
    private on_navigate: (topic: string) => void;
    private get_client: () => LanguageClient | null;
    private disposed = false;

    // Cache of `{findalias}` resolutions (alias → SMCL substitution or
    // `null` for misses). Shared across refreshes for a given panel so
    // debounced edits and scroll-sync redraws don't re-query the LSP.
    private findalias_cache: Map<string, string> = new Map();

    // Scroll sync state
    private scroll_sync_source: 'editor' | 'preview' | null = null;
    private scroll_sync_timeout: ReturnType<typeof setTimeout> | undefined;

    constructor(
        source_uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        on_navigate: (topic: string) => void,
        get_client: () => LanguageClient | null
    ) {
        this.source_uri = source_uri;
        this.panel = panel;
        this.on_navigate = on_navigate;
        this.get_client = get_client;

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

        // Clear findalias cache when ado-path configuration changes
        // so stale null-misses don't persist after new .maint files
        // become available.
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('sight.adoPaths')) {
                    this.findalias_cache.clear();
                    this.schedule_update();
                }
            })
        );

        // Initial render
        void this.refresh();
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

    /**
     * Clean up listeners and timers without disposing the panel.
     * Called when the panel is closed by the user (onDidDispose).
     */
    cleanup(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.debounce_timer !== undefined) {
            clearTimeout(this.debounce_timer);
        }
        if (this.scroll_sync_timeout !== undefined) {
            clearTimeout(this.scroll_sync_timeout);
        }
        for (const my_disposable of this.disposables) {
            my_disposable.dispose();
        }
    }

    dispose(): void {
        this.cleanup();
        this.panel.dispose();
    }

    private schedule_update(): void {
        if (this.debounce_timer !== undefined) {
            clearTimeout(this.debounce_timer);
        }
        this.debounce_timer = setTimeout(() => {
            this.debounce_timer = undefined;
            void this.refresh();
        }, UPDATE_DEBOUNCE_MS);
    }

    private async refresh(): Promise<void> {
        // Try to get content from open editor first; fall back to disk
        const my_content = this.read_content();
        if (my_content === null) return;

        const my_findalias_map = await this.resolve_findalias_map(my_content);

        // If the panel was disposed while we were awaiting LSP
        // responses, bail out rather than writing to a dead webview.
        if (this.disposed) return;

        const my_result = smcl_to_html(my_content, {
            findalias_map: my_findalias_map,
        });
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

    /**
     * Collect unique `{findalias X}` aliases in the source and resolve
     * them via the LSP. Returns a map of alias → SMCL substitution
     * containing only successful resolutions (misses are omitted so
     * the renderer can fall back to its empty-string behavior).
     *
     * Resolutions are cached for the lifetime of the panel so repeat
     * renders caused by debounced edits or scroll sync don't re-hit
     * the LSP.
     */
    private async resolve_findalias_map(
        content: string
    ): Promise<Map<string, string>> {
        const the_aliases = collect_findalias_names(content);
        const my_map = new Map<string, string>();
        if (the_aliases.size === 0) return my_map;

        const my_client = this.get_client();
        // Pull cached hits up-front so we only query the LSP for misses.
        const the_unresolved: string[] = [];
        for (const my_alias of the_aliases) {
            const my_cached = this.findalias_cache.get(my_alias);
            if (my_cached !== undefined) {
                my_map.set(my_alias, my_cached);
                continue;
            }
            the_unresolved.push(my_alias);
        }

        if (the_unresolved.length === 0 || !my_client) {
            return my_map;
        }

        const the_results = await Promise.all(
            the_unresolved.map(async (my_alias) => {
                try {
                    const my_response = await my_client.sendRequest<{
                        smcl: string | null;
                    }>('sight/resolveFindalias', { alias: my_alias });
                    return { alias: my_alias, smcl: my_response?.smcl ?? null };
                } catch {
                    // Server unavailable / handler unregistered: treat
                    // like a miss. Don't cache so we retry next refresh.
                    return { alias: my_alias, smcl: null, skip_cache: true };
                }
            })
        );

        for (const my_result of the_results) {
            // Only cache hits — null misses are intentionally not
            // cached so that newly installed .maint files are picked
            // up on the next refresh without reopening the panel.
            if (my_result.smcl !== null) {
                if (!('skip_cache' in my_result)) {
                    this.findalias_cache.set(my_result.alias, my_result.smcl);
                }
                my_map.set(my_result.alias, my_result.smcl);
            }
        }
        return my_map;
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

/**
 * Best-effort extraction of unique `{findalias <alias>}` arguments
 * from raw SMCL text. Returns a set so duplicates trigger only one
 * LSP lookup per alias.
 *
 * Exported for tests. We rely on the pattern being non-nested (Stata
 * never puts `{` inside `{findalias …}` args), which matches every
 * real-world occurrence in the ado base tree.
 */
export function collect_findalias_names(source: string): Set<string> {
    const the_names = new Set<string>();
    FINDALIAS_RE.lastIndex = 0;
    let my_match: RegExpExecArray | null;
    while ((my_match = FINDALIAS_RE.exec(source)) !== null) {
        const my_alias = my_match[1].trim();
        if (my_alias.length > 0) {
            the_names.add(my_alias);
        }
    }
    return the_names;
}
