/**
 * Unit tests for the shared token-stream diagnostic helpers.
 */

import { describe, it, expect } from 'bun:test';
import { Range } from 'vscode-languageserver/node';
import { StataLexer } from '../../src/lexer';
import {
    collect_significant_tokens,
    is_diagnostic_range_ignored,
} from '../../src/providers/diagnostic-token-stream';

const lexer = new StataLexer();

describe('is_diagnostic_range_ignored', () => {
    it('hits a single-line range whose line is ignored', () => {
        expect(
            is_diagnostic_range_ignored(Range.create(3, 0, 3, 5), new Set([3]))
        ).toBe(true);
    });

    it('misses a single-line range whose line is not ignored', () => {
        expect(
            is_diagnostic_range_ignored(Range.create(3, 0, 3, 5), new Set([2, 4]))
        ).toBe(false);
    });

    it('hits a multi-line range when only an interior line is ignored', () => {
        expect(
            is_diagnostic_range_ignored(Range.create(1, 0, 4, 5), new Set([3]))
        ).toBe(true);
    });

    it('misses a multi-line range with no ignored line inside', () => {
        expect(
            is_diagnostic_range_ignored(Range.create(1, 0, 4, 5), new Set([0, 5]))
        ).toBe(false);
    });
});

describe('collect_significant_tokens', () => {
    it('drops the newline terminator swallowed by a /// continuation', () => {
        const { tokens } = lexer.tokenize('local x = 1 + ///\n    2\nlocal y');
        const the_significant = collect_significant_tokens(tokens);
        const the_terminators = the_significant.filter(
            (my_token) => my_token.type === 'STATEMENT_TERMINATOR'
        );
        // Only the real newline after `2` remains (no trailing newline
        // after `local y`, so no final terminator).
        expect(the_terminators.every((my_token) => my_token.value === '\n')).toBe(true);
        expect(the_terminators.length).toBe(1);
    });

    it('keeps a real ; terminator on the line after a /// (semicolon mode)', () => {
        // In `#delimit ;` mode the newline after `///` lexes as
        // WHITESPACE, so a `;` on the following line is a real
        // statement terminator — it must survive filtering, or two
        // statements merge in the significant stream.
        const { tokens } = lexer.tokenize(
            '#delimit ;\nlocal x = 1 ///\n;\nlocal y = 2 ;'
        );
        const the_significant = collect_significant_tokens(tokens);
        const the_semicolons = the_significant.filter(
            (my_token) =>
                my_token.type === 'STATEMENT_TERMINATOR' &&
                my_token.value === ';'
        );
        expect(the_semicolons.length).toBe(2);
    });
});
