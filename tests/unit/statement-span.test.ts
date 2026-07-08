/**
 * Unit tests for next_statement_line_span (issue #268 item 2).
 *
 * The span walk drives @lsp-ignore-next suppression: it must cover every
 * physical line of the next logical statement (including `///`-continued
 * lines and a `{` block-header line) without ever entering a block body.
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { next_statement_line_span } from '../../src/utils/statement-span';

const lexer = new StataLexer();

/**
 * Tokenize `source` and return the span of the statement following the
 * first COMMENT_LINE containing `@lsp-ignore-next`.
 */
function span_after_directive(source: string) {
    const { tokens } = lexer.tokenize(source);
    const my_directive_index = tokens.findIndex(
        (my_token) =>
            my_token.type === 'COMMENT_LINE' &&
            my_token.value.includes('@lsp-ignore-next')
    );
    expect(my_directive_index).toBeGreaterThanOrEqual(0);
    return next_statement_line_span(tokens, my_directive_index);
}

describe('next_statement_line_span', () => {
    it('spans a single-line statement', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\nlocal x = 1\nlocal y = 2'
        );
        expect(my_span).toEqual({ start_line: 1, end_line: 1 });
    });

    it('spans every line of a ///-continued statement', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\nlocal x = 1 + ///\n    2 + ///\n    3\nlocal y = 4'
        );
        expect(my_span).toEqual({ start_line: 1, end_line: 3 });
    });

    it('ends at a comment-only continued line (its newline is a real terminator)', () => {
        // `///` joins only the immediately following line. A line that is
        // all comment ends the statement at its own newline — the same
        // rule collect_significant_tokens applies — so the span covers
        // the joined comment line but not the code after it.
        const my_span = span_after_directive(
            '// @lsp-ignore-next\nlocal x = 1 + ///\n    // interior comment\n    2\nlocal y = 4'
        );
        expect(my_span).toEqual({ start_line: 1, end_line: 2 });
    });

    it('skips blank lines between the directive and the statement', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\n\n\nlocal x = 1'
        );
        expect(my_span).toEqual({ start_line: 3, end_line: 3 });
    });

    it('skips other comments between the directive and the statement', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\n// unrelated comment\nlocal x = 1'
        );
        expect(my_span).toEqual({ start_line: 2, end_line: 2 });
    });

    it('stops at a { block header and never enters the body', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\nif a == 1 {\n    display b\n}'
        );
        expect(my_span).toEqual({ start_line: 1, end_line: 1 });
    });

    it('covers a ///-continued block header up to the {', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\nif a == 1 & ///\n    b == 2 {\n    display c\n}'
        );
        expect(my_span).toEqual({ start_line: 1, end_line: 2 });
    });

    it('spans a multi-line statement under #delimit ;', () => {
        const my_span = span_after_directive(
            '#delimit ;\n// @lsp-ignore-next\nlocal x = 1 +\n    2 +\n    3 ;\nlocal y = 4 ;'
        );
        expect(my_span).toEqual({ start_line: 2, end_line: 4 });
    });

    it('skips embedded-block blank-line whitespace under #delimit ;', () => {
        const my_span = span_after_directive(
            '#delimit ;\nmata:\n// @lsp-ignore-next\n\nx = 1;\nend\n#delimit cr'
        );
        expect(my_span?.start_line).toBe(4);
    });

    it('ends at a real ; terminator on the line after a /// (semicolon mode)', () => {
        // In `#delimit ;` mode the newline after `///` lexes as
        // WHITESPACE, so a `;` on the following line is a REAL
        // terminator — it must end the statement, not be swallowed as
        // the continuation's newline (which only ever lexes as '\n').
        const my_span = span_after_directive(
            '#delimit ;\n// @lsp-ignore-next\nlocal x = 1 ///\n;\ndisplay $undef ;'
        );
        expect(my_span).toEqual({ start_line: 2, end_line: 3 });
    });

    it('skips a #delimit mode switch between directive and statement', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\n#delimit ;\nlocal x = 1 ;'
        );
        expect(my_span).toEqual({ start_line: 2, end_line: 2 });
    });

    it('returns undefined when only EOF follows', () => {
        const my_span = span_after_directive('// @lsp-ignore-next\n');
        expect(my_span).toBeUndefined();
    });

    it('spans a lone } as a single-line statement', () => {
        const my_span = span_after_directive(
            'if a == 1 {\n    display b\n// @lsp-ignore-next\n}'
        );
        expect(my_span).toEqual({ start_line: 3, end_line: 3 });
    });

    it('stops at a mata block header and never enters the body', () => {
        const my_span = span_after_directive(
            '// @lsp-ignore-next\nmata:\n    x = 1 < 2 < 3\nend'
        );
        expect(my_span).toEqual({ start_line: 1, end_line: 1 });
    });
});
