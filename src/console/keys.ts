/**
 * Decodes raw terminal input (already UTF-8 decoded) into key events.
 *
 * Input arrives in arbitrary chunks, so an escape sequence or bracketed
 * paste can be split anywhere; the decoder carries the incomplete tail
 * over to the next `push()`. A lone ESC is ambiguous (Esc key, or the
 * start of a sequence) and is only reported as Esc by `flush_escape()`,
 * which the session calls after a short timeout.
 *
 * With `editor_sends`, it also reads editor sends (an APC sequence, see
 * editor-send-channel.ts) outside a bracketed paste, so text the user
 * pastes is never taken for one. A send's payload is JSON, which has no
 * control characters: one (Ctrl+C, Enter) or an ESC that doesn't end
 * the sequence abandons it and is then read as usual, and the rest of
 * the broken send is dropped too, up to its end (`ESC \`), the next
 * Enter, or `flush_frame()`, so it is never typed. A payload over
 * MAX_EDITOR_SEND_LENGTH is dropped whole, and `flush_frame()` drops
 * one that stops arriving.
 */

import { EDITOR_SEND_START, MAX_EDITOR_SEND_LENGTH } from './editor-send-channel';

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
    | { type: 'paste'; text: string }
    /** An editor send's payload (with `editor_sends` only). */
    | { type: 'editor_send'; payload: string };

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
/** What ends or abandons an editor send's payload: any control char. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x1f]/;
const EDITOR_SEND_END_CHAR = '\\';
/** EDITOR_SEND_START after its ESC. */
const EDITOR_SEND_START_BODY = EDITOR_SEND_START.slice(1);

export interface KeyDecoderOptions {
    /** Read editor sends (editor-send-channel.ts) as well as keys. */
    editor_sends?: boolean;
}

/** An editor send being read: its payload so far. */
interface Frame {
    parts: string[];
    length: number;
    /** Too long: the rest is read and dropped. */
    oversize: boolean;
}

export class KeyDecoder {
    private buffer = '';
    private paste: string[] | null = null;
    private frame: Frame | null = null;
    /** The rest of an abandoned send is being dropped. */
    private discarding = false;
    private readonly editor_sends: boolean;
    /**
     * A lone ESC was just reported as Esc: a send split right after
     * its ESC, longer than the Esc wait, is still read as a send.
     */
    private escape_flushed = false;

    constructor(options: KeyDecoderOptions = {}) {
        this.editor_sends = options.editor_sends === true;
    }

    /** Decode a chunk; incomplete trailing sequences are kept for later. */
    push(chunk: string): KeyEvent[] {
        const escape_flushed = this.escape_flushed;
        this.escape_flushed = false;
        if (escape_flushed && this.editor_sends && this.buffer.length === 0
            && this.paste === null && this.frame === null
            && chunk.startsWith(EDITOR_SEND_START_BODY)) {
            chunk = `\x1b${chunk}`;
        }
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
            if (this.frame !== null) {
                if (!this.read_frame(events)) {
                    break;
                }
                continue;
            }
            if (this.discarding && this.paste === null) {
                const first = this.buffer[0] ?? '';
                if (first === '\x1b') {
                    if (this.buffer.length === 1) {
                        break; // Wait: it may end the broken send.
                    }
                    if (this.buffer[1] === EDITOR_SEND_END_CHAR) {
                        this.buffer = this.buffer.slice(2);
                        this.discarding = false;
                        continue;
                    }
                    // Another sequence (an arrow key): read it.
                } else if (first === '\r' || first === '\n') {
                    // A payload has no line ends: this is a key.
                    this.discarding = false;
                } else if (first.charCodeAt(0) >= 0x20) {
                    const stop = this.buffer.search(CONTROL_CHAR);
                    this.buffer = stop === -1 ? '' : this.buffer.slice(stop);
                    continue;
                }
            }
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
            if (this.editor_sends && this.buffer[1] === '_') {
                if (this.buffer.startsWith(EDITOR_SEND_START)) {
                    this.buffer = this.buffer.slice(EDITOR_SEND_START.length);
                    this.frame = { parts: [], length: 0, oversize: false };
                    continue;
                }
                if (EDITOR_SEND_START.startsWith(this.buffer)) {
                    break; // Maybe a send; wait (flush_frame gives up).
                }
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
        return this.paste === null && this.frame === null
            && !this.discarding && this.buffer === '\x1b';
    }

    /** Report a pending lone ESC as the Esc key. */
    flush_escape(): KeyEvent[] {
        if (!this.has_pending_escape()) {
            return [];
        }
        this.buffer = '';
        this.escape_flushed = true;
        return [{ type: 'key', name: 'escape' }];
    }

    /**
     * True while an editor send has started (or may have: its first
     * bytes came) and waits for the rest, for `flush_frame()`.
     */
    has_pending_frame(): boolean {
        if (this.frame !== null || this.discarding) {
            return true;
        }
        return this.editor_sends && this.paste === null
            && this.buffer.length > 1
            && EDITOR_SEND_START.startsWith(this.buffer);
    }

    /**
     * The rest of a send hasn't come: drop a started one, and read the
     * first bytes of one that never started as keys (Alt+_, ...).
     */
    flush_frame(): KeyEvent[] {
        if (this.frame !== null || this.discarding) {
            this.frame = null;
            this.discarding = false;
            // An ESC kept to see if it ends the send goes with it.
            if (this.buffer === '\x1b') {
                this.buffer = '';
            }
            return [];
        }
        if (!this.has_pending_frame()) {
            return [];
        }
        const text = this.buffer;
        this.buffer = '';
        // Read it as keys only: it is known not to be a send.
        const events: KeyEvent[] = [{ type: 'alt', letter: '_' }];
        if (text.length > 2) {
            events.push(...this.push(text.slice(2)));
        }
        return events;
    }

    /**
     * Read a started send's payload from `buffer`. Returns false when
     * the buffer is used up and more input is needed.
     */
    private read_frame(events: KeyEvent[]): boolean {
        const frame = this.frame;
        if (frame === null) {
            return true;
        }
        const stop = this.buffer.search(CONTROL_CHAR);
        const text = stop === -1 ? this.buffer : this.buffer.slice(0, stop);
        if (text.length > 0) {
            frame.length += text.length;
            if (frame.length > MAX_EDITOR_SEND_LENGTH) {
                frame.oversize = true;
                frame.parts = [];
            } else {
                frame.parts.push(text);
            }
        }
        if (stop === -1) {
            this.buffer = '';
            return false;
        }
        this.buffer = this.buffer.slice(stop);
        if (this.buffer[0] === '\x1b') {
            if (this.buffer.length === 1) {
                return false; // Wait: it may end the send.
            }
            if (this.buffer[1] === EDITOR_SEND_END_CHAR) {
                this.buffer = this.buffer.slice(2);
                this.frame = null;
                if (!frame.oversize) {
                    events.push({
                        type: 'editor_send', payload: frame.parts.join(''),
                    });
                }
                return true;
            }
        }
        // A control char or another sequence: not a send after all.
        // Drop what was read, read this as usual, and drop the rest.
        this.frame = null;
        this.discarding = true;
        return true;
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
