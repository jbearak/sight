/**
 * Property Tests: Post-Block-Comment Diagnostic Resumption
 *
 * Feature: block-comment-indentation-false-positive
 * Property 2: Post-block-comment diagnostic resumption
 * Validates: Requirements 1.4
 *
 * For any Stata source code where a block comment is followed by code with
 * intentional indentation issues, the IndentationDiagnosticAnalyzer should
 * produce appropriate diagnostics for the code lines after the block comment
 * closes.
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { StataDiagnosticCode } from '../../src/types';
import { indentation_diagnostics } from './helpers/indentation-test-utils';

describe('Post-Block-Comment Diagnostic Resumption Property Tests', () => {
    // Generator for random block comment content lines (without /* or */)
    const arbitrary_comment_line = fc.oneof(
        // Line starting with asterisk (common style)
        fc.string({ minLength: 0, maxLength: 30 }).map(s => `* ${s.replace(/[/*]/g, '')}`),
        // Line NOT starting with asterisk
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

    /**
     * Feature: block-comment-indentation-false-positive, Property 2: Post-block-comment diagnostic resumption
     * Validates: Requirements 1.4
     *
     * For any Stata source code where a block comment is followed by code with
     * intentional indentation issues (code inside braces not indented), the
     * IndentationDiagnosticAnalyzer should produce appropriate diagnostics for
     * the code lines after the block comment closes.
     */
    it('Property 2: Diagnostics should resume after block comment closes for code with missing indentation', () => {
        fc.assert(
            fc.property(
                arbitrary_block_comment,
                (my_block_comment) => {
                    // Create code with intentional indentation issue after block comment:
                    // An if block where the inner code is NOT indented (should trigger diagnostic)
                    const my_source = `${my_block_comment}
if 1 {
display "not indented"
}`;
                    const my_diagnostics = indentation_diagnostics(my_source);

                    // The display line is the second line after the
                    // block comment's closing `*/`
                    const my_display_line_index = my_block_comment.split('\n').length + 1;

                    // Filter for indentation-related diagnostics
                    const my_indentation_diagnostics = my_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

                    // Should have at least one diagnostic for the unindented line inside braces
                    // The diagnostic should be on the display line (after the block comment)
                    const my_has_diagnostic_on_display_line = my_indentation_diagnostics.some(
                        d => d.range.start.line === my_display_line_index
                    );

                    return my_has_diagnostic_on_display_line;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 2: Post-block-comment diagnostic resumption
     * Validates: Requirements 1.4
     *
     * Code after a block comment that is properly indented should not produce
     * diagnostics, demonstrating that normal checking resumes correctly.
     */
    it('Property 2: Properly indented code after block comment should not produce diagnostics', () => {
        fc.assert(
            fc.property(
                arbitrary_block_comment,
                (my_block_comment) => {
                    // Create code with PROPER indentation after block comment
                    const my_source = `${my_block_comment}
if 1 {
    display "properly indented"
}`;
                    const my_diagnostics = indentation_diagnostics(my_source);

                    // The display line is the second line after the
                    // block comment's closing `*/`
                    const my_display_line_index = my_block_comment.split('\n').length + 1;

                    // Filter for indentation-related diagnostics on the display line
                    const my_diagnostics_on_display = my_diagnostics.filter(
                        d => (d.code === StataDiagnosticCode.MISSING_INDENTATION ||
                              d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION) &&
                             d.range.start.line === my_display_line_index
                    );

                    // Should have NO diagnostics on the properly indented line
                    return my_diagnostics_on_display.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 2: Post-block-comment diagnostic resumption
     * Validates: Requirements 1.4
     *
     * Multiple block comments followed by code should all correctly resume
     * diagnostic checking after each block comment.
     */
    it('Property 2: Multiple block comments should each correctly resume diagnostics after closing', () => {
        fc.assert(
            fc.property(
                fc.tuple(arbitrary_block_comment, arbitrary_block_comment),
                ([my_comment1, my_comment2]) => {
                    // Create code with two block comments, each followed by code
                    // First block followed by properly indented code
                    // Second block followed by improperly indented code
                    const my_source = `${my_comment1}
if 1 {
    display "first block - properly indented"
}
${my_comment2}
if 1 {
display "second block - not indented"
}`;
                    const my_diagnostics = indentation_diagnostics(my_source);

                    // The display lines are each the second line after
                    // a block comment's closing `*/`
                    const my_first_display_index = my_comment1.split('\n').length + 1;
                    const my_second_display_index =
                        my_first_display_index + 2 + my_comment2.split('\n').length + 1;

                    // Filter for indentation diagnostics
                    const my_indentation_diagnostics = my_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

                    // Should have NO diagnostic on the first (properly indented) display line
                    const my_has_diagnostic_on_first = my_indentation_diagnostics.some(
                        d => d.range.start.line === my_first_display_index
                    );

                    // Should have a diagnostic on the second (improperly indented) display line
                    const my_has_diagnostic_on_second = my_indentation_diagnostics.some(
                        d => d.range.start.line === my_second_display_index
                    );

                    return !my_has_diagnostic_on_first && my_has_diagnostic_on_second;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Feature: block-comment-indentation-false-positive, Property 2: Post-block-comment diagnostic resumption
     * Validates: Requirements 1.4
     *
     * Comment indentation issues after block comments should also be detected.
     */
    it('Property 2: Comment indentation issues after block comment should be detected', () => {
        fc.assert(
            fc.property(
                arbitrary_block_comment,
                fc.integer({ min: 4, max: 12 }),
                (my_block_comment, my_indent) => {
                    // Create code with a line comment followed by unnecessarily indented code
                    // after a block comment
                    const my_source = `${my_block_comment}
* This is a comment
${' '.repeat(my_indent)}display "unnecessarily indented after comment"`;
                    const my_diagnostics = indentation_diagnostics(my_source);

                    // The display line is the second line after the
                    // block comment's closing `*/`
                    const my_display_line_index = my_block_comment.split('\n').length + 1;

                    // Filter for unnecessary indentation diagnostics
                    const my_unnecessary_indent_diagnostics = my_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );

                    // Should have a diagnostic on the unnecessarily indented line
                    const my_has_diagnostic = my_unnecessary_indent_diagnostics.some(
                        d => d.range.start.line === my_display_line_index
                    );

                    return my_has_diagnostic;
                }
            ),
            { numRuns: 100 }
        );
    });
});
