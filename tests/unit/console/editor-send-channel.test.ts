/**
 * Editor sends carried in a terminal console's input (Perch sessions):
 * split from keys in order, across chunks, without losing a bare Esc.
 */

import { describe, expect, it } from 'bun:test';
import {
    EditorSendDecoder,
    encode_editor_send,
} from '../../../src/console/editor-send-channel';

const SEND = encode_editor_send({ line: 'do "a.do"', file: '/tmp/a.do' });

describe('EditorSendDecoder', () => {
    it('splits sends from keys, in order', () => {
        const decoder = new EditorSendDecoder();
        expect(decoder.push(`di 9${SEND}\r`)).toEqual([
            { type: 'keys', text: 'di 9' },
            { type: 'send', send: { line: 'do "a.do"', file: '/tmp/a.do' } },
            { type: 'keys', text: '\r' },
        ]);
        expect(decoder.has_partial_start()).toBe(false);
    });

    it('reads a send split across chunks at any point', () => {
        for (let i = 1; i < SEND.length; i++) {
            const decoder = new EditorSendDecoder();
            const the_events = [
                ...decoder.push(`q${SEND.slice(0, i)}`),
                ...decoder.push(SEND.slice(i)),
            ];
            expect(the_events).toEqual([
                { type: 'keys', text: 'q' },
                { type: 'send', send: { line: 'do "a.do"', file: '/tmp/a.do' } },
            ]);
        }
    });

    it('gives back a lone Esc once it is clearly not a send', () => {
        const decoder = new EditorSendDecoder();
        expect(decoder.push('\x1b')).toEqual([]);
        expect(decoder.has_partial_start()).toBe(true);
        expect(decoder.flush_partial()).toEqual([{ type: 'keys', text: '\x1b' }]);
        // Arrow keys and other escape sequences pass straight through.
        expect(decoder.push('\x1b[A')).toEqual([{ type: 'keys', text: '\x1b[A' }]);
        expect(decoder.push('\x1b_x')).toEqual([{ type: 'keys', text: '\x1b_x' }]);
    });

    it('waits for the rest of a started send rather than flushing it', () => {
        const decoder = new EditorSendDecoder();
        expect(decoder.push(SEND.slice(0, 20))).toEqual([]);
        expect(decoder.has_partial_start()).toBe(false);
        expect(decoder.flush_partial()).toEqual([]);
        expect(decoder.push(SEND.slice(20))).toHaveLength(1);
    });

    it('drops a malformed send', () => {
        const decoder = new EditorSendDecoder();
        expect(decoder.push('\x1b_sight-send;{"line":1}\x1b\\x')).toEqual([
            { type: 'keys', text: 'x' },
        ]);
    });
});
