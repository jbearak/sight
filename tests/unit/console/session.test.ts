/**
 * ConsoleSession tests with a fake PTY and a manual clock. They pin the
 * input-routing contracts: input is written to Stata only on Enter,
 * staged paste lines are loaded but never sent on their own, and Ctrl+C
 * always interrupts.
 */

import { describe, expect, it } from 'bun:test';
import {
    ConsoleSession,
    MAX_CANONICAL_LINE_BYTES,
    PROMPT_QUIET_MS,
    type Clock,
    type Completer,
} from '../../../src/console/session';
import type { StataPty } from '../../../src/console/pty';
import { strip_ansi } from '../../../src/console/prompt-detector';

class ManualClock implements Clock {
    now_ms = 0;
    private timers = new Map<number, { at_ms: number; callback: () => void }>();
    private next_id = 1;

    set_timeout(callback: () => void, delay_ms: number): unknown {
        const id = this.next_id++;
        this.timers.set(id, { at_ms: this.now_ms + delay_ms, callback });
        return id;
    }

    clear_timeout(handle: unknown): void {
        this.timers.delete(handle as number);
    }

    advance(ms: number): void {
        const target_ms = this.now_ms + ms;
        for (;;) {
            let next: [number, { at_ms: number; callback: () => void }] | null = null;
            for (const my_entry of this.timers) {
                if (my_entry[1].at_ms <= target_ms && (!next || my_entry[1].at_ms < next[1].at_ms)) {
                    next = my_entry;
                }
            }
            if (!next) {
                break;
            }
            this.timers.delete(next[0]);
            this.now_ms = next[1].at_ms;
            next[1].callback();
        }
        this.now_ms = target_ms;
    }
}

class FakePty implements StataPty {
    readonly pid = 1;
    written: string[] = [];
    interrupts = 0;
    echo = false;
    canonical = true;
    readonly exit_status = new Promise<number>(() => undefined);
    write(text: string): void {
        this.written.push(text);
    }
    interrupt(): void {
        this.interrupts++;
    }
    resize(): void {}
    echo_enabled(): boolean {
        return this.echo;
    }
    canonical_mode(): boolean {
        return this.canonical;
    }
    kill(): void {}
    close(): void {}
}

function setup(options: { completer?: Completer | null; history?: string[] } = {}) {
    const clock = new ManualClock();
    const pty = new FakePty();
    const screen: string[] = [];
    const history = options.history ?? [];
    const session = new ConsoleSession({
        pty,
        write: (text) => screen.push(text),
        columns: () => 80,
        clock,
        history: { all: () => history, add: (line) => history.push(line) },
        completer: options.completer ?? null,
        color_mode: 'streams',
        stata_echoes: false,
    });
    const at_prompt = (text = '. '): void => {
        session.handle_output(text);
        clock.advance(PROMPT_QUIET_MS + 1);
    };
    return { clock, pty, screen, history, session, at_prompt };
}

describe('ConsoleSession', () => {
    it('recognizes a prompt only after output goes quiet', () => {
        const { clock, session } = setup();
        session.handle_output('. ');
        expect(session.current_prompt).toBeNull();
        clock.advance(PROMPT_QUIET_MS + 1);
        expect(session.current_prompt).toBe('stata');
    });

    it('forgets a prompt-shaped fragment when more output follows', () => {
        const { session, at_prompt } = setup();
        at_prompt('working\n. ');
        expect(session.current_prompt).toBe('stata');
        session.handle_output('still working\n');
        expect(session.current_prompt).toBeNull();
    });

    it('writes typed input only on Enter, even while Stata is busy', () => {
        const { pty, session } = setup();
        session.handle_output('Enter a name: ');
        session.handle_input('Bob');
        expect(pty.written).toEqual([]);
        session.handle_input('\r');
        expect(pty.written).toEqual(['Bob\r']);
    });

    it('records history only for lines entered at command prompts', () => {
        const { session, history, at_prompt } = setup();
        at_prompt();
        session.handle_input('display 1\r');
        session.handle_output('Enter a name: ');
        session.handle_input('secret\r');
        expect(history).toEqual(['display 1']);
    });

    it('stages pasted lines and loads them only at a recognized prompt', () => {
        const { pty, session, at_prompt, clock } = setup();
        at_prompt();
        session.handle_input('\x1b[200~display 1\r\nrequest\r\ndisplay 3\r\n\x1b[201~');
        expect(session.buffer).toBe('display 1');
        expect(session.staged_lines).toEqual(['request', 'display 3']);
        expect(pty.written).toEqual([]);

        session.handle_input('\r');
        expect(pty.written).toEqual(['display 1\r']);
        at_prompt('1\n\n. ');
        // Loaded, not sent.
        expect(session.buffer).toBe('request');
        expect(pty.written).toEqual(['display 1\r']);

        session.handle_input('\r');
        // A command waiting for input without a prompt: nothing loads.
        session.handle_output('Enter a name: ');
        clock.advance(1000);
        expect(session.buffer).toBe('');
        expect(pty.written).toEqual(['display 1\r', 'request\r']);
    });

    it('drops the staged-lines note from the submitted line', () => {
        const { session, screen, at_prompt } = setup();
        at_prompt();
        session.handle_input('\x1b[200~display 1\ndisplay 2\x1b[201~');
        screen.length = 0;
        session.handle_input('\r');
        // The final draw of the line has no note row, so the newline
        // that follows doesn't leave the note for output to overwrite.
        const newline_index = screen.indexOf('\r\n');
        expect(newline_index).toBeGreaterThan(0);
        expect(screen[newline_index - 1]).not.toContain('pasted');
    });

    it('does not send a staged line after a delayed prompt-shaped fragment', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt();
        session.handle_input('\x1b[200~slow\ndisplay 2\x1b[201~\r');
        at_prompt('working\n. ');
        expect(session.buffer).toBe('display 2');
        session.handle_output('still working\n');
        expect(pty.written).toEqual(['slow\r']);
    });

    it('keeps typed text instead of loading a staged line over it', () => {
        const { session, at_prompt } = setup();
        at_prompt();
        session.handle_input('\x1b[200~a\nb\x1b[201~\r');
        session.handle_output('x\n');
        session.handle_input('typed');
        at_prompt();
        expect(session.buffer).toBe('typed');
        expect(session.staged_lines).toEqual(['b']);
    });

    it('discards staged lines after an error, on Esc, and on Ctrl+C', () => {
        const first = setup();
        first.at_prompt();
        first.session.handle_input('\x1b[200~bad\nnext\x1b[201~\r');
        first.session.handle_output('command bad is unrecognized\nr(199);\n');
        expect(first.session.staged_lines).toEqual([]);

        const second = setup();
        second.at_prompt();
        second.session.handle_input('\x1b[200~a\nb\x1b[201~');
        second.session.handle_input('\x1b');
        second.clock.advance(100);
        expect(second.session.staged_lines).toEqual([]);

        const third = setup();
        third.at_prompt();
        third.session.handle_input('\x1b[200~a\nb\x1b[201~');
        third.session.handle_input('\x03');
        expect(third.session.staged_lines).toEqual([]);
        expect(third.session.buffer).toBe('');
    });

    it('interrupts Stata on Ctrl+C both at a prompt and while busy', () => {
        const { pty, session, screen, at_prompt } = setup();
        at_prompt();
        session.handle_input('half typed\x03');
        expect(pty.interrupts).toBe(1);
        expect(pty.written).toEqual([]);
        // A fresh prompt is drawn even if Stata prints nothing.
        expect(strip_ansi(screen.join(''))).toContain('^C\r\n\r. ');
        expect(session.current_prompt).toBe('stata');

        session.handle_input('sleep 5000\r');
        session.handle_input('\x03');
        expect(pty.interrupts).toBe(2);
    });

    it('answers --more-- with one keystroke', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt('line\n--more--');
        expect(session.current_prompt).toBe('more');
        session.handle_input('q');
        expect(pty.written).toEqual(['q\r']);
        expect(session.buffer).toBe('');

        at_prompt('\n--more--');
        session.handle_input('\r');
        expect(pty.written).toEqual(['q\r', '\r']);

        pty.canonical = false;
        at_prompt('\n--more--');
        session.handle_input(' ');
        expect(pty.written).toEqual(['q\r', '\r', ' ']);
    });

    it('sends exit on Ctrl+D only at the top-level prompt', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt('  1. ');
        session.handle_input('\x04');
        expect(pty.written).toEqual([]);
        at_prompt('\n. ');
        session.handle_input('\x04');
        expect(pty.written).toEqual(['exit\r']);
    });

    it('refuses lines the terminal line buffer would truncate', () => {
        const { pty, session, screen, at_prompt } = setup();
        at_prompt();
        session.handle_input(`display "${'x'.repeat(MAX_CANONICAL_LINE_BYTES)}"\r`);
        expect(pty.written).toEqual([]);
        expect(screen.join('')).toContain('was not sent');
    });

    it('highlights input at a Stata prompt but not at an input request', () => {
        const prompt = setup();
        prompt.at_prompt();
        prompt.session.handle_input('display 1');
        expect(prompt.screen.join('')).toContain('\x1b[1;34mdisplay');

        const request = setup();
        request.session.handle_output('Enter a name: ');
        request.session.handle_input('display 1');
        expect(request.screen.join('')).not.toContain('\x1b[1;34m');
    });

    it('lets Stata echo the line when its terminal echo is on', () => {
        const { pty, session, screen, at_prompt } = setup();
        pty.echo = true;
        at_prompt();
        screen.length = 0;
        session.handle_input('display 1\r');
        expect(pty.written).toEqual(['display 1\r']);
        // The editor is cleared back to the prompt rather than left.
        expect(screen.join('').endsWith('\r\x1b[J. \r\x1b[2C')).toBe(true);
    });

    it('keeps failure tracking for a running command across typed-ahead lines', () => {
        const transcript: string[] = [];
        const completer: Completer = {
            complete: async () => [],
            add_line: (line) => transcript.push(line),
            drop_last_line: () => transcript.pop(),
        };
        const { session, at_prompt } = setup({ completer });
        at_prompt();
        session.handle_input('generate bad = missingvar\r');
        session.handle_input('display 1\r');
        session.handle_output('variable missingvar not found\nr(111);\n');
        expect(transcript).toEqual([]);
    });

    it('records the end of a Mata block in the transcript', () => {
        const transcript: string[] = [];
        const completer: Completer = {
            complete: async () => [],
            add_line: (line) => transcript.push(line),
            drop_last_line: () => transcript.pop(),
        };
        const { session, at_prompt } = setup({ completer });
        at_prompt();
        session.handle_input('mata\r');
        at_prompt('---- mata ----\n: ');
        session.handle_input('x = 1\r');
        at_prompt('\n: ');
        session.handle_input('end\r');
        expect(transcript).toEqual(['mata', 'end']);
    });

    it('completes at Stata prompts and drops failed lines from the transcript', async () => {
        const transcript: string[] = [];
        const completer: Completer = {
            complete: async () => [{ label: 'summarize', insert: 'summarize', start: 0, end: 2 }],
            add_line: (line) => transcript.push(line),
            drop_last_line: () => transcript.pop(),
        };
        const { session, at_prompt } = setup({ completer });
        at_prompt();
        session.handle_input('su\t');
        await Promise.resolve();
        await Promise.resolve();
        expect(session.buffer).toBe('summarize');

        session.handle_input('\r');
        expect(transcript).toEqual(['summarize']);
        session.handle_output('varlist required\nr(100);\n');
        expect(transcript).toEqual([]);
    });
});
