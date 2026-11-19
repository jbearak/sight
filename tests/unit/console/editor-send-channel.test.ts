/**
 * Editor sends carried in a terminal console's input (Perch sessions):
 * read by the key decoder apart from keys, in order, however the input
 * is split; never from a paste; abandoned, never typed, when broken;
 * and the console deletes only the extension's own temp do-files.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    EDITOR_SEND_START,
    MAX_EDITOR_SEND_LENGTH,
    delete_editor_send_file,
    encode_editor_send,
    is_editor_send_file,
    parse_editor_send,
} from '../../../src/console/editor-send-channel';
import { KeyDecoder, type KeyEvent } from '../../../src/console/keys';

const FILE = '/tmp/stata_send_0123456789abcdef0123456789abcdef.do';
const SEND = encode_editor_send({ line: 'do "a.do"', file: FILE });
const PAYLOAD = JSON.stringify({ line: 'do "a.do"', file: FILE });

function decoder(): KeyDecoder {
    return new KeyDecoder({ editor_sends: true });
}

/** Push each chunk, flushing nothing: the events, in order. */
function push_all(the_chunks: string[], the_decoder = decoder()): KeyEvent[] {
    return the_chunks.flatMap((my_chunk) => the_decoder.push(my_chunk));
}

describe('KeyDecoder with editor sends', () => {
    it('reads sends apart from keys, in order', () => {
        expect(push_all([`di 9${SEND}\r`])).toEqual([
            { type: 'text', text: 'di 9' },
            { type: 'editor_send', payload: PAYLOAD },
            { type: 'key', name: 'enter' },
        ]);
    });

    it('reads a send split across chunks at any point, or byte by byte', () => {
        for (let i = 1; i < SEND.length; i++) {
            expect(push_all([`q${SEND.slice(0, i)}`, SEND.slice(i)])).toEqual([
                { type: 'text', text: 'q' },
                { type: 'editor_send', payload: PAYLOAD },
            ]);
        }
        expect(push_all(Array.from(SEND))).toEqual([
            { type: 'editor_send', payload: PAYLOAD },
        ]);
    });

    it('never reads a send from a bracketed paste', () => {
        const the_events = push_all([`\x1b[200~x${SEND}\r\n\x1b[201~`]);
        expect(the_events).toEqual([
            { type: 'paste', text: `x${SEND}\r\n` },
        ]);
        // Split anywhere, it is still pasted text.
        for (let i = 1; i < SEND.length; i++) {
            const the_split = push_all([
                `\x1b[200~${SEND.slice(0, i)}`, `${SEND.slice(i)}\x1b[201~`,
            ]);
            expect(the_split).toEqual([{ type: 'paste', text: SEND }]);
        }
    });

    it('reads the same send without the option as keys, as before', () => {
        const plain = new KeyDecoder();
        const the_events = plain.push(SEND);
        expect(the_events.some((my_event) => my_event.type === 'editor_send'))
            .toBe(false);
        expect(the_events[0]).toEqual({ type: 'alt', letter: '_' });
    });

    it('abandons a send at a control character, which is then read', () => {
        const the_decoder = decoder();
        expect(the_decoder.push(`${EDITOR_SEND_START}{"line":`)).toEqual([]);
        expect(the_decoder.has_pending_frame()).toBe(true);
        expect(the_decoder.push('q\x03')).toEqual([
            { type: 'ctrl', letter: 'c' },
        ]);
        expect(the_decoder.has_pending_frame()).toBe(false);
        expect(the_decoder.push('x\r')).toEqual([
            { type: 'text', text: 'x' }, { type: 'key', name: 'enter' },
        ]);
    });

    it('reads a send that follows a broken one', () => {
        expect(push_all([`${EDITOR_SEND_START}{"li`, SEND])).toEqual([
            { type: 'editor_send', payload: PAYLOAD },
        ]);
    });

    it('drops an oversize send whole, however it is split', () => {
        const big = encode_editor_send({
            line: 'a'.repeat(MAX_EDITOR_SEND_LENGTH), file: FILE,
        });
        for (const the_chunks of [
            [big, 'z'],
            [big.slice(0, -2), big.slice(-2), 'z'],
            [big.slice(0, 1000), big.slice(1000, -1), big.slice(-1), 'z'],
        ]) {
            expect(push_all(the_chunks)).toEqual([{ type: 'text', text: 'z' }]);
        }
    });

    it('drops a send that stops arriving, and reads what comes after', () => {
        const the_decoder = decoder();
        the_decoder.push(SEND.slice(0, 30));
        expect(the_decoder.flush_frame()).toEqual([]);
        expect(the_decoder.push('di 1\r')).toEqual([
            { type: 'text', text: 'di 1' }, { type: 'key', name: 'enter' },
        ]);
        // Even with only its ESC kept, waiting to see if the send ends.
        const ending = decoder();
        ending.push(SEND.slice(0, -1));
        expect(ending.flush_frame()).toEqual([]);
        expect(ending.push('\\')).toEqual([{ type: 'text', text: '\\' }]);
    });

    it('reads the first bytes of what was not a send as keys', () => {
        const the_decoder = decoder();
        expect(the_decoder.push('\x1b_si')).toEqual([]);
        expect(the_decoder.has_pending_frame()).toBe(true);
        expect(the_decoder.flush_frame()).toEqual([
            { type: 'alt', letter: '_' }, { type: 'text', text: 'si' },
        ]);
        expect(push_all(['\x1b_x'])).toEqual([
            { type: 'alt', letter: '_' }, { type: 'text', text: 'x' },
        ]);
    });

    it('reads a send split just after its ESC, past the Esc wait', () => {
        const the_decoder = decoder();
        expect(the_decoder.push('\x1b')).toEqual([]);
        expect(the_decoder.has_pending_escape()).toBe(true);
        expect(the_decoder.flush_escape()).toEqual([
            { type: 'key', name: 'escape' },
        ]);
        expect(the_decoder.push(SEND.slice(1))).toEqual([
            { type: 'editor_send', payload: PAYLOAD },
        ]);
        // Any other text after a lone Esc is text, as before.
        const other = decoder();
        other.push('\x1b');
        other.flush_escape();
        expect(other.push('_z')).toEqual([{ type: 'text', text: '_z' }]);
    });
});

describe('parse_editor_send', () => {
    it('needs a line and a file', () => {
        expect(parse_editor_send(PAYLOAD)).toEqual({ line: 'do "a.do"', file: FILE });
        expect(parse_editor_send('{"line":"x"}')).toBeNull();
        expect(parse_editor_send('{"line":1,"file":"/f"}')).toBeNull();
        expect(parse_editor_send('not json')).toBeNull();
        expect(parse_editor_send('null')).toBeNull();
    });
});

describe('is_editor_send_file', () => {
    const NAME = 'stata_send_0123456789abcdef0123456789abcdef.do';

    it('takes only the extension\'s temp do-files in the send directory', () => {
        expect(is_editor_send_file(`/tmp/${NAME}`, '/tmp')).toBe(true);
        expect(is_editor_send_file(`/tmp/${NAME}`, '/tmp/')).toBe(true);
        for (const my_file of [
            `/tmp/../tmp/${NAME}`,
            `/tmp/sub/${NAME}`,
            `/etc/${NAME}`,
            `tmp/${NAME}`,
            '/tmp/stata_send_0123.do',
            '/tmp/stata_send_0123456789ABCDEF0123456789abcdef.do',
            '/tmp/profile.do',
            '/tmp/',
            '/tmp',
        ]) {
            expect(is_editor_send_file(my_file, '/tmp')).toBe(false);
        }
    });

    it('deletes a regular file, never what a symbolic link points to', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-send-'));
        try {
            const target = path.join(dir, 'keep.do');
            fs.writeFileSync(target, 'keep');
            const link = path.join(dir, NAME);
            fs.symlinkSync(target, link);
            delete_editor_send_file(link);
            expect(fs.existsSync(target)).toBe(true);
            expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
            fs.unlinkSync(link);
            fs.writeFileSync(link, 'do');
            delete_editor_send_file(link);
            expect(fs.existsSync(link)).toBe(false);
            // Gone already: nothing happens.
            delete_editor_send_file(link);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
