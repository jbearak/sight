/**
 * The editor console as a terminal program
 * (src/console/editor-console-tty.ts, bundled as
 * client/console-runtime/tty.js): what the VS Code extension runs in a
 * Perch session in a remote window. It runs under Node on a real
 * terminal, which here is one more sight-pty helper, and runs the fake
 * Stata in tests/fixtures/console/fake-stata.ts through the helper, as
 * the extension's pane does.
 *
 * Skipped without a C compiler or Node, where pseudo-terminals can't be
 * opened, and on Windows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn_helper_pty, type HelperPty } from '../../../src/console/helper-pty';
import { parse_tty_console_args } from '../../../src/console/editor-console-tty';

const ROOT = path.resolve(import.meta.dir, '../../..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SOURCE = path.join(ROOT, 'client/pty-helper/sight-pty.c');
const FAKE_STATA = path.join(ROOT, 'tests/fixtures/console/fake-stata.ts');
const TTY_BUNDLE = path.join(CLIENT_DIR, 'console-runtime', 'tty.js');
const BUILD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-tty-test-'));
const HELPER = path.join(BUILD_DIR, 'sight-pty');
const NODE = Bun.which('node');
const BUILD_TIMEOUT_MS = 60000;

function build_helper(): boolean {
    if (process.platform === 'win32' || !NODE) {
        return false;
    }
    const the_libraries = process.platform === 'linux' ? ['-lutil'] : [];
    const compiled = spawnSync('cc', ['-Wall', '-Wextra', '-Werror', '-o', HELPER, SOURCE, ...the_libraries], {
        encoding: 'utf8',
    });
    if (compiled.error) {
        return false;
    }
    if (compiled.status !== 0) {
        throw new Error(`sight-pty doesn't compile:\n${compiled.stderr}`);
    }
    const probe = spawnSync(HELPER, ['10', '5', '--', 'true'], { encoding: 'latin1' });
    return probe.stdout.includes('X')
        && !probe.stdout.includes('cannot open a pseudo-terminal');
}

const AVAILABLE = build_helper();
const describe_tty = AVAILABLE ? describe : describe.skip;

afterAll(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
});

const sleep = (time_ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, time_ms));

async function wait_for(predicate: () => boolean, what: string, timeout_ms = 10000): Promise<void> {
    const deadline_ms = Date.now() + timeout_ms;
    while (!predicate()) {
        if (Date.now() > deadline_ms) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(20);
    }
}

interface Run {
    terminal: HelperPty;
    screen: () => string;
    dir: string;
    ready_file: string;
    end_file: string;
}

let run_count = 0;

function start(options: { stata?: string; run_line?: string } = {}): Run {
    run_count += 1;
    const dir = path.join(BUILD_DIR, `session-${run_count}`);
    fs.mkdirSync(dir, { mode: 0o700 });
    const ready_file = path.join(dir, 'sight-console-ready');
    const end_file = path.join(dir, 'sight-console-end');
    const the_args = [
        TTY_BUNDLE,
        '--helper', HELPER,
        '--stata', options.stata ?? FAKE_STATA,
        '--cwd', dir,
        '--ready-file', ready_file,
        '--end-file', end_file,
    ];
    if (options.run_line) {
        the_args.push('--run', options.run_line);
    }
    let screen = '';
    const terminal = spawn_helper_pty({
        helper_path: HELPER,
        command: NODE ?? 'node',
        args: the_args,
        columns: 80,
        rows: 24,
        env: { ...process.env, FAKE_STATA_MODE: 'raw', NO_COLOR: '1', TERM: 'xterm-256color' },
        on_data: (text) => {
            screen += text;
        },
    });
    return { terminal, screen: () => screen, dir, ready_file, end_file };
}

describe('parse_tty_console_args', () => {
    it('reads every flag', () => {
        expect(parse_tty_console_args([
            '--helper', '/h', '--stata', '/s', '--cwd', '/c',
            '--ready-file', '/r', '--end-file', '/e', '--run', 'do x',
        ])).toEqual({
            helper_path: '/h', stata_path: '/s', working_directory: '/c',
            ready_file: '/r', end_file: '/e', run_line: 'do x',
        });
    });

    it('rejects unknown flags, missing values and missing paths', () => {
        expect(parse_tty_console_args(['--nope', 'x'])).toContain('unknown');
        expect(parse_tty_console_args(['--helper'])).toContain('needs a value');
        expect(parse_tty_console_args(['--helper', '/h'])).toContain('required');
    });
});

describe_tty('editor console on a terminal (tty.js)', () => {
    beforeAll(() => {
        const result = spawnSync('bun', ['run', 'copy-console'], {
            cwd: CLIENT_DIR,
            encoding: 'utf8',
            timeout: BUILD_TIMEOUT_MS,
        });
        if (result.status !== 0) {
            throw new Error(`copy-console failed:\n${result.stdout}\n${result.stderr}`);
        }
    }, BUILD_TIMEOUT_MS);

    it('writes the ready file at the first prompt, runs --run, then typed input', async () => {
        const run = start({ run_line: 'display first {dir} line' });
        await wait_for(() => fs.existsSync(run.ready_file), 'the ready file');
        const ready = JSON.parse(fs.readFileSync(run.ready_file, 'utf8'));
        expect(typeof ready.pid).toBe('number');
        expect(fs.statSync(run.ready_file).mode & 0o777).toBe(0o600);
        // No temporary file left behind by the atomic write.
        expect(fs.readdirSync(run.dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
        // Output lines, not the echoed command (the outer terminal
        // turns each \n into \r\n, so lines end in \r\r\n).
        await wait_for(() => /\nfirst \{dir\} line\r/.test(run.screen()), 'the --run output');

        run.terminal.write('display hello there\r');
        await wait_for(() => /\nhello there\r/.test(run.screen()), 'the typed output');

        run.terminal.write('exit\r');
        expect(await run.terminal.exit_status).toBe(0);
        const end = JSON.parse(fs.readFileSync(run.end_file, 'utf8'));
        expect(end).toEqual({ code: 0, took_stata: true, helper_failed: false });
    }, 30000);

    it('passes a resize through to Stata', async () => {
        const run = start();
        await wait_for(() => fs.existsSync(run.ready_file), 'the ready file');
        run.terminal.write('size\r');
        await wait_for(() => run.screen().includes('size 80x24'), 'the first size');
        run.terminal.resize(100, 30);
        await sleep(200);
        run.terminal.write('size\r');
        await wait_for(() => run.screen().includes('size 100x30'), 'the new size');
        run.terminal.write('exit\r');
        expect(await run.terminal.exit_status).toBe(0);
    }, 30000);

    it('closes Stata and exits on SIGHUP', async () => {
        const run = start();
        await wait_for(() => fs.existsSync(run.ready_file), 'the ready file');
        run.terminal.write('pid\r');
        await wait_for(() => /pid \d+/.test(run.screen()), 'the fake Stata pid');
        const stata_pid = Number(/pid (\d+)/.exec(run.screen())?.[1]);
        // The helper hangs up its terminal: SIGHUP to the console.
        run.terminal.kill('SIGHUP');
        await run.terminal.exit_status;
        await wait_for(() => {
            try {
                process.kill(stata_pid, 0);
                return false;
            } catch {
                return true;
            }
        }, 'the fake Stata to end');
        // Ended by the user, not on its own: no end file.
        expect(fs.existsSync(run.end_file)).toBe(false);
    }, 30000);

    it('reports a Stata that cannot run in the end file, and waits for a key', async () => {
        const run = start({ stata: path.join(BUILD_DIR, 'no-stata') });
        await wait_for(() => fs.existsSync(run.end_file), 'the end file');
        expect(fs.existsSync(run.ready_file)).toBe(false);
        const end = JSON.parse(fs.readFileSync(run.end_file, 'utf8'));
        expect(end.code).toBe(127);
        expect(end.took_stata).toBe(false);
        await wait_for(() => run.screen().includes('Press any key'), 'the key prompt');
        expect(run.screen()).toContain('no-stata');
        run.terminal.write('x');
        expect(await run.terminal.exit_status).toBe(127);
    }, 30000);

    it('reports a helper that cannot start as a helper failure', async () => {
        run_count += 1;
        const dir = path.join(BUILD_DIR, `session-${run_count}`);
        fs.mkdirSync(dir, { mode: 0o700 });
        const end_file = path.join(dir, 'end');
        let screen = '';
        const terminal = spawn_helper_pty({
            helper_path: HELPER,
            command: NODE ?? 'node',
            args: [
                TTY_BUNDLE,
                '--helper', path.join(BUILD_DIR, 'no-such-helper'),
                '--stata', FAKE_STATA,
                '--end-file', end_file,
            ],
            columns: 80,
            rows: 24,
            on_data: (text) => {
                screen += text;
            },
        });
        await wait_for(() => fs.existsSync(end_file), 'the end file');
        const end = JSON.parse(fs.readFileSync(end_file, 'utf8'));
        expect(end.helper_failed).toBe(true);
        expect(end.took_stata).toBe(false);
        await wait_for(() => screen.includes('Press any key'), 'the key prompt');
        terminal.write('x');
        expect(await terminal.exit_status).not.toBe(0);
    }, 30000);
});
