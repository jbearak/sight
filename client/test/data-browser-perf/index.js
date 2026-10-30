/* eslint-env node */
/**
 * Programmatic Mocha runner for the data-browser timing suite: the
 * `extensionTestsPath` target that `@vscode/test-electron` loads inside
 * the extension host (same pattern as toolbar-wrap-layout/index.js).
 */

const path = require('path');
const Mocha = require('mocha');

function run() {
    const my_mocha = new Mocha({
        ui: 'bdd',
        color: true,
        // Opening a wide fixture and waiting for paint can take a while
        // on a cold CI runner.
        timeout: 180000,
    });

    // `.mocha.js`, not `.test.js`, so the root `bun test` does not
    // discover it (it needs the real `vscode` module).
    my_mocha.addFile(path.resolve(__dirname, 'data-browser-perf.mocha.js'));

    return new Promise((resolve, reject) => {
        try {
            my_mocha.run(failure_count => {
                if (failure_count > 0) {
                    reject(new Error(
                        `${failure_count} data-browser timing test(s) failed.`
                    ));
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
