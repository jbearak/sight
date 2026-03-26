/**
 * Webview HTML Document Builder
 *
 * Assembles a complete HTML document for the SMCL preview webview,
 * including theme-aware CSS, Content Security Policy, and the
 * client-side script for cross-reference navigation.
 */

import { SmclHtmlResult } from './smcl-to-html';

export function build_webview_html(
    result: SmclHtmlResult,
    nonce: string,
    title: string
): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${escape_attr(title)}</title>
<style nonce="${nonce}">
${SMCL_CSS}
</style>
</head>
<body>
<div class="smcl-document">
${result.html}
</div>
<script nonce="${nonce}">
${WEBVIEW_SCRIPT}
</script>
</body>
</html>`;
}

function escape_attr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const SMCL_CSS = `
/* Base */
body {
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: var(--vscode-editor-font-size, 14px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 24px;
    line-height: 1.5;
    max-width: 100ch;
}

/* Headings */
.smcl-title {
    font-size: 1.3em;
    font-weight: bold;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding-bottom: 6px;
    margin: 1.2em 0 0.6em 0;
}
.smcl-dlgtab {
    font-size: 1.1em;
    font-weight: bold;
    margin: 1em 0 0.4em 4ch;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-panel-border, #444);
}

/* Horizontal rules */
hr.smcl-hline {
    border: none;
    border-top: 1px solid var(--vscode-panel-border);
    margin: 0.5em 0;
}
.smcl-hline-inline {
    color: var(--vscode-panel-border);
    letter-spacing: -0.2ch;
}

/* Code / commands */
code.smcl-cmd,
code.smcl-opt {
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    font-size: 1em;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
    padding: 1px 4px;
    border-radius: 3px;
}

/* Color styles (log file output) */
.smcl-txt { color: var(--vscode-foreground); }
.smcl-com { font-weight: bold; }
.smcl-res { font-weight: bold; color: var(--vscode-textLink-foreground, #0066cc); }
.smcl-err { color: var(--vscode-errorForeground, #cc0000); }
.smcl-inp { color: var(--vscode-terminal-ansiYellow, #cc6600); }
.smcl-hi  { color: var(--vscode-textLink-foreground, #0066cc); }

/* Paragraphs */
.smcl-p    { margin: 0.3em 0; }
.smcl-pstd { margin: 0.3em 0; padding-left: 4ch; padding-right: 2ch; }
.smcl-psee { margin: 0.3em 0; padding-left: 4ch; text-indent: 9ch; padding-right: 2ch; }
.smcl-phang  { margin: 0.3em 0; padding-left: 8ch; text-indent: -4ch; padding-right: 2ch; }
.smcl-phang2 { margin: 0.3em 0; padding-left: 12ch; text-indent: -4ch; padding-right: 2ch; }
.smcl-phang3 { margin: 0.3em 0; padding-left: 16ch; text-indent: -4ch; padding-right: 2ch; }
.smcl-pmore  { margin: 0.3em 0; padding-left: 8ch; padding-right: 2ch; }
.smcl-pmore2 { margin: 0.3em 0; padding-left: 12ch; padding-right: 2ch; }
.smcl-pmore3 { margin: 0.3em 0; padding-left: 16ch; padding-right: 2ch; }
.smcl-pin    { margin: 0.3em 0; padding-left: 8ch; padding-right: 2ch; }
.smcl-pin2   { margin: 0.3em 0; padding-left: 12ch; padding-right: 2ch; }
.smcl-pin3   { margin: 0.3em 0; padding-left: 16ch; padding-right: 2ch; }

/* Inline layout */
.smcl-bind { white-space: nowrap; }
.smcl-center { text-align: center; }
.smcl-right { text-align: right; }
.smcl-col { display: inline-block; }

/* Variable placeholders */
.smcl-varplaceholder { font-style: italic; }
.smcl-ifin, .smcl-weight { font-style: normal; }

/* Asis (preformatted) */
.smcl-asis {
    font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
    white-space: pre;
}

/* Links */
a.smcl-help-link,
a.smcl-browse,
a.smcl-jumpto {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: pointer;
}
a.smcl-help-link:hover,
a.smcl-browse:hover,
a.smcl-jumpto:hover {
    text-decoration: underline;
}
a.smcl-stata {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    cursor: default;
    opacity: 0.8;
}
.smcl-manlink,
.smcl-mansection {
    color: var(--vscode-foreground);
}

/* Synopt tables */
table.smcl-synopt-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
    table-layout: fixed;
}
table.smcl-synopt-table td,
table.smcl-synopt-table th {
    padding: 2px 8px;
    vertical-align: top;
    text-align: left;
}
.smcl-synopt-col1 {
    width: 30%;
    white-space: nowrap;
    padding-left: 4ch;
}
.smcl-synopt-col2 {
    width: 70%;
}
tr.smcl-synopthdr th {
    font-weight: normal;
    font-style: italic;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding-left: 4ch;
}
tr.smcl-synoptline td hr {
    border: none;
    border-top: 1px solid var(--vscode-panel-border);
    margin: 2px 0;
}
tr.smcl-syntab td {
    padding-top: 0.8em;
    padding-left: 2ch;
    font-weight: bold;
}
tr.smcl-synopt-row td {
    padding: 1px 8px;
}

/* Two-column layout tables */
table.smcl-p2col-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
    table-layout: fixed;
}
table.smcl-p2col-table td {
    padding: 2px 8px;
    vertical-align: top;
}
.smcl-p2col-col1 {
    width: 40%;
    padding-left: 4ch;
}
.smcl-p2col-col2 {
    width: 60%;
}

/* Document container */
.smcl-document {
    white-space: pre-wrap;
    word-wrap: break-word;
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 10px;
}
::-webkit-scrollbar-track {
    background: var(--vscode-editor-background);
}
::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
}
::-webkit-scrollbar-thumb:hover {
    background: var(--vscode-scrollbarSlider-hoverBackground);
}
`;

// ---------------------------------------------------------------------------
// Client-side script for the webview
// ---------------------------------------------------------------------------

const WEBVIEW_SCRIPT = `
(function() {
    const vscode = acquireVsCodeApi();

    // Handle cross-reference link clicks
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[data-smcl-topic]');
        if (link) {
            e.preventDefault();
            const topic = link.getAttribute('data-smcl-topic');
            if (topic) {
                vscode.postMessage({ type: 'navigate', topic: topic });
            }
            return;
        }

        // Handle in-page anchor links
        const anchor = e.target.closest('a.smcl-jumpto');
        if (anchor) {
            const href = anchor.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const target = document.getElementById(href.substring(1));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            }
            return;
        }

        // Handle external browse links - let VS Code handle them
        const browse = e.target.closest('a.smcl-browse');
        if (browse) {
            e.preventDefault();
            const url = browse.getAttribute('href');
            if (url) {
                vscode.postMessage({ type: 'openExternal', url: url });
            }
            return;
        }
    });
})();
`;
