/* eslint-env node */
/**
 * Extension-host helper for the toolbar-wrap real-layout suite.
 *
 * Opens a webview panel that loads the test harness bundle from
 * `dist-test/toolbar-wrap-harness/` (built by `bun run bundle:webview-test`),
 * and exposes the `test:*` message protocol the harness implements:
 *
 *   host → webview: test:reset, test:setWidth, test:setState,
 *                   test:requestSnapshot
 *   webview → host: test:ready, test:layoutSnapshot
 *
 * The host cannot read the sandboxed webview's DOM, so the webview measures
 * its own layout and posts the numbers back; this helper collects them and
 * resolves the higher-level `apply()` / `wait_for_ready()` promises the
 * test cases consume.
 */

const path = require('path');
const crypto = require('crypto');
const vscode = require('vscode');

// dist-test/toolbar-wrap-harness, relative to client/test/toolbar-wrap-layout.
const HARNESS_DIR = path.resolve(
    __dirname,
    '..',
    '..',
    'dist-test',
    'toolbar-wrap-harness'
);

function generate_nonce() {
    return crypto.randomBytes(16).toString('hex');
}

function build_harness_html(webview, nonce) {
    const my_js_uri = webview.asWebviewUri(
        vscode.Uri.file(path.join(HARNESS_DIR, 'index.js'))
    );
    const my_css_uri = webview.asWebviewUri(
        vscode.Uri.file(path.join(HARNESS_DIR, 'index.css'))
    );

    // Mirrors webview-html.ts: per-panel nonce in script-src; the harness
    // bundle emits a sibling index.css (esbuild's css loader does not inline
    // CSS into the IIFE), so we link it just like production.
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
<title>Toolbar Wrap Harness</title>
<link nonce="${nonce}" rel="stylesheet" href="${my_css_uri}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${my_js_uri}"></script>
</body>
</html>`;
}

function with_timeout(promise, timeout_ms, message) {
    let timer;
    const my_timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout_ms);
    });
    return Promise.race([promise, my_timeout]).finally(() =>
        clearTimeout(timer)
    );
}

/**
 * Open the harness panel and wire up the message protocol. Returns a
 * controller with `wait_for_ready`, `reset`, `apply`, and `dispose`.
 */
function open_harness_panel() {
    const my_panel = vscode.window.createWebviewPanel(
        'sight.toolbarWrapHarness',
        'Toolbar Wrap Harness',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(HARNESS_DIR)],
        }
    );

    let is_ready = false;
    const the_ready_waiters = [];
    const the_snapshot_waiters = [];
    let latest_snapshot = null;

    // Register BEFORE setting html so the test:ready handshake and the
    // initial snapshot can never be missed.
    my_panel.webview.onDidReceiveMessage(my_message => {
        if (!my_message || typeof my_message.type !== 'string') {
            return;
        }
        if (my_message.type === 'test:ready') {
            is_ready = true;
            while (the_ready_waiters.length > 0) {
                the_ready_waiters.shift()();
            }
            return;
        }
        if (my_message.type === 'test:layoutSnapshot') {
            latest_snapshot = my_message;
            while (the_snapshot_waiters.length > 0) {
                the_snapshot_waiters.shift()(my_message);
            }
        }
    });

    const my_nonce = generate_nonce();
    my_panel.webview.html = build_harness_html(
        my_panel.webview,
        my_nonce
    );

    function send(message) {
        return my_panel.webview.postMessage(message);
    }

    function wait_for_ready(timeout_ms = 15000) {
        if (is_ready) {
            return Promise.resolve();
        }
        return with_timeout(
            new Promise(resolve => the_ready_waiters.push(resolve)),
            timeout_ms,
            'Timed out waiting for harness test:ready'
        );
    }

    // Resolves on the next layoutSnapshot received after this call. The
    // waiter is registered synchronously, so callers can register it before
    // posting and never miss the reply.
    function next_snapshot(timeout_ms) {
        return new Promise((resolve, reject) => {
            const my_timer = setTimeout(() => {
                const my_index = the_snapshot_waiters.indexOf(my_entry);
                if (my_index >= 0) {
                    the_snapshot_waiters.splice(my_index, 1);
                }
                reject(
                    new Error('Timed out waiting for test:layoutSnapshot')
                );
            }, timeout_ms);
            const my_entry = snapshot => {
                clearTimeout(my_timer);
                resolve(snapshot);
            };
            the_snapshot_waiters.push(my_entry);
        });
    }

    /**
     * Send a control message, then poll snapshots (via test:requestSnapshot)
     * until `predicate(snapshot)` holds or the deadline passes. Each
     * requested snapshot is posted after the change is applied, so it
     * reflects the settled DOM. With no predicate, returns the first
     * post-change snapshot. Returns the last snapshot seen if the predicate
     * never matches (the caller's assertion then reports the mismatch).
     */
    async function apply(message, predicate, timeout_ms = 5000) {
        const my_deadline = Date.now() + timeout_ms;
        send(message);
        let my_snapshot = null;
        while (Date.now() < my_deadline) {
            const my_wait = next_snapshot(1500);
            send({ type: 'test:requestSnapshot' });
            try {
                my_snapshot = await my_wait;
            } catch {
                continue;
            }
            if (!predicate || predicate(my_snapshot)) {
                return my_snapshot;
            }
        }
        if (my_snapshot) {
            return my_snapshot;
        }
        throw new Error('apply: no snapshot received within timeout');
    }

    function reset() {
        // Wait for the cleared state to settle. With zero chips the toolbar
        // can never wrap, so each test starts from a known single-row
        // baseline and a stray late snapshot can't leak into the next case.
        return apply(
            { type: 'test:reset' },
            my_snap => my_snap.is_wrapped === false
        );
    }

    async function dispose() {
        my_panel.dispose();
        // Let VS Code settle the panel teardown before the next suite.
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
        panel: my_panel,
        send,
        wait_for_ready,
        apply,
        reset,
        get latest_snapshot() {
            return latest_snapshot;
        },
        dispose,
    };
}

module.exports = { open_harness_panel, HARNESS_DIR };
