import * as crypto from 'crypto';
import * as vscode from 'vscode';

export function generate_nonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function build_data_browser_html(
    webview: vscode.Webview,
    extension_uri: vscode.Uri,
    nonce: string
): string {
    const my_js_uri = webview.asWebviewUri(
        vscode.Uri.joinPath(
            extension_uri,
            'dist',
            'data-browser-webview',
            'index.js'
        )
    );
    const my_css_uri = webview.asWebviewUri(
        vscode.Uri.joinPath(
            extension_uri,
            'dist',
            'data-browser-webview',
            'index.css'
        )
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               style-src ${webview.cspSource} 'nonce-${nonce}';
               script-src 'nonce-${nonce}';
               img-src ${webview.cspSource} https: data:;
               font-src ${webview.cspSource};">
<title>Data Browser</title>
<link nonce="${nonce}" rel="stylesheet" href="${my_css_uri}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${my_js_uri}"></script>
</body>
</html>`;
}
