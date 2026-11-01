/* eslint-env node */
/**
 * Programmatic Mocha runner for the Perch end-to-end suite (see
 * perch-e2e.mocha.js and `--suite perch` in ../runTest.js).
 */

const path = require('path');
const Mocha = require('mocha');

function run() {
    const my_mocha = new Mocha({ ui: 'bdd', color: true, timeout: 120000 });
    my_mocha.addFile(path.resolve(__dirname, 'perch-e2e.mocha.js'));
    return new Promise((resolve, reject) => {
        try {
            my_mocha.run(failure_count => {
                if (failure_count > 0) {
                    reject(new Error(
                        `${failure_count} Perch end-to-end test(s) failed.`
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
