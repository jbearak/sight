/**
 * The Automation backend: drives a Stata GUI instance through the COM
 * bridge and turns its text log into the byte stream console Stata
 * would produce, so the session works unchanged.
 *
 * - Prompts: the log has none. When a line finishes, the backend emits
 *   the prompt the mode tracker predicts.
 * - Echo: when the log shows the echo of the line in flight, it is
 *   replaced by the line exactly as submitted (Stata drops leading
 *   whitespace), which is what the session's echo removal expects.
 * - Completion: at top level, a line is finished when Stata is free
 *   on two polls at least 60 ms apart with the log unchanged. While
 *   Stata waits for more block, program, Mata or Python input it stays
 *   busy, so there a line is finished once its echo has appeared and
 *   the log has gone quiet; a missing echo is bounded.
 * - Typeahead: one line in Stata at a time; the rest wait in a FIFO
 *   that Ctrl+C can clear.
 *
 * Once connected, the backend never ends the session on a timeout;
 * only Stata exiting, the bridge dying, or the user can (ending closes
 * Stata).
 */

import type { BackendEvents, BackendHandle, BackendLifecycle, ShutdownReason, StataBackend } from '../backend';
import { is_server_gone, type Bridge, type BridgeReply } from './bridge';
import type { LogSource } from './log-tail';
import { ModeTracker, parse_echo } from './mode-tracker';

/** `DoCommandAsync` accepted 8192 bytes in the spike (S10). */
export const AUTOMATION_MAX_LINE_BYTES = 8191;

export const BUSY_POLL_MS = 30;
export const IDLE_LOG_POLL_MS = 100;
export const IDLE_FREE_POLL_MS = 500;
export const FREE_SETTLE_MS = 60;
export const AWAITING_QUIET_MS = 150;
export const ECHO_MISS_MS = 1000;
/** Entering Mata or Python can be slow the first time (S5-edge). */
export const ECHO_MISS_ENTERING_MS = 5000;
export const BREAK_FINISH_MS = 1000;
export const BUSY_NOTE_MS = 5000;
export const PARTIAL_LINE_QUIET_MS = 300;
export const POLL_TIMEOUT_MS = 2000;
export const NOT_RESPONDING_TIMEOUTS = 5;
/** How long a finished line's late log echo is still recognized. */
const LATE_ECHO_WINDOW_MS = 3000;
const RECORD_LIMIT = 64;

export const BUSY_NOTE = 'Still running; if Stata asks for input, answer in its window.';
export const NOT_RESPONDING_NOTE =
    'Stata isn\'t responding. Ctrl+C twice ends the console and closes Stata.';
export const LOG_LOST_TEXT =
    'Sight\'s log was closed (by `log close _all` or `log off`?); output now '
    + 'shows only in the Stata window. Restart sight console to get it back.';

export interface AutomationClock {
    now(): number;
    set_timeout(callback: () => void, delay_ms: number): unknown;
    clear_timeout(handle: unknown): void;
}

interface InFlight {
    line: string;
    trimmed: string;
    drawn: boolean;
    blank: boolean;
    submitted_ms: number;
    entering: boolean;
    echo_seen: boolean;
    breaking_until_ms: number | null;
    busy_noted: boolean;
}

interface EchoRecord {
    trimmed: string;
    blank: boolean;
    echoed: boolean;
    finished_ms: number | null;
}

export interface AutomationBackendOptions {
    bridge: Bridge;
    log: LogSource;
    clock: AutomationClock;
    events: BackendEvents;
    /** Size the log had when tailing began. */
    start_size: number;
}

export class AutomationBackend implements StataBackend {
    private readonly bridge: Bridge;
    private readonly log: LogSource;
    private readonly clock: AutomationClock;
    private readonly events: BackendEvents;

    private readonly tracker = new ModeTracker();
    private readonly fifo: Array<{ line: string; drawn: boolean }> = [];
    private in_flight: InFlight | null = null;
    private readonly records: EchoRecord[] = [];

    /** Complete lines read but not yet handled, and the trailing part. */
    private held_lines: string[] = [];
    private partial = '';
    private partial_emitted = false;
    private last_growth_ms: number;
    private log_size: number;
    private log_lost = false;
    private no_echo_streak = 0;

    private last_free: { at_ms: number; size: number } | null = null;
    private last_free_poll_ms = 0;
    private prompt_on_screen = false;
    private foreign_activity = false;

    private consecutive_timeouts = 0;
    private not_responding = false;
    private interrupts_while_stuck = 0;

    private polling = false;
    private timer: unknown = null;
    private ended = false;
    private end_message: string | null = null;
    private resolve_exit: (status: number) => void = () => undefined;
    readonly exit_status: Promise<number>;

    constructor(options: AutomationBackendOptions) {
        this.bridge = options.bridge;
        this.log = options.log;
        this.clock = options.clock;
        this.events = options.events;
        this.log_size = options.start_size;
        this.last_growth_ms = options.clock.now();
        this.exit_status = new Promise<number>((resolve) => {
            this.resolve_exit = resolve;
        });
        void this.bridge.ended.then(() => {
            this.end(1, 'Lost the connection to Stata.');
        });
    }

    /** Show the first prompt and start polling. */
    start(): void {
        this.emit_prompt();
        this.schedule(BUSY_POLL_MS);
    }

    // ---- StataBackend ----

    submit_line(line: string, drawn: boolean): void {
        if (this.ended) {
            return;
        }
        if (line.includes('\0')) {
            this.events.on_notice('Line contains a NUL character and was not sent.');
            return;
        }
        if (this.in_flight || this.fifo.length > 0) {
            this.fifo.push({ line, drawn });
            return;
        }
        this.dispatch(line, drawn);
    }

    answer_more(): void {
        this.events.on_notice(BUSY_NOTE);
    }

    interrupt(): void {
        if (this.ended) {
            return;
        }
        if (this.not_responding) {
            this.interrupts_while_stuck++;
            if (this.interrupts_while_stuck >= 2) {
                this.end(1, null);
                return;
            }
        }
        this.fifo.length = 0;
        const in_flight = this.in_flight;
        if (in_flight) {
            if (in_flight.breaking_until_ms === null) {
                in_flight.breaking_until_ms = this.clock.now() + BREAK_FINISH_MS;
                this.tracker.reset_top();
                void this.bridge.request('break', {}, { timeout_ms: POLL_TIMEOUT_MS });
            }
            return;
        }
        if (this.tracker.awaiting_input()) {
            // A block, program, Mata or Python prompt with nothing in
            // flight: break out of it, and redraw once Stata settles.
            this.tracker.reset_top();
            this.in_flight = {
                line: '', trimmed: '', drawn: true, blank: true,
                submitted_ms: this.clock.now(), entering: false,
                echo_seen: true, breaking_until_ms: this.clock.now() + BREAK_FINISH_MS,
                busy_noted: true,
            };
            this.prompt_on_screen = false;
            this.replace_prompt_line = true;
            void this.bridge.request('break', {}, { timeout_ms: POLL_TIMEOUT_MS });
        }
    }

    resize(): void {
        // `linesize` is set once at setup; resizing sends nothing.
    }

    echoes_input(): boolean {
        return true;
    }

    max_line_bytes(): number | null {
        return AUTOMATION_MAX_LINE_BYTES;
    }

    // ---- Lifecycle ----

    handle(): BackendHandle {
        const lifecycle: BackendLifecycle = {
            exit_status: this.exit_status,
            closing_message: () => this.end_message,
            shutdown: (reason) => this.shutdown(reason),
        };
        return { backend: this, lifecycle };
    }

    private async shutdown(_reason: ShutdownReason): Promise<void> {
        this.stop_polling();
        this.ended = true;
        // Closing stdin makes the bridge release its reference and exit;
        // Stata then quits, as the console's Stata does on any end.
        this.bridge.close();
        const ended = await Promise.race([
            this.bridge.ended.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
        ]);
        if (!ended) {
            this.bridge.kill();
        }
        this.resolve_exit(1);
    }

    private end(status: number, message: string | null): void {
        if (this.ended) {
            return;
        }
        this.ended = true;
        this.stop_polling();
        this.drain_log();
        this.end_message = message;
        this.bridge.close();
        this.resolve_exit(status);
    }

    // ---- Sending ----

    private dispatch(line: string, drawn: boolean): void {
        const now = this.clock.now();
        const entering = this.tracker.advance(line);
        const trimmed = line.trim();
        const in_flight: InFlight = {
            line, trimmed, drawn, blank: trimmed.length === 0,
            submitted_ms: now, entering, echo_seen: false,
            breaking_until_ms: null, busy_noted: false,
        };
        this.in_flight = in_flight;
        this.last_free = null;
        this.prompt_on_screen = false;
        this.push_record({ trimmed, blank: in_flight.blank, echoed: false, finished_ms: null });
        if (this.log_lost && !drawn) {
            this.emit(`${line}\r\n`);
            in_flight.echo_seen = true;
            this.mark_echoed(this.records.length - 1);
        }
        void this.bridge.request('do_async', { cmd: line }).then((reply) => {
            this.handle_failure(reply);
        });
        this.schedule(BUSY_POLL_MS);
    }

    private finish(): void {
        const in_flight = this.in_flight;
        if (!in_flight) {
            return;
        }
        this.flush_held_lines(true);
        const record_index = this.records.length - 1;
        if (!in_flight.echo_seen) {
            if (!in_flight.drawn) {
                this.emit(`${in_flight.line}\r\n`);
            }
            if (!in_flight.blank && in_flight.breaking_until_ms === null) {
                this.no_echo_streak++;
                if (this.no_echo_streak >= 2) {
                    this.mark_log_lost();
                }
            }
        } else if (!in_flight.blank) {
            this.no_echo_streak = 0;
        }
        const record = this.records[record_index];
        if (record) {
            record.finished_ms = this.clock.now();
            if ((!in_flight.echo_seen && !in_flight.drawn) || in_flight.blank) {
                record.echoed = true;
            }
        }
        this.in_flight = null;
        this.last_free = null;
        if (this.log_lost && !this.tracker.awaiting_input()) {
            void this.bridge.request('error_code', {}, { timeout_ms: POLL_TIMEOUT_MS }).then((reply) => {
                if (reply.ok && typeof reply.value.rc === 'number' && reply.value.rc !== 0) {
                    this.tracker.observe_error();
                    this.events.on_stata_error();
                }
            });
        }
        this.emit_prompt();
        const next = this.fifo.shift();
        if (next) {
            this.dispatch(next.line, next.drawn);
        }
    }

    // ---- Polling ----

    private schedule(delay_ms: number): void {
        if (this.ended) {
            return;
        }
        if (this.timer !== null) {
            this.clock.clear_timeout(this.timer);
        }
        this.timer = this.clock.set_timeout(() => {
            this.timer = null;
            void this.tick();
        }, delay_ms);
    }

    private stop_polling(): void {
        if (this.timer !== null) {
            this.clock.clear_timeout(this.timer);
            this.timer = null;
        }
    }

    private async tick(): Promise<void> {
        if (this.ended || this.polling) {
            return;
        }
        this.polling = true;
        try {
            this.read_log();
            if (this.in_flight) {
                await this.poll_in_flight();
            } else {
                await this.poll_idle();
            }
        } finally {
            this.polling = false;
        }
        if (!this.ended) {
            this.schedule(this.in_flight || this.foreign_activity ? BUSY_POLL_MS : IDLE_LOG_POLL_MS);
        }
    }

    private async poll_free(): Promise<boolean | null> {
        const reply = await this.bridge.request('is_free', {}, { timeout_ms: POLL_TIMEOUT_MS });
        if (this.ended) {
            return null;
        }
        if (!reply.ok) {
            if ('timed_out' in reply) {
                this.consecutive_timeouts++;
                if (this.consecutive_timeouts >= NOT_RESPONDING_TIMEOUTS && !this.not_responding) {
                    this.not_responding = true;
                    this.interrupts_while_stuck = 0;
                    this.events.on_notice(NOT_RESPONDING_NOTE);
                }
                return null;
            }
            this.handle_failure(reply);
            return null;
        }
        this.consecutive_timeouts = 0;
        this.not_responding = false;
        this.interrupts_while_stuck = 0;
        return reply.value.free === true;
    }

    /** True once Stata has been free twice, 60 ms apart, log unchanged. */
    private free_settled(free: boolean): boolean {
        const now = this.clock.now();
        if (!free) {
            this.last_free = null;
            return false;
        }
        const last = this.last_free;
        if (last && last.size === this.log_size && now - last.at_ms >= FREE_SETTLE_MS) {
            return true;
        }
        if (!last || last.size !== this.log_size) {
            this.last_free = { at_ms: now, size: this.log_size };
        }
        return false;
    }

    private async poll_in_flight(): Promise<void> {
        const free = await this.poll_free();
        const in_flight = this.in_flight;
        if (this.ended || !in_flight) {
            return;
        }
        this.read_log();
        const now = this.clock.now();
        const quiet_ms = now - this.last_growth_ms;
        const settled = free === null ? false : this.free_settled(free);
        if (quiet_ms >= PARTIAL_LINE_QUIET_MS) {
            // A prompt Stata printed without a newline (`_request`).
            this.flush_held_lines(true);
            this.flush_partial();
        }

        if (settled) {
            // Free only happens at top level (S5).
            if (this.tracker.awaiting_input()) {
                this.tracker.reset_top();
            }
            this.finish();
            return;
        }
        if (in_flight.breaking_until_ms !== null) {
            if (now >= in_flight.breaking_until_ms && quiet_ms >= AWAITING_QUIET_MS) {
                this.finish();
            }
            return;
        }
        if (this.tracker.awaiting_input()) {
            const bound = in_flight.entering ? ECHO_MISS_ENTERING_MS : ECHO_MISS_MS;
            const echoed = in_flight.echo_seen || in_flight.blank;
            if (quiet_ms >= AWAITING_QUIET_MS
                && (echoed || now - in_flight.submitted_ms >= bound)) {
                this.finish();
            }
            return;
        }
        if (!in_flight.busy_noted && now - in_flight.submitted_ms >= BUSY_NOTE_MS
            && quiet_ms >= BUSY_NOTE_MS) {
            in_flight.busy_noted = true;
            this.events.on_notice(BUSY_NOTE);
        }
    }

    private async poll_idle(): Promise<void> {
        const now = this.clock.now();
        const quiet_ms = now - this.last_growth_ms;
        if (this.partial.length > 0 && !this.partial_emitted && quiet_ms >= PARTIAL_LINE_QUIET_MS) {
            this.flush_partial();
        }
        const due = this.foreign_activity || now - this.last_free_poll_ms >= IDLE_FREE_POLL_MS;
        if (!due) {
            return;
        }
        this.last_free_poll_ms = now;
        const free = await this.poll_free();
        if (this.ended || free === null || this.in_flight) {
            return;
        }
        this.read_log();
        // Output from commands typed in the Stata window: once it has
        // settled, draw a fresh prompt.
        if (!this.foreign_activity
            || this.clock.now() - this.last_growth_ms < AWAITING_QUIET_MS) {
            return;
        }
        if (this.free_settled(free)) {
            this.foreign_activity = false;
            this.flush_held_lines(true);
            this.tracker.reset_top();
            this.emit_prompt();
        } else if (!free && this.tracker.awaiting_input()) {
            // Late output while Stata waits for block or Mata input:
            // redraw the prompt it overwrote.
            this.foreign_activity = false;
            this.flush_held_lines(true);
            this.emit_prompt();
        }
    }

    private handle_failure(reply: BridgeReply): void {
        if (reply.ok || this.ended) {
            return;
        }
        if ('bridge_gone' in reply) {
            this.end(1, 'Lost the connection to Stata.');
            return;
        }
        if (is_server_gone(reply)) {
            this.end(0, 'Stata exited.');
        }
    }

    // ---- The log ----

    private drain_log(): void {
        try {
            this.read_log();
            this.flush_held_lines(true);
            this.flush_partial();
        } catch {
            // Nothing more to show.
        }
    }

    private read_log(): void {
        const result = this.log.poll();
        if (result.lost) {
            this.mark_log_lost();
        }
        if (result.text.length === 0) {
            return;
        }
        this.log_size = result.size;
        this.last_growth_ms = this.clock.now();
        if (!this.in_flight) {
            this.foreign_activity = true;
        }
        const text = this.partial + result.text;
        const lines = text.split('\n');
        const tail = lines.pop() ?? '';
        if (this.partial_emitted && lines.length > 0) {
            // The start of this line is already on screen.
            const first = lines[0] ?? '';
            lines[0] = first.slice(this.partial.length);
            this.emit_raw(`${lines[0]}\r\n`);
            lines.shift();
            this.partial_emitted = false;
        }
        this.partial = tail;
        this.held_lines.push(...lines);
        this.flush_held_lines(false);
    }

    /**
     * Handle complete lines in order. An echo of the line in flight may
     * span several lines (Stata wraps long lines with `> `); when the
     * lines so far could still be the start of it, they wait for more,
     * unless `force` (the line finished).
     */
    private flush_held_lines(force: boolean): void {
        while (this.held_lines.length > 0) {
            const in_flight = this.in_flight;
            if (in_flight && !in_flight.echo_seen && in_flight.breaking_until_ms === null) {
                const matched = match_echo(this.held_lines, in_flight.trimmed);
                if (matched === 'wait' && !force) {
                    return;
                }
                if (typeof matched === 'number') {
                    this.held_lines.splice(0, matched);
                    in_flight.echo_seen = true;
                    this.mark_echoed(this.records.length - 1);
                    this.emit(`${in_flight.line}\r\n`);
                    continue;
                }
            }
            const line = this.held_lines.shift() ?? '';
            if (this.is_late_echo(line)) {
                continue;
            }
            this.observe_line(line);
            this.emit(`${line}\r\n`);
        }
    }

    private observe_line(line: string): void {
        if (/^r\(\d+\);$/.test(line)) {
            this.tracker.observe_error();
            return;
        }
        if (line === '--Break--') {
            this.tracker.reset_top();
            return;
        }
        if (!this.in_flight) {
            const parsed = parse_echo(line);
            if (parsed) {
                this.tracker.observe_foreign_echo(parsed.prefix);
            }
        }
    }

    /** A finished line's echo arriving late: drop it, once. */
    private is_late_echo(line: string): boolean {
        const parsed = parse_echo(line);
        if (!parsed) {
            return false;
        }
        const now = this.clock.now();
        const text = parsed.rest.trim();
        for (const my_record of this.records) {
            if (!my_record.echoed && my_record.finished_ms !== null
                && now - my_record.finished_ms <= LATE_ECHO_WINDOW_MS
                && my_record.trimmed === text) {
                my_record.echoed = true;
                return true;
            }
        }
        return false;
    }

    private flush_partial(): void {
        if (this.partial.length === 0 || this.partial_emitted) {
            return;
        }
        this.emit_raw(this.partial);
        this.partial_emitted = true;
    }

    private mark_log_lost(): void {
        if (this.log_lost) {
            return;
        }
        this.log_lost = true;
        this.events.on_sight_text(LOG_LOST_TEXT);
    }

    private push_record(record: EchoRecord): void {
        // A blank line's record retires when the line finishes, so a
        // never-echoed top-level blank can't absorb a later echo.
        this.records.push(record);
        if (this.records.length > RECORD_LIMIT) {
            this.records.shift();
        }
    }

    private mark_echoed(index: number): void {
        const record = this.records[index];
        if (record) {
            record.echoed = true;
        }
    }

    // ---- Output ----

    private replace_prompt_line = false;

    private emit_prompt(): void {
        const prompt = this.tracker.prompt();
        if (this.replace_prompt_line) {
            this.replace_prompt_line = false;
            this.events.on_output(`\r\x1b[K${prompt}`);
        } else {
            this.events.on_output(prompt);
        }
        this.prompt_on_screen = true;
    }

    private emit(text: string): void {
        this.emit_raw(text);
    }

    private emit_raw(text: string): void {
        if (text.length === 0) {
            return;
        }
        if (this.prompt_on_screen && !this.in_flight) {
            // Output from the Stata window after our prompt: start at
            // the beginning of that line.
            this.prompt_on_screen = false;
            this.events.on_output(`\r\x1b[K${text}`);
            return;
        }
        this.prompt_on_screen = false;
        this.events.on_output(text);
    }
}

/**
 * Does `lines` start with Stata's echo of `target` (trimmed)? Returns
 * the number of lines it spans, 'wait' when the lines so far could be
 * the start of it, or null.
 */
export function match_echo(lines: readonly string[], target: string): number | 'wait' | null {
    const first = lines[0];
    if (first === undefined) {
        return 'wait';
    }
    const parsed = parse_echo(first);
    if (!parsed) {
        return null;
    }
    let text = parsed.rest;
    let used = 1;
    for (;;) {
        const trimmed = text.trim();
        if (trimmed === target) {
            return used;
        }
        if (!target.startsWith(trimmed) || trimmed.length >= target.length) {
            return null;
        }
        const next = lines[used];
        if (next === undefined) {
            return 'wait';
        }
        if (!next.startsWith('> ')) {
            return null;
        }
        text += next.slice(2);
        used++;
    }
}
