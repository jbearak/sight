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

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';

/**
 * Create a DocumentState for indentation analysis with proper AST.
 * The IndentationDiagnosticAnalyzer needs content, context_tracker, and AST
 * for depth-based indentation analysis.
 */
function create_document_for_indentation(content: string): DocumentState {
    const the_line_offsets: number[] = [];
    let my_offset = 0;
    for (const my_line of content.split('\n')) {
        the_line_offsets.push(my_offset);
        my_offset += my_line.length + 1;
    }

    // Parse the content to get proper AST for depth computation
    const my_lexer = new StataLexer();
    const my_parser = new StataParser();
    const my_lex_result = my_lexer.tokenize(content);
    const my_parse_result = my_parser.parse(my_lex_result.tokens);
    
    const my_context_tracker = new ContextTracker();
    my_context_tracker.initialize_from_tokens(my_lex_result.tokens);

    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        tokens: my_lex_result.tokens,
        ast: my_parse_result.ast,
        symbols: {
            localMacros: new Map(),
            globalMacros: new Map(),
            programs: new Map(),
            scalars: new Map(),
            matrices: new Map(),
            variables: new Map()
        },
        diagnostics: [],
        context_tracker: my_context_tracker,
        context_ranges: [],
        line_offsets: the_line_offsets,
        forward_calls: []
    };
}

const config: StataLSPConfig = {
    diagnostics: {
        enabled: true,
        indentation: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint'
        },
    },
    adoPaths: [],
    cross_file: {
        index_workspace: true,
        max_indexed_files: 1000,
        assume_call_site: 'end',
        max_backward_depth: 10,
        max_forward_depth: 10,
        max_chain_depth: 20,
        auto_detect_forward_calls: true
    }
};

describe('Post-Block-Comment Diagnostic Resumption Property Tests', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Get the line numbers that are inside the block comment
                    const the_lines = my_source.split('\n');
                    const my_block_comment_lines = analyzer.compute_block_comment_lines(the_lines);

                    // Find the line with "display" - it should be after the block comment
                    const my_display_line_index = the_lines.findIndex(l => l.includes('display "not indented"'));

                    // The display line should NOT be in a block comment
                    if (my_block_comment_lines.has(my_display_line_index)) {
                        // Something is wrong with our test setup
                        return false;
                    }

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Get the line numbers that are inside the block comment
                    const the_lines = my_source.split('\n');
                    const my_block_comment_lines = analyzer.compute_block_comment_lines(the_lines);

                    // Find the line with "display" - it should be after the block comment
                    const my_display_line_index = the_lines.findIndex(l => l.includes('display "properly indented"'));

                    // The display line should NOT be in a block comment
                    if (my_block_comment_lines.has(my_display_line_index)) {
                        return false;
                    }

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Get the line numbers that are inside block comments
                    const the_lines = my_source.split('\n');
                    const my_block_comment_lines = analyzer.compute_block_comment_lines(the_lines);

                    // Find the lines with display statements
                    const my_first_display_index = the_lines.findIndex(l => l.includes('first block - properly indented'));
                    const my_second_display_index = the_lines.findIndex(l => l.includes('second block - not indented'));

                    // Both display lines should NOT be in block comments
                    if (my_block_comment_lines.has(my_first_display_index) ||
                        my_block_comment_lines.has(my_second_display_index)) {
                        return false;
                    }

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Get the line numbers that are inside the block comment
                    const the_lines = my_source.split('\n');
                    const my_block_comment_lines = analyzer.compute_block_comment_lines(the_lines);

                    // Find the line with "display"
                    const my_display_line_index = the_lines.findIndex(l => l.includes('display "unnecessarily indented'));

                    // The display line should NOT be in a block comment
                    if (my_block_comment_lines.has(my_display_line_index)) {
                        return false;
                    }

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
