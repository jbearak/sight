/**
 * The console's single-line editor: buffer, cursor, kill buffer, history
 * navigation, and the completion menu. Pure state; the session renders
 * it and performs the side effects named by the returned actions.
 *
 * Stata's interactive console reads one line per command (blocks such as
 * `foreach ... {` use numbered prompts), so there is no multi-line
 * editing. Key bindings follow Emacs style, as in Raven's console.
 */

import type { KeyEvent } from './keys';

/** A completion item resolved to a replacement in the buffer. */
export interface CompletionCandidate {
    label: string;
    insert: string;
    /** Replaced range, as UTF-16 offsets into the buffer. */
    start: number;
    end: number;
}

export type EditorAction =
    | { type: 'none' }
    | { type: 'redraw' }
    | { type: 'submit'; line: string }
    | { type: 'interrupt' }
    | { type: 'eof' }
    | { type: 'clear_screen' }
    | { type: 'complete' }
    | { type: 'escape' }
    | { type: 'paste'; text: string };

export interface CompletionMenu {
    items: CompletionCandidate[];
    selected: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const NONE: EditorAction = { type: 'none' };
const REDRAW: EditorAction = { type: 'redraw' };

export class LineEditor {
    buffer = '';
    cursor = 0;
    menu: CompletionMenu | null = null;
    private kill_buffer = '';
    private history_index: number | null = null;
    private history_draft = '';
    private readonly history_entries: () => readonly string[];

    constructor(history_entries: () => readonly string[] = () => []) {
        this.history_entries = history_entries;
    }

    /** Replace the buffer (cursor at end) and leave history navigation. */
    set_buffer(text: string): void {
        this.buffer = text;
        this.cursor = text.length;
        this.menu = null;
        this.history_index = null;
    }

    reset(): void {
        this.set_buffer('');
    }

    insert(text: string): void {
        this.buffer = this.buffer.slice(0, this.cursor) + text
            + this.buffer.slice(this.cursor);
        this.cursor += text.length;
    }

    handle(event: KeyEvent, allow_complete: boolean): EditorAction {
        if (this.menu) {
            const menu_action = this.handle_menu_key(event);
            if (menu_action) {
                return menu_action;
            }
            this.menu = null;
        }
        switch (event.type) {
            case 'text':
                this.insert(event.text);
                return REDRAW;
            case 'paste':
                return { type: 'paste', text: event.text };
            case 'alt_backspace':
                this.kill(this.word_start_before(this.cursor), this.cursor);
                return REDRAW;
            case 'alt':
                return this.handle_alt(event.letter);
            case 'ctrl':
                return this.handle_ctrl(event.letter);
            case 'key':
                break;
        }
        switch (event.name) {
            case 'enter':
                return { type: 'submit', line: this.buffer };
            case 'tab':
                return allow_complete ? { type: 'complete' } : NONE;
            case 'shift_tab':
                return NONE;
            case 'backspace':
                if (this.cursor > 0) {
                    const start = previous_index(this.buffer, this.cursor);
                    this.delete_range(start, this.cursor);
                }
                return REDRAW;
            case 'delete':
                this.delete_forward();
                return REDRAW;
            case 'left':
                this.cursor = previous_index(this.buffer, this.cursor);
                return REDRAW;
            case 'right':
                this.cursor = next_index(this.buffer, this.cursor);
                return REDRAW;
            case 'home':
                this.cursor = 0;
                return REDRAW;
            case 'end':
                this.cursor = this.buffer.length;
                return REDRAW;
            case 'word_left':
                this.cursor = this.word_start_before(this.cursor);
                return REDRAW;
            case 'word_right':
                this.cursor = this.word_end_after(this.cursor);
                return REDRAW;
            case 'up':
                return this.history_step(-1);
            case 'down':
                return this.history_step(1);
            case 'escape':
                return { type: 'escape' };
        }
    }

    /** Show completion results: insert a single match, else open a menu. */
    show_completions(candidates: CompletionCandidate[]): void {
        if (candidates.length === 0) {
            this.menu = null;
            return;
        }
        if (candidates.length === 1) {
            const only = candidates[0];
            if (only) {
                this.apply_candidate(only);
            }
            return;
        }
        this.extend_common_prefix(candidates);
        this.menu = { items: candidates, selected: 0 };
    }

    apply_candidate(candidate: CompletionCandidate): void {
        this.buffer = this.buffer.slice(0, candidate.start) + candidate.insert
            + this.buffer.slice(candidate.end);
        this.cursor = candidate.start + candidate.insert.length;
        this.menu = null;
    }

    private handle_menu_key(event: KeyEvent): EditorAction | null {
        const menu = this.menu;
        if (!menu) {
            return null;
        }
        const count = menu.items.length;
        if (event.type === 'key') {
            switch (event.name) {
                case 'tab':
                case 'down':
                    menu.selected = (menu.selected + 1) % count;
                    return REDRAW;
                case 'shift_tab':
                case 'up':
                    menu.selected = (menu.selected - 1 + count) % count;
                    return REDRAW;
                case 'enter': {
                    const chosen = menu.items[menu.selected];
                    if (chosen) {
                        this.apply_candidate(chosen);
                    }
                    this.menu = null;
                    return REDRAW;
                }
                case 'escape':
                    this.menu = null;
                    return REDRAW;
                default:
                    return null;
            }
        }
        if (event.type === 'ctrl' && (event.letter === 'n' || event.letter === 'p')) {
            const step = event.letter === 'n' ? 1 : -1;
            menu.selected = (menu.selected + step + count) % count;
            return REDRAW;
        }
        return null;
    }

    private handle_ctrl(letter: string): EditorAction {
        switch (letter) {
            case 'a':
                this.cursor = 0;
                return REDRAW;
            case 'e':
                this.cursor = this.buffer.length;
                return REDRAW;
            case 'b':
                this.cursor = previous_index(this.buffer, this.cursor);
                return REDRAW;
            case 'f':
                this.cursor = next_index(this.buffer, this.cursor);
                return REDRAW;
            case 'k':
                this.kill(this.cursor, this.buffer.length);
                return REDRAW;
            case 'u':
                this.kill(0, this.cursor);
                return REDRAW;
            case 'w':
                this.kill(this.word_start_before(this.cursor), this.cursor);
                return REDRAW;
            case 'y':
                this.insert(this.kill_buffer);
                return REDRAW;
            case 't':
                this.transpose();
                return REDRAW;
            case 'p':
                return this.history_step(-1);
            case 'n':
                return this.history_step(1);
            case 'c':
                return { type: 'interrupt' };
            case 'd':
                if (this.buffer.length === 0) {
                    return { type: 'eof' };
                }
                this.delete_forward();
                return REDRAW;
            case 'l':
                return { type: 'clear_screen' };
            default:
                return NONE;
        }
    }

    private handle_alt(letter: string): EditorAction {
        switch (letter) {
            case 'b':
                this.cursor = this.word_start_before(this.cursor);
                return REDRAW;
            case 'f':
                this.cursor = this.word_end_after(this.cursor);
                return REDRAW;
            case 'd':
                this.kill(this.cursor, this.word_end_after(this.cursor));
                return REDRAW;
            default:
                return NONE;
        }
    }

    private history_step(direction: -1 | 1): EditorAction {
        const entries = this.history_entries();
        if (entries.length === 0) {
            return NONE;
        }
        if (this.history_index === null) {
            if (direction === 1) {
                return NONE;
            }
            this.history_draft = this.buffer;
            this.history_index = entries.length - 1;
        } else {
            const next = this.history_index + direction;
            if (next < 0) {
                return NONE;
            }
            if (next >= entries.length) {
                this.history_index = null;
                this.buffer = this.history_draft;
                this.cursor = this.buffer.length;
                return REDRAW;
            }
            this.history_index = next;
        }
        this.buffer = entries[this.history_index] ?? '';
        this.cursor = this.buffer.length;
        return REDRAW;
    }

    private delete_forward(): void {
        if (this.cursor < this.buffer.length) {
            this.delete_range(this.cursor, next_index(this.buffer, this.cursor));
        }
    }

    private delete_range(start: number, end: number): void {
        this.buffer = this.buffer.slice(0, start) + this.buffer.slice(end);
        this.cursor = start;
    }

    private kill(start: number, end: number): void {
        if (end <= start) {
            return;
        }
        this.kill_buffer = this.buffer.slice(start, end);
        this.delete_range(start, end);
    }

    private transpose(): void {
        if (this.buffer.length < 2 || this.cursor === 0) {
            return;
        }
        // At end of line, swap the two characters before the cursor.
        const right_end = this.cursor >= this.buffer.length
            ? this.buffer.length
            : next_index(this.buffer, this.cursor);
        const middle = previous_index(this.buffer, right_end);
        const left_start = previous_index(this.buffer, middle);
        const left = this.buffer.slice(left_start, middle);
        const right = this.buffer.slice(middle, right_end);
        this.buffer = this.buffer.slice(0, left_start) + right + left
            + this.buffer.slice(right_end);
        this.cursor = right_end;
    }

    private word_start_before(position: number): number {
        let index = position;
        while (index > 0 && !is_word_char(this.buffer, previous_index(this.buffer, index))) {
            index = previous_index(this.buffer, index);
        }
        while (index > 0 && is_word_char(this.buffer, previous_index(this.buffer, index))) {
            index = previous_index(this.buffer, index);
        }
        return index;
    }

    private word_end_after(position: number): number {
        let index = position;
        while (index < this.buffer.length && !is_word_char(this.buffer, index)) {
            index = next_index(this.buffer, index);
        }
        while (index < this.buffer.length && is_word_char(this.buffer, index)) {
            index = next_index(this.buffer, index);
        }
        return index;
    }

    /** When every candidate replaces the same range, insert their common prefix. */
    private extend_common_prefix(candidates: CompletionCandidate[]): void {
        const first = candidates[0];
        if (!first) {
            return;
        }
        let prefix = first.insert;
        for (const my_candidate of candidates) {
            if (my_candidate.start !== first.start || my_candidate.end !== first.end) {
                return;
            }
            prefix = common_prefix(prefix, my_candidate.insert);
        }
        const typed = this.buffer.slice(first.start, first.end);
        if (prefix.length <= typed.length || !prefix.startsWith(typed)) {
            return;
        }
        this.buffer = this.buffer.slice(0, first.start) + prefix + this.buffer.slice(first.end);
        this.cursor = first.start + prefix.length;
        const new_end = first.start + prefix.length;
        for (const my_candidate of candidates) {
            my_candidate.end = new_end;
        }
    }
}

function common_prefix(left: string, right: string): string {
    let index = 0;
    while (index < left.length && index < right.length && left[index] === right[index]) {
        index++;
    }
    return left.slice(0, index);
}

function is_word_char(text: string, index: number): boolean {
    const code_point = text.codePointAt(index);
    return code_point !== undefined && WORD_CHAR.test(String.fromCodePoint(code_point));
}

/** Index of the code point before `index` (surrogate-pair aware). */
export function previous_index(text: string, index: number): number {
    if (index <= 0) {
        return 0;
    }
    const low = text.charCodeAt(index - 1);
    if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
        const high = text.charCodeAt(index - 2);
        if (high >= 0xd800 && high <= 0xdbff) {
            return index - 2;
        }
    }
    return index - 1;
}

/** Index of the code point after `index` (surrogate-pair aware). */
export function next_index(text: string, index: number): number {
    if (index >= text.length) {
        return text.length;
    }
    const code_point = text.codePointAt(index) ?? 0;
    return index + (code_point > 0xffff ? 2 : 1);
}
