/**
 * Property Tests: Block Comment Indentation Exclusion
 *
 * Feature: block-comment-indentation-false-positive
 * Property 1: Block comment line exclusion
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * For any Stata source code containing a block comment with any content and
 * any indentation pattern, the IndentationDiagnosticAnalyzer should produce
 * zero indentation diagnostics for lines that are inside the block comment
 * boundaries.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataDiagnosticCode } from '../../src/types';
import {
    indentation_codes_by_line,
    indentation_diagnostics,
    with_line_indent,
} from './helpers/indentation-test-utils';

/**
 * The line numbers a block comment occupies when its first line is
 * line `first_line` of the document.
 */
function block_comment_lines(first_line: number, block_comment: string): Set<number> {
    const the_lines = new Set<number>();
    const line_count = block_comment.split('\n').length;
    for (let i = 0; i < line_count; i++) {
        the_lines.add(first_line + i);
    }
    return the_lines;
}

describe('Block Comment Indentation Exclusion Property Tests', () => {
    it('excludes lines between an inner block close and the outer block close', () => {
        const my_source = [
            '/* outer',
            '/* inner */',
            'display "commented but not indented"',
            '*/',
            'if 1 {',
            'display "live and not indented"',
            '}',
        ].join('\n');
        const my_codes = indentation_codes_by_line(my_source);

        // Line 2 is still inside the outer comment: no diagnostic,
        // however it is indented.
        expect(my_codes.has(2)).toBe(false);
        expect(indentation_codes_by_line(
            with_line_indent(my_source, 2, 8)
        ).has(2)).toBe(false);
        // Line 4 is live code again: indenting it is reported.
        expect(indentation_codes_by_line(
            with_line_indent(my_source, 4, 4)
        ).get(4)).toBe(StataDiagnosticCode.UNNECESSARY_INDENTATION);
        expect(my_codes.get(5)).toBe(StataDiagnosticCode.MISSING_INDENTATION);
    });

    it('does not treat /* inside a string literal as a block comment', () => {
        // The `/*` sequences live inside a string, not a comment, so
        // no line is inside a block comment and the unindented live
        // `display` must still be flagged.
        const my_source = [
            'display "/* outer /* inner */"',
            'if 1 {',
            'display "live and not indented"',
            '}',
        ].join('\n');
        const my_codes = indentation_codes_by_line(my_source);

        expect(indentation_codes_by_line(
            with_line_indent(my_source, 1, 4)
        ).get(1)).toBe(StataDiagnosticCode.UNNECESSARY_INDENTATION);
        expect(my_codes.get(2)).toBe(StataDiagnosticCode.MISSING_INDENTATION);
    });

    it('excludes lines inside a multi-line star-led comment span', () => {
        // A line-leading `*` comment that absorbs an unclosed `/*` is
        // lexed as one multi-line COMMENT_LINE token; its inside lines
        // must be excluded from indentation checks too.
        const my_source = [
            'if 1 {',
            '* /* outer',
            'display "commented and not indented"',
            '*/',
            '}',
        ].join('\n');
        // Unindented inside `if 1 {`, line 2 would be MISSING_INDENTATION
        // were it live; indented two levels, UNNECESSARY_INDENTATION.
        expect(indentation_codes_by_line(my_source).has(2)).toBe(false);
        expect(indentation_codes_by_line(
            with_line_indent(my_source, 2, 8)
        ).has(2)).toBe(false);
    });

    // Generator for random block comment content lines (without /* or */)
    const arbitrary_comment_line = fc.oneof(
        // Line starting with asterisk (common style)
        fc.string({ minLength: 0, maxLength: 30 }).map(s => `* ${s.replace(/[/*]/g, '')}`),
        // Line NOT starting with asterisk (the bug case)
        fc.string({ minLength: 0, maxLength: 30 }).map(s => s.replace(/[/*]/g, '')),
        // Indented line
        fc.tuple(
            fc.integer({ min: 0, max: 8 }),
            fc.string({ minLength: 0, maxLength: 20 })
        ).map(([indent, s]) => ' '.repeat(indent) + s.replace(/[/*]/g, '')),
        // Empty line
        fc.constant('')
    );

    // Generator for block comment with varying content
    const arbitrary_block_comment = fc.array(arbitrary_comment_line, { minLength: 1, maxLength: 5 })
        .map(the_lines => `/*\n${the_lines.join('\n')}\n*/`);

    // Generator for valid Stata code (simple statements)
    const arbitrary_stata_statement = fc.constantFrom(
        'display "hello"',
        'gen x = 1',
        'local y = 2',
        'replace x = 2',
        'summarize x',
        'regress y x'
    );

    /**
     * Feature: block-comment-indentation-false-positive, Property 1: Block comment line exclusion
     * Validates: Requirements 1.1, 1.2, 1.3
     *
     * For any Stata source code containing a block comment with any content and
     * any indentation pattern, the IndentationDiagnosticAnalyzer should produce
     * zero indentation diagnostics for lines that are inside the block comment
     * boundaries.
     */
    it('Property 1: Block comment lines should never produce indentation diagnostics', () => {
        fc.assert(
            fc.property(
                arbitrary_block_comment,
                (my_block_comment) => {
                    const my_indentation_diagnostics =
                        indentation_diagnostics(my_block_comment);

                    // Should have zero indentation diagnostics for block comment content
                    return my_indentation_diagnostics.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 1: Block comment line exclusion
     * Validates: Requirements 1.1, 1.2, 1.3
     *
     * Block comments with code before and after should not produce diagnostics
     * for lines inside the block comment.
     */
    it('Property 1: Block comment surrounded by code should not produce diagnostics for comment lines', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_stata_statement,
                    arbitrary_block_comment,
                    arbitrary_stata_statement
                ),
                ([my_before, my_block_comment, my_after]) => {
                    const my_source = `${my_before}\n${my_block_comment}\n${my_after}`;
                    const my_diagnostics = indentation_diagnostics(my_source);

                    // The block comment starts on line 1
                    const my_block_comment_lines =
                        block_comment_lines(1, my_block_comment);

                    // Check that no diagnostics are on block comment lines
                    for (const my_diag of my_diagnostics) {
                        const my_diag_line = my_diag.range.start.line;
                        if (my_block_comment_lines.has(my_diag_line)) {
                            // Found a diagnostic on a block comment line - this is a failure
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 1: Block comment line exclusion
     * Validates: Requirements 1.1, 1.2, 1.3
     *
     * Block comments with lines that don't start with asterisk should not
     * trigger false positives (the original bug case).
     */
    it('Property 1: Block comment with non-asterisk lines should not trigger false positives', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    fc.string({ minLength: 1, maxLength: 20 }).map(s => s.replace(/[/*\n]/g, '')),
                    fc.integer({ min: 0, max: 8 }),
                    fc.string({ minLength: 1, maxLength: 20 }).map(s => s.replace(/[/*\n]/g, ''))
                ),
                ([my_asterisk_content, my_indent, my_non_asterisk_content]) => {
                    // Create the specific bug case: asterisk line followed by non-asterisk line
                    const my_source = `/*
* ${my_asterisk_content}
${' '.repeat(my_indent)}${my_non_asterisk_content}
*/`;
                    const my_indentation_diagnostics =
                        indentation_diagnostics(my_source);

                    // Should have zero indentation diagnostics
                    return my_indentation_diagnostics.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 1: Block comment line exclusion
     * Validates: Requirements 1.1, 1.2, 1.3
     *
     * Multiple block comments in a file should all be excluded from indentation checks.
     */
    it('Property 1: Multiple block comments should all be excluded from indentation checks', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_block_comment,
                    arbitrary_stata_statement,
                    arbitrary_block_comment
                ),
                ([my_comment1, my_code, my_comment2]) => {
                    const my_source = `${my_comment1}\n${my_code}\n${my_comment2}`;
                    const my_diagnostics = indentation_diagnostics(my_source);

                    // The first comment starts on line 0, the second on
                    // the line after the statement that follows it
                    const my_first_comment_lines = block_comment_lines(0, my_comment1);
                    const my_block_comment_lines = new Set([
                        ...my_first_comment_lines,
                        ...block_comment_lines(my_first_comment_lines.size + 1, my_comment2),
                    ]);

                    // Check that no diagnostics are on block comment lines
                    for (const my_diag of my_diagnostics) {
                        const my_diag_line = my_diag.range.start.line;
                        if (my_block_comment_lines.has(my_diag_line)) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 1: Block comment line exclusion
     * Validates: Requirements 1.1, 1.2, 1.3
     *
     * Single-line block comments should also be excluded.
     */
    it('Property 1: Single-line block comments should be excluded from indentation checks', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 30 }).map(s => s.replace(/[/*\n]/g, '')),
                (my_content) => {
                    const my_source = `/* ${my_content} */`;
                    const my_indentation_diagnostics =
                        indentation_diagnostics(my_source);

                    return my_indentation_diagnostics.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});
