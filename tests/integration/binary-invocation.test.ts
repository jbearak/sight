/**
 * Integration tests for binary/CLI invocation.
 * 
 * Tests CLI argument parsing and behavior by invoking `bun src/cli.ts` directly.
 * This validates the CLI entry point works correctly before compilation.
 * For compiled binary tests, see the "Compiled Binary Smoke Tests" section.
 */

import { describe, it, expect } from 'bun:test';
import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { detect_platform } from '../../scripts/build-binary';
import { is_cli_entry_point } from '../../src/cli';
import { CLI_DESCRIPTION, PRIMARY_BINARY_NAME } from '../../src/cli-binary-names';

const CLI_PATH = join(__dirname, '../../src/cli.ts');

/**
 * Run the CLI with given args and return stdout/stderr/exitCode.
 */
function run_cli(
    args: string[],
    timeout_ms = 3000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        // Note: Node's child_process.spawn does NOT support a `timeout` option.
        // Bun's child_process compatibility layer may treat unknown options as an error,
        // which would make these tests flaky. Implement timeout manually.
        const bun_executable = process.execPath;
        const proc = spawn(bun_executable, [CLI_PATH, ...args], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        const timeout_id = setTimeout(() => {
            proc.kill();
        }, timeout_ms);

        proc.on('close', (code) => {
            clearTimeout(timeout_id);
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });

        proc.on('error', (err) => {
            clearTimeout(timeout_id);
            // Surface errors to help debug CI failures
            stderr += err?.message ? String(err.message) : String(err);
            resolve({ stdout, stderr, exitCode: 1 });
        });
    });
}

/**
 * Run the compiled binary with given args.
 */
function run_binary(
    binary_path: string,
    args: string[],
    timeout_ms = 3000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const proc = spawn(binary_path, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        const timeout_id = setTimeout(() => {
            proc.kill();
        }, timeout_ms);

        proc.on('close', (code) => {
            clearTimeout(timeout_id);
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });

        proc.on('error', (err) => {
            clearTimeout(timeout_id);
            stderr += err?.message ? String(err.message) : String(err);
            resolve({ stdout, stderr, exitCode: 1 });
        });
    });
}

type BinaryHelpResult = {
    status: number | null;
    stdout: Buffer | string | null;
};

function binary_help_matches_current_source(result: BinaryHelpResult): boolean {
    if (result.status !== 0) {
        return false;
    }

    const stdout = result.stdout?.toString() ?? '';
    const first_line = stdout.split('\n')[0] ?? '';

    return first_line.startsWith(`${PRIMARY_BINARY_NAME} `)
        && first_line.includes(CLI_DESCRIPTION);
}

describe('Binary Invocation', () => {
    it('should print help with --help flag', async () => {
        const result = await run_cli(['--help']);
        expect(result.exitCode).toBe(0);
        const first_line = result.stdout.split('\n')[0];
        expect(first_line.startsWith(`${PRIMARY_BINARY_NAME} `)).toBe(true);
        expect(first_line).toContain(CLI_DESCRIPTION);
        expect(result.stdout).toContain('--stdio');
        expect(result.stdout).toContain('--node-ipc');
        expect(result.stdout).toContain('--quiet');
    });

    it('should print help with -h flag', async () => {
        const result = await run_cli(['-h']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('USAGE:');
    });

    it('should print version with --version flag', async () => {
        const result = await run_cli(['--version']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/sight \d+\.\d+\.\d+/);
    });

    it('should print version with -v flag', async () => {
        const result = await run_cli(['-v']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/sight \d+\.\d+\.\d+/);
    });

    it('should reject unknown flags', async () => {
        const result = await run_cli(['--unknown-flag']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Unknown flag');
    });

    it('should reject unknown commands', async () => {
        const result = await run_cli(['definitely-not-a-command']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Unknown command');
    });

    it('should reject conflicting transport flags', async () => {
        const result = await run_cli(['--stdio', '--node-ipc']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Cannot specify both');
    });
});

describe('CLI Entry Point Detection', () => {
    it('recognizes npm bin symlink command names', () => {
        const bundle_path = '/repo/dist/sight-server.js';

        expect(is_cli_entry_point('/tmp/bin/sight', bundle_path)).toBe(true);
        expect(is_cli_entry_point(
            '/tmp/bin/sight-language-server',
            bundle_path
        ))
            .toBe(true);
        expect(is_cli_entry_point('/repo/dist/sight-server.js', bundle_path))
            .toBe(true);
        expect(is_cli_entry_point('C:\\Tools\\sight.exe', bundle_path))
            .toBe(true);
        expect(
            is_cli_entry_point(
                'C:\\Tools\\sight-language-server.exe',
                bundle_path
            )
        ).toBe(true);
        expect(is_cli_entry_point(
            'D:\\a\\sight\\sight\\bin\\sight-windows-x64.exe',
            bundle_path
        ))
            .toBe(true);
        expect(is_cli_entry_point(
            '/tmp/sight/bin/sight-darwin-arm64',
            bundle_path
        ))
            .toBe(true);
        expect(is_cli_entry_point(
            '/tmp/sight/bin/sight-linux-arm64',
            bundle_path
        ))
            .toBe(true);
    });

    it('rejects unrelated script paths', () => {
        const bundle_path = '/repo/dist/sight-server.js';

        expect(is_cli_entry_point('/tmp/bin/other', bundle_path)).toBe(false);
        expect(is_cli_entry_point(undefined, bundle_path)).toBe(false);
    });
});

describe('Compiled Binary Freshness Detection', () => {
    it('rejects stale binaries whose help text does not match current source', () => {
        const stale_result = {
            status: 0,
            stdout: Buffer.from(
                'Sight - Language Server Protocol implementation for Stata\n' +
                '\nUSAGE:\n  sight [options]\n\n  --stdio\n'
            ),
        };

        expect(binary_help_matches_current_source(stale_result)).toBe(false);
    });

    it('accepts binaries whose help text matches current source', () => {
        const fresh_result = {
            status: 0,
            stdout: Buffer.from(
                `${PRIMARY_BINARY_NAME} 1.2.3, ${CLI_DESCRIPTION}\n` +
                '\nUSAGE:\n  sight [options]\n\n  --stdio\n'
            ),
        };

        expect(binary_help_matches_current_source(fresh_result)).toBe(true);
    });

    it('does not use smoke-test assertions for freshness detection', () => {
        const fresh_result_with_help_regression = {
            status: 0,
            stdout: Buffer.from(
                `${PRIMARY_BINARY_NAME} 1.2.3, ${CLI_DESCRIPTION}\n` +
                '\nUSAGE:\n  sight [options]\n\n'
            ),
        };

        expect(
            binary_help_matches_current_source(
                fresh_result_with_help_regression
            )
        ).toBe(true);
    });
});


/**
 * Smoke tests for the compiled binary.
 * These tests only run if the binary has been built AND is functional.
 * The binary may exist but fail to run (e.g., missing bundled resources).
 */
describe('Compiled Binary Smoke Tests', () => {
    const platform_info = detect_platform();
    const binary_path = platform_info 
        ? join(__dirname, '../../bin', platform_info.binary_name)
        : null;
    const binary_file_exists = binary_path && existsSync(binary_path);
    
    // Check if binary is runnable and was built from current source metadata.
    // A stale local artifact can execute successfully but report old help text.
    let binary_is_functional = false;
    if (binary_file_exists && binary_path) {
        try {
            const result = spawnSync(binary_path, ['--help'], { timeout: 5000 });
            binary_is_functional =
                binary_help_matches_current_source(result);
        } catch {
            binary_is_functional = false;
        }
    }

    it.skipIf(!binary_is_functional)('compiled binary should print help', async () => {
        const result = await run_binary(binary_path!, ['--help']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(CLI_DESCRIPTION);
        expect(result.stdout).toContain('--stdio');
    });

    it.skipIf(!binary_is_functional)('compiled binary should print version', async () => {
        const result = await run_binary(binary_path!, ['--version']);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/sight \d+\.\d+\.\d+/);
    });

    it.skipIf(!binary_is_functional)('compiled binary should reject unknown flags', async () => {
        const result = await run_binary(binary_path!, ['--unknown-flag']);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Unknown flag');
    });
});
