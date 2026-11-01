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

/**
 * Sight's Stata console in a Perch session, end to end (local only, not
 * CI): perch-e2e/perch-e2e.mocha.js with the real Perch extension
 * loaded beside Sight. SIGHT_PERCH_E2E_PHASES picks phases (comma
 * separated; default all). PERCH_EXTENSION_PATH is a built `editors/vscode`
 * of a Perch checkout, with its binary in bin/<platform>-<arch>/.
 * Needs `bun run bundle`, `bun run copy-console` and
 * `bun run build-pty-helper` first, and Bun for the fake Stata. Uses
 * VSCODE_EXECUTABLE if set, else downloads VS Code.
 */
async function run_perch_suite(extension_development_path) {
    const perch_path = process.env.PERCH_EXTENSION_PATH;
    if (!perch_path) {
        throw new Error(
            'Set PERCH_EXTENSION_PATH to a built editors/vscode of Perch.'
        );
    }
    const perch_bin = path.join(
        perch_path, 'bin', `${process.platform}-${process.arch}`, 'perch'
    );
    const my_work_dir = make_temp_dir('sight-perch-e2e-');
    const my_bin_dir = path.join(my_work_dir, 'bin');
    const my_workspace = path.join(my_work_dir, 'workspace');
    const my_user_data_dir = path.join(my_work_dir, 'user-data');
    fs.mkdirSync(my_bin_dir);
    fs.mkdirSync(my_workspace);
    fs.mkdirSync(path.join(my_user_data_dir, 'User'), { recursive: true });
    fs.writeFileSync(
        path.join(my_user_data_dir, 'User', 'settings.json'),
        JSON.stringify({
            'sight.sendToStata.target': 'integrated',
            'sight.sendToStata.workingDirectory': 'none',
            'sight.sendToStata.focusStataWindow': false,
        })
    );
    // The stand-in Stata, as `stata-mp` on PATH.
    const my_fake_stata = path.resolve(
        extension_development_path, '..',
        'tests', 'fixtures', 'console', 'fake-stata.ts'
    );
    const my_stata = path.join(my_bin_dir, 'stata-mp');
    fs.writeFileSync(
        my_stata, `#!/bin/sh\nexec bun "${my_fake_stata}" "$@"\n`
    );
    fs.chmodSync(my_stata, 0o755);
    const my_env = {
        // Read only in extension tests: treat this window as remote.
        SIGHT_TEST_PERCH_REMOTE: '1',
        SIGHT_PERCH_E2E_DIR: my_work_dir,
        SIGHT_PERCH_E2E_PERCH_BIN: perch_bin,
        FAKE_STATA_LOG: path.join(my_work_dir, 'stata.log'),
        FAKE_STATA_MODE: 'raw',
        // Perch keeps its restore set here in extension tests, where
        // workspace storage doesn't outlive a launch.
        PERCH_TEST_RESTORE_FILE: path.join(my_work_dir, 'restore.json'),
        PATH: `${my_bin_dir}${path.delimiter}${process.env.PATH}`,
    };
    // Terminals (and so Perch sessions) get VS Code's environment, not
    // the extension host's.
    Object.assign(process.env, my_env);
    console.log(`Perch end-to-end work directory: ${my_work_dir}`);
    const the_phases = process.env.SIGHT_PERCH_E2E_PHASES
        ? process.env.SIGHT_PERCH_E2E_PHASES.split(',')
        : ['start', 'adopt', 'launcher'];
    for (const my_phase of the_phases) {
        // The launcher phase runs as a local window: no remote override.
        const my_remote = my_phase === 'launcher' ? '0' : '1';
        process.env.SIGHT_TEST_PERCH_REMOTE = my_remote;
        await runTests({
            version: process.env.VSCODE_VERSION || 'stable',
            vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
            extensionDevelopmentPath: [extension_development_path, perch_path],
            extensionTestsPath: path.resolve(
                __dirname, 'perch-e2e', 'index.js'
            ),
            launchArgs: [
                my_workspace,
                '--user-data-dir', my_user_data_dir,
                '--disable-extensions',
                '--skip-welcome',
                '--skip-release-notes',
            ],
            extensionTestsEnv: {
                ...my_env,
                SIGHT_TEST_PERCH_REMOTE: my_remote,
                SIGHT_PERCH_E2E_PHASE: my_phase,
            },
        });
    }
    console.log(fs.readFileSync(path.join(my_work_dir, 'report.txt'), 'utf8'));
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
        // on the current VS Code rather than the oldest supported one.
        // VS Code is cached under
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

    if (my_suite === 'perch') {
        await run_perch_suite(extension_development_path);
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

    // The oldest VS Code the extension supports (engines.vscode): 1.123
    // is the first whose extension host runs Node 24 (Electron 42).
    await runTests({
        version: '1.123.0',
        extensionDevelopmentPath: extension_development_path,
        extensionTestsPath: extension_tests_path,
        launchArgs: launch_args,
    });
}

main().catch((my_err) => {
    console.error(my_err);
    process.exit(1);
});
