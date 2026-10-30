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

function parse_suite(argv) {
    const my_index = argv.indexOf('--suite');
    if (my_index >= 0 && argv[my_index + 1]) {
        return argv[my_index + 1];
    }
    return 'smoke';
}

async function main() {
    const my_suite = parse_suite(process.argv.slice(2));

    const extension_development_path = path.resolve(
        __dirname,
        '..'
    );
    const workspace_path = path.resolve(
        extension_development_path,
        '..'
    );

    const launch_args = [
        workspace_path,
        '--disable-extensions',
        '--skip-welcome',
        '--skip-release-notes',
    ];

    if (my_suite === 'layout') {
        // Escape hatch for sandboxes/CI that cannot run VS Code (e.g. a
        // network reaching only github.com, while VS Code/Electron download
        // from Microsoft CDNs): the real-layout assertion is the point, so by
        // default an undownloadable binary fails — but this opts out cleanly.
        if (process.env.SIGHT_SKIP_LAYOUT_TESTS === '1') {
            console.log(
                'SIGHT_SKIP_LAYOUT_TESTS=1: skipping the real-layout '
                    + 'toolbar-wrap suite.'
            );
            return;
        }

        // The layout assertions only gate anything if the run BLOCKS and
        // propagates the test exit code. The system `code` CLI does not: it
        // launches a window and returns 0 immediately (a false pass). So this
        // suite always uses @vscode/test-electron's blocking download path,
        // on a modern VS Code — mocha 11 needs the extension host's Node >= 18
        // (the smoke suite's 1.75.0 ships Node 16). VS Code is cached under
        // .vscode-test after the first download. Override with VSCODE_VERSION.
        await runTests({
            version: process.env.VSCODE_VERSION || 'stable',
            extensionDevelopmentPath: extension_development_path,
            extensionTestsPath: path.resolve(
                __dirname,
                'toolbar-wrap-layout',
                'index.js'
            ),
            launchArgs: launch_args,
        });
        return;
    }

    if (my_suite === 'perf') {
        // Data-browser timing in a real VS Code (see
        // data-browser-perf/data-browser-perf.mocha.js). Fixtures are
        // generated by the benchmark's generator into
        // SIGHT_PERF_FIXTURE_DIR (default: a temp dir), at
        // SIGHT_PERF_SCALE of the full 10M x 10 / 1M x 500 shapes.
        // Like the layout suite, this needs a blocking run, so it uses
        // @vscode/test-electron (or VSCODE_EXECUTABLE, an installed
        // VS Code, with its own throwaway profile).
        const my_dir = process.env.SIGHT_PERF_FIXTURE_DIR
            || path.join(os.tmpdir(), 'sight-perf-fixtures');
        const my_scale = process.env.SIGHT_PERF_SCALE || '0.1';
        const my_names = ['narrow', 'wide'];
        const my_generator = path.resolve(
            workspace_path,
            'scripts/bench-data-browser/make-fixtures.ts'
        );
        const the_fixtures = my_names.map(my_name => path.join(
            my_dir,
            my_scale === '1' ? `${my_name}.dta` : `${my_name}-${my_scale}.dta`
        ));
        const the_missing = my_names.filter(
            (_, i) => !fs.existsSync(the_fixtures[i])
        );
        if (the_missing.length > 0) {
            const my_gen = require('child_process').spawnSync(
                'bun',
                [my_generator, my_dir, the_missing.join(','),
                    '--scale', my_scale],
                { stdio: 'inherit' }
            );
            if (my_gen.status !== 0) {
                throw new Error('could not generate data-browser fixtures');
            }
        }
        const my_user_data_dir = make_temp_dir('sight-perf-userdata-');
        try {
            await runTests({
                version: process.env.VSCODE_VERSION || 'stable',
                vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
                extensionDevelopmentPath: extension_development_path,
                extensionTestsPath: path.resolve(
                    __dirname,
                    'data-browser-perf',
                    'index.js'
                ),
                launchArgs: [
                    ...launch_args,
                    '--user-data-dir',
                    my_user_data_dir,
                ],
                extensionTestsEnv: {
                    SIGHT_PERF_FIXTURES: the_fixtures.join(','),
                    SIGHT_PERF_OUT: process.env.SIGHT_PERF_OUT || '',
                },
            });
        } finally {
            try_remove_dir(my_user_data_dir);
        }
        return;
    }

    const extension_tests_path = path.resolve(
        __dirname,
        'extension-smoke.js'
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
        launchArgs: launch_args,
    });
}

main().catch((my_err) => {
    console.error(my_err);
    process.exit(1);
});
