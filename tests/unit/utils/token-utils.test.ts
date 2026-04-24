/**
 * Unit tests for token-utils binary search helpers.
 */

import { describe, it, expect } from 'bun:test';
import { Token } from '../../../src/types';
import {
    find_last_token_starting_at_or_before,
    find_last_token_starting_before,
    find_token_index_at_position,
} from '../../../src/utils/token-utils';

/**
 * Helper to build a simple single-line token list from (value, type) pairs,
 * laying tokens out consecutively with no gaps.
 */
function build_tokens(
    the_parts: Array<{ value: string; type: Token['type'] }>,
    line: number = 0
): Token[] {
    const the_tokens: Token[] = [];
    let char = 0;
    for (const my_part of the_parts) {
        the_tokens.push({
            type: my_part.type,
            value: my_part.value,
            range: {
                start: { line, character: char },
                end: { line, character: char + my_part.value.length },
            },
        });
        char += my_part.value.length;
    }
    return the_tokens;
}

describe('token-utils', () => {
    describe('find_last_token_starting_at_or_before', () => {
        it('returns -1 for empty token arrays', () => {
            const index = find_last_token_starting_at_or_before(
                [],
                { line: 0, character: 0 }
            );
            expect(index).toBe(-1);
        });

        it('returns -1 when all tokens start after the position', () => {
            // tokens start at column 5
            const the_tokens = build_tokens(
                [{ value: 'hello', type: 'WORD' }]
            );
            the_tokens[0].range.start.character = 5;
            the_tokens[0].range.end.character = 10;
            const index = find_last_token_starting_at_or_before(
                the_tokens,
                { line: 0, character: 0 }
            );
            expect(index).toBe(-1);
        });

        it('returns the last token starting at or before the cursor', () => {
            // `ab cd` → tokens: WORD 'ab' [0,2), WS ' ' [2,3), WORD 'cd' [3,5)
            const the_tokens = build_tokens([
                { value: 'ab', type: 'WORD' },
                { value: ' ', type: 'WHITESPACE' },
                { value: 'cd', type: 'WORD' },
            ]);

            // Cursor inside 'ab' → returns index 0
            expect(
                find_last_token_starting_at_or_before(
                    the_tokens,
                    { line: 0, character: 1 }
                )
            ).toBe(0);
            // Cursor at boundary between 'ab' and ' ' → returns WS
            expect(
                find_last_token_starting_at_or_before(
                    the_tokens,
                    { line: 0, character: 2 }
                )
            ).toBe(1);
            // Cursor inside 'cd' → returns index 2
            expect(
                find_last_token_starting_at_or_before(
                    the_tokens,
                    { line: 0, character: 4 }
                )
            ).toBe(2);
        });
    });

    describe('find_last_token_starting_before', () => {
        it('returns -1 for empty token arrays', () => {
            const index = find_last_token_starting_before(
                [],
                { line: 0, character: 5 }
            );
            expect(index).toBe(-1);
        });

        it('returns -1 when the cursor is before the first token', () => {
            const the_tokens = build_tokens([
                { value: 'hello', type: 'WORD' },
            ]);
            const index = find_last_token_starting_before(
                the_tokens,
                { line: 0, character: 0 }
            );
            expect(index).toBe(-1);
        });

        it('excludes tokens starting exactly at the cursor', () => {
            // `ab cd` - cursor at column 3 (start of 'cd')
            const the_tokens = build_tokens([
                { value: 'ab', type: 'WORD' },
                { value: ' ', type: 'WHITESPACE' },
                { value: 'cd', type: 'WORD' },
            ]);
            // Position 3 is the start of 'cd'; tokens starting at the
            // cursor do not count, so the last token strictly before is WS.
            expect(
                find_last_token_starting_before(
                    the_tokens,
                    { line: 0, character: 3 }
                )
            ).toBe(1);
        });

        it('handles multi-line token layouts', () => {
            const the_tokens: Token[] = [
                {
                    type: 'WORD',
                    value: 'foo',
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 3 },
                    },
                },
                {
                    type: 'STATEMENT_TERMINATOR',
                    value: '\n',
                    range: {
                        start: { line: 0, character: 3 },
                        end: { line: 1, character: 0 },
                    },
                },
                {
                    type: 'WORD',
                    value: 'bar',
                    range: {
                        start: { line: 1, character: 0 },
                        end: { line: 1, character: 3 },
                    },
                },
            ];
            // Cursor at line 1, char 2 (inside 'bar')
            const index = find_last_token_starting_before(
                the_tokens,
                { line: 1, character: 2 }
            );
            expect(index).toBe(2);
            // Cursor at line 1, char 0 (start of 'bar') — 'bar' starts at
            // cursor so it is excluded; the terminator also starts at line
            // 0 char 3 which is before line 1 char 0, so it wins.
            expect(
                find_last_token_starting_before(
                    the_tokens,
                    { line: 1, character: 0 }
                )
            ).toBe(1);
        });
    });

    describe('find_token_index_at_position', () => {
        it('returns -1 for empty token arrays', () => {
            const index = find_token_index_at_position(
                [],
                { line: 0, character: 0 }
            );
            expect(index).toBe(-1);
        });

        it('returns the token whose range contains the cursor', () => {
            const the_tokens = build_tokens([
                { value: 'ab', type: 'WORD' },
                { value: ' ', type: 'WHITESPACE' },
                { value: 'cd', type: 'WORD' },
            ]);
            // Inside 'ab'
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 0 }
                )
            ).toBe(0);
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 1 }
                )
            ).toBe(0);
            // At column 2 (start of whitespace, end of 'ab')
            // LSP [start, end) — whitespace covers this
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 2 }
                )
            ).toBe(1);
            // Inside 'cd'
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 3 }
                )
            ).toBe(2);
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 4 }
                )
            ).toBe(2);
        });

        it('returns -1 when the cursor is past the last token', () => {
            const the_tokens = build_tokens([
                { value: 'ab', type: 'WORD' },
            ]);
            // Column 2 is the end of 'ab' (exclusive in LSP semantics)
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 2 }
                )
            ).toBe(-1);
            expect(
                find_token_index_at_position(
                    the_tokens,
                    { line: 0, character: 10 }
                )
            ).toBe(-1);
        });

        it('scales to large token arrays via binary search', () => {
            // Build a sparse token array with 10k entries; every
            // token is one character wide with a one-character gap.
            const the_tokens: Token[] = [];
            const TOKEN_COUNT = 10_000;
            for (let i = 0; i < TOKEN_COUNT; i++) {
                the_tokens.push({
                    type: 'WORD',
                    value: 'x',
                    range: {
                        start: { line: 0, character: i * 2 },
                        end: { line: 0, character: i * 2 + 1 },
                    },
                });
            }

            // Cursor in the middle of the last token
            const last_index = find_token_index_at_position(
                the_tokens,
                { line: 0, character: (TOKEN_COUNT - 1) * 2 }
            );
            expect(last_index).toBe(TOKEN_COUNT - 1);

            // Cursor in a gap between tokens — not covered by any token
            const gap_index = find_token_index_at_position(
                the_tokens,
                { line: 0, character: 5 }
            );
            expect(gap_index).toBe(-1);

            // Cursor before any token
            const before_index = find_token_index_at_position(
                the_tokens,
                { line: 0, character: -1 }
            );
            expect(before_index).toBe(-1);
        });
    });
});
