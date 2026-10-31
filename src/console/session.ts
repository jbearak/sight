/**
 * The console session: routes keystrokes to the line editor and whole
 * lines to Stata, and Stata's output (colorized) to the screen.
 *
 * Input model (as in rlwrap): what the user types is held locally and
 * written to Stata only when they press Enter, whether or not a prompt
 * has been recognized. That way a command that reads input without a
 * recognizable prompt (`display _request()`, `input`) still gets it, and
 * typing ahead while Stata runs works as in plain console Stata. A
 * recognized prompt only adds highlighting and completion, and lets the
 * next staged pasted line load into the editor.
 *
 * A trailing partial line counts as a prompt only after output has been
 * quiet for PROMPT_QUIET_MS and it matches a known prompt exactly.
 */

import { OutputColorizer, type ColorOutputMode } from './output-colorizer';
import {
    classify_prompt,
    COMMAND_PROMPT_KINDS,
    COMPLETION_PROMPT_KINDS,
    HIGHLIGHT_PROMPT_KINDS,
    strip_ansi,
    type PromptKind,
} from './prompt-detector';
import { highlight_stata } from './highlighter';
import { KeyDecoder, type KeyEvent } from './keys';
import { LineEditor, type CompletionCandidate, type EditorAction } from './line-editor';
import { display_width, erase, render, type RenderState } from './render';
import type { StataBackend } from './backend';
import { MAX_CANONICAL_LINE_BYTES } from './pty-backend';

export { MAX_CANONICAL_LINE_BYTES };

export const PROMPT_QUIET_MS = 50;
export const COLOR_FLUSH_MS = 30;
export const ESCAPE_TIMEOUT_MS = 25;
/** What Stata's console inserts where it wraps an echoed long line. */
const ECHO_WRAP_MARKER = '\r\n> ';

export interface Clock {
    set_timeout(callback: () => void, delay_ms: number): unknown;
    clear_timeout(handle: unknown): void;
}

export interface Completer {
    complete(line: string, cursor: number): Promise<CompletionCandidate[]>;
    add_line(line: string): void;
    drop_last_line(): void;
}

export interface HistoryStore {
    all(): readonly string[];
    add(line: string): void;
}

export interface SessionOptions {
    backend: StataBackend;
    write: (text: string) => void;
    columns: () => number;
    clock: Clock;
    history: HistoryStore;
    completer: Completer | null;
    color_mode: ColorOutputMode;
    /** Called once, when Stata's top-level prompt first shows. */
    on_ready?: () => void;
}

export class ConsoleSession {
    private readonly options: SessionOptions;
    private readonly editor: LineEditor;
    private readonly decoder = new KeyDecoder();
    private readonly colorizer: OutputColorizer;

    /** Screen text after the last newline Stata printed (may hold ANSI). */
    private partial = '';
    private prompt_kind: PromptKind | null = null;
    private render_state: RenderState | null = null;
    private staged: string[] = [];
    /** One-off message shown under the input until the next keystroke. */
    private message: string | null = null;
    /**
     * The rest of the echo Stata is expected to print for the line just
     * submitted, and what of it has been held back so far.
     */
    private expected_echo: string | null = null;
    private held_echo = '';
    private echo_carry = '';
    private last_line_in_transcript = false;
    private completion_generation = 0;
    private exited = false;
    private reported_ready = false;

    private prompt_timer: unknown = null;
    private flush_timer: unknown = null;
    private escape_timer: unknown = null;

    constructor(options: SessionOptions) {
        this.options = options;
        this.editor = new LineEditor(() => options.history.all());
        this.colorizer = new OutputColorizer(options.color_mode, () => this.on_stata_error());
    }

    /** Current recognized prompt, for tests and diagnostics. */
    get current_prompt(): PromptKind | null {
        return this.prompt_kind;
    }

    get staged_lines(): readonly string[] {
        return this.staged;
    }

    get buffer(): string {
        return this.editor.buffer;
    }

    // ---- Output from Stata ----

    handle_output(text: string): void {
        if (this.exited || text.length === 0) {
            return;
        }
        const output = this.consume_echo(text);
        if (output.length === 0) {
            return;
        }
        this.prompt_kind = null;
        this.hide_editor();
        this.emit(this.colorizer.push(output));
        this.restart_timer('flush');
        this.restart_timer('prompt');
        if (this.has_editor_content()) {
            this.show_editor();
        }
    }

    /** Stata exited: write what's left and stop drawing. */
    handle_exit(): void {
        if (this.exited) {
            return;
        }
        this.hide_editor();
        this.emit(this.colorizer.flush());
        this.exited = true;
        this.clear_timers();
        if (this.partial.length > 0) {
            this.options.write('\r\n');
        }
    }

    // ---- Input from the user ----

    handle_input(text: string): void {
        if (this.exited) {
            return;
        }
        this.clear_timer('escape');
        for (const my_event of this.decoder.push(text)) {
            this.handle_key(my_event);
        }
        if (this.decoder.has_pending_escape()) {
            this.escape_timer = this.options.clock.set_timeout(() => {
                this.escape_timer = null;
                for (const my_event of this.decoder.flush_escape()) {
                    this.handle_key(my_event);
                }
            }, ESCAPE_TIMEOUT_MS);
        }
    }

    /** Show a short one-row note under the editor until the next key. */
    show_notice(text: string): void {
        if (this.exited) {
            return;
        }
        this.message = text;
        this.show_editor(true);
    }

    /**
     * Write a lasting line of Sight's own (not Stata's output): no
     * colors, no echo matching. Any echo still expected is dropped.
     */
    write_sight_text(text: string): void {
        if (this.exited) {
            return;
        }
        this.expected_echo = null;
        this.held_echo = '';
        this.echo_carry = '';
        const had_editor = this.render_state !== null;
        this.hide_editor();
        this.emit_flush();
        const lead = this.partial.length > 0 ? '\r\n' : '';
        this.options.write(`${lead}\x1b[2m${text}\x1b[0m\r\n`);
        this.partial = '';
        if (had_editor || this.has_editor_content()) {
            this.show_editor(true);
        }
    }

    /** Stata reported an error that its output didn't show. */
    handle_stata_error(): void {
        if (!this.exited) {
            this.on_stata_error();
        }
    }

    /** The terminal was resized: redraw for the new width. */
    handle_resize(): void {
        if (this.render_state) {
            this.show_editor();
        }
    }

    private handle_key(event: KeyEvent): void {
        if (this.exited) {
            return;
        }
        this.message = null;
        if (event.type === 'ctrl' && event.letter === 'c') {
            this.interrupt();
            return;
        }
        if (this.prompt_kind === 'more') {
            this.answer_more(event);
            return;
        }
        const allow_complete = this.prompt_kind !== null
            && COMPLETION_PROMPT_KINDS.has(this.prompt_kind)
            && this.options.completer !== null;
        this.perform(this.editor.handle(event, allow_complete));
    }

    private perform(action: EditorAction): void {
        switch (action.type) {
            case 'none':
                return;
            case 'redraw':
                this.show_editor();
                return;
            case 'submit':
                this.submit(action.line);
                return;
            case 'interrupt':
                this.interrupt();
                return;
            case 'eof':
                // `exit` only quits at the top-level prompt; inside a
                // block it would become part of the block.
                if (this.prompt_kind === 'stata') {
                    this.editor.set_buffer('exit');
                    this.submit('exit');
                }
                return;
            case 'clear_screen':
                this.options.write('\x1b[H\x1b[2J');
                this.render_state = { cursor_row: 0 };
                this.show_editor(true);
                return;
            case 'complete':
                void this.complete();
                return;
            case 'escape':
                if (this.staged.length > 0) {
                    this.staged = [];
                    this.show_editor();
                }
                return;
            case 'paste':
                this.paste(action.text);
                return;
        }
    }

    /**
     * Ctrl+C: one policy everywhere. Drop the input and staged lines and
     * interrupt Stata (it prints `--Break--` if it was running). The
     * input is never sent partially, so nothing half typed is left in
     * Stata's terminal.
     */
    private interrupt(): void {
        this.editor.reset();
        this.staged = [];
        this.options.backend.interrupt();
        if (this.prompt_kind !== null && COMMAND_PROMPT_KINDS.has(this.prompt_kind)) {
            // Start a fresh prompt line so the screen never lacks one,
            // even if Stata prints nothing in response.
            this.hide_editor();
            this.options.write('^C\r\n');
            // The new row is blank; draw the prompt and editor there.
            this.render_state = { cursor_row: 0 };
            this.show_editor(true);
        } else {
            this.show_editor();
        }
    }

    /**
     * `--more--` takes one keystroke. Writing the key plus Enter works
     * whether Stata reads it line-buffered or as a single key.
     */
    private answer_more(event: KeyEvent): void {
        let reply: string | null = null;
        if (event.type === 'key' && event.name === 'enter') {
            reply = '';
        } else if (event.type === 'text' && event.text.length > 0) {
            reply = Array.from(event.text)[0] ?? '';
        }
        if (reply === null) {
            return;
        }
        this.prompt_kind = null;
        this.options.backend.answer_more(reply);
    }

    private submit(line: string): void {
        const max_bytes = this.options.backend.max_line_bytes();
        if (max_bytes !== null && Buffer.byteLength(line, 'utf8') > max_bytes) {
            this.message = `Line is longer than ${max_bytes} bytes and `
                + 'was not sent; put it in a do-file.';
            this.show_editor();
            return;
        }
        const kind = this.prompt_kind;
        this.editor.menu = null;
        const stata_echoes = this.options.backend.echoes_input();
        const drawn = !(stata_echoes && kind === null);
        // Draw the final line without the menu or note rows under it.
        if (!drawn) {
            // Typed ahead while Stata runs: Stata echoes the line when it
            // reads it, after the running command's output.
            this.render_input('', 0, false);
        } else {
            this.render_input(this.editor.buffer, this.editor.buffer.length, false);
            this.options.write('\r\n');
            this.partial = '';
            this.colorizer.end_line();
            if (stata_echoes) {
                // The highlighted line stays; drop Stata's plain copy.
                this.expected_echo = line + '\r\n';
                this.held_echo = '';
                this.echo_carry = '';
            }
        }
        this.render_state = null;

        if (kind !== null && COMMAND_PROMPT_KINDS.has(kind)) {
            this.options.history.add(line);
        }
        if (kind !== null) {
            // A line typed ahead while Stata runs (no prompt) leaves the
            // running command's failure tracking alone.
            this.last_line_in_transcript = false;
        }
        if ((kind === 'stata' || kind === 'block') && line.trim().length > 0) {
            this.options.completer?.add_line(line);
            this.last_line_in_transcript = true;
        } else if ((kind === 'mata' || kind === 'python') && line.trim() === 'end') {
            // Close the embedded block the transcript opened with `mata`
            // or `python`, so later Stata lines analyze as Stata.
            this.options.completer?.add_line(line);
        }
        this.editor.reset();
        this.prompt_kind = null;
        this.options.backend.submit_line(line, drawn);
    }

    private paste(text: string): void {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        this.editor.insert(lines[0] ?? '');
        if (lines.length > 1) {
            this.staged.push(...lines.slice(1));
        }
        this.show_editor();
    }

    private async complete(): Promise<void> {
        const completer = this.options.completer;
        if (!completer) {
            return;
        }
        const generation = ++this.completion_generation;
        const line = this.editor.buffer;
        const cursor = this.editor.cursor;
        let candidates: CompletionCandidate[];
        try {
            candidates = await completer.complete(line, cursor);
        } catch {
            return;
        }
        if (generation !== this.completion_generation || this.exited
            || this.editor.buffer !== line || this.editor.cursor !== cursor) {
            return;
        }
        this.editor.show_completions(candidates);
        this.show_editor();
    }

    /**
     * Remove Stata's echo of the line just submitted from the start of
     * its output. Only an exact copy (line, then CR LF) directly after
     * the submission is removed, even across chunks, allowing for the
     * `CR LF > ` Stata inserts where it wraps a long line. Anything else
     * releases what was held and is shown unchanged.
     */
    private consume_echo(text: string): string {
        const expected = this.expected_echo;
        if (expected === null) {
            return text;
        }
        // Resume with any wrap marker that was split across chunks.
        const scan = this.echo_carry + text;
        this.echo_carry = '';
        let scan_index = 0;
        let expected_index = 0;
        while (scan_index < scan.length && expected_index < expected.length) {
            if (scan[scan_index] === expected[expected_index]) {
                scan_index++;
                expected_index++;
            } else if (scan.startsWith(ECHO_WRAP_MARKER, scan_index)) {
                scan_index += ECHO_WRAP_MARKER.length;
            } else if (ECHO_WRAP_MARKER.startsWith(scan.slice(scan_index))) {
                this.echo_carry = scan.slice(scan_index);
                scan_index = scan.length;
            } else {
                break;
            }
        }
        if (expected_index === expected.length) {
            this.expected_echo = null;
            this.held_echo = '';
            return scan.slice(scan_index);
        }
        if (scan_index === scan.length) {
            this.expected_echo = expected.slice(expected_index);
            this.held_echo += text;
            return '';
        }
        const released = this.held_echo + text;
        this.expected_echo = null;
        this.held_echo = '';
        this.echo_carry = '';
        return released;
    }

    // ---- Stata events ----

    private on_stata_error(): void {
        if (this.last_line_in_transcript) {
            // Definitions from a failed command shouldn't be suggested.
            this.options.completer?.drop_last_line();
            this.last_line_in_transcript = false;
        }
        if (this.staged.length > 0) {
            const count = this.staged.length;
            this.staged = [];
            this.message = `Discarded ${count} pasted line${count === 1 ? '' : 's'} after an error.`;
        }
    }

    private on_quiet(): void {
        this.emit_flush();
        const kind = classify_prompt(this.partial);
        if (kind === null) {
            return;
        }
        this.prompt_kind = kind;
        if (COMMAND_PROMPT_KINDS.has(kind) && this.editor.buffer.length === 0
            && this.staged.length > 0) {
            this.editor.set_buffer(this.staged.shift() ?? '');
        }
        this.show_editor(true);
        if (kind === 'stata' && !this.reported_ready) {
            this.reported_ready = true;
            this.options.on_ready?.();
        }
    }

    // ---- Drawing ----

    private has_editor_content(): boolean {
        return this.editor.buffer.length > 0 || this.editor.menu !== null
            || this.staged.length > 0 || this.message !== null;
    }

    /** Draw the editor after the current partial line. */
    private show_editor(force = false): void {
        if (!force && !this.render_state && !this.has_editor_content()
            && this.prompt_kind === null) {
            return;
        }
        this.render_input(this.editor.buffer, this.editor.cursor);
    }

    private render_input(buffer: string, cursor: number, with_extras = true): void {
        const highlight = this.prompt_kind !== null && HIGHLIGHT_PROMPT_KINDS.has(this.prompt_kind);
        const previous = this.render_state ?? this.partial_render_state();
        const result = render({
            prompt: this.partial,
            buffer,
            buffer_display: highlight ? highlight_stata(buffer) : buffer,
            cursor,
            menu: with_extras ? this.editor.menu : null,
            note: with_extras ? this.note() : null,
            columns: this.options.columns(),
        }, previous);
        this.options.write(result.output);
        this.render_state = result.state;
    }

    private note(): string | null {
        if (this.message) {
            return this.message;
        }
        if (this.staged.length > 0) {
            const count = this.staged.length;
            return `${count} more pasted line${count === 1 ? '' : 's'}; `
                + 'Enter runs each, Ctrl+C or Esc discards.';
        }
        return null;
    }

    /** Remove the drawn editor, leaving Stata's partial line on screen. */
    private hide_editor(): void {
        if (!this.render_state) {
            return;
        }
        this.options.write(erase(this.render_state) + this.partial);
        this.render_state = null;
    }

    /**
     * Where the cursor is when only Stata's partial line is on screen:
     * on its last row (a line that exactly fills its rows leaves the
     * cursor parked on the last one).
     */
    private partial_render_state(): RenderState {
        const width = display_width(strip_ansi(this.partial));
        const columns = Math.max(this.options.columns(), 2);
        const rows = width > 0 && width % columns === 0
            ? width / columns - 1
            : Math.floor(width / columns);
        return { cursor_row: rows };
    }

    private emit(text: string): void {
        if (text.length === 0) {
            return;
        }
        this.options.write(text);
        const newline_index = text.lastIndexOf('\n');
        this.partial = newline_index === -1
            ? this.partial + text
            : text.slice(newline_index + 1);
        this.partial = apply_line_controls(this.partial);
    }

    private emit_flush(): void {
        this.emit(this.colorizer.flush());
    }

    // ---- Timers ----

    private restart_timer(which: 'prompt' | 'flush'): void {
        this.clear_timer(which);
        if (which === 'prompt') {
            this.prompt_timer = this.options.clock.set_timeout(() => {
                this.prompt_timer = null;
                if (!this.exited) {
                    this.on_quiet();
                }
            }, PROMPT_QUIET_MS);
            return;
        }
        if (!this.colorizer.has_buffered()) {
            return;
        }
        this.flush_timer = this.options.clock.set_timeout(() => {
            this.flush_timer = null;
            if (this.exited) {
                return;
            }
            const had_editor = this.render_state !== null;
            this.hide_editor();
            this.emit_flush();
            if (had_editor || this.has_editor_content()) {
                this.show_editor();
            }
        }, COLOR_FLUSH_MS);
    }

    private clear_timer(which: 'prompt' | 'flush' | 'escape'): void {
        const handle = which === 'prompt' ? this.prompt_timer
            : which === 'flush' ? this.flush_timer
            : this.escape_timer;
        if (handle !== null) {
            this.options.clock.clear_timeout(handle);
        }
        if (which === 'prompt') {
            this.prompt_timer = null;
        } else if (which === 'flush') {
            this.flush_timer = null;
        } else {
            this.escape_timer = null;
        }
    }

    private clear_timers(): void {
        this.clear_timer('prompt');
        this.clear_timer('flush');
        this.clear_timer('escape');
    }
}

/**
 * Apply carriage returns and backspaces within a partial line, so text
 * Stata overwrote (such as an erased `--more--`) isn't taken as a prompt.
 */
export function apply_line_controls(partial: string): string {
    let text = partial;
    const carriage_return = text.lastIndexOf('\r');
    if (carriage_return !== -1) {
        text = text.slice(carriage_return + 1);
    }
    if (!text.includes('\b')) {
        return text;
    }
    const kept: string[] = [];
    for (const my_char of text) {
        if (my_char === '\b') {
            kept.pop();
        } else {
            kept.push(my_char);
        }
    }
    return kept.join('');
}

