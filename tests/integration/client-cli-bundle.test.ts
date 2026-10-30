/**
 * Build test for the CLI bundle the VS Code extension ships
 * (client/cli/cli.js, made by the client's `copy-cli` script).
 *
 * The extension runs it on Windows as `Code.exe cli/cli.js console`
 * with ELECTRON_RUN_AS_NODE=1. main() runs only when
 * is_cli_entry_point(process.argv[1]) holds, and src/cli.ts derives
 * its own path from import.meta.url, which a CommonJS bundle has to
 * supply; so this runs the bundle instead of only checking that the
 * file exists.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const CLIENT_DIR = join(import.meta.dir, '../../client');
const CLI_BUNDLE_PATH = join(CLIENT_DIR, 'cli', 'cli.js');
// The bundle is about 1.1 MB minified; fail if it balloons.
const CLI_BUNDLE_BUDGET_BYTES = 3 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 60000;

/**
 * Prefer Node, which is closest to Electron's runtime under
 * ELECTRON_RUN_AS_NODE; fall back to Bun when Node isn't installed.
 */
function get_js_runtime(): string {
    return Bun.which('node') ?? process.execPath;
}

describe('client CLI bundle (copy-cli)', () => {
    beforeAll(() => {
        const result = spawnSync('bun', ['run', 'copy-cli'], {
            cwd: CLIENT_DIR,
            encoding: 'utf8',
            timeout: BUILD_TIMEOUT_MS,
        });
        if (result.status !== 0) {
            throw new Error(
                `copy-cli failed (${result.status}):\n`
                + `${result.stdout}\n${result.stderr}`
            );
        }
    }, BUILD_TIMEOUT_MS);

    test('writes a CommonJS bundle with the command caches', () => {
        expect(existsSync(CLI_BUNDLE_PATH)).toBe(true);
        const nested_package = JSON.parse(
            readFileSync(join(CLIENT_DIR, 'cli', 'package.json'), 'utf8')
        );
        expect(nested_package).toEqual({ type: 'commonjs' });
        expect(existsSync(join(
            CLIENT_DIR, 'cli', 'command-database', 'caches', 'v18.json'
        ))).toBe(true);
    });

    test('stays within its size budget', () => {
        const size_bytes = statSync(CLI_BUNDLE_PATH).size;
        expect(size_bytes).toBeLessThan(CLI_BUNDLE_BUDGET_BYTES);
    });

    test('runs `console --help` as the entry point', () => {
        const result = spawnSync(
            get_js_runtime(),
            [CLI_BUNDLE_PATH, 'console', '--help'],
            {
                encoding: 'utf8',
                timeout: 10000,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            }
        );
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('sight console');
    });

    test('runs when started from another working directory', () => {
        const result = spawnSync(
            get_js_runtime(),
            [CLI_BUNDLE_PATH, '--version'],
            {
                cwd: join(CLIENT_DIR, '..'),
                encoding: 'utf8',
                timeout: 10000,
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            }
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/^sight \d+\.\d+\.\d+/);
    });
});
