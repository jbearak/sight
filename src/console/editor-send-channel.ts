/**
 * Editor sends to the console on a terminal (editor-console-tty.ts),
 * carried in its input stream: a Perch session's only way in is input
 * typed through Perch, and a send typed as keys would answer
 * `--more--` and join what the user is typing. The extension wraps
 * each send in an APC escape sequence, which no key produces:
 *
 *   ESC _ sight-send; {"line": "...", "file": "..."} ESC \
 *
 * JSON escapes control characters, so ESC never appears inside the
 * payload. `file` is the send's temporary do-file, which the console
 * deletes once Stata has read the line (or at once if it never will).
 *
 * The extension mirrors these constants (perch-core.ts).
 */

export const EDITOR_SEND_START = '\x1b_sight-send;';
export const EDITOR_SEND_END = '\x1b\\';
/** A payload longer than this without its end is taken as keys. */
const MAX_PAYLOAD_LENGTH = 1024 * 1024;

export interface EditorSend {
    line: string;
    file?: string;
}

export type EditorInputEvent =
    | { type: 'keys'; text: string }
    | { type: 'send'; send: EditorSend };

export function encode_editor_send(send: EditorSend): string {
    return EDITOR_SEND_START + JSON.stringify(send) + EDITOR_SEND_END;
}

function parse_send(payload: string): EditorSend | null {
    try {
        const value: unknown = JSON.parse(payload);
        if (typeof value !== 'object' || value === null) {
            return null;
        }
        const line: unknown = Reflect.get(value, 'line');
        const file: unknown = Reflect.get(value, 'file');
        if (typeof line !== 'string'
            || (file !== undefined && typeof file !== 'string')) {
            return null;
        }
        return file === undefined ? { line } : { line, file };
    } catch {
        return null;
    }
}

/** Length of the longest end of `text` that starts EDITOR_SEND_START. */
function partial_start_length(text: string): number {
    const longest = Math.min(text.length, EDITOR_SEND_START.length - 1);
    for (let length = longest; length > 0; length--) {
        if (EDITOR_SEND_START.startsWith(text.slice(text.length - length))) {
            return length;
        }
    }
    return 0;
}

/**
 * Splits terminal input into keys and editor sends, in order, across
 * chunks. Text that may be the start of a send (a lone ESC, say) is
 * held until the next chunk or `flush_partial`, which the caller calls
 * after a short quiet time so a bare Esc key isn't lost.
 */
export class EditorSendDecoder {
    private carry = '';

    push(text: string): EditorInputEvent[] {
        const the_events: EditorInputEvent[] = [];
        let input = this.carry + text;
        this.carry = '';
        for (;;) {
            const start_index = input.indexOf(EDITOR_SEND_START);
            if (start_index === -1) {
                const held = partial_start_length(input);
                push_keys(the_events, input.slice(0, input.length - held));
                this.carry = input.slice(input.length - held);
                return the_events;
            }
            push_keys(the_events, input.slice(0, start_index));
            const payload_index = start_index + EDITOR_SEND_START.length;
            const end_index = input.indexOf(EDITOR_SEND_END, payload_index);
            if (end_index === -1) {
                const rest = input.slice(start_index);
                if (rest.length > MAX_PAYLOAD_LENGTH) {
                    push_keys(the_events, rest);
                } else {
                    this.carry = rest;
                }
                return the_events;
            }
            const send = parse_send(input.slice(payload_index, end_index));
            if (send) {
                the_events.push({ type: 'send', send });
            }
            input = input.slice(end_index + EDITOR_SEND_END.length);
        }
    }

    /** True while held text could still start a send. */
    has_partial_start(): boolean {
        return this.carry.length > 0
            && !this.carry.startsWith(EDITOR_SEND_START);
    }

    /** Give up on held text that only looked like a send's start. */
    flush_partial(): EditorInputEvent[] {
        if (!this.has_partial_start()) {
            return [];
        }
        const text = this.carry;
        this.carry = '';
        return [{ type: 'keys', text }];
    }
}

function push_keys(the_events: EditorInputEvent[], text: string): void {
    if (text.length > 0) {
        the_events.push({ type: 'keys', text });
    }
}
