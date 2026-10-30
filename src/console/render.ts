/**
 * Draws the editor (prompt, input, completion menu, note) below Stata's
 * output, and erases it again before more output is written.
 *
 * The editor may wrap across several terminal rows. Rendering remembers
 * which of those rows the cursor is on, so a redraw can move back to the
 * first row, clear to the end of the screen, and draw afresh.
 */

import type { CompletionMenu } from './line-editor';
import { strip_ansi } from './prompt-detector';
import { SGR } from './highlighter';

export interface RenderInput {
    /** The prompt as Stata printed it (may contain ANSI codes). */
    prompt: string;
    /** The buffer with highlighting added; same visible text as `buffer`. */
    buffer_display: string;
    buffer: string;
    /** Cursor as a UTF-16 offset into `buffer`. */
    cursor: number;
    menu: CompletionMenu | null;
    /** A dim line shown under the input, such as staged-paste status. */
    note: string | null;
    columns: number;
}

export interface RenderState {
    /** Row of the cursor, counted from the editor's first row. */
    cursor_row: number;
}

const MAX_MENU_ROWS = 8;

/** Escape sequence that removes a previously drawn editor. */
export function erase(previous: RenderState | null): string {
    if (!previous) {
        return '';
    }
    const up = previous.cursor_row > 0 ? `\x1b[${previous.cursor_row}A` : '';
    return `${up}\r\x1b[J`;
}

export function render(
    input: RenderInput,
    previous: RenderState | null
): { output: string; state: RenderState } {
    const columns = Math.max(input.columns, 2);
    const parts: string[] = [erase(previous), input.prompt, input.buffer_display];
    const prompt_width = display_width(strip_ansi(input.prompt));
    const total_width = prompt_width + display_width(input.buffer);
    if (total_width > 0 && total_width % columns === 0) {
        // The cursor is parked past the last column; move it to the next
        // row so row arithmetic below stays exact.
        parts.push('\r\n');
    }
    let end_row = Math.floor(total_width / columns);

    for (const my_line of extra_lines(input, columns)) {
        parts.push('\r\n', my_line);
        end_row++;
    }

    const cursor_width = prompt_width
        + display_width(input.buffer.slice(0, input.cursor));
    const cursor_row = Math.floor(cursor_width / columns);
    const cursor_column = cursor_width % columns;
    if (end_row > cursor_row) {
        parts.push(`\x1b[${end_row - cursor_row}A`);
    }
    parts.push('\r');
    if (cursor_column > 0) {
        parts.push(`\x1b[${cursor_column}C`);
    }
    return { output: parts.join(''), state: { cursor_row } };
}

function extra_lines(input: RenderInput, columns: number): string[] {
    const lines: string[] = [];
    const menu = input.menu;
    if (menu && menu.items.length > 0) {
        const count = menu.items.length;
        const first = Math.min(
            Math.max(0, menu.selected - MAX_MENU_ROWS + 1),
            Math.max(0, count - MAX_MENU_ROWS)
        );
        const last = Math.min(count, first + MAX_MENU_ROWS);
        for (let i = first; i < last; i++) {
            const label = truncate(`  ${menu.items[i]?.label ?? ''}  `, columns - 1);
            lines.push(i === menu.selected ? `\x1b[7m${label}${SGR.reset}` : label);
        }
        if (count > MAX_MENU_ROWS) {
            lines.push(`${SGR.dim}${truncate(`  (${menu.selected + 1}/${count})`, columns - 1)}${SGR.reset}`);
        }
    }
    if (input.note) {
        lines.push(`${SGR.dim}${truncate(input.note, columns - 1)}${SGR.reset}`);
    }
    return lines;
}

/** Cut `text` (plain) to at most `width` columns. */
function truncate(text: string, width: number): string {
    const parts: string[] = [];
    let used = 0;
    for (const my_char of text) {
        const char_width = char_display_width(my_char);
        if (used + char_width > width) {
            break;
        }
        parts.push(my_char);
        used += char_width;
    }
    return parts.join('');
}

/** Terminal columns taken by plain `text` (no escape sequences). */
export function display_width(text: string): number {
    let width = 0;
    for (const my_char of text) {
        width += char_display_width(my_char);
    }
    return width;
}

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]$/u;
const EMOJI = /^\p{Extended_Pictographic}$/u;

function char_display_width(char: string): number {
    if (ZERO_WIDTH.test(char)) {
        return 0;
    }
    const code_point = char.codePointAt(0) ?? 0;
    // Older pictographs such as (c) and (r) are narrow; emoji from the
    // supplementary planes are drawn two columns wide.
    const wide_emoji = code_point >= 0x1f000 && EMOJI.test(char);
    return is_wide(code_point) || wide_emoji ? 2 : 1;
}

// East Asian Wide and Fullwidth ranges (the common blocks).
function is_wide(code_point: number): boolean {
    return (code_point >= 0x1100 && code_point <= 0x115f)
        || (code_point >= 0x2e80 && code_point <= 0x303e)
        || (code_point >= 0x3041 && code_point <= 0x33ff)
        || (code_point >= 0x3400 && code_point <= 0x4dbf)
        || (code_point >= 0x4e00 && code_point <= 0x9fff)
        || (code_point >= 0xa000 && code_point <= 0xa4cf)
        || (code_point >= 0xac00 && code_point <= 0xd7a3)
        || (code_point >= 0xf900 && code_point <= 0xfaff)
        || (code_point >= 0xfe30 && code_point <= 0xfe4f)
        || (code_point >= 0xff00 && code_point <= 0xff60)
        || (code_point >= 0xffe0 && code_point <= 0xffe6)
        || (code_point >= 0x20000 && code_point <= 0x3fffd);
}
