/**
 * Unit tests for console input: key decoding, the line editor, and
 * rendering.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { KeyDecoder, type KeyEvent } from '../../../src/console/keys';
import { LineEditor, type CompletionCandidate } from '../../../src/console/line-editor';
import { display_width, erase, render } from '../../../src/console/render';

/** Merge adjacent text events so chunking doesn't change the result. */
function normalize(events: KeyEvent[]): KeyEvent[] {
    const merged: KeyEvent[] = [];
    for (const my_event of events) {
        const last = merged[merged.length - 1];
        if (my_event.type === 'text' && last?.type === 'text') {
            merged[merged.length - 1] = { type: 'text', text: last.text + my_event.text };
        } else {
            merged.push(my_event);
        }
    }
    return merged;
}

function decode_all(chunks: string[]): KeyEvent[] {
    const decoder = new KeyDecoder();
    const events: KeyEvent[] = [];
    for (const my_chunk of chunks) {
        events.push(...decoder.push(my_chunk));
    }
    events.push(...decoder.flush_escape());
    return normalize(events);
}

describe('KeyDecoder', () => {
    it('decodes keys, chords and paste', () => {
        expect(decode_all(['ab\r\t\x7f\x01\x1bb\x1b[A\x1b[1;5D\x1b[3~\x1b[Z\x1bOH'])).toEqual([
            { type: 'text', text: 'ab' },
            { type: 'key', name: 'enter' },
            { type: 'key', name: 'tab' },
            { type: 'key', name: 'backspace' },
            { type: 'ctrl', letter: 'a' },
            { type: 'alt', letter: 'b' },
            { type: 'key', name: 'up' },
            { type: 'key', name: 'word_left' },
            { type: 'key', name: 'delete' },
            { type: 'key', name: 'shift_tab' },
            { type: 'key', name: 'home' },
        ]);
        expect(decode_all(['\x1b[200~line 1\r\nline 2\x1b[201~'])).toEqual([
            { type: 'paste', text: 'line 1\r\nline 2' },
        ]);
    });

    it('holds a lone ESC until flushed', () => {
        const decoder = new KeyDecoder();
        expect(decoder.push('\x1b')).toEqual([]);
        expect(decoder.has_pending_escape()).toBe(true);
        expect(decoder.flush_escape()).toEqual([{ type: 'key', name: 'escape' }]);
    });

    it('decodes the same events however input is split', () => {
        const input = 'di "é"\x1b[200~a\r\nb\x1b[201~\x1b[1;5C\x1bf\x03\x1b[3~😀\r';
        const expected = decode_all([input]);
        fc.assert(fc.property(fc.array(fc.nat(input.length), { maxLength: 6 }), (cuts) => {
            const points = [...new Set(cuts)].sort((a, b) => a - b);
            const chunks: string[] = [];
            let start = 0;
            for (const my_point of [...points, input.length]) {
                chunks.push(input.slice(start, my_point));
                start = my_point;
            }
            expect(decode_all(chunks)).toEqual(expected);
        }));
    });
});

function type_text(editor: LineEditor, text: string): void {
    editor.handle({ type: 'text', text }, false);
}

describe('LineEditor', () => {
    it('edits with emacs keys', () => {
        const editor = new LineEditor();
        type_text(editor, 'summarize price');
        editor.handle({ type: 'ctrl', letter: 'a' }, false);
        expect(editor.cursor).toBe(0);
        editor.handle({ type: 'alt', letter: 'f' }, false);
        expect(editor.cursor).toBe('summarize'.length);
        editor.handle({ type: 'ctrl', letter: 'k' }, false);
        expect(editor.buffer).toBe('summarize');
        editor.handle({ type: 'ctrl', letter: 'y' }, false);
        expect(editor.buffer).toBe('summarize price');
        editor.handle({ type: 'ctrl', letter: 'w' }, false);
        expect(editor.buffer).toBe('summarize ');
        editor.handle({ type: 'ctrl', letter: 'u' }, false);
        expect(editor.buffer).toBe('');
    });

    it('moves over surrogate pairs as one character', () => {
        const editor = new LineEditor();
        type_text(editor, 'a😀');
        editor.handle({ type: 'key', name: 'backspace' }, false);
        expect(editor.buffer).toBe('a');
    });

    it('steps through history and restores the draft', () => {
        const editor = new LineEditor(() => ['first', 'second']);
        type_text(editor, 'draft');
        editor.handle({ type: 'key', name: 'up' }, false);
        expect(editor.buffer).toBe('second');
        editor.handle({ type: 'key', name: 'up' }, false);
        expect(editor.buffer).toBe('first');
        editor.handle({ type: 'key', name: 'down' }, false);
        editor.handle({ type: 'key', name: 'down' }, false);
        expect(editor.buffer).toBe('draft');
    });

    it('returns actions for submit, interrupt, eof and completion', () => {
        const editor = new LineEditor();
        expect(editor.handle({ type: 'ctrl', letter: 'd' }, false)).toEqual({ type: 'eof' });
        expect(editor.handle({ type: 'key', name: 'tab' }, true)).toEqual({ type: 'complete' });
        expect(editor.handle({ type: 'key', name: 'tab' }, false)).toEqual({ type: 'none' });
        type_text(editor, 'x');
        expect(editor.handle({ type: 'ctrl', letter: 'd' }, false)).toEqual({ type: 'redraw' });
        expect(editor.handle({ type: 'ctrl', letter: 'c' }, false)).toEqual({ type: 'interrupt' });
        expect(editor.handle({ type: 'key', name: 'enter' }, false))
            .toEqual({ type: 'submit', line: 'x' });
    });

    it('inserts a single completion and the common prefix of several', () => {
        const editor = new LineEditor();
        type_text(editor, 'su');
        editor.show_completions([{ label: 'summarize', insert: 'summarize', start: 0, end: 2 }]);
        expect(editor.buffer).toBe('summarize');
        expect(editor.menu).toBeNull();

        editor.reset();
        type_text(editor, 'reg');
        const candidates: CompletionCandidate[] = [
            { label: 'regress', insert: 'regress', start: 0, end: 3 },
            { label: 'regression', insert: 'regression', start: 0, end: 3 },
        ];
        editor.show_completions(candidates);
        expect(editor.buffer).toBe('regress');
        expect(editor.menu?.items.length).toBe(2);
        editor.handle({ type: 'key', name: 'tab' }, true);
        expect(editor.menu?.selected).toBe(1);
        editor.handle({ type: 'key', name: 'enter' }, true);
        expect(editor.buffer).toBe('regression');
        expect(editor.menu).toBeNull();
    });

    it('closes the menu on Esc before anything else', () => {
        const editor = new LineEditor();
        editor.show_completions([
            { label: 'a1', insert: 'a1', start: 0, end: 0 },
            { label: 'b1', insert: 'b1', start: 0, end: 0 },
        ]);
        expect(editor.handle({ type: 'key', name: 'escape' }, true)).toEqual({ type: 'redraw' });
        expect(editor.menu).toBeNull();
        expect(editor.handle({ type: 'key', name: 'escape' }, true)).toEqual({ type: 'escape' });
    });
});

describe('render', () => {
    const base = { buffer_display: '', buffer: '', cursor: 0, menu: null, note: null };

    it('draws the prompt and input and places the cursor', () => {
        const result = render({ ...base, prompt: '. ', buffer: 'di 1', buffer_display: 'di 1',
            cursor: 2, columns: 80 }, null);
        expect(result.output).toBe('. di 1\r\x1b[4C');
        expect(result.state.cursor_row).toBe(0);
    });

    it('tracks wrapped rows and erases from the first one', () => {
        const buffer = 'x'.repeat(20);
        const result = render({ ...base, prompt: '. ', buffer, buffer_display: buffer,
            cursor: 20, columns: 10 }, null);
        // 22 columns on a 10-column terminal: the cursor is on row 2.
        expect(result.state.cursor_row).toBe(2);
        expect(erase(result.state)).toBe('\x1b[2A\r\x1b[J');
    });

    it('moves past a row filled exactly', () => {
        const buffer = 'x'.repeat(8);
        const result = render({ ...base, prompt: '. ', buffer, buffer_display: buffer,
            cursor: 8, columns: 10 }, null);
        expect(result.output).toBe(`. ${buffer}\r\n\r`);
        expect(result.state.cursor_row).toBe(1);
    });

    it('draws a menu and note below and returns to the input row', () => {
        const result = render({ ...base, prompt: '. ', buffer: 'r', buffer_display: 'r', cursor: 1,
            columns: 40, note: '2 more pasted lines',
            menu: { items: [
                { label: 'regress', insert: 'regress', start: 0, end: 1 },
                { label: 'replace', insert: 'replace', start: 0, end: 1 },
            ], selected: 0 } }, null);
        expect(result.output).toContain('\x1b[7m  regress  ');
        expect(result.output).toContain('2 more pasted lines');
        expect(result.output.endsWith('\x1b[3A\r\x1b[3C')).toBe(true);
    });

    it('measures wide and zero-width characters', () => {
        expect(display_width('abc')).toBe(3);
        expect(display_width('统计')).toBe(4);
        expect(display_width('é')).toBe(1);
        expect(display_width('😀')).toBe(2);
    });
});
