/**
 * ConsoleSession tests with a fake PTY and a manual clock. They pin the
 * input-routing contracts: input is written to Stata only on Enter,
 * staged paste lines are loaded but never sent on their own, and Ctrl+C
 * always interrupts.
 */

import { describe, expect, it } from 'bun:test';
import {
    ConsoleSession,
    ESCAPE_TIMEOUT_MS,
    MAX_CANONICAL_LINE_BYTES,
    EXIT_CLEAR_NOTICE,
    PROMPT_QUIET_MS,
    type Clock,
    type Completer,
} from '../../../src/console/session';
import type { StataPty } from '../../../src/console/pty';
import { PtyBackend } from '../../../src/console/pty-backend';
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

function setup(options: {
    completer?: Completer | null;
    history?: string[];
    on_ready?: () => void;
    color_mode?: 'streams' | 'off';
} = {}) {
    const clock = new ManualClock();
    const pty = new FakePty();
    const screen: string[] = [];
    const history = options.history ?? [];
    const session = new ConsoleSession({
        backend: new PtyBackend(pty, { stata_echoes: false }),
        write: (text) => screen.push(text),
        columns: () => 80,
        clock,
        history: { all: () => history, add: (line) => history.push(line) },
        completer: options.completer ?? null,
        color_mode: options.color_mode ?? 'streams',
        on_ready: options.on_ready,
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

    it('reports ready once, at the first top-level Stata prompt', () => {
        let ready_count = 0;
        const { session, at_prompt } = setup({ on_ready: () => ready_count++ });
        at_prompt('--more--');
        expect(ready_count).toBe(0);
        session.handle_output('\r\n');
        at_prompt(': ');
        expect(ready_count).toBe(0);
        session.handle_output('\r\n');
        at_prompt('. ');
        expect(ready_count).toBe(1);
        session.handle_output('\r\n');
        at_prompt('. ');
        expect(ready_count).toBe(1);
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

    // A lone Esc is the Esc key once it has waited ESCAPE_TIMEOUT_MS,
    // and the start of Alt+key before that.
    it('reads a lone Esc as the Esc key after its wait', () => {
        const late = setup();
        late.at_prompt();
        late.session.handle_input('\x1b[200~abc\ndef\x1b[201~');
        expect(late.session.staged_lines).toEqual(['def']);
        late.session.handle_input('\x1b');
        late.clock.advance(35);
        // The Esc key cancelled the staged pasted line.
        expect(late.session.staged_lines).toEqual([]);
        late.session.handle_input('z');
        expect(late.session.buffer).toBe('abcz');

        const quick = setup();
        quick.at_prompt();
        quick.session.handle_input('\x1b[200~abc\ndef\x1b[201~');
        quick.session.handle_input('\x1b');
        quick.clock.advance(ESCAPE_TIMEOUT_MS - 5);
        quick.session.handle_input('z');
        // Alt+z: the staged line stays, and no z is typed.
        expect(quick.session.staged_lines).toEqual(['def']);
        expect(quick.session.buffer).toBe('abc');
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

    it('holds an editor send at --more-- until the prompt returns', () => {
        const { pty, session, at_prompt, screen } = setup();
        const the_reports: boolean[] = [];
        at_prompt('line\n--more--');
        session.send_line('do "second.do"', (sent) => the_reports.push(sent));
        expect(pty.written).toEqual([]);
        expect(the_reports).toEqual([]);
        expect(strip_ansi(screen.join(''))).toContain('1 send from the editor waits');

        // Typed keys still answer the pager.
        session.handle_input(' ');
        expect(pty.written).toEqual([' \r']);
        at_prompt('\nmore output\n--more--');
        expect(pty.written).toEqual([' \r']);
        session.handle_input('q');
        expect(pty.written).toEqual([' \r', 'q\r']);

        at_prompt('\n. ');
        expect(pty.written).toEqual([' \r', 'q\r', 'do "second.do"\r']);
        expect(the_reports).toEqual([true]);
    });

    it('sends held editor sends one per prompt, in order', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt('--more--');
        session.send_line('do "a.do"');
        session.send_line('do "b.do"');
        session.handle_input('q');
        at_prompt('\n. ');
        expect(pty.written).toEqual(['q\r', 'do "a.do"\r']);
        at_prompt('\n. ');
        expect(pty.written).toEqual(['q\r', 'do "a.do"\r', 'do "b.do"\r']);
    });

    it('drops held editor sends on Ctrl+C and at exit', () => {
        const { pty, session, at_prompt } = setup();
        const the_reports: string[] = [];
        at_prompt('--more--');
        session.send_line('do "a.do"', (sent) => the_reports.push(`a ${sent}`));
        session.handle_input('\x03');
        at_prompt('\n. ');
        expect(pty.written).toEqual([]);
        expect(the_reports).toEqual(['a false']);

        at_prompt('\n--more--');
        session.send_line('do "b.do"', (sent) => the_reports.push(`b ${sent}`));
        session.handle_exit();
        expect(the_reports).toEqual(['a false', 'b false']);
        session.send_line('do "c.do"', (sent) => the_reports.push(`c ${sent}`));
        expect(the_reports).toEqual(['a false', 'b false', 'c false']);
    });

    it('types an editor send at once when no pager shows', () => {
        const { pty, session, at_prompt } = setup();
        const the_reports: boolean[] = [];
        at_prompt();
        session.send_line('do "a.do"', (sent) => the_reports.push(sent));
        expect(pty.written).toEqual(['do "a.do"\r']);
        expect(the_reports).toEqual([true]);
    });

    it('enters a held send on its own line and keeps what the user typed', () => {
        const { pty, session, at_prompt, screen } = setup();
        const the_reports: boolean[] = [];
        at_prompt('--more--');
        session.send_line('do "file.do"', (sent) => the_reports.push(sent));
        session.handle_input('q');
        // Typed after answering the pager, before the next prompt.
        session.handle_input('di 9');
        at_prompt('\n. ');
        expect(pty.written).toEqual(['q\r', 'do "file.do"\r']);
        expect(the_reports).toEqual([true]);
        expect(session.buffer).toBe('di 9');
        // The unfinished line is drawn again after the send.
        expect(strip_ansi(screen.join(''))).toMatch(/do "file\.do"\r*\n\r*di 9\r*$/);
        session.handle_input('\r');
        expect(pty.written).toEqual(['q\r', 'do "file.do"\r', 'di 9\r']);
    });

    it('keeps typed input and its cursor when a send is entered at a prompt', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt();
        session.handle_input('di 19');
        session.handle_input('\x1b[D');
        session.send_line('do "a.do"');
        expect(pty.written).toEqual(['do "a.do"\r']);
        expect(session.buffer).toBe('di 19');
        at_prompt('\n. ');
        session.handle_input('2\r');
        expect(pty.written).toEqual(['do "a.do"\r', 'di 129\r']);
    });

    it('runs a line typed with Enter before sends still waiting', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt('--more--');
        session.send_line('do "held.do"');
        session.handle_input('q');
        // Typed ahead (no prompt yet): goes to Stata at once, as when
        // typing ahead in console Stata, so Stata runs it first.
        session.handle_input('di 9\r');
        expect(pty.written).toEqual(['q\r', 'di 9\r']);
        at_prompt('\n. ');
        expect(pty.written).toEqual(['q\r', 'di 9\r', 'do "held.do"\r']);
    });

    it('still sends a typed answer to an unrecognized prompt while a send waits', () => {
        const { pty, session, at_prompt } = setup();
        at_prompt('--more--');
        session.send_line('do "held.do"');
        session.handle_input('q');
        // `display _request(name)` asks with a prompt the console
        // doesn't know; the answer must still reach Stata.
        at_prompt('\nYour name? ');
        session.handle_input('Ann\r');
        expect(pty.written).toEqual(['q\r', 'Ann\r']);
        at_prompt('\n. ');
        expect(pty.written).toEqual(['q\r', 'Ann\r', 'do "held.do"\r']);
    });

    it('does not release a held send on a prompt a typed line already answered', () => {
        // Real Stata echoes input itself (raw mode).
        const { pty, session, clock } = setup();
        pty.canonical = false;
        const the_reports: boolean[] = [];
        session.handle_output('working\n');
        session.send_line('do "a.do"', (sent) => the_reports.push(sent));
        // The prompt arrives, and the user enters a line before the
        // quiet window passes: that line takes the prompt.
        session.handle_output('. ');
        session.handle_input('sleep 60000\r');
        clock.advance(PROMPT_QUIET_MS + 1);
        expect(pty.written).toEqual(['sleep 60000\r']);
        expect(the_reports).toEqual([]);
        session.handle_output('sleep 60000\r\n\r\n. ');
        clock.advance(PROMPT_QUIET_MS + 1);
        expect(pty.written).toEqual(['sleep 60000\r', 'do "a.do"\r']);
        expect(the_reports).toEqual([true]);
    });

    it('holds an editor send until a prompt is recognized', () => {
        const { pty, session, clock } = setup();
        const the_reports: boolean[] = [];
        // `--more--` has arrived but the quiet window hasn't passed.
        session.handle_output('line\n--more--');
        session.send_line('do "a.do"', (sent) => the_reports.push(sent));
        expect(pty.written).toEqual([]);
        clock.advance(PROMPT_QUIET_MS + 1);
        expect(session.current_prompt).toBe('more');
        expect(pty.written).toEqual([]);
        session.handle_input('q');
        expect(pty.written).toEqual(['q\r']);
        session.handle_output('\n. ');
        clock.advance(PROMPT_QUIET_MS + 1);
        expect(pty.written).toEqual(['q\r', 'do "a.do"\r']);
        expect(the_reports).toEqual([true]);
    });

    it('reports a send made while Stata runs only at a recognized prompt', () => {
        const { pty, session, clock, at_prompt, screen } = setup();
        const the_reports: boolean[] = [];
        at_prompt();
        session.handle_input('sleep 60000\r');
        session.send_line('do "a.do"', (sent) => the_reports.push(sent));
        // The pseudo-terminal would take the line now, but Stata is
        // asleep: the line waits, and so does its do-file's cleanup.
        expect(pty.written).toEqual(['sleep 60000\r']);
        expect(strip_ansi(screen.join(''))).toContain('1 send from the editor waits');
        // Output, quiet spells and a minute pass without a prompt.
        session.handle_output('running');
        clock.advance(30000);
        session.handle_output('\nstill running\n');
        clock.advance(30000);
        expect(pty.written).toEqual(['sleep 60000\r']);
        expect(the_reports).toEqual([]);
        // Stata's prompt, in the output of the command that ends.
        session.handle_output('done\n\n. ');
        expect(pty.written).toEqual(['sleep 60000\r']);
        clock.advance(PROMPT_QUIET_MS + 1);
        expect(pty.written).toEqual(['sleep 60000\r', 'do "a.do"\r']);
        expect(the_reports).toEqual([true]);
        // The line was entered after the prompt, on its own line.
        expect(strip_ansi(screen.join(''))).toMatch(/\. do "a\.do"\r*\n$/);
    });

    it('holds a send after text that is not a known prompt, and says so', () => {
        const { pty, session, clock, at_prompt, screen } = setup();
        const the_reports: string[] = [];
        at_prompt();
        session.handle_input('cmd\r');
        at_prompt('\nabc. ');
        session.send_line('do "a.do"', (sent) => the_reports.push(`a ${sent}`));
        clock.advance(60000);
        expect(pty.written).toEqual(['cmd\r']);
        expect(the_reports).toEqual([]);
        expect(strip_ansi(screen.join('')))
            .toMatch(/abc\. \r?\n?.*1 send from the editor waits/s);
        // Enter gets a fresh prompt from Stata, and the send goes.
        session.handle_input('\r');
        at_prompt('\n. ');
        expect(pty.written).toEqual(['cmd\r', '\r', 'do "a.do"\r']);
        expect(the_reports).toEqual(['a true']);

        // Or Ctrl+C drops the sends that wait.
        session.handle_input('cmd\r');
        at_prompt('\nabc. ');
        session.send_line('do "b.do"', (sent) => the_reports.push(`b ${sent}`));
        session.handle_input('\x03');
        expect(the_reports).toEqual(['a true', 'b false']);
    });

    it('tries the next held send when one is too long to enter', () => {
        const { pty, session, at_prompt, screen } = setup();
        const the_reports: string[] = [];
        at_prompt();
        session.handle_input('slow\r');
        session.handle_input('di 1');
        const long_line = 'x'.repeat(MAX_CANONICAL_LINE_BYTES + 1);
        session.send_line(long_line, (sent) => the_reports.push(`long ${sent}`));
        session.send_line('do "ok.do"', (sent) => the_reports.push(`ok ${sent}`));
        at_prompt('\n. ');
        expect(the_reports).toEqual(['long false', 'ok true']);
        expect(pty.written).toEqual(['slow\r', 'do "ok.do"\r']);
        // The rejected line is not left to be entered by the next Enter.
        expect(session.buffer).toBe('di 1');
        expect(strip_ansi(screen.join(''))).toContain('was not sent');
    });

    it('does not leave a rejected send in the input at a prompt', () => {
        const { pty, session, at_prompt } = setup();
        const the_reports: boolean[] = [];
        at_prompt();
        session.send_line(
            'x'.repeat(MAX_CANONICAL_LINE_BYTES + 1),
            (sent) => the_reports.push(sent)
        );
        expect(the_reports).toEqual([false]);
        expect(session.buffer).toBe('');
        session.handle_input('\r');
        expect(pty.written).toEqual(['\r']);
    });

    it('enters a send held before the first prompt ahead of one made when ready', () => {
        let send_when_ready: () => void = () => undefined;
        const { pty, session, at_prompt } = setup({
            on_ready: () => send_when_ready(),
        });
        session.send_line('do "early.do"');
        send_when_ready = () => session.send_line('do "ready.do"');
        at_prompt();
        expect(pty.written).toEqual(['do "early.do"\r']);
        at_prompt('\n. ');
        expect(pty.written).toEqual(['do "early.do"\r', 'do "ready.do"\r']);
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

    describe('a second Ctrl+D after Stata refuses exit', () => {
        const REFUSAL = 'no; dataset in memory has changed since last saved\r\n'
            + '    Save the data or specify option clear to exit anyway.\r\n'
            + 'r(4);\r\n\r\n. ';

        function refused(options: { color_mode?: 'streams' | 'off' } = {}) {
            const harness = setup(options);
            harness.at_prompt();
            harness.session.handle_input('\x04');
            harness.at_prompt(REFUSAL);
            return harness;
        }

        it('shows a warning and sends exit, clear', () => {
            const { pty, session, screen } = refused();
            expect(screen.join('')).toContain(`\x1b[33m${EXIT_CLEAR_NOTICE}`);
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit, clear\r']);
        });

        it('arms when the refusal arrives in pieces (frames variant)', () => {
            const { pty, session, clock, at_prompt } = setup();
            at_prompt();
            session.handle_input('\x04');
            session.handle_output('no; dataset in memory has ch');
            clock.advance(PROMPT_QUIET_MS + 1);
            at_prompt('anged since last saved\r\n    There are unsaved data '
                + 'in frame f2. Save the data or specify option clear\r\n'
                + '    to exit anyway.\r\nr(4);\r\n\r\n. ');
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit, clear\r']);
        });

        it('disarms on any other key', () => {
            const { pty, session } = refused();
            session.handle_input('x');
            session.handle_input('\x7f');
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit\r']);
        });

        it('disarms on Ctrl+C', () => {
            const { pty, session } = refused();
            session.handle_input('\x03');
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit\r']);
        });

        it('disarms when the editor sends a line', () => {
            const { pty, session, at_prompt } = refused();
            session.send_line('display 1');
            at_prompt('1\r\n\r\n. ');
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'display 1\r', 'exit\r']);
        });

        it('disarms on a key the decoder ignores (F1)', () => {
            const { pty, session } = refused();
            session.handle_input('\x1bOP');
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit\r']);
        });

        it('does not arm after a key pressed before the refusal', () => {
            const { pty, session, at_prompt } = setup();
            at_prompt();
            session.handle_input('\x04');
            session.handle_input('x');
            session.handle_input('\x7f');
            at_prompt(REFUSAL);
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit\r']);
        });

        it('removes the notice on Esc', () => {
            const { session, screen } = refused();
            screen.length = 0;
            session.handle_input('\x1b');
            session.handle_input('\x1b');
            expect(screen.join('')).toContain('\x1b[J');
            expect(screen.join('')).not.toContain(EXIT_CLEAR_NOTICE);
        });

        it('does not arm for a typed exit', () => {
            const { pty, session, screen, at_prompt } = setup();
            at_prompt();
            session.handle_input('exit\r');
            at_prompt(REFUSAL);
            expect(screen.join('')).not.toContain(EXIT_CLEAR_NOTICE);
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit\r']);
        });

        it('does not arm for other output after Ctrl+D', () => {
            const { pty, session, screen, at_prompt } = setup();
            at_prompt();
            session.handle_input('\x04');
            at_prompt('something else\r\n. ');
            expect(screen.join('')).not.toContain(EXIT_CLEAR_NOTICE);
            session.handle_input('\x04');
            expect(pty.written).toEqual(['exit\r', 'exit\r']);
        });

        it('draws the notice uncolored when colors are off', () => {
            const { screen } = refused({ color_mode: 'off' });
            const text = screen.join('');
            expect(text).toContain(EXIT_CLEAR_NOTICE);
            expect(text).not.toContain(`\x1b[33m${EXIT_CLEAR_NOTICE}`);
        });
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

    it('drops Stata\'s own echo of a submitted line, also split across chunks', () => {
        // Real Stata runs its terminal in raw mode and echoes input itself.
        const { pty, session, screen, at_prompt, clock } = setup();
        pty.canonical = false;
        at_prompt();
        session.handle_input('display 1\r');
        expect(pty.written).toEqual(['display 1\r']);
        screen.length = 0;
        session.handle_output('displ');
        session.handle_output('ay 1\r\n2\r\n');
        clock.advance(100);
        const shown = strip_ansi(screen.join(''));
        expect(shown).not.toContain('display 1');
        expect(shown).toContain('2\r\n');
    });

    it('drops an echo that Stata wrapped at the line width', () => {
        const { pty, session, screen, at_prompt, clock } = setup();
        pty.canonical = false;
        at_prompt();
        session.handle_input('display "abcdef"\r');
        screen.length = 0;
        // Wrapped, with the marker split across chunks.
        session.handle_output('display "ab\r');
        session.handle_output('\n> cdef"\r\nabcdef\r\n');
        clock.advance(100);
        const shown = strip_ansi(screen.join(''));
        expect(shown).not.toContain('display');
        expect(shown).toContain('abcdef\r\n');
    });

    it('shows output unchanged when it is not an exact echo', () => {
        const { pty, session, screen, at_prompt, clock } = setup();
        pty.echo = true;
        at_prompt();
        session.handle_input('display 1\r');
        screen.length = 0;
        session.handle_output('disp');
        session.handle_output('X\r\n');
        clock.advance(100);
        expect(strip_ansi(screen.join(''))).toContain('dispX\r\n');
    });

    it('leaves a typed-ahead line for Stata to echo when it reads it', () => {
        const { pty, session, screen, clock } = setup();
        pty.canonical = false;
        session.handle_output('working');
        clock.advance(100);
        session.handle_input('display 2');
        screen.length = 0;
        session.handle_input('\r');
        expect(pty.written).toEqual(['display 2\r']);
        // Cleared back to Stata's partial line, not left on screen.
        expect(screen.join('').endsWith('\r\x1b[Jworking\r\x1b[7C')).toBe(true);
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

describe('ConsoleSession: every editor send is answered once', () => {
    type Step = 'prompt' | 'pager' | 'ctrl_c' | 'close' | 'exit' | 'send' | 'long';
    const THE_STEPS: Step[] = ['prompt', 'pager', 'ctrl_c', 'close', 'exit', 'send', 'long'];

    /** Every sequence of `length` steps. */
    function* sequences(length: number): Generator<Step[]> {
        if (length === 0) {
            yield [];
            return;
        }
        for (const my_rest of sequences(length - 1)) {
            for (const my_step of THE_STEPS) {
                yield [...my_rest, my_step];
            }
        }
    }

    it('answers each send exactly once, whatever happens, in any order', () => {
        for (const the_steps of sequences(4)) {
            const { session, at_prompt } = setup();
            const the_answers = new Map<number, boolean[]>();
            let next_id = 0;
            const send = (line: string): void => {
                const id = next_id++;
                the_answers.set(id, []);
                session.send_line(line, (sent) => the_answers.get(id)?.push(sent));
            };
            at_prompt();
            session.handle_input('busy\r');
            send('do "first.do"');
            send('do "second.do"');
            for (const my_step of the_steps) {
                switch (my_step) {
                    case 'prompt': at_prompt('\n. '); break;
                    case 'pager': at_prompt('\n--more--'); break;
                    case 'ctrl_c': session.handle_input('\x03'); break;
                    case 'close': session.close_sends(); break;
                    case 'exit': session.handle_exit(); break;
                    case 'send': send('do "more.do"'); break;
                    case 'long': send('x'.repeat(MAX_CANONICAL_LINE_BYTES + 1)); break;
                }
            }
            session.handle_exit();
            for (const [my_id, my_answers] of the_answers) {
                expect({ steps: the_steps, id: my_id, count: my_answers.length })
                    .toEqual({ steps: the_steps, id: my_id, count: 1 });
            }
        }
    });
});
