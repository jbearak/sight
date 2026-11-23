/**
 * Tests for Bun's PTY (src/console/pty.ts), which `sight console` uses
 * on the command line. Skipped where pseudo-terminals can't be opened
 * (some sandboxes).
 */

import { describe, expect, it } from 'bun:test';
import { spawn_stata_pty, type StataPty } from '../../../src/console/pty';

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

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function wait_for(
    condition: () => boolean, what: string, timeout_ms = 5000,
): Promise<void> {
    const deadline_ms = Date.now() + timeout_ms;
    while (!condition()) {
        if (Date.now() > deadline_ms) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(20);
    }
}

function run_shell(script: string): { pty: StataPty; output: () => string } {
    let output = '';
    const pty = spawn_stata_pty({
        command: '/bin/sh',
        args: ['-c', script],
        columns: 80,
        rows: 24,
        on_data: (text) => {
            output += text;
        },
    });
    return { pty, output: () => output };
}

describe.skipIf(!pty_available())('Bun PTY', () => {
    it('interrupts what the command started, too', async () => {
        // Like Stata during `shell sleep 60`: the shell defers its trap
        // until its foreground child ends, so a SIGINT to the shell
        // alone would wait out the sleep.
        const shell = run_shell("trap 'echo interrupted' INT; sh -c 'echo started; exec sleep 30'; echo after");
        try {
            await wait_for(() => shell.output().includes('started'), 'the sleep');
            const started_ms = Date.now();
            shell.pty.interrupt();
            await wait_for(() => shell.output().includes('after'), 'the shell to go on', 3000);
            expect(Date.now() - started_ms).toBeLessThan(3000);
            expect(shell.output()).toContain('interrupted');
            expect(await shell.pty.exit_status).toBe(0);
        } finally {
            shell.pty.kill('SIGKILL');
            shell.pty.close();
        }
    });
});
