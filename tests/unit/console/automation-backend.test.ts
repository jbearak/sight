/**
 * AutomationBackend tests with a fake COM bridge, an in-memory log and
 * a manual clock. Log text follows what Stata 18 wrote in the Windows
 * spike (scripts/spike/windows-com/results/s5.log.gz): echoes carry the
 * prompt they were read at, and Stata stays busy while it waits for
 * more block, program or Mata input.
 */

import { describe, expect, it } from 'bun:test';
import {
    AWAITING_INTERRUPT_NOTE,
    AutomationBackend,
    BUSY_NOTE,
    LOG_LOST_TEXT,
    NOT_RESPONDING_NOTE,
    match_echo,
    type AutomationClock,
} from '../../../src/console/automation/automation-backend';
import { BROWSE_IN_STATA_NOTE, browse_to_vview, is_browse_command } from '../../../src/console/automation/browse-alias';
import type { Bridge, BridgeReply, RequestOptions } from '../../../src/console/automation/bridge';
import type { LogPoll, LogSource } from '../../../src/console/automation/log-tail';
import { ModeTracker, brace_balance } from '../../../src/console/automation/mode-tracker';
import { ConsoleSession } from '../../../src/console/session';

class ManualClock implements AutomationClock {
    now_ms = 0;
    private timers = new Map<number, { at_ms: number; callback: () => void }>();
    private next_id = 1;
    now(): number {
        return this.now_ms;
    }
    set_timeout(callback: () => void, delay_ms: number): unknown {
        const id = this.next_id++;
        this.timers.set(id, { at_ms: this.now_ms + delay_ms, callback });
        return id;
    }
    clear_timeout(handle: unknown): void {
        this.timers.delete(handle as number);
    }
    next_due(target_ms: number): [number, { at_ms: number; callback: () => void }] | null {
        let next: [number, { at_ms: number; callback: () => void }] | null = null;
        for (const my_entry of this.timers) {
            if (my_entry[1].at_ms <= target_ms && (!next || my_entry[1].at_ms < next[1].at_ms)) {
                next = my_entry;
            }
        }
        return next;
    }
    take(id: number): void {
        this.timers.delete(id);
    }
}

class FakeLog implements LogSource {
    content = '';
    private read = 0;
    lost_next = false;
    throw_next: Error | null = null;
    append(text: string): void {
        this.content += text;
    }
    poll(): LogPoll {
        if (this.throw_next) {
            const error = this.throw_next;
            this.throw_next = null;
            throw error;
        }
        if (this.lost_next) {
            this.lost_next = false;
            return { text: '', size: this.read, lost: true };
        }
        const text = this.content.slice(this.read);
        this.read = this.content.length;
        return { text, size: this.read, lost: false };
    }
}

class FakeBridge implements Bridge {
    free = true;
    commands: string[] = [];
    breaks = 0;
    timeouts = false;
    gone_hresult: string | null = null;
    /** If set, `do_async` waits for this reply. */
    do_async_reply: Promise<BridgeReply> | null = null;
    closed = false;
    private end_bridge: (text: string) => void = () => undefined;
    readonly ended = new Promise<string>((resolve) => {
        this.end_bridge = resolve;
    });
    request(op: string, params: Record<string, unknown> = {}, _options: RequestOptions = {}): Promise<BridgeReply> {
        if (this.gone_hresult) {
            return Promise.resolve({
                ok: false,
                failure: { error: 'com', hresult: this.gone_hresult, detail: {} },
            });
        }
        if (this.timeouts && op === 'is_free') {
            return Promise.resolve({ ok: false, timed_out: true });
        }
        switch (op) {
            case 'is_free':
                return Promise.resolve({ ok: true, value: { free: this.free } });
            case 'do_async':
                this.commands.push(String(params.cmd));
                return this.do_async_reply ?? Promise.resolve({ ok: true, value: {} });
            case 'break':
                this.breaks++;
                return Promise.resolve({ ok: true, value: {} });
            case 'error_code':
                return Promise.resolve({ ok: true, value: { rc: 0 } });
            default:
                return Promise.resolve({ ok: true, value: {} });
        }
    }
    close(): void {
        this.closed = true;
    }
    kill(): void {
        this.end_bridge('');
    }
    die(): void {
        this.end_bridge('');
    }
}

async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
}

function setup(extra: { has_vview?: boolean } = {}) {
    const clock = new ManualClock();
    const log = new FakeLog();
    const bridge = new FakeBridge();
    const output: string[] = [];
    const notices: string[] = [];
    const sight: string[] = [];
    let errors = 0;
    const backend = new AutomationBackend({
        bridge,
        log,
        clock,
        start_size: 0,
        has_vview: extra.has_vview ?? true,
        events: {
            on_output: (text) => output.push(text),
            on_notice: (text) => notices.push(text),
            on_sight_text: (text) => sight.push(text),
            on_stata_error: () => {
                errors++;
            },
        },
    });
    backend.start();
    const advance = async (ms: number): Promise<void> => {
        const target_ms = clock.now_ms + ms;
        for (;;) {
            const next = clock.next_due(target_ms);
            if (!next) {
                break;
            }
            clock.take(next[0]);
            clock.now_ms = next[1].at_ms;
            next[1].callback();
            await flush();
        }
        clock.now_ms = target_ms;
        await flush();
    };
    const screen = (): string => output.join('');
    return { clock, log, bridge, backend, output, notices, sight, advance, screen, errors: () => errors };
}

describe('AutomationBackend', () => {
    // Node (the extension) overflows a 200,000-argument spread; Bun only
    // past about a million, so the test uses a million lines.
    it('keeps polling after one poll reads a burst of a million lines', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('list', true);
        log.append(`. list\n${'x\n'.repeat(1000000)}`);
        await advance(100);
        expect(screen()).toContain('x\r\nx\r\n');
        log.append('\n');
        bridge.free = true;
        await advance(300);
        expect(screen().endsWith('\r\n. ')).toBe(true);
        backend.submit_line('display 2', true);
        expect(bridge.commands).toEqual(['list', 'display 2']);
    });

    it('keeps polling after a poll throws, and says so once', async () => {
        const { backend, bridge, log, advance, screen, sight } = setup();
        bridge.free = false;
        backend.submit_line('display 1', true);
        log.throw_next = new Error('read failed');
        await advance(100);
        expect(sight).toHaveLength(1);
        expect(sight[0]).toContain('read failed');
        log.append('. display 1\n1\n\n');
        bridge.free = true;
        await advance(300);
        expect(screen().endsWith('1\r\n\r\n. ')).toBe(true);
        expect(sight).toHaveLength(1);
    });

    it('reports a queued line sent only when Stata is given it', async () => {
        const { backend, bridge, log, advance } = setup();
        const the_reports: string[] = [];
        bridge.free = false;
        backend.submit_line('sleep 60000', true);
        backend.submit_line('do "second.do"', false, (sent) => {
            the_reports.push(sent ? 'sent' : 'dropped');
        });
        await advance(59000);
        expect(bridge.commands).toEqual(['sleep 60000']);
        expect(the_reports).toEqual([]);
        log.append('. sleep 60000\n\n');
        bridge.free = true;
        await advance(300);
        expect(bridge.commands).toEqual(['sleep 60000', 'do "second.do"']);
        expect(the_reports).toEqual(['sent']);
    });

    it('reports a line sent only once Stata accepts it', async () => {
        const { backend, bridge, advance } = setup();
        const the_reports: string[] = [];
        let reply: (value: BridgeReply) => void = () => undefined;
        bridge.do_async_reply = new Promise<BridgeReply>((resolve) => {
            reply = resolve;
        });
        backend.submit_line('do "a.do"', true, (sent) => {
            the_reports.push(sent ? 'sent' : 'dropped');
        });
        await advance(10);
        expect(bridge.commands).toEqual(['do "a.do"']);
        // The helper is blocked: Stata may not have the line yet.
        expect(the_reports).toEqual([]);
        reply({ ok: true, value: {} });
        await advance(10);
        expect(the_reports).toEqual(['sent']);
    });

    // The helper calls DoCommandAsync before it replies, so any reply,
    // or a reply lost after the request reached the helper, is an
    // outcome Stata may have acted on: a failed call (the server died
    // during it) may have executed, and its do-file must stay for the
    // usual cleanup delay. Only a line the helper never got is
    // reported dropped (its do-file goes at once).
    for (const [name, the_reply, expected] of [
        ['a reply lost after the request was written',
            { ok: false, bridge_gone: true, request_written: true }, 'sent'],
        ['a request never written',
            { ok: false, bridge_gone: true }, 'dropped'],
        ['a failure reply from DoCommandAsync (RPC_E_SERVER_DIED)',
            { ok: false, failure: { error: 'error', hresult: '0x80010007', detail: {} } },
            'sent'],
    ] as const) {
        it(`reports ${expected} for ${name}`, async () => {
            const { backend, bridge, advance } = setup();
            const the_reports: string[] = [];
            bridge.do_async_reply = Promise.resolve(the_reply);
            backend.submit_line('do "a.do"', true, (sent) => {
                the_reports.push(sent ? 'sent' : 'dropped');
            });
            bridge.die();
            await advance(10);
            expect(the_reports).toEqual([expected]);
        });
    }

    it('shows a partial line that grows across polls whole', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('display 1', true);
        log.append('. display 1\nA');
        await advance(400);
        expect(screen().endsWith('A')).toBe(true);
        log.append('B');
        await advance(100);
        log.append('C\n');
        await advance(100);
        expect(screen()).toContain('ABC\r\n');
    });

    it('reports queued lines dropped by Ctrl+C or the end of the session', async () => {
        const { backend, bridge, advance } = setup();
        const the_reports: string[] = [];
        const report = (name: string) => (sent: boolean): void => {
            the_reports.push(`${name} ${sent ? 'sent' : 'dropped'}`);
        };
        bridge.free = false;
        backend.submit_line('sleep 60000', true, report('first'));
        backend.submit_line('display 2', false, report('second'));
        backend.interrupt();
        await advance(100);
        // The drop is at once; `first` is reported when Stata accepts it.
        expect(the_reports).toEqual(['second dropped', 'first sent']);
        backend.submit_line('display 3', false, report('third'));
        const shutdown = backend.handle().lifecycle.shutdown('user');
        bridge.die();
        await shutdown;
        backend.submit_line('display 4', false, report('fourth'));
        expect(the_reports).toEqual([
            'second dropped', 'first sent', 'third dropped', 'fourth dropped',
        ]);
    });

    it('shows the first prompt at once', () => {
        const { screen } = setup();
        expect(screen()).toBe('. ');
    });

    it('finishes a fast command once Stata is free and the log settles', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        backend.submit_line('display 1', true);
        expect(bridge.commands).toEqual(['display 1']);
        log.append('. display 1\n1\n\n');
        await advance(200);
        expect(screen()).toBe('. display 1\r\n1\r\n\r\n. ');
    });

    it('replaces the echo with the line as submitted', async () => {
        const { backend, log, advance, screen } = setup();
        backend.submit_line('  display  2', true);
        log.append('. display  2\n2\n\n');
        await advance(200);
        expect(screen()).toContain('  display  2\r\n2\r\n');
    });

    it('recognizes the first echo without a prompt after opening the log', async () => {
        const { backend, log, advance, screen } = setup();
        backend.submit_line('sysuse auto, clear', false);
        log.append('sysuse auto, clear\n(1978 automobile data)\n\n');
        await advance(200);
        expect(screen()).toBe('. sysuse auto, clear\r\n(1978 automobile data)\r\n\r\n. ');
    });

    it('recognizes a wrapped first echo without a prompt', async () => {
        const { backend, log, advance, screen } = setup();
        backend.submit_line('display "abcdefghijabcdefghij"', false);
        log.append('display "abcdefghij\n');
        await advance(30);
        log.append('> abcdefghij"\nresult\n');
        await advance(200);
        expect(screen()).toBe('. display "abcdefghijabcdefghij"\r\nresult\r\n. ');
    });

    it('matches an echo that Stata wrapped over several lines', () => {
        const target = 'display "abcdefghijabcdefghij"';
        expect(match_echo(['. display "abcdefghij', '> abcdefghij"'], target)).toBe(2);
        expect(match_echo(['. display "abcdefghij'], target)).toBe('wait');
        expect(match_echo(['. summarize'], target)).toBeNull();
    });

    it('prompts inside a foreach block while Stata stays busy', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('foreach x in 1 2 {', true);
        log.append('. foreach x in 1 2 {\n');
        await advance(300);
        expect(screen().endsWith('  2. ')).toBe(true);
        backend.submit_line('display `x\'', true);
        log.append('  2. display `x\'\n');
        await advance(300);
        expect(screen().endsWith('  3. ')).toBe(true);
        backend.submit_line('}', true);
        log.append('  3. }\n1\n2\n\n');
        bridge.free = true;
        await advance(300);
        expect(screen().endsWith('1\r\n2\r\n\r\n. ')).toBe(true);
    });

    it('numbers a program definition from 1 and returns at end', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('program define hello', true);
        log.append('. program define hello\n');
        await advance(300);
        expect(screen().endsWith('  1. ')).toBe(true);
        backend.submit_line('display 42', true);
        log.append('  1. display 42\n');
        await advance(300);
        backend.submit_line('end', true);
        log.append('  2. end\n\n');
        bridge.free = true;
        await advance(300);
        expect(screen().endsWith('\r\n. ')).toBe(true);
    });

    it('keeps typeahead in order, one line in Stata at a time', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('sleep 1000', true);
        backend.submit_line('display 3', false);
        expect(bridge.commands).toEqual(['sleep 1000']);
        log.append('. sleep 1000\n\n');
        bridge.free = true;
        await advance(200);
        expect(bridge.commands).toEqual(['sleep 1000', 'display 3']);
        log.append('. display 3\n3\n\n');
        await advance(200);
        // The undrawn typeahead line is shown after its prompt.
        expect(screen()).toContain('. display 3\r\n3\r\n');
    });

    it('shows an undrawn line itself when its echo never comes', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('sleep 1', true);
        backend.submit_line('display 4', false);
        log.append('. sleep 1\n\n');
        bridge.free = true;
        await advance(400);
        // `display 4` finished with no echo in the log: shown once,
        // after its prompt, by the backend.
        expect(screen()).toBe('. sleep 1\r\n\r\n. display 4\r\n. ');
    });

    it('reports a lost log after two lines without echoes', async () => {
        const { backend, log, advance, sight } = setup();
        backend.submit_line('display 5', true);
        log.append('5\n');
        await advance(200);
        expect(sight).toEqual([]);
        backend.submit_line('display 6', true);
        log.append('6\n');
        await advance(200);
        expect(sight).toEqual([LOG_LOST_TEXT]);
    });

    it('does not count blank lines toward a lost log', async () => {
        const { backend, advance, sight } = setup();
        backend.submit_line('', true);
        await advance(200);
        backend.submit_line('', true);
        await advance(200);
        expect(sight).toEqual([]);
    });

    it('reports a log that shrank or vanished', async () => {
        const { log, advance, sight } = setup();
        log.lost_next = true;
        await advance(200);
        expect(sight).toEqual([LOG_LOST_TEXT]);
    });

    it('finishes an awaiting-input line without an echo after the bound', async () => {
        const { backend, bridge, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('foreach x in 1 {', true);
        await advance(500);
        expect(screen().endsWith('  2. ')).toBe(false);
        await advance(700);
        expect(screen().endsWith('  2. ')).toBe(true);
    });

    it('waits longer for the first echo when entering Mata', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('mata', true);
        await advance(1500);
        expect(screen().endsWith(': ')).toBe(false);
        log.append('. mata\n---- mata (type end to exit) ----\n');
        await advance(300);
        expect(screen().endsWith(': ')).toBe(true);
    });

    it('sends nothing for Ctrl+C at an idle top-level prompt', async () => {
        const { backend, bridge, advance } = setup();
        backend.interrupt();
        await advance(100);
        expect(bridge.breaks).toBe(0);
    });

    it('breaks a running line, clears typeahead, and always returns a prompt', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('sleep 10000', true);
        backend.submit_line('display 7', false);
        log.append('. sleep 10000\n');
        await advance(100);
        backend.interrupt();
        await advance(10);
        expect(bridge.breaks).toBe(1);
        // Stata stays busy (as in an input wait): the line still ends.
        await advance(1500);
        expect(screen().endsWith('. ')).toBe(true);
        expect(bridge.commands).toEqual(['sleep 10000']);
    });

    it('matches the command echo arriving after an interrupt', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('sleep 10000', false);
        backend.interrupt();
        log.append('. sleep 10000\n--Break--\nr(1);\n\n');
        bridge.free = true;
        await advance(300);
        expect(screen()).toBe('. sleep 10000\r\n--Break--\r\nr(1);\r\n\r\n. ');
    });

    it('stays in a block on Ctrl+C at its prompt, sending nothing', async () => {
        const { backend, bridge, log, advance, screen, notices } = setup();
        bridge.free = false;
        backend.submit_line('foreach x in 1 {', true);
        log.append('. foreach x in 1 {\n');
        await advance(300);
        backend.interrupt();
        await advance(300);
        expect(bridge.breaks).toBe(0);
        expect(notices).toEqual([AWAITING_INTERRUPT_NOTE]);
        // The next line still goes into the block, as in Stata.
        backend.submit_line('display 1', true);
        log.append('  2. display 1\n');
        await advance(300);
        expect(screen().endsWith('  3. ')).toBe(true);
    });

    it('treats free polls as top level after a mispredicted block', async () => {
        const { backend, log, advance, screen } = setup();
        backend.submit_line('mata: x = 1', true);
        log.append('. mata: x = 1\n\n');
        await advance(300);
        expect(screen().endsWith('. ')).toBe(true);
    });

    it('notes a long silent command once', async () => {
        const { backend, bridge, log, advance, notices } = setup();
        bridge.free = false;
        backend.submit_line('sleep 60000', true);
        log.append('. sleep 60000\n');
        await advance(6000);
        await advance(6000);
        expect(notices).toEqual([BUSY_NOTE]);
    });

    it('ends with status 0 when COM reports Stata gone', async () => {
        const { backend, bridge, advance } = setup();
        bridge.gone_hresult = '0x800706BA';
        await advance(1000);
        expect(await backend.exit_status).toBe(0);
        expect(bridge.closed).toBe(true);
    });

    it('ends with status 1 when the bridge dies', async () => {
        const { backend, bridge } = setup();
        bridge.die();
        expect(await backend.exit_status).toBe(1);
    });

    // A send made once the console knows Stata or the helper is gone
    // never reaches Stata: its do-file can go at once.
    it('reports a line dropped once COM has reported Stata gone', async () => {
        const { backend, bridge, advance } = setup();
        bridge.gone_hresult = '0x800706BA';
        await advance(1000);
        const the_reports: boolean[] = [];
        backend.submit_line('do "a.do"', true, (sent) => the_reports.push(sent));
        expect(the_reports).toEqual([false]);
    });

    it('reports a line dropped once the bridge has died', async () => {
        const { backend, bridge, advance } = setup();
        bridge.die();
        await advance(10);
        const the_reports: boolean[] = [];
        backend.submit_line('do "a.do"', true, (sent) => the_reports.push(sent));
        expect(the_reports).toEqual([false]);
        expect(bridge.commands).toEqual([]);
    });

    it('keeps waiting when Stata stops responding, until Ctrl+C twice', async () => {
        const { backend, bridge, advance, notices } = setup();
        bridge.timeouts = true;
        backend.submit_line('display 8', true);
        await advance(1000);
        expect(notices).toEqual([NOT_RESPONDING_NOTE]);
        backend.interrupt();
        await advance(10);
        backend.interrupt();
        expect(await backend.exit_status).toBe(1);
    });

    it('shows output typed in the Stata window and redraws the prompt', async () => {
        const { log, advance, screen } = setup();
        log.append('. display 9\n9\n\n');
        await advance(1000);
        expect(screen()).toBe('. \r\x1b[K. display 9\r\n9\r\n\r\n. ');
    });

    it('sends browse as vview, showing the line as typed', async () => {
        const { backend, bridge, log, advance, screen, sight } = setup();
        backend.submit_line('br price if foreign', true);
        expect(bridge.commands).toEqual(['vview price if foreign']);
        log.append('. vview price if foreign\nOpened in Sight Data Browser\n\n');
        await advance(200);
        expect(screen()).toContain('br price if foreign\r\nOpened');
        expect(screen()).not.toContain('vview');
        expect(sight).toEqual([]);
    });

    it('leaves browse alone in Mata', async () => {
        const { backend, bridge, log, advance } = setup();
        bridge.free = false;
        backend.submit_line('mata', true);
        log.append('. mata\n---- mata (type end to exit) ----\n');
        await advance(300);
        backend.submit_line('browse = 1', true);
        expect(bridge.commands).toEqual(['mata', 'browse = 1']);
    });

    it('sends browse as is without vview, and says why once', async () => {
        const { backend, bridge, log, advance, sight } = setup({ has_vview: false });
        backend.submit_line('browse', true);
        log.append('. browse\n\n');
        await advance(200);
        backend.submit_line('browse', true);
        expect(bridge.commands).toEqual(['browse', 'browse']);
        expect(sight).toEqual([BROWSE_IN_STATA_NOTE]);
    });

    it('refuses a line with a NUL character, with a fresh prompt', () => {
        const { backend, bridge, notices, output } = setup();
        expect(output).toEqual(['. ']);
        backend.submit_line('display "a\0b"', true);
        expect(bridge.commands).toEqual([]);
        expect(notices.length).toBe(1);
        // The session gave up its prompt with the line: draw another,
        // or a held send would wait for one forever.
        expect(output).toEqual(['. ', '. ']);
    });

    it('draws no second prompt for a refused line that was not drawn', () => {
        const { backend, notices, output } = setup();
        expect(output).toEqual(['. ']);
        // The prompt already given is still on screen.
        backend.submit_line('display "a\0b"', false);
        expect(notices.length).toBe(1);
        expect(output).toEqual(['. ']);
    });

    it('draws no prompt for a NUL line typed ahead while Stata runs', async () => {
        const { backend, bridge, notices, output, advance } = setup();
        bridge.free = false;
        backend.submit_line('sleep 60000', true);
        await advance(100);
        const count = output.length;
        backend.submit_line('display "a\0b"', false);
        expect(notices.length).toBe(1);
        expect(output.length).toBe(count);
    });

    it('starts its prompt on a new line after output without a newline', async () => {
        const { backend, bridge, log, advance, screen } = setup();
        bridge.free = false;
        backend.submit_line('display _continue "A"', true);
        log.append('. display _continue "A"\nA');
        await advance(400);
        expect(screen().endsWith('A')).toBe(true);
        bridge.free = true;
        await advance(300);
        expect(screen().endsWith('A\r\n. ')).toBe(true);
    });

    it('shows a quick command\'s last partial line before its prompt', async () => {
        // Stata is free again before the partial line has been quiet
        // long enough to show: the prompt must not go first, to be
        // erased by that line later.
        const { backend, log, advance, screen } = setup();
        backend.submit_line('display _continue "A"', true);
        log.append('. display _continue "A"\nA');
        await advance(200);
        expect(screen().endsWith('A\r\n. ')).toBe(true);
        await advance(2000);
        expect(screen().endsWith('A\r\n. ')).toBe(true);
    });

    it('draws the prompt again on its own line after a partial line from the Stata window', async () => {
        const { log, advance, screen } = setup();
        await advance(200);
        log.append('B');
        await advance(1500);
        expect(screen()).toBe('. \r\x1b[KB\r\n. ');
    });
});

/** The backend under a real session, as the Windows pane runs it. */
function setup_with_session() {
    const clock = new ManualClock();
    const log = new FakeLog();
    const bridge = new FakeBridge();
    let session: ConsoleSession | null = null;
    const backend = new AutomationBackend({
        bridge,
        log,
        clock,
        start_size: 0,
        has_vview: true,
        events: {
            on_output: (text) => session?.handle_output(text),
            on_notice: (text) => session?.show_notice(text),
            on_sight_text: (text) => session?.write_sight_text(text),
            on_stata_error: () => undefined,
        },
    });
    const the_session = new ConsoleSession({
        backend,
        write: () => undefined,
        columns: () => 80,
        clock,
        history: { all: () => [], add: () => undefined },
        completer: null,
        color_mode: 'off',
    });
    session = the_session;
    backend.start();
    const advance = async (ms: number): Promise<void> => {
        const target_ms = clock.now_ms + ms;
        for (;;) {
            const next = clock.next_due(target_ms);
            if (!next) {
                break;
            }
            clock.take(next[0]);
            clock.now_ms = next[1].at_ms;
            next[1].callback();
            await flush();
        }
        clock.now_ms = target_ms;
        await flush();
    };
    return { log, bridge, session: the_session, advance };
}

describe('AutomationBackend under a session', () => {
    it('gives a held send to Stata once it is free after output without a newline', async () => {
        const { log, bridge, session, advance } = setup_with_session();
        await advance(60);
        bridge.free = false;
        const the_reports: boolean[] = [];
        session.handle_input('display _continue "A"\r');
        session.send_line('do "editor.do"', (sent) => the_reports.push(sent));
        log.append('. display _continue "A"\nA');
        await advance(500);
        expect(bridge.commands).toEqual(['display _continue "A"']);
        bridge.free = true;
        await advance(65000);
        expect(bridge.commands)
            .toEqual(['display _continue "A"', 'do "editor.do"']);
        expect(the_reports).toEqual([true]);
    });

    it('gives a held send to Stata after it refuses a pasted line with a NUL', async () => {
        const { bridge, session, advance } = setup_with_session();
        await advance(60);
        const the_reports: boolean[] = [];
        session.handle_input('\x1b[200~display "a\0b"\x1b[201~\r');
        session.send_line('do "editor.do"', (sent) => the_reports.push(sent));
        await advance(1000);
        expect(bridge.commands).toEqual(['do "editor.do"']);
        expect(the_reports).toEqual([true]);
    });
});

describe('ModeTracker', () => {
    it('predicts block, program, Mata and Python prompts', () => {
        const tracker = new ModeTracker();
        tracker.advance('foreach x in a b {');
        expect(tracker.prompt()).toBe('  2. ');
        tracker.advance('  foreach y in c {');
        tracker.advance('display "`x\'`y\'"');
        expect(tracker.prompt()).toBe('  4. ');
        tracker.advance('}');
        tracker.advance('}');
        expect(tracker.prompt()).toBe('. ');
        tracker.advance('pr de hello');
        expect(tracker.prompt()).toBe('  1. ');
        tracker.advance('end');
        expect(tracker.prompt()).toBe('. ');
        expect(tracker.advance('mata')).toBe(true);
        expect(tracker.prompt()).toBe(': ');
        tracker.advance('for (i = 1; i <= 2; i++) {');
        expect(tracker.prompt()).toBe('> ');
        tracker.advance('}');
        tracker.advance('end');
        expect(tracker.advance('python:')).toBe(true);
        tracker.advance('if True:');
        expect(tracker.prompt()).toBe('... ');
        tracker.advance('');
        expect(tracker.prompt()).toBe('>>> ');
        tracker.advance('end');
        expect(tracker.prompt()).toBe('. ');
    });

    it('matches keywords by exact case', () => {
        const tracker = new ModeTracker();
        expect(tracker.advance('Mata')).toBe(false);
        expect(tracker.prompt()).toBe('. ');
        tracker.advance('Program define x');
        expect(tracker.prompt()).toBe('. ');
    });

    it('ignores one-line forms and program subcommands', () => {
        const tracker = new ModeTracker();
        tracker.advance('mata: x = 1');
        tracker.advance('python: print(1)');
        tracker.advance('program drop hello');
        tracker.advance('program list');
        expect(tracker.prompt()).toBe('. ');
    });

    it('counts braces outside strings and comments', () => {
        expect(brace_balance('display "{" // {')).toBe(0);
        expect(brace_balance('if 1 {')).toBe(1);
    });
});

describe('browse_to_vview', () => {
    it('rewrites browse and its abbreviations, after prefixes', () => {
        expect(browse_to_vview('browse')).toBe('vview');
        expect(browse_to_vview('br')).toBe('vview');
        expect(browse_to_vview('bro make, rows(5)')).toBe('vview make, rows(5)');
        expect(browse_to_vview('brow if foreign')).toBe('vview if foreign');
        expect(browse_to_vview('  brows price')).toBe('  vview price');
        expect(browse_to_vview('quietly browse')).toBe('quietly vview');
        expect(browse_to_vview('cap noi br price')).toBe('cap noi vview price');
        expect(browse_to_vview('capture: browse')).toBe('capture: vview');
        expect(browse_to_vview('nobreak browse')).toBe('nobreak vview');
        expect(browse_to_vview('capture break br price'))
            .toBe('capture break vview price');
    });

    it('rejects a long run of prefixes quickly', () => {
        const start_ms = Date.now();
        expect(is_browse_command(`${'n '.repeat(5000)}x`)).toBe(false);
        expect(is_browse_command(`${'n  '.repeat(5000)}x`)).toBe(false);
        expect(Date.now() - start_ms).toBeLessThan(500);
    });

    it('leaves other commands and other cases alone', () => {
        for (const my_line of [
            'b', 'browser', 'brx', 'Browse', 'BR', 'display "browse"',
            'gen br = 1', 'qu browse', 'browse_count = 1',
            // nobreak and break take no abbreviation
            'nobrea browse', 'brea browse',
        ]) {
            expect(is_browse_command(my_line)).toBe(false);
            expect(browse_to_vview(my_line)).toBe(my_line);
        }
    });
});
