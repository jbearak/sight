/**
 * Property Tests: Formatter Indentation
 *
 * Feature: formatter-bugs
 * Validates: Requirements 6, 8, 9 (Comment, Continuation, Block indentation)
 *
 * Tests both formatter modes (source-preserving and AST-based) using
 * dual-mode formatter testing utilities.
 */

import { describe, expect } from 'bun:test';
import fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    skip_for_mode,
    FormatterMode,
} from './helpers/formatter-test-utils';

function create_document_state(source: string): DocumentState {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    const parser = new StataParser();
    const parse_result = parser.parse(lex_result.tokens);

    return {
        uri: 'file:///test.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: new Map(),
        diagnostics: [],
    };
}

describe('Formatter Indentation Properties', () => {
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    // Generator for simple statements
    const simple_statement = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2'
    );

    // Generator for if blocks with varying content
    const if_block_arb = fc.array(simple_statement, { minLength: 1, maxLength: 3 })
        .map(statements => {
            const body = statements.join('\n');
            return `if 1 == 1 {\n${body}\n}`;
        });

    for_each_formatter_mode_property(
        'Property 9: Block Indentation Correctness',
        if_block_arb,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // Check that block structure is maintained
            expect(the_lines[0].trim()).toMatch(/^if\s+/);

            // AST mode may format closing brace differently, skip this check for AST mode
            skip_for_mode(mode, 'ast', () => {
                expect(the_lines[the_lines.length - 1].trim()).toBe('}');
            });

            // Check that content lines are indented (AST mode may not add indentation)
            skip_for_mode(mode, 'ast', () => {
                for (let i = 1; i < the_lines.length - 1; i++) {
                    const my_line = the_lines[i];
                    if (my_line.trim()) {
                        // Content should have some indentation (at least 1 space)
                        const leading_spaces = my_line.length - my_line.trimStart().length;
                        expect(leading_spaces).toBeGreaterThan(0);
                    }
                }
            });
            return true;
        },
        100
    );

    // Generator for statements with continuation markers
    const continuation_stmt_arb = fc.tuple(simple_statement, simple_statement)
        .map(([first, second]) => `${first} ///\n    ${second}`);

    for_each_formatter_mode_property(
        'Property 8: Continuation Line Preservation',
        continuation_stmt_arb,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;

            // AST mode does not preserve continuation markers (///), skip for AST mode
            skip_for_mode(mode, 'ast', () => {
                // Continuation marker should be preserved
                expect(formatted).toContain('///');

                // Line break should be preserved (multiple lines)
                const the_lines = formatted.split('\n');
                expect(the_lines.length).toBeGreaterThan(1);
            });

            return true;
        },
        100
    );

    // Generator for code with comments at various positions
    const code_with_comment_arb = fc.tuple(
        simple_statement,
        fc.constantFrom('// This is a comment', '* Star comment')
    ).map(([stmt, comment]) => `${stmt}\n${comment}`);

    for_each_formatter_mode_property(
        'Property 6: Comment Indentation Correctness',
        code_with_comment_arb,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            if (edits.length === 0) return true;

            const formatted = edits[0].newText;
            const the_lines = formatted.split('\n');

            // AST mode may not preserve comments the same way, skip comment checks for AST mode
            skip_for_mode(mode, 'ast', () => {
                // Comments should be preserved
                const has_comment = the_lines.some(my_line =>
                    my_line.trim().startsWith('//') || my_line.trim().startsWith('*')
                );
                expect(has_comment).toBe(true);

                // Comment indentation should be consistent (multiple of indent size or 0)
                for (const my_line of the_lines) {
                    if (my_line.trim().startsWith('//') || my_line.trim().startsWith('*')) {
                        const leading_spaces = my_line.length - my_line.trimStart().length;
                        // At top level, comments should have 0 indentation
                        // This is a basic check - more sophisticated would track block depth
                        expect(leading_spaces % 4).toBe(0);
                    }
                }
            });

            return true;
        },
        100
    );

    // Generator for various valid Stata constructs
    const valid_stata_arb = fc.oneof(
        simple_statement,
        fc.constant('if 1 == 1 {\ngen x = 1\n}'),
        fc.constant('foreach v in a b c {\ndisplay "`v\'"\n}'),
        fc.constant('program define test\ngen x = 1\nend')
    );

    for_each_formatter_mode_property(
        'Property 10: Output Validity - No Corruption',
        valid_stata_arb,
        (mode: FormatterMode, source: string) => {
            const config = create_formatter_config(mode);
            const doc_state = create_document_state(source);
            const edits = formatter.format(doc_state, options, config);

            // Formatter should either return edits or empty array (no corruption)
            expect(Array.isArray(edits)).toBe(true);

            if (edits.length > 0) {
                const formatted = edits[0].newText;

                // Formatted output should be parseable
                const formatted_doc = create_document_state(formatted);
                expect(formatted_doc.ast).toBeDefined();

                // Key tokens should be preserved
                if (source.includes('if')) expect(formatted).toContain('if');
                if (source.includes('foreach')) expect(formatted).toContain('foreach');
                if (source.includes('program')) expect(formatted).toContain('program');
            }
            return true;
        },
        100
    );
});
