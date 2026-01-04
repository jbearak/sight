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
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { DocumentState } from '../../src/document-store';
import { ContextTracker } from '../../src/context-tracker';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';

/**
 * Create a minimal DocumentState for indentation analysis.
 * The IndentationDiagnosticAnalyzer only needs content and context_tracker.
 */
function create_document_for_indentation(content: string): DocumentState {
    const the_line_offsets: number[] = [];
    let my_offset = 0;
    for (const my_line of content.split('\n')) {
        the_line_offsets.push(my_offset);
        my_offset += my_line.length + 1;
    }

    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        tokens: [],
        ast: null,
        symbols: {
            localMacros: new Map(),
            globalMacros: new Map(),
            programs: new Map(),
            scalars: new Map(),
            matrices: new Map(),
            variables: new Map()
        },
        diagnostics: [],
        context_tracker: new ContextTracker(),
        line_offsets: the_line_offsets
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
        undefinedVariableEnabled: false
    },
    adoPaths: [],
    cross_file: {
        index_workspace: true,
        max_indexed_files: 1000,
        assume_call_site: false,
        max_backward_depth: 10,
        max_forward_depth: 10,
        max_chain_depth: 20,
        auto_detect_forward_calls: true
    }
};

describe('Block Comment Indentation Exclusion Property Tests', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();

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
                    const my_document = create_document_for_indentation(my_block_comment);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Filter for indentation-related diagnostics
                    const my_indentation_diagnostics = my_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Get the line numbers that are inside the block comment
                    const the_lines = my_source.split('\n');
                    const my_block_comment_lines = analyzer.compute_block_comment_lines(the_lines);

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Filter for indentation-related diagnostics
                    const my_indentation_diagnostics = my_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Get the line numbers that are inside block comments
                    const the_lines = my_source.split('\n');
                    const my_block_comment_lines = analyzer.compute_block_comment_lines(the_lines);

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
                    const my_document = create_document_for_indentation(my_source);
                    const my_diagnostics = analyzer.analyze(my_document, config);

                    // Filter for indentation-related diagnostics
                    const my_indentation_diagnostics = my_diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

                    return my_indentation_diagnostics.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});
