/**
 * Data Browser Webview HTML
 *
 * Generates the complete HTML document for the data browser
 * webview.  Uses VS Code CSS variables for theming and
 * includes an inline script for the grid, lazy loading,
 * and toggle controls.
 */

import * as crypto from 'crypto';

export function generate_nonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function build_data_browser_html(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
              style-src 'nonce-${nonce}';
              script-src 'nonce-${nonce}';">
<title>Data Browser</title>
<style nonce="${nonce}">
${DATA_BROWSER_CSS}
</style>
</head>
<body>
<div id="toolbar">
    <span id="row-count"></span>
    <button id="btn-labels" class="toggle-btn"
            title="Toggle value labels">Labels</button>
    <button id="btn-formats" class="toggle-btn"
            title="Toggle display formats">Formats</button>
</div>
<div id="grid-container">
    <table id="data-grid">
        <thead><tr id="header-row"></tr></thead>
        <tbody id="grid-body"></tbody>
    </table>
</div>
<div id="status-bar"></div>
<script nonce="${nonce}">
${WEBVIEW_SCRIPT}
</script>
</body>
</html>`;
}

// -----------------------------------------------------------
// CSS
// -----------------------------------------------------------

const DATA_BROWSER_CSS = `
/* Reset */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: var(--vscode-editor-font-family,
        'Courier New', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100vh;
}

/* Toolbar */
#toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--vscode-editorGroupHeader-tabsBackground,
        var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
}
#row-count {
    font-size: 0.9em;
    opacity: 0.8;
    margin-right: auto;
}
.toggle-btn {
    background: var(--vscode-button-secondaryBackground,
        rgba(128,128,128,0.2));
    color: var(--vscode-button-secondaryForeground,
        var(--vscode-foreground));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 0.85em;
    font-family: inherit;
}
.toggle-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground,
        rgba(128,128,128,0.35));
}
.toggle-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
}

/* Grid container */
#grid-container {
    flex: 1;
    overflow: auto;
    position: relative;
}

/* Table */
#data-grid {
    border-collapse: separate;
    border-spacing: 0;
    width: max-content;
    min-width: 100%;
}
#data-grid th,
#data-grid td {
    padding: 2px 10px;
    white-space: nowrap;
    border-right: 1px solid
        var(--vscode-editorGroup-border,
            rgba(128,128,128,0.2));
    border-bottom: 1px solid
        var(--vscode-editorGroup-border,
            rgba(128,128,128,0.2));
}

/* Sticky column headers */
#data-grid thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--vscode-editorGroupHeader-tabsBackground,
        var(--vscode-editor-background));
    font-weight: bold;
    text-align: left;
    border-bottom: 2px solid var(--vscode-panel-border);
}

/* Sticky row number column */
#data-grid th:first-child,
#data-grid td:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--vscode-editorGroupHeader-tabsBackground,
        var(--vscode-editor-background));
    text-align: right;
    color: var(--vscode-editorLineNumber-foreground,
        rgba(128,128,128,0.6));
    min-width: 5ch;
}
/* Corner cell: sticky both directions */
#data-grid thead th:first-child {
    z-index: 3;
}

/* Numeric cells */
.cell-numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* Missing values */
.cell-missing {
    color: var(--vscode-disabledForeground,
        rgba(128,128,128,0.5));
    font-style: italic;
}

/* Variable label subtitle row */
.label-row th {
    font-weight: normal;
    font-style: italic;
    font-size: 0.85em;
    opacity: 0.7;
    border-bottom: 2px solid var(--vscode-panel-border);
}

/* Status bar */
#status-bar {
    padding: 2px 8px;
    font-size: 0.85em;
    opacity: 0.7;
    background: var(--vscode-statusBar-background,
        var(--vscode-editor-background));
    border-top: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
}

/* Scrollbar */
::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}
::-webkit-scrollbar-track {
    background: var(--vscode-editor-background);
}
::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
}
::-webkit-scrollbar-thumb:hover {
    background:
        var(--vscode-scrollbarSlider-hoverBackground);
}
`;

// -----------------------------------------------------------
// Client-side script
// -----------------------------------------------------------

const WEBVIEW_SCRIPT = `
(function() {
    var vscode = acquireVsCodeApi();

    // State
    var metadata = null;
    var totalRows = 0;
    var loadedRows = 0;
    var pendingRequest = false;
    var requestCounter = 0;
    var showLabels = true;
    var showFormats = false;
    var PAGE_SIZE = 200;
    var SCROLL_THRESHOLD = 400;

    // Elements
    var headerRow = document.getElementById('header-row');
    var gridBody = document.getElementById('grid-body');
    var rowCount = document.getElementById('row-count');
    var statusBar = document.getElementById('status-bar');
    var btnLabels = document.getElementById('btn-labels');
    var btnFormats = document.getElementById('btn-formats');
    var gridContainer =
        document.getElementById('grid-container');

    // -------------------------------------------------
    // HTML escaping
    // -------------------------------------------------

    function escapeHtml(text) {
        if (typeof text !== 'string') return String(text);
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // -------------------------------------------------
    // Metadata rendering
    // -------------------------------------------------

    function renderHeader() {
        if (!metadata) return;
        var html = '<th></th>';
        for (var i = 0; i < metadata.variables.length; i++) {
            var v = metadata.variables[i];
            var label = showLabels && v.label
                ? ' title="' + escapeHtml(v.label) + '"'
                : '';
            html += '<th' + label + '>'
                + escapeHtml(v.name) + '</th>';
        }
        headerRow.innerHTML = html;

        totalRows = metadata.nobs;
        rowCount.textContent = totalRows.toLocaleString()
            + ' obs \\u00D7 '
            + metadata.variables.length.toLocaleString()
            + ' vars';

        var info = metadata.name || '';
        if (metadata.dataset_label) {
            info += info ? ' \\u2014 ' : '';
            info += metadata.dataset_label;
        }
        statusBar.textContent = info;
    }

    // -------------------------------------------------
    // Row rendering
    // -------------------------------------------------

    function renderRows(start, rows) {
        var fragment = document.createDocumentFragment();
        for (var r = 0; r < rows.length; r++) {
            var tr = document.createElement('tr');
            // Row number cell
            var rowNum = start + r + 1;
            var tdNum = document.createElement('td');
            tdNum.textContent = String(rowNum);
            tr.appendChild(tdNum);

            var row = rows[r];
            for (var c = 0; c < row.length; c++) {
                var cell = row[c];
                var td = document.createElement('td');

                if (cell.missing_type) {
                    td.className = 'cell-missing';
                    td.textContent = cell.display;
                } else if (typeof cell.raw === 'number') {
                    td.className = 'cell-numeric';
                    td.textContent = cell.display;
                } else {
                    td.textContent = cell.display;
                }

                tr.appendChild(td);
            }
            fragment.appendChild(tr);
        }
        gridBody.appendChild(fragment);
        loadedRows = start + rows.length;
    }

    // -------------------------------------------------
    // Data fetching
    // -------------------------------------------------

    function requestNextPage() {
        if (pendingRequest) return;
        if (loadedRows >= totalRows) return;

        pendingRequest = true;
        requestCounter++;
        vscode.postMessage({
            type: 'requestRows',
            start: loadedRows,
            count: PAGE_SIZE,
            request_id: 'req_' + requestCounter
        });
    }

    // -------------------------------------------------
    // Lazy loading on scroll
    // -------------------------------------------------

    gridContainer.addEventListener('scroll', function() {
        var el = gridContainer;
        var distanceFromBottom = el.scrollHeight
            - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < SCROLL_THRESHOLD) {
            requestNextPage();
        }
    });

    // -------------------------------------------------
    // Toggle buttons
    // -------------------------------------------------

    btnLabels.classList.add('active');

    btnLabels.addEventListener('click', function() {
        showLabels = !showLabels;
        btnLabels.classList.toggle('active', showLabels);
        renderHeader();
    });

    btnFormats.addEventListener('click', function() {
        showFormats = !showFormats;
        btnFormats.classList.toggle('active', showFormats);
        // Format toggling is handled by re-requesting
        // data with a different display mode (future).
    });

    // -------------------------------------------------
    // Message handling
    // -------------------------------------------------

    window.addEventListener('message', function(event) {
        var msg = event.data;

        switch (msg.type) {
            case 'metadata':
                metadata = msg;
                loadedRows = 0;
                gridBody.innerHTML = '';
                renderHeader();
                requestNextPage();
                break;

            case 'rowData':
                pendingRequest = false;
                renderRows(msg.start, msg.rows);
                // If more rows remain visible, keep loading
                var el = gridContainer;
                var distFromBottom = el.scrollHeight
                    - el.scrollTop - el.clientHeight;
                if (distFromBottom < SCROLL_THRESHOLD) {
                    requestNextPage();
                }
                break;
        }
    });

    // Signal ready to extension host
    vscode.postMessage({ type: 'ready' });
})();
`;
