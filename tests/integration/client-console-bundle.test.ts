/**
 * Build test for the console runtime the VS Code extension ships
 * (client/console-runtime/console.js, made by the client's
 * `copy-console` script). The extension loads it into its own process
 * and runs sight console in a terminal pane, so this loads the bundle
 * under Node, as the extension host does, and starts it.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const CLIENT_DIR = join(import.meta.dir, '../../client');
const BUNDLE_DIR = join(CLIENT_DIR, 'console-runtime');
const BUNDLE_PATH = join(BUNDLE_DIR, 'console.js');
// The bundle is about 0.8 MB minified; fail if it balloons.
const BUNDLE_BUDGET_BYTES = 2 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 60000;
// Mirrors client/src/send-to-stata/console-pane.ts.
const EDITOR_CONSOLE_API_VERSION = 2;
const IS_WINDOWS = process.platform === 'win32';

/** Node is closest to VS Code's extension host; Bun if it's absent. */
function get_js_runtime(): string {
    return Bun.which('node') ?? process.execPath;
}

// Starts a console with a fake host. On Windows, without PowerShell
// (or without Stata registered), it must end cleanly, inside this
// process, with 85 (helper couldn't run) or 84 (Automation not
// registered). Elsewhere it's given a sight-pty helper that doesn't
// exist, and must end cleanly reporting a helper failure.
const PROBE = `
const { pathToFileURL } = require('url');
(async () => {
    const loaded = await import(pathToFileURL(process.argv[1]).href);
    const mod = typeof loaded.start_editor_console === 'function'
        ? loaded : loaded.default;
    const written = [];
    const started = mod.start_editor_console({
        write: (text) => written.push(text),
        columns: () => 80,
        rows: () => 24,
        ask: async () => 'no',
        env: { ...process.env, SIGHT_CONSOLE_TMPDIR: require('os').tmpdir() },
        pty: {
            helper_path: require('path').join(require('os').tmpdir(), 'no-such-sight-pty'),
            stata_path: 'stata-mp',
        },
    });
    const ready = await started.ready;
    const end = await started.done;
    console.log(JSON.stringify({
        version: mod.EDITOR_CONSOLE_API_VERSION,
        ready,
        end,
        wrote: written.join(''),
    }));
})();
`;

describe('client console runtime bundle (copy-console)', () => {
    beforeAll(() => {
        const result = spawnSync('bun', ['run', 'copy-console'], {
            cwd: CLIENT_DIR,
            encoding: 'utf8',
            timeout: BUILD_TIMEOUT_MS,
        });
        if (result.status !== 0) {
            throw new Error(
                `copy-console failed (${result.status}):\n`
                + `${result.stdout}\n${result.stderr}`
            );
        }
    }, BUILD_TIMEOUT_MS);

    test('writes a CommonJS bundle within its size budget', () => {
        expect(existsSync(BUNDLE_PATH)).toBe(true);
        const nested_package = JSON.parse(
            readFileSync(join(BUNDLE_DIR, 'package.json'), 'utf8')
        );
        expect(nested_package).toEqual({ type: 'commonjs' });
        expect(statSync(BUNDLE_PATH).size).toBeLessThan(BUNDLE_BUDGET_BYTES);
    });

    test('loads in Node and ends cleanly when it can\'t reach Stata', () => {
        const result = spawnSync(
            get_js_runtime(),
            ['-e', PROBE, BUNDLE_PATH],
            { encoding: 'utf8', timeout: 30000 }
        );
        expect(result.status).toBe(0);
        const report = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
        expect(report.version).toBe(EDITOR_CONSOLE_API_VERSION);
        expect(report.ready).toBe(false);
        expect(report.end.took_stata).toBe(false);
        if (IS_WINDOWS) {
            expect([84, 85]).toContain(report.end.code);
            expect(report.wrote).toContain('Error:');
        } else {
            expect(report.end.helper_failed).toBe(true);
            expect(report.wrote).toContain('no-such-sight-pty');
        }
    }, 40000);
});
