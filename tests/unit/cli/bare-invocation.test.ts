/**
 * Tests for bare `sight` invocation behavior.
 *
 * A bare invocation in an interactive terminal should print help instead of
 * silently starting the stdio server (which would block on stdin). When stdin
 * is not a TTY (an editor spawning the server over a pipe), the server still
 * starts — that path is covered by the integration/smoke tests.
 */

import { describe, it, expect } from 'bun:test';
import { main } from '../../../src/cli';

async function capture_main(
    argv: string[],
    deps: { is_tty?: boolean }
): Promise<{ code: number; out: string }> {
    const the_lines: string[] = [];
    const original_log = console.log;
    console.log = (message?: unknown) => {
        the_lines.push(String(message));
    };
    try {
        const code = await main(argv, deps);
        return { code, out: the_lines.join('\n') };
    } finally {
        console.log = original_log;
    }
}

describe('bare sight invocation', () => {
    it('prints help and exits 0 when run with no args in a TTY', async () => {
        const { code, out } = await capture_main([], { is_tty: true });

        expect(code).toBe(0);
        expect(out).toContain('USAGE:');
        expect(out).toContain('sight check');
    });

    it('does not short-circuit to help when args are present in a TTY', async () => {
        // --version must print the version, not the bare-invocation help.
        const { code, out } = await capture_main(['--version'], { is_tty: true });

        expect(code).toBe(0);
        expect(out).not.toContain('USAGE:');
    });
});
