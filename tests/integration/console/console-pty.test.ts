/**
 * End-to-end tests for `sight console`: the real CLI runs in a real
 * pseudo-terminal and wraps the fake Stata in
 * tests/fixtures/console/fake-stata.ts. Assertions read the final screen
 * through a small terminal emulator.
 *
 * Skipped where pseudo-terminals can't be opened (some sandboxes).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Screen } from './screen';

const ROOT = path.resolve(import.meta.dir, '../../..');
const CLI = path.join(ROOT, 'src/cli.ts');
const FAKE_STATA = path.join(ROOT, 'tests/fixtures/console/fake-stata.ts');
const COLUMNS = 80;

function pty_available(): boolean {
    try {
        const terminal = new Bun.Terminal({ cols: 10, rows: 5 });
        const probe = Bun.spawn(['true'], { terminal });
        probe.kill();
        terminal.close();
        return true;
    } catch {
        return false;
    }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Driven {
    proc: Bun.Subprocess;
    terminal: Bun.Terminal;
    raw: () => string;
    screen: () => string;
    type: (keys: string) => void;
    wait_for: (pattern: RegExp, timeout_ms?: number) => Promise<void>;
}

function drive(mode = '', extra_args: string[] = []): Driven {
    let raw = '';
    const decoder = new TextDecoder();
    const terminal = new Bun.Terminal({
        cols: COLUMNS,
        rows: 40,
        data: (_terminal, data) => {
            raw += decoder.decode(data, { stream: true });
        },
    });
    const proc = Bun.spawn(['bun', CLI, 'console', '--no-history', '--stata', FAKE_STATA,
        ...extra_args], {
        terminal,
        env: { ...process.env, FAKE_STATA_MODE: mode, NO_COLOR: '' },
    });
    const screen = (): string => {
        const emulator = new Screen(COLUMNS);
        emulator.write(raw);
        return emulator.text();
    };
    return {
        proc,
        terminal,
        raw: () => raw,
        screen,
        type: (keys) => {
            terminal.write(keys);
        },
        wait_for: async (pattern, timeout_ms = 5000) => {
            const deadline_ms = Date.now() + timeout_ms;
            while (!pattern.test(screen())) {
                if (Date.now() > deadline_ms) {
                    throw new Error(`Timed out waiting for ${pattern}; screen:\n${screen()}`);
                }
                await sleep(20);
            }
        },
    };
}

/**
 * Wait for the console to settle at a prompt (prompt quiet period). The
 * screen text has trailing blanks trimmed, so `. ` reads as `.`.
 */
async function at_prompt(driven: Driven, prompt = /(?:^|\n)\.$/): Promise<void> {
    await driven.wait_for(prompt);
    await sleep(120);
}

const available = pty_available();

describe.skipIf(!available)('sight console in a pseudo-terminal', () => {
    it('runs commands, colors errors, and passes the exit code through', async () => {
        const driven = drive();
        try {
            await at_prompt(driven);
            driven.type('display "hi"\r');
            await driven.wait_for(/^hi$/m);
            // The submitted line was highlighted.
            expect(driven.raw()).toContain('\x1b[1;34mdisplay\x1b[0m \x1b[32m"hi"\x1b[0m');

            await at_prompt(driven);
            driven.type('foo\r');
            await driven.wait_for(/r\(199\);/);
            expect(driven.raw()).toContain('\x1b[31mcommand foo is unrecognized\x1b[0m');
            expect(driven.raw()).toContain('\x1b[31mr(199);\x1b[0m');

            await at_prompt(driven);
            driven.type('exitcode 3\r');
            expect(await driven.proc.exited).toBe(3);
            // Bracketed paste mode is turned off again on the way out.
            expect(driven.raw().endsWith('\x1b[?2004l')).toBe(true);
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });

    it('completes with Tab and shows each line once', async () => {
        const driven = drive();
        try {
            await at_prompt(driven);
            driven.type('summ\t');
            await driven.wait_for(/\. summarize$/m);
            driven.type('\r');
            await driven.wait_for(/command summarize is unrecognized/);
            const lines = driven.screen().split('\n');
            expect(lines.filter((my_line) => my_line === '. summarize').length).toBe(1);
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });

    it('interrupts a running command and an idle prompt with Ctrl+C', async () => {
        const driven = drive();
        try {
            await at_prompt(driven);
            driven.type('sleep 10000\r');
            await sleep(200);
            driven.type('\x03');
            await driven.wait_for(/--Break--\nr\(1\);/);

            await at_prompt(driven);
            driven.type('half typed\x03');
            await driven.wait_for(/\^C/);
            // The fake prints --Break-- for SIGINT at a prompt too.
            await driven.wait_for(/--Break--[\s\S]*--Break--/);
            await at_prompt(driven);
            driven.type('display "still alive"\r');
            await driven.wait_for(/^still alive$/m);
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });

    it('serves input requests and --more-- without a prompt', async () => {
        const driven = drive();
        try {
            await at_prompt(driven);
            driven.type('request\r');
            await driven.wait_for(/Enter a name:$/);
            driven.type('Bob\r');
            await driven.wait_for(/^hello, Bob$/m);

            await at_prompt(driven);
            driven.type('more\r');
            await driven.wait_for(/--more--$/);
            await sleep(120);
            driven.type('q');
            await driven.wait_for(/^line 3 \("q"\)$/m);
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });

    it('stages pasted lines instead of sending them', async () => {
        const driven = drive();
        try {
            await at_prompt(driven);
            driven.type('\x1b[200~display "one"\ndisplay "two"\n\x1b[201~');
            await driven.wait_for(/1 more pasted line/);
            driven.type('\r');
            await driven.wait_for(/^one$/m);
            await at_prompt(driven, /\. display "two"$/m);
            expect(driven.screen()).not.toMatch(/^two$/m);
            driven.type('\r');
            await driven.wait_for(/^two$/m);
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });

    it('shows a line once when Stata turns terminal echo back on', async () => {
        const driven = drive('echo');
        try {
            await at_prompt(driven);
            driven.type('display 42\r');
            await driven.wait_for(/^42$/m);
            const lines = driven.screen().split('\n');
            expect(lines.filter((my_line) => my_line === '. display 42').length).toBe(1);
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });

    it('stops and reaps Stata when the console is terminated', async () => {
        const driven = drive();
        try {
            await at_prompt(driven);
            driven.type('pid\r');
            await driven.wait_for(/^pid \d+$/m);
            const child_pid = Number(/^pid (\d+)$/m.exec(driven.screen())?.[1]);
            driven.proc.kill('SIGTERM');
            expect(await driven.proc.exited).toBe(128 + (os.constants.signals.SIGTERM ?? 15));
            expect(() => process.kill(child_pid, 0)).toThrow();
        } finally {
            driven.proc.kill();
            driven.terminal.close();
        }
    });
});

describe('sight console under Node', () => {
    let bundle_dir: string;
    let bundle_path: string;
    const node = Bun.which('node');

    beforeAll(async () => {
        bundle_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-console-node-'));
        // Same shape as the npm bundle (scripts/build-binary.ts): the CLI
        // runs main() only under a recognized entry-point name.
        bundle_path = path.join(bundle_dir, 'sight-server.js');
        const result = await Bun.build({
            entrypoints: [CLI],
            target: 'node',
            format: 'esm',
            outdir: bundle_dir,
            naming: { entry: 'sight-server.js' },
        });
        if (!result.success) {
            throw new Error(result.logs.join('\n'));
        }
    });
    afterAll(() => {
        fs.rmSync(bundle_dir, { recursive: true, force: true });
    });

    it.skipIf(!node)('passes piped input straight to Stata', async () => {
        const proc = Bun.spawn([node ?? 'node', bundle_path, 'console', '--stata', FAKE_STATA], {
            stdin: new TextEncoder().encode('display "piped"\nexitcode 5\n'),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const output = await new Response(proc.stdout).text();
        expect(await proc.exited).toBe(5);
        expect(output).toContain('piped');
    });

    it.skipIf(!node || !available)('explains that an interactive console needs Bun', async () => {
        let raw = '';
        const terminal = new Bun.Terminal({
            cols: 80,
            rows: 24,
            data: (_terminal, data) => {
                raw += new TextDecoder().decode(data);
            },
        });
        const proc = Bun.spawn([node ?? 'node', bundle_path, 'console', '--stata', FAKE_STATA], { terminal });
        try {
            expect(await proc.exited).toBe(2);
            expect(raw).toContain('pseudo-terminal support');
        } finally {
            terminal.close();
        }
    });
});
