/**
 * Unit tests for next_statement_line_span (issue #268 item 2).
 *
 * The span walk drives @lsp-ignore-next suppression: it must cover every
 * physical line of the next logical statement (including `///`-continued
 * lines and a `{` block-header line) without ever entering a block body.
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import {
    next_statement_line_span,
    inline_embedded_statement_end,
} from '../../src/utils/statement-span';
import { StataParser } from '../../src/parser';

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

/**
 * inline_embedded_statement_end (issue #309): computes the physical end
 * line of an inline `mata:`/`python:` statement so the context tracker can
 * report the embedded language on `#delimit ;` continuation lines. It must
 * agree with the parser's embedded_block span (the governing principle).
 */
function opener_index(tokens: ReturnType<StataLexer['tokenize']>['tokens']) {
    const my_index = tokens.findIndex(
        (my_token) =>
            my_token.type === 'MATA_INLINE' ||
            my_token.type === 'PYTHON_INLINE'
    );
    expect(my_index).toBeGreaterThanOrEqual(0);
    return my_index;
}

/**
 * The parser's single-line embedded_block range.end.line is the ground
 * truth the helper must match.
 */
function parser_inline_end_line(source: string): number {
    const { tokens } = lexer.tokenize(source);
    const my_parse = new StataParser().parse(tokens);
    let my_end_line = -1;
    const my_seen = new WeakSet<object>();
    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (my_seen.has(node as object)) {
            return;
        }
        my_seen.add(node as object);
        const my_node = node as Record<string, unknown>;
        if (
            my_node.type === 'embedded_block' &&
            my_node.is_single_line === true
        ) {
            const my_range = my_node.range as {
                end: { line: number };
            };
            my_end_line = my_range.end.line;
        }
        for (const my_key of Object.keys(my_node)) {
            const my_value = my_node[my_key];
            if (Array.isArray(my_value)) {
                my_value.forEach(walk);
            } else if (my_value && typeof my_value === 'object') {
                walk(my_value);
            }
        }
    };
    walk(my_parse.ast);
    return my_end_line;
}

describe('inline_embedded_statement_end', () => {
    it('spans to the ; terminator line for a #delimit ; multiline mata', () => {
        const my_source = '#delimit ;\nmata: st_local("b",\n"2");\n#delimit cr\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(2);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
        // end_index consumes the ; terminator.
        expect(tokens[my_end.end_index].type).toBe('STATEMENT_TERMINATOR');
        expect(tokens[my_end.end_index].value).toBe(';');
    });

    it('spans to the ; terminator line for a #delimit ; multiline python', () => {
        const my_source = '#delimit ;\npython: x = (1 +\n2);\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(2);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
    });

    it('ends on the opener line for a cr single-line inline (unchanged)', () => {
        const my_source = 'mata: st_local("b", "2")\ndisplay 1\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(0);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
    });

    it('ends on the opener line for a ; inline terminating on that line', () => {
        const my_source = '#delimit ;\nmata: foo() ;\ndisplay 1 ;\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(1);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
    });

    it('bounds an unterminated inline at EOF (no file swallow)', () => {
        const my_source = '#delimit ;\nmata: st_local("b",\n"2")';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(2);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
        // end_index must not run past the final token index.
        expect(my_end.end_index).toBeLessThan(tokens.length);
    });

    it('matches the parser when #delimit cr appears before the terminator', () => {
        const my_source = '#delimit ;\nmata: foo(\n#delimit cr\ndisplay 1\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(2);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
    });

    it('ends on the opener line for a cr /// continued inline (matches parser)', () => {
        const my_source = 'mata: st_local("b", ///\n"2")\ndisplay 1\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(0);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
    });

    it('spans a multi-line /* */ block comment inside a cr inline (matches parser)', () => {
        const my_source = 'mata: st_local("a", /* c\n*/ "1")\ndisplay 1\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_end = inline_embedded_statement_end(
            tokens,
            opener_index(tokens)
        );
        expect(my_end.end_line).toBe(1);
        expect(my_end.end_line).toBe(parser_inline_end_line(my_source));
    });

    it('consumes a trailing same-line embedded opener after the terminator', () => {
        // `"2"); python: x = 1;` — the trailing python: on the terminator
        // line must be swallowed into the mata whole-line span so it cannot
        // spawn a second, overlapping context range.
        const my_source =
            '#delimit ;\nmata: st_local("b",\n"2"); python: x = 1;\n';
        const { tokens } = lexer.tokenize(my_source);
        const my_opener = opener_index(tokens);
        const my_end = inline_embedded_statement_end(tokens, my_opener);
        expect(my_end.end_line).toBe(2);
        // Every remaining token on line 2 (including the trailing PYTHON_INLINE)
        // is consumed: no token after end_index starts on line 2.
        const my_next = tokens[my_end.end_index + 1];
        if (my_next && my_next.type !== 'EOF') {
            expect(my_next.range.start.line).toBeGreaterThan(2);
        }
    });
});
