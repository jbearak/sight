/* eslint-env node */
/**
 * Programmatic Mocha runner for the toolbar-wrap real-layout suite.
 *
 * This module is the `extensionTestsPath` target: `@vscode/test-electron`
 * loads it inside the extension host and calls `run()`. We construct a
 * Mocha instance, add the suite file, and resolve/reject on the failure
 * count (the standard VS Code extension-test pattern).
 */

const path = require('path');
const Mocha = require('mocha');

function run() {
    const my_mocha = new Mocha({
        ui: 'bdd',
        color: true,
        // Real-layout cases open a webview and await settled layout, so
        // give each case generous headroom over the snapshot polling.
        timeout: 60000,
    });

    // The suite file is `.mocha.js`, not `.test.js`, on purpose: the repo's
    // CI runs a bare `bun test` from the root, which auto-discovers every
    // `*.test.*` file. This is a Mocha + vscode-test suite (it `require`s
    // `vscode` and uses `this.timeout`), so bun must not try to run it.
    // Mocha loads it here by explicit path, so the name is free to dodge
    // bun's glob — same reason `extension-smoke.js` has no `.test.` either.
    my_mocha.addFile(
        path.resolve(__dirname, 'toolbar-wrap-layout.mocha.js')
    );

    return new Promise((resolve, reject) => {
        try {
            my_mocha.run(failure_count => {
                if (failure_count > 0) {
                    reject(
                        new Error(
                            `${failure_count} layout test(s) failed.`
                        )
                    );
                } else {
                    resolve();
                }
            });
        } catch (my_error) {
            reject(my_error);
        }
    });
}

module.exports = { run };
