import * as vscode from 'vscode';
import { DataBrowserPanel } from './browser-panel';
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
        private readonly extension_uri: vscode.Uri
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

        const my_html = build_data_browser_html(
            webview_panel.webview,
            this.extension_uri,
            my_nonce
        );

        new DataBrowserPanel(
            webview_panel,
            my_sidecar,
            document.uri.fsPath,
            my_html
        );
    }
}

export function register_data_browser_custom_editor(
    context: vscode.ExtensionContext
): void {
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            DATA_BROWSER_EDITOR_VIEW_TYPE,
            new DataBrowserReadonlyEditorProvider(
                context.extensionUri
            ),
            {
                supportsMultipleEditorsPerDocument: true,
            }
        )
    );
}
