/**
 * The session host's single end: once the pane closes (shutdown
 * begins), no editor send is entered, and every waiting send is
 * answered false exactly once, even if Stata shows a prompt while
 * shutting down.
 */

import { describe, expect, it } from 'bun:test';
import type { BackendEvents, BackendHandle } from '../../../src/console/backend';
import { start_session_host } from '../../../src/console/session-host';
import { PROMPT_QUIET_MS } from '../../../src/console/session';

const sleep = (time_ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, time_ms));

function create_host() {
    let events: BackendEvents | null = null;
    let finish_shutdown: () => void = () => undefined;
    const the_written: string[] = [];
    const host = start_session_host({
        write: () => undefined,
        columns: () => 80,
        rows: () => 24,
        color_output: 'off',
        history: false,
        start_backend: (the_events): BackendHandle => {
            events = the_events;
            return {
                backend: {
                    submit_line: (line, _drawn, on_sent) => {
                        the_written.push(line);
                        on_sent?.(true);
                    },
                    answer_more: () => undefined,
                    interrupt: () => undefined,
                    resize: () => undefined,
                    echoes_input: () => false,
                    max_line_bytes: () => null,
                    waits_for_stata: () => false,
                },
                lifecycle: {
                    exit_status: new Promise<number>(() => undefined),
                    shutdown: () => new Promise<void>((resolve) => {
                        finish_shutdown = resolve;
                    }),
                    closing_message: () => null,
                },
            };
        },
    });
    const output = (text: string): void => {
        events?.on_output(text);
    };
    return { host, output, the_written, finish: () => finish_shutdown() };
}

describe('start_session_host', () => {
    it('enters no held send once shutdown begins', async () => {
        const { host, output, the_written, finish } = create_host();
        output('. ');
        await sleep(PROMPT_QUIET_MS + 15);
        host.handle_input('slow\r');
        const the_reports: string[] = [];
        host.send_line('do "held.do"', (sent) => the_reports.push(`held ${sent}`));

        const done = host.shutdown('user', 0);
        expect(the_reports).toEqual(['held false']);
        host.send_line('do "late.do"', (sent) => the_reports.push(`late ${sent}`));
        expect(the_reports).toEqual(['held false', 'late false']);

        // Stata shows its prompt while the shutdown is still running.
        output('\n. ');
        await sleep(PROMPT_QUIET_MS + 15);
        finish();
        await done;
        expect(the_written).toEqual(['slow']);
        expect(the_reports).toEqual(['held false', 'late false']);
    });
});
