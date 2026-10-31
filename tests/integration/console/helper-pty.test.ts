/**
 * The sight-pty helper (client/pty-helper/sight-pty.c) and its Node
 * side (src/console/helper-pty.ts), which let the VS Code extension
 * run sight console on macOS and Linux. The helper is compiled for
 * this machine with `cc`; the editor console runs the fake Stata in
 * tests/fixtures/console/fake-stata.ts through it.
 *
 * Skipped without a C compiler, or where pseudo-terminals can't be
 * opened (some sandboxes), and on Windows.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    FrameReader,
    exit_status_from_frame,
    spawn_helper_pty,
    type HelperPty,
} from '../../../src/console/helper-pty';
import { start_editor_console } from '../../../src/console/editor-console';
import { create_pty_handle } from '../../../src/console/pty-backend';

const ROOT = path.resolve(import.meta.dir, '../../..');
const SOURCE = path.join(ROOT, 'client/pty-helper/sight-pty.c');
const FAKE_STATA = path.join(ROOT, 'tests/fixtures/console/fake-stata.ts');
const BUILD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-pty-test-'));
const HELPER = path.join(BUILD_DIR, 'sight-pty');

function build_helper(): boolean {
    if (process.platform === 'win32') {
        return false;
    }
    // glibc before 2.34 keeps openpty in libutil.
    const the_libraries = process.platform === 'linux' ? ['-lutil'] : [];
    const compiled = spawnSync('cc', ['-Wall', '-Wextra', '-Werror', '-o', HELPER, SOURCE, ...the_libraries], {
        encoding: 'utf8',
    });
    if (compiled.status !== 0) {
        if (compiled.stderr) {
            console.warn(compiled.stderr);
        }
        return false;
    }
    // Some sandboxes refuse to open pseudo-terminals. (The probe's
    // input closes at once, which hangs up `true`; that's fine.)
    const probe = spawnSync(HELPER, ['10', '5', '--', 'true'], { encoding: 'latin1' });
    return probe.stdout.includes('X')
        && !probe.stdout.includes('cannot open a pseudo-terminal');
}

const AVAILABLE = build_helper();
const describe_helper = AVAILABLE ? describe : describe.skip;

afterAll(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
});

const sleep = (time_ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, time_ms));

async function wait_for(predicate: () => boolean, what: string, timeout_ms = 5000): Promise<void> {
    const deadline_ms = Date.now() + timeout_ms;
    while (!predicate()) {
        if (Date.now() > deadline_ms) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(10);
    }
}

interface Shell {
    pty: HelperPty;
    output: () => string;
    errors: string[];
}

function run_shell(script: string, columns = 80, rows = 24): Shell {
    let output = '';
    const errors: string[] = [];
    const pty = spawn_helper_pty({
        helper_path: HELPER,
        command: '/bin/sh',
        args: ['-c', script],
        columns,
        rows,
        on_data: (text) => {
            output += text;
        },
        on_helper_error: (message) => errors.push(message),
    });
    return { pty, output: () => output, errors };
}

describe('FrameReader', () => {
    it('reassembles frames split anywhere', () => {
        const the_frames: Array<[string, string]> = [];
        const reader = new FrameReader((type, payload) => {
            the_frames.push([type, payload.toString('utf8')]);
        });
        const frame = (type: string, text: string): Buffer => {
            const payload = Buffer.from(text, 'utf8');
            const header = Buffer.alloc(5);
            header.write(type, 0, 'latin1');
            header.writeUInt32BE(payload.length, 1);
            return Buffer.concat([header, payload]);
        };
        const all = Buffer.concat([frame('L', '4c3'), frame('O', 'héllo'), frame('X', '0 0')]);
        for (let i = 0; i < all.length; i++) {
            reader.push(all.subarray(i, i + 1));
        }
        expect(the_frames).toEqual([['L', '4c3'], ['O', 'héllo'], ['X', '0 0']]);
    });

    it('turns exits into shell statuses', () => {
        expect(exit_status_from_frame('3 0')).toBe(3);
        expect(exit_status_from_frame('0 9')).toBe(137);
        expect(exit_status_from_frame('garbage')).toBe(1);
    });
});

describe_helper('sight-pty helper', () => {
    it('relays output and reports the exit code', async () => {
        const shell = run_shell('printf "hello\\n"; exit 3');
        expect(await shell.pty.exit_status).toBe(3);
        expect(shell.output()).toContain('hello');
        expect(shell.pty.helper_failed()).toBe(false);
    });

    it('reports a signal as 128 + n', async () => {
        const shell = run_shell('kill -9 $$');
        expect(await shell.pty.exit_status).toBe(137);
    });

    it('reports a command it cannot run, with 127', async () => {
        let errors = '';
        const pty = spawn_helper_pty({
            helper_path: HELPER,
            command: path.join(BUILD_DIR, 'no such stata'),
            args: [],
            columns: 80,
            rows: 24,
            on_data: () => undefined,
            on_helper_error: (message) => {
                errors += message;
            },
        });
        expect(await pty.exit_status).toBe(127);
        expect(errors).toContain('no such stata');
        expect(pty.helper_failed()).toBe(false);
    });

    it('marks a helper that cannot start as failed', async () => {
        const pty = spawn_helper_pty({
            helper_path: path.join(BUILD_DIR, 'missing-helper'),
            command: 'true',
            args: [],
            columns: 80,
            rows: 24,
            on_data: () => undefined,
        });
        expect(await pty.exit_status).toBe(127);
        expect(pty.helper_failed()).toBe(true);
    });

    it('marks a helper that reports a failure without an exit as failed', async () => {
        // As when the helper can't open a pseudo-terminal: an 'E'
        // frame and no 'X'.
        const fake_helper = path.join(BUILD_DIR, 'fake-failing-helper');
        fs.writeFileSync(fake_helper, "#!/bin/sh\nprintf 'E\\000\\000\\000\\004boom'\nexit 1\n");
        fs.chmodSync(fake_helper, 0o755);
        let errors = '';
        const pty = spawn_helper_pty({
            helper_path: fake_helper,
            command: 'stata-mp',
            args: [],
            columns: 80,
            rows: 24,
            on_data: () => undefined,
            on_helper_error: (message) => {
                errors += message;
            },
        });
        expect(await pty.exit_status).toBe(1);
        expect(errors).toBe('boom');
        expect(pty.helper_failed()).toBe(true);
    });

    it('shutdown ends a command that ignores the hangup', async () => {
        let output = '';
        const handle = create_pty_handle({
            stata_path: '/bin/sh',
            stata_args: ['-c', 'trap "" HUP; echo "pid=$$"; while :; do sleep 1; done'],
            columns: 80,
            rows: 24,
            stata_echoes: false,
        }, {
            on_output: (text) => {
                output += text;
            },
            on_notice: () => undefined,
            on_sight_text: () => undefined,
            on_stata_error: () => undefined,
        }, (pty_options) => spawn_helper_pty({ ...pty_options, helper_path: HELPER }));
        await wait_for(() => /pid=\d+/.test(output), 'the pid');
        const pid = Number(/pid=(\d+)/.exec(output)?.[1]);
        await handle.lifecycle.shutdown('user');
        await sleep(100);
        expect(() => process.kill(pid, 0)).toThrow();
    }, 10000);

    it('starts with echo off and tracks terminal mode changes in order', async () => {
        const shell = run_shell('read go; stty echo -icanon; echo changed; read done');
        await sleep(200);
        expect(shell.pty.echo_enabled()).toBe(false);
        expect(shell.pty.canonical_mode()).toBe(true);
        let at_change: [boolean, boolean] | null = null;
        const original = shell.output;
        shell.pty.write('go\r');
        await wait_for(() => original().includes('changed'), 'the change');
        at_change = [shell.pty.echo_enabled(), shell.pty.canonical_mode()];
        expect(at_change).toEqual([true, false]);
        shell.pty.write('x\n');
        await shell.pty.exit_status;
    });

    it('starts at the given size and resizes', async () => {
        const shell = run_shell('stty size; read go; stty size', 100, 30);
        await wait_for(() => shell.output().includes('30 100'), 'the first size');
        shell.pty.resize(120, 40);
        await sleep(100);
        shell.pty.write('go\r');
        await wait_for(() => shell.output().includes('40 120'), 'the new size');
        await shell.pty.exit_status;
    });

    it('interrupts the command', async () => {
        const shell = run_shell('trap "echo interrupted; exit 5" INT; sleep 10 & wait');
        await sleep(300);
        shell.pty.interrupt();
        expect(await shell.pty.exit_status).toBe(5);
        expect(shell.output()).toContain('interrupted');
    });

    it('hangs up the command on kill, and kills one that ignores the hangup', async () => {
        const polite = run_shell('sleep 10');
        await sleep(200);
        polite.pty.kill('SIGHUP');
        expect(await polite.pty.exit_status).toBe(129);

        const stubborn = run_shell('trap "" HUP; sleep 10');
        await sleep(200);
        const started_ms = Date.now();
        stubborn.pty.kill('SIGHUP');
        expect(await stubborn.pty.exit_status).toBe(137);
        expect(Date.now() - started_ms).toBeGreaterThanOrEqual(1500);
    });

    it('hangs up the command when its input closes', async () => {
        const shell = run_shell('sleep 10');
        await sleep(200);
        shell.pty.close();
        expect(await shell.pty.exit_status).toBe(129);
    });

    it('runs the command in the given directory', async () => {
        let output = '';
        const pty = spawn_helper_pty({
            helper_path: HELPER,
            command: '/bin/sh',
            args: ['-c', 'pwd'],
            columns: 80,
            rows: 24,
            cwd: BUILD_DIR,
            on_data: (text) => {
                output += text;
            },
        });
        expect(await pty.exit_status).toBe(0);
        expect(output).toContain(fs.realpathSync(BUILD_DIR));
    });

    it('gives the command no controlling terminal', async () => {
        // With one, job control could stop Stata after `shell`. (Not
        // checked with sh: bash takes the terminal itself when it
        // leads a session.)
        let output = '';
        const pty = spawn_helper_pty({
            helper_path: HELPER,
            command: process.execPath,
            args: ['-e', "try { require('fs').openSync('/dev/tty', 'r'); console.log('has-tty'); }"
                + " catch { console.log('no-tty'); }"],
            columns: 80,
            rows: 24,
            on_data: (text) => {
                output += text;
            },
        });
        await pty.exit_status;
        expect(output).toContain('no-tty');
    });

    it('keeps its control pipe from the command', async () => {
        const shell = run_shell('if [ -e /dev/fd/3 ]; then echo leaked; else echo closed; fi');
        await shell.pty.exit_status;
        expect(shell.output()).toContain('closed');
    });

    it('ends promptly when a background process keeps the terminal open', async () => {
        const started_ms = Date.now();
        const shell = run_shell('(sleep 5 &) ; echo done');
        expect(await shell.pty.exit_status).toBe(0);
        expect(Date.now() - started_ms).toBeLessThan(2000);
    });

    it('does not deadlock on a lot of input while the command writes', async () => {
        const shell = run_shell('stty -icanon; head -c 300000 >/dev/null; yes | head -n 50000; echo finished');
        await sleep(200);
        const line = 'x'.repeat(999) + '\n';
        for (let i = 0; i < 400; i++) {
            shell.pty.write(line);
        }
        expect(await shell.pty.exit_status).toBe(0);
        expect(shell.output()).toContain('finished');
    }, 20000);
});

describe_helper('editor console over sight-pty', () => {
    function start(stata_path = FAKE_STATA) {
        let screen = '';
        const the_console = start_editor_console({
            write: (text) => {
                screen += text;
            },
            columns: () => 80,
            rows: () => 24,
            ask: async () => 'no',
            env: { ...process.env, FAKE_STATA_MODE: 'raw', NO_COLOR: '1', TERM: '' },
            working_directory: BUILD_DIR,
            pty: { helper_path: HELPER, stata_path },
        });
        return { the_console, screen: () => screen };
    }

    it('is ready at the first prompt and runs typed lines', async () => {
        const { the_console, screen } = start();
        expect(await the_console.ready).toBe(true);
        the_console.handle_input('display hello there\r');
        await wait_for(() => screen().includes('hello there\r\n'), 'the output');
        the_console.handle_input('exit\r');
        const end = await the_console.done;
        expect(end).toEqual({ code: 0, took_stata: true, helper_failed: false });
    });

    it('is never ready when Stata cannot run, and says why', async () => {
        const { the_console, screen } = start(path.join(BUILD_DIR, 'no-stata'));
        expect(await the_console.ready).toBe(false);
        const end = await the_console.done;
        expect(end).toEqual({ code: 127, took_stata: false, helper_failed: false });
        expect(screen()).toContain('no-stata');
    });

    it('reports a helper that cannot start as a helper failure', async () => {
        let screen = '';
        const the_console = start_editor_console({
            write: (text) => {
                screen += text;
            },
            columns: () => 80,
            rows: () => 24,
            ask: async () => 'no',
            env: process.env,
            pty: { helper_path: path.join(BUILD_DIR, 'missing-helper'), stata_path: FAKE_STATA },
        });
        expect(await the_console.ready).toBe(false);
        const end = await the_console.done;
        expect(end.helper_failed).toBe(true);
        expect(end.took_stata).toBe(false);
        expect(screen).toContain('missing-helper');
    });
});
