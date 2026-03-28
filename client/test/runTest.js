/* eslint-env node */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { runTests } = require('@vscode/test-electron');

function find_code_binary() {
    const the_candidates = [
        process.env.VSCODE_BINARY,
        '/opt/homebrew/bin/code',
        '/usr/local/bin/code',
    ].filter(Boolean);

    for (const my_candidate of the_candidates) {
        try {
            fs.accessSync(my_candidate, fs.constants.X_OK);
            return my_candidate;
        } catch {
            // Ignore non-executable candidates and keep searching.
        }
    }

    return null;
}

function make_temp_dir(prefix) {
    return fs.mkdtempSync(
        path.join(os.tmpdir(), prefix)
    );
}

function try_remove_dir(dir_path) {
    try {
        fs.rmSync(dir_path, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
        });
    } catch {
        // Best-effort cleanup; ignore removal errors.
    }
}

async function run_with_system_code(
    extension_development_path,
    extension_tests_path,
    workspace_path
) {
    const my_code_binary = find_code_binary();
    if (!my_code_binary) {
        return false;
    }

    const my_user_data_dir = make_temp_dir(
        'sight-vscode-userdata-'
    );
    const my_extensions_dir = make_temp_dir(
        'sight-vscode-extensions-'
    );

    try {
        await new Promise((resolve, reject) => {
            const my_child = spawn(
                my_code_binary,
                [
                    '--user-data-dir',
                    my_user_data_dir,
                    '--extensions-dir',
                    my_extensions_dir,
                    '--disable-extensions',
                    '--skip-welcome',
                    '--skip-release-notes',
                    '--extensionDevelopmentPath',
                    extension_development_path,
                    '--extensionTestsPath',
                    extension_tests_path,
                    workspace_path,
                ],
                {
                    stdio: 'inherit',
                }
            );

            my_child.on('error', reject);
            my_child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(
                    new Error(
                        `VS Code test run failed with code ${code}`
                    )
                );
            });
        });
        return true;
    } finally {
        try_remove_dir(my_user_data_dir);
        try_remove_dir(my_extensions_dir);
    }
}

async function main() {
    const extension_development_path = path.resolve(
        __dirname,
        '..'
    );
    const extension_tests_path = path.resolve(
        __dirname,
        'extension-smoke.js'
    );
    const workspace_path = path.resolve(
        extension_development_path,
        '..'
    );

    const my_used_system_code = await run_with_system_code(
        extension_development_path,
        extension_tests_path,
        workspace_path
    );
    if (my_used_system_code) {
        return;
    }

    await runTests({
        version: '1.75.0',
        extensionDevelopmentPath: extension_development_path,
        extensionTestsPath: extension_tests_path,
        launchArgs: [
            workspace_path,
            '--disable-extensions',
            '--skip-welcome',
            '--skip-release-notes',
        ],
    });
}

main().catch((my_err) => {
    console.error(my_err);
    process.exit(1);
});
