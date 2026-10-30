/**
 * Best-effort coloring of Stata console output, applied as it streams.
 *
 * Stata's console prints plain text, so colors come from recognizing its
 * output conventions:
 *
 * - an error is a message line followed by `r(NNN);` on its own line, so
 *   both are red. The message line is only known to be an error once the
 *   `r(NNN);` arrives, so the colorizer holds back the most recent
 *   complete line until the next line arrives or `flush()` is called (the
 *   session flushes after a short quiet period);
 * - `--Break--` (an interrupt) is red;
 * - `note:` and `warning:` lines are yellow;
 * - commands echoed by a do-file (`. cmd`, `  4. cmd`) are highlighted
 *   like input.
 *
 * Text without a newline yet (a prompt, or progress dots) is passed
 * through by `flush()` uncolored. If the rest of that line arrives later,
 * it is passed through uncolored too, so a line is never half-colored.
 * Lines that already contain escape sequences pass through unchanged.
 */

import { highlight_stata, SGR } from './highlighter';

export type ColorOutputMode = 'streams' | 'off';

const ERROR_RETURN_LINE = /^r\(\d+\);$/;
const BREAK_LINE = /^--Break--$/;
const NOTE_LINE = /^\(?(?:note|warning): /;
// `. cmd` or `  12. cmd`, but not `list` output rows like `  1. | 3 4 |`.
const ECHO_LINE = /^(\. |\s+\d+\. )(?!\s*[|+])(.+)$/;

export class OutputColorizer {
    private readonly mode: ColorOutputMode;
    /** Incomplete text (no newline yet) not yet passed through. */
    private pending = '';
    /** True when the start of the current line was already passed through raw. */
    private line_started_raw = false;
    /** The most recent complete line, held for error lookahead. */
    private held: string | null = null;
    private readonly on_error: (() => void) | undefined;
    /** Incomplete line carried between chunks for `off`-mode scanning. */
    private scan_pending = '';

    constructor(mode: ColorOutputMode, on_error?: () => void) {
        this.mode = mode;
        this.on_error = on_error;
    }

    /** True when text is buffered and `flush()` would emit something. */
    has_buffered(): boolean {
        return this.pending.length > 0 || this.held !== null;
    }

    /**
     * The console ended the current screen line itself (the user pressed
     * Enter after a prompt), so the next output starts a fresh line even
     * though Stata's prompt line was passed through raw.
     */
    end_line(): void {
        if (this.pending.length === 0) {
            this.line_started_raw = false;
        }
    }

    /** Feed a chunk of output; returns the text to write now. */
    push(chunk: string): string {
        if (this.mode === 'off') {
            this.notice_errors(chunk);
            return chunk;
        }
        const parts: string[] = [];
        let text = this.pending + chunk;
        this.pending = '';
        let newline_index = text.indexOf('\n');
        while (newline_index !== -1) {
            const line_with_newline = text.slice(0, newline_index + 1);
            text = text.slice(newline_index + 1);
            if (this.line_started_raw) {
                // The start of this line is already on screen uncolored.
                this.line_started_raw = false;
                this.emit_held(parts, false);
                parts.push(line_with_newline);
            } else {
                this.accept_line(line_with_newline, parts);
            }
            newline_index = text.indexOf('\n');
        }
        this.pending = text;
        return parts.join('');
    }

    /** Emit everything buffered, uncolored if its line is incomplete. */
    flush(): string {
        if (this.mode === 'off') {
            return '';
        }
        const parts: string[] = [];
        this.emit_held(parts, false);
        if (this.pending.length > 0) {
            parts.push(this.pending);
            this.pending = '';
            this.line_started_raw = true;
        }
        return parts.join('');
    }

    private accept_line(line_with_newline: string, parts: string[]): void {
        const ending = line_with_newline.endsWith('\r\n') ? '\r\n' : '\n';
        const content = line_with_newline.slice(0, -ending.length);
        if (content.includes('\x1b')) {
            this.emit_held(parts, false);
            parts.push(line_with_newline);
            return;
        }
        if (ERROR_RETURN_LINE.test(content)) {
            this.on_error?.();
            this.emit_held(parts, true);
            parts.push(`${SGR.red}${content}${SGR.reset}${ending}`);
            return;
        }
        this.emit_held(parts, false);
        if (BREAK_LINE.test(content)) {
            parts.push(`${SGR.red}${content}${SGR.reset}${ending}`);
            return;
        }
        this.held = line_with_newline;
    }

    private emit_held(parts: string[], as_error: boolean): void {
        if (this.held === null) {
            return;
        }
        const line_with_newline = this.held;
        this.held = null;
        const ending = line_with_newline.endsWith('\r\n') ? '\r\n' : '\n';
        const content = line_with_newline.slice(0, -ending.length);
        parts.push(colorize_line(content, as_error) + ending);
    }

    /** In `off` mode, still report `r(NNN);` lines, split or not. */
    private notice_errors(chunk: string): void {
        if (!this.on_error) {
            return;
        }
        const lines = (this.scan_pending + chunk).split('\n');
        this.scan_pending = lines.pop() ?? '';
        for (const my_line of lines) {
            if (ERROR_RETURN_LINE.test(my_line.replace(/\r$/, ''))) {
                this.on_error();
            }
        }
    }
}

function colorize_line(content: string, as_error: boolean): string {
    if (content.trim().length === 0) {
        return content;
    }
    if (as_error) {
        return `${SGR.red}${content}${SGR.reset}`;
    }
    if (NOTE_LINE.test(content)) {
        return `${SGR.yellow}${content}${SGR.reset}`;
    }
    const echo = ECHO_LINE.exec(content);
    if (echo) {
        return `${echo[1]}${highlight_stata(echo[2] ?? '')}`;
    }
    return content;
}
