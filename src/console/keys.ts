/**
 * Decodes raw terminal input (already UTF-8 decoded) into key events.
 *
 * Input arrives in arbitrary chunks, so an escape sequence or bracketed
 * paste can be split anywhere; the decoder carries the incomplete tail
 * over to the next `push()`. A lone ESC is ambiguous (Esc key, or the
 * start of a sequence) and is only reported as Esc by `flush_escape()`,
 * which the session calls after a short timeout.
 */

export type KeyName =
    | 'enter' | 'tab' | 'shift_tab' | 'backspace' | 'delete' | 'escape'
    | 'up' | 'down' | 'left' | 'right' | 'home' | 'end'
    | 'word_left' | 'word_right';

export type KeyEvent =
    | { type: 'text'; text: string }
    | { type: 'key'; name: KeyName }
    | { type: 'ctrl'; letter: string }
    | { type: 'alt'; letter: string }
    | { type: 'alt_backspace' }
    | { type: 'paste'; text: string };

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

// Final bytes of CSI/SS3 sequences we understand, keyed by the sequence
// body after `ESC [` or `ESC O`.
const CSI_KEYS: ReadonlyMap<string, KeyName> = new Map([
    ['A', 'up'], ['B', 'down'], ['C', 'right'], ['D', 'left'],
    ['H', 'home'], ['F', 'end'], ['Z', 'shift_tab'],
    ['1~', 'home'], ['7~', 'home'], ['4~', 'end'], ['8~', 'end'],
    ['3~', 'delete'],
    ['1;5C', 'word_right'], ['1;5D', 'word_left'],
    ['1;3C', 'word_right'], ['1;3D', 'word_left'],
    ['5C', 'word_right'], ['5D', 'word_left'],
]);

// A complete CSI sequence: parameters, intermediates, one final byte.
// Terminal escape sequences start with ESC, so these patterns must
// contain that control character.
// eslint-disable-next-line no-control-regex
const CSI_SEQUENCE = /^\x1b\[([0-?]*[ -/]*[@-~])/;
// eslint-disable-next-line no-control-regex
const CSI_PREFIX = /^\x1b\[[0-?]*[ -/]*$/;

export class KeyDecoder {
    private buffer = '';
    private paste: string[] | null = null;

    /** Decode a chunk; incomplete trailing sequences are kept for later. */
    push(chunk: string): KeyEvent[] {
        this.buffer += chunk;
        const events: KeyEvent[] = [];
        let text_run: string[] = [];
        const flush_text = (): void => {
            if (text_run.length > 0) {
                events.push({ type: 'text', text: text_run.join('') });
                text_run = [];
            }
        };

        while (this.buffer.length > 0) {
            if (this.paste !== null) {
                const end = this.buffer.indexOf(PASTE_END);
                if (end === -1) {
                    // Keep a possible partial end marker in the buffer.
                    const keep = partial_suffix_length(this.buffer, PASTE_END);
                    this.paste.push(this.buffer.slice(0, this.buffer.length - keep));
                    this.buffer = this.buffer.slice(this.buffer.length - keep);
                    break;
                }
                this.paste.push(this.buffer.slice(0, end));
                this.buffer = this.buffer.slice(end + PASTE_END.length);
                events.push({ type: 'paste', text: this.paste.join('') });
                this.paste = null;
                continue;
            }

            const char = this.buffer[0] ?? '';
            if (char !== '\x1b') {
                const code = char.charCodeAt(0);
                this.buffer = this.buffer.slice(1);
                if (char === '\r' || char === '\n') {
                    flush_text();
                    events.push({ type: 'key', name: 'enter' });
                } else if (char === '\t') {
                    flush_text();
                    events.push({ type: 'key', name: 'tab' });
                } else if (char === '\x7f' || char === '\x08') {
                    flush_text();
                    events.push({ type: 'key', name: 'backspace' });
                } else if (code < 0x20) {
                    flush_text();
                    events.push({
                        type: 'ctrl',
                        letter: String.fromCharCode(code + 0x60),
                    });
                } else {
                    text_run.push(char);
                }
                continue;
            }

            // Escape sequences.
            flush_text();
            if (this.buffer.length === 1) {
                break; // Lone ESC: wait for more input or flush_escape().
            }
            if (this.buffer.startsWith(PASTE_START)) {
                this.buffer = this.buffer.slice(PASTE_START.length);
                this.paste = [];
                continue;
            }
            const second = this.buffer[1] ?? '';
            if (second === '[') {
                const match = CSI_SEQUENCE.exec(this.buffer);
                if (!match) {
                    if (CSI_PREFIX.test(this.buffer)
                        || PASTE_START.startsWith(this.buffer)) {
                        break; // Incomplete; wait for the rest.
                    }
                    // Malformed: drop the ESC and continue.
                    this.buffer = this.buffer.slice(1);
                    continue;
                }
                this.buffer = this.buffer.slice(match[0].length);
                const name = CSI_KEYS.get(match[1] ?? '');
                if (name) {
                    events.push({ type: 'key', name });
                }
                continue;
            }
            if (second === 'O') {
                if (this.buffer.length < 3) {
                    break;
                }
                const name = CSI_KEYS.get(this.buffer[2] ?? '');
                this.buffer = this.buffer.slice(3);
                if (name) {
                    events.push({ type: 'key', name });
                }
                continue;
            }
            // ESC + key: Alt chord.
            this.buffer = this.buffer.slice(2);
            if (second === '\x7f' || second === '\x08') {
                events.push({ type: 'alt_backspace' });
            } else if (second === '\r') {
                events.push({ type: 'key', name: 'enter' });
            } else if (second === '\x1b') {
                // ESC ESC: report one Esc and reconsider the second.
                events.push({ type: 'key', name: 'escape' });
                this.buffer = '\x1b' + this.buffer;
            } else {
                events.push({ type: 'alt', letter: second });
            }
        }
        flush_text();
        return events;
    }

    /** True when a lone ESC is waiting for `flush_escape()`. */
    has_pending_escape(): boolean {
        return this.paste === null && this.buffer === '\x1b';
    }

    /** Report a pending lone ESC as the Esc key. */
    flush_escape(): KeyEvent[] {
        if (!this.has_pending_escape()) {
            return [];
        }
        this.buffer = '';
        return [{ type: 'key', name: 'escape' }];
    }
}

/** Length of the longest suffix of `text` that is a prefix of `marker`. */
function partial_suffix_length(text: string, marker: string): number {
    const max = Math.min(text.length, marker.length - 1);
    for (let length = max; length > 0; length--) {
        if (marker.startsWith(text.slice(text.length - length))) {
            return length;
        }
    }
    return 0;
}
