/**
 * Property Tests: No False Positive When Visual Width Equals Expected
 *
 * Feature: mixed-whitespace-indentation-fix
 * Property 2: No False Positive When Visual Width Equals Expected
 * Validates: Requirements 1.2, 1.4
 *
 * Tests that the IndentationDiagnosticAnalyzer does NOT emit unnecessary
 * indentation diagnostics when mixed whitespace produces the correct visual width.
 */

import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

describe('No False Positive Visual Width Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();

    const default_config: StataLSPConfig = {
        ...DEFAULT_SETTINGS,
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            enabled: true,
            indentation: true,
        },
    };

    /**
     * Calculate visual width using tab-stop semantics.
     * Reference implementation for generating test cases.
     */
    function calculate_visual_width(whitespace: string, tab_width: number): number {
        let visual_column = 0;
        for (const char of whitespace) {
            if (char === ' ') {
                visual_column += 1;
            } else if (char === '\t') {
                visual_column = Math.ceil((visual_column + 1) / tab_width) * tab_width;
            }
        }
        return visual_column;
    }

    /**
     * Generate whitespace that produces exactly the target visual width.
     * Uses a combination of tabs and spaces to reach the target.
     */
    function generate_whitespace_for_width(target_width: number, tab_width: number): string[] {
        const the_results: string[] = [];
        
        // Pure spaces
        the_results.push(' '.repeat(target_width));
        
        // Pure tabs (only if target is a multiple of tab_width)
        if (target_width > 0 && target_width % tab_width === 0) {
            the_results.push('\t'.repeat(target_width / tab_width));
        }
        
        // Mixed: spaces followed by tab that lands exactly on target
        // For target=4, tab_width=4: " \t", "  \t", "   \t" all produce width 4
        if (target_width >= tab_width) {
            for (let my_spaces = 1; my_spaces < tab_width; my_spaces++) {
                // spaces + tab lands on next tab stop
                const my_tab_stop = Math.ceil((my_spaces + 1) / tab_width) * tab_width;
                if (my_tab_stop === target_width) {
                    the_results.push(' '.repeat(my_spaces) + '\t');
                }
            }
        }
        
        // Mixed: tab followed by spaces
        if (target_width > tab_width) {
            const my_num_tabs = Math.floor(target_width / tab_width);
            const my_remaining_spaces = target_width - (my_num_tabs * tab_width);
            if (my_remaining_spaces > 0) {
                the_results.push('\t'.repeat(my_num_tabs) + ' '.repeat(my_remaining_spaces));
            }
        }
        
        return the_results;
    }

    // Generator for indent sizes (common values)
    const indent_size_arb = fc.constantFrom(2, 4, 8);

    // Generator for simple statements that won't trigger other diagnostics
    const simple_statement_arb = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2',
        'summarize x'
    );

    // Generator for nesting depth (0 = top level, 1 = inside one block, etc.)
    const depth_arb = fc.integer({ min: 0, max: 3 });

    /**
     * Property 2: No False Positive When Visual Width Equals Expected
     *
     * For any line of Stata code where the visual width of leading whitespace
     * equals the expected indentation (depth × indent_size), the
     * Indentation_Diagnostic_Analyzer SHALL NOT emit an unnecessary indentation
     * diagnostic.
     *
     * **Validates: Requirements 1.2, 1.4**
     */
    it('Property 2: No false positive when visual width equals expected indentation', () => {
        fc.assert(
            fc.property(
                indent_size_arb,
                depth_arb,
                simple_statement_arb,
                (indent_size, depth, statement) => {
                    const expected_indent = depth * indent_size;
                    
                    // Generate various whitespace combinations that produce the expected width
                    const the_whitespace_options = generate_whitespace_for_width(expected_indent, indent_size);
                    
                    for (const my_whitespace of the_whitespace_options) {
                        // Verify our whitespace produces the expected width
                        const actual_width = calculate_visual_width(my_whitespace, indent_size);
                        expect(actual_width).toBe(expected_indent);
                        
                        // Build source code at the specified depth
                        let source: string;
                        if (depth === 0) {
                            source = `${my_whitespace}${statement}`;
                        } else {
                            // Create nested blocks to reach the desired depth
                            let opening = '';
                            let closing = '';
                            for (let my_d = 0; my_d < depth; my_d++) {
                                const my_block_indent = ' '.repeat(my_d * indent_size);
                                opening += `${my_block_indent}if 1 == 1 {\n`;
                                closing = `${my_block_indent}}\n` + closing;
                            }
                            source = `${opening}${my_whitespace}${statement}\n${closing}`;
                        }
                        
                        const doc_state = create_document_state(source);
                        
                        const config: StataLSPConfig = {
                            ...default_config,
                            formatting: {
                                ...default_config.formatting,
                                indentSize: indent_size,
                            },
                        };
                        
                        const diagnostics = analyzer.analyze(doc_state, config);
                        
                        // Find the line with our statement
                        const the_lines = source.split('\n');
                        let statement_line = -1;
                        for (let my_i = 0; my_i < the_lines.length; my_i++) {
                            if (the_lines[my_i].includes(statement)) {
                                statement_line = my_i;
                                break;
                            }
                        }
                        
                        // Filter for UNNECESSARY_INDENTATION diagnostics on the statement line
                        const unnecessary_on_statement = diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                                 d.range.start.line === statement_line
                        );
                        
                        // Should NOT have any unnecessary indentation diagnostic
                        // since visual width equals expected indentation
                        expect(unnecessary_on_statement.length).toBe(0);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2b: Space followed by tab producing correct width - no false positive
     *
     * Specific test for the bug case: " \t" (space + tab) with indent_size=4
     * produces visual width 4, which should NOT trigger a diagnostic when
     * expected indentation is 4.
     *
     * **Validates: Requirements 1.4**
     */
    it('Property 2b: Space+tab producing correct width does not trigger diagnostic', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 3 }),  // 1-3 spaces before tab
                indent_size_arb,
                simple_statement_arb,
                (num_spaces, indent_size, statement) => {
                    // Create whitespace: spaces followed by tab
                    const whitespace = ' '.repeat(num_spaces) + '\t';
                    const visual_width = calculate_visual_width(whitespace, indent_size);
                    
                    // Calculate the depth where this visual width is expected
                    const depth = Math.floor(visual_width / indent_size);
                    const expected_indent = depth * indent_size;
                    
                    // Only test when visual width exactly matches expected indent
                    if (visual_width !== expected_indent) {
                        return true;  // Skip this case
                    }
                    
                    // Build source at the correct depth
                    let source: string;
                    if (depth === 0) {
                        source = `${whitespace}${statement}`;
                    } else {
                        let opening = '';
                        let closing = '';
                        for (let my_d = 0; my_d < depth; my_d++) {
                            const my_block_indent = ' '.repeat(my_d * indent_size);
                            opening += `${my_block_indent}if 1 == 1 {\n`;
                            closing = `${my_block_indent}}\n` + closing;
                        }
                        source = `${opening}${whitespace}${statement}\n${closing}`;
                    }
                    
                    const doc_state = create_document_state(source);
                    
                    const config: StataLSPConfig = {
                        ...default_config,
                        formatting: {
                            ...default_config.formatting,
                            indentSize: indent_size,
                        },
                    };
                    
                    const diagnostics = analyzer.analyze(doc_state, config);
                    
                    // Find the statement line
                    const the_lines = source.split('\n');
                    let statement_line = -1;
                    for (let my_i = 0; my_i < the_lines.length; my_i++) {
                        if (the_lines[my_i].includes(statement)) {
                            statement_line = my_i;
                            break;
                        }
                    }
                    
                    // Should NOT have unnecessary indentation diagnostic
                    const unnecessary_on_statement = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                             d.range.start.line === statement_line
                    );
                    
                    expect(unnecessary_on_statement.length).toBe(0);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2c: Mixed whitespace at depth 1 - no false positive
     *
     * Test that various mixed whitespace combinations that produce exactly
     * indent_size visual width do not trigger diagnostics at depth 1.
     *
     * **Validates: Requirements 1.2, 1.4**
     */
    it('Property 2c: Mixed whitespace at depth 1 with correct width - no diagnostic', () => {
        fc.assert(
            fc.property(
                indent_size_arb,
                simple_statement_arb,
                (indent_size, statement) => {
                    // Generate all whitespace options that produce exactly indent_size width
                    const the_whitespace_options = generate_whitespace_for_width(indent_size, indent_size);
                    
                    for (const my_whitespace of the_whitespace_options) {
                        // Verify width
                        const actual_width = calculate_visual_width(my_whitespace, indent_size);
                        expect(actual_width).toBe(indent_size);
                        
                        // Create code at depth 1 (inside one block)
                        const source = `if 1 == 1 {\n${my_whitespace}${statement}\n}`;
                        
                        const doc_state = create_document_state(source);
                        
                        const config: StataLSPConfig = {
                            ...default_config,
                            formatting: {
                                ...default_config.formatting,
                                indentSize: indent_size,
                            },
                        };
                        
                        const diagnostics = analyzer.analyze(doc_state, config);
                        
                        // Filter for UNNECESSARY_INDENTATION on line 1 (the body line)
                        const unnecessary_on_body = diagnostics.filter(
                            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                                 d.range.start.line === 1
                        );
                        
                        // Should NOT have unnecessary indentation diagnostic
                        expect(unnecessary_on_body.length).toBe(0);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2d: Specific regression test for " \t" bug
     *
     * The original bug: " \t" (1 space + 1 tab) with indent_size=4 was
     * incorrectly calculated as width 5 (1+4) instead of width 4.
     * This caused false positive diagnostics.
     *
     * **Validates: Requirements 1.4**
     */
    it('Property 2d: Regression test for space+tab false positive bug', () => {
        const indent_size = 4;
        
        // " \t" should have visual width 4 (space to col 1, tab to col 4)
        const whitespace = ' \t';
        const visual_width = calculate_visual_width(whitespace, indent_size);
        expect(visual_width).toBe(4);
        
        // At depth 1, expected indent is 4
        const source = `if 1 == 1 {\n${whitespace}gen x = 1\n}`;
        
        const doc_state = create_document_state(source);
        
        const config: StataLSPConfig = {
            ...default_config,
            formatting: {
                ...default_config.formatting,
                indentSize: indent_size,
            },
        };
        
        const diagnostics = analyzer.analyze(doc_state, config);
        
        // Should NOT have unnecessary indentation on line 1
        const unnecessary_on_body = diagnostics.filter(
            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                 d.range.start.line === 1
        );
        
        expect(unnecessary_on_body.length).toBe(0);
    });

    /**
     * Property 2e: Multiple spaces before tab - no false positive
     *
     * Test "  \t" (2 spaces + tab), "   \t" (3 spaces + tab) with indent_size=4.
     * All should produce visual width 4 and not trigger diagnostics at depth 1.
     *
     * **Validates: Requirements 1.4**
     */
    it('Property 2e: Multiple spaces before tab - no false positive', () => {
        const indent_size = 4;
        
        const the_test_cases = [
            { whitespace: ' \t', expected_width: 4 },
            { whitespace: '  \t', expected_width: 4 },
            { whitespace: '   \t', expected_width: 4 },
        ];
        
        for (const my_test_case of the_test_cases) {
            const actual_width = calculate_visual_width(my_test_case.whitespace, indent_size);
            expect(actual_width).toBe(my_test_case.expected_width);
            
            // At depth 1, expected indent is 4
            const source = `if 1 == 1 {\n${my_test_case.whitespace}gen x = 1\n}`;
            
            const doc_state = create_document_state(source);
            
            const config: StataLSPConfig = {
                ...default_config,
                formatting: {
                    ...default_config.formatting,
                    indentSize: indent_size,
                },
            };
            
            const diagnostics = analyzer.analyze(doc_state, config);
            
            // Should NOT have unnecessary indentation on line 1
            const unnecessary_on_body = diagnostics.filter(
                d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                     d.range.start.line === 1
            );
            
            expect(unnecessary_on_body.length).toBe(0);
        }
    });
});
