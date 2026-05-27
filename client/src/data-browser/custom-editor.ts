import * as vscode from 'vscode';
import { DataBrowserPanel } from './browser-panel';
import type { DataBrowserColumnWidthStore } from './column-width-state';
import type { DataBrowserColumnVisibilityStore } from './column-visibility-state';
import type { DataBrowserSortStateStore } from './sort-state';
import type { DataBrowserFilterStateStore } from './filter-state';
import {
    build_direct_open_sidecar,
    DATA_BROWSER_EDITOR_VIEW_TYPE,
} from './opening';
import {
    build_data_browser_html,
    generate_nonce,
} from './webview-html';

class DataBrowserDocument
    implements vscode.CustomDocument {

    constructor(
        public readonly uri: vscode.Uri
    ) {}

    dispose(): void {}
}

export class DataBrowserReadonlyEditorProvider
    implements vscode.CustomReadonlyEditorProvider<DataBrowserDocument> {

    constructor(
        private readonly extension_uri: vscode.Uri,
        private readonly column_width_store: DataBrowserColumnWidthStore,
        private readonly column_visibility_store: DataBrowserColumnVisibilityStore,
        private readonly sort_state_store: DataBrowserSortStateStore,
        private readonly filter_state_store: DataBrowserFilterStateStore
    ) {}

    async openCustomDocument(
        uri: vscode.Uri
    ): Promise<DataBrowserDocument> {
        return new DataBrowserDocument(uri);
    }

    async resolveCustomEditor(
        document: DataBrowserDocument,
        webview_panel: vscode.WebviewPanel
    ): Promise<void> {
        const my_sidecar = build_direct_open_sidecar(
            document.uri.fsPath
        );
        const my_nonce = generate_nonce();

        webview_panel.title = `Data: ${my_sidecar.name}`;
        webview_panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(
                    this.extension_uri,
                    'dist',
                    'data-browser-webview'
                ),
            ],
        };

        const my_html = build_data_browser_html(
            webview_panel.webview,
            this.extension_uri,
            my_nonce
        );

        new DataBrowserPanel(
            webview_panel,
            my_sidecar,
            document.uri.fsPath,
            my_html,
            this.column_width_store,
            this.column_visibility_store,
            this.sort_state_store,
            this.filter_state_store
        );
    }
}

export function register_data_browser_custom_editor(
    context: vscode.ExtensionContext,
    column_width_store: DataBrowserColumnWidthStore,
    column_visibility_store: DataBrowserColumnVisibilityStore,
    sort_state_store: DataBrowserSortStateStore,
    filter_state_store: DataBrowserFilterStateStore
): void {
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            DATA_BROWSER_EDITOR_VIEW_TYPE,
            new DataBrowserReadonlyEditorProvider(
                context.extensionUri,
                column_width_store,
                column_visibility_store,
                sort_state_store,
                filter_state_store
            ),
            {
                supportsMultipleEditorsPerDocument: true,
            }
        )
    );
}
