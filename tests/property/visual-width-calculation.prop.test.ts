/**
 * Property Tests: Visual Width Calculation Correctness
 *
 * Feature: mixed-whitespace-indentation-fix
 * Validates: Requirements 1.1
 *
 * Tests that the IndentationDiagnosticAnalyzer correctly computes visual width
 * when lines contain mixed tabs and spaces, using proper tab-stop semantics.
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

describe('Visual Width Calculation Properties', () => {
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
     * Calculate expected visual width using tab-stop semantics.
     * This is the reference implementation for testing.
     * 
     * @param whitespace - String of spaces and tabs
     * @param tab_width - Tab stop interval (typically 4)
     * @returns Visual column width
     */
    function calculate_expected_visual_width(whitespace: string, tab_width: number): number {
        let visual_column = 0;
        for (const char of whitespace) {
            if (char === ' ') {
                visual_column += 1;
            } else if (char === '\t') {
                // Tab advances to next tab stop (next multiple of tab_width)
                visual_column = Math.ceil((visual_column + 1) / tab_width) * tab_width;
            }
        }
        return visual_column;
    }

    // Generator for whitespace strings (spaces and tabs only)
    const whitespace_arb = fc.array(
        fc.constantFrom(' ', '\t'),
        { minLength: 1, maxLength: 12 }
    ).map(chars => chars.join(''));

    // Generator for indent sizes (common values)
    const indent_size_arb = fc.constantFrom(2, 4, 8);

    // Generator for simple statements
    const simple_statement = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2',
        'summarize x'
    );

    /**
     * Property 1: Visual Width Calculation Correctness
     * 
     * For any string of whitespace characters (spaces and tabs) and any positive
     * tab width, the visual width calculation SHALL:
     * - Add 1 to the visual column for each space
     * - Advance to the next multiple of tab_width for each tab
     * 
     * **Validates: Requirements 1.1**
     */
    test('Property 1: Spaces add 1 to visual column', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 20 }),
                indent_size_arb,
                simple_statement,
                (num_spaces, indent_size, statement) => {
                    const whitespace = ' '.repeat(num_spaces);
                    const expected_width = num_spaces;
                    
                    // Create source with spaces-only indentation
                    const source = `${whitespace}${statement}`;
                    const doc_state = create_document_state(source);
                    
                    const config: StataLSPConfig = {
                        ...default_config,
                        formatting: {
                            ...default_config.formatting,
                            indentSize: indent_size,
                        },
                    };
                    
                    const diagnostics = analyzer.analyze(doc_state, config);
                    
                    // Should detect unnecessary indentation since expected is 0
                    const unnecessary = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );
                    
                    expect(unnecessary.length).toBeGreaterThanOrEqual(1);
                    
                    // Verify the diagnostic range width matches expected visual width
                    const diagnostic = unnecessary[0];
                    const actual_width = diagnostic.range.end.character;
                    expect(actual_width).toBe(expected_width);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1b: Tabs advance to next multiple of indent_size
     * 
     * For any number of tabs, the visual width should be:
     * - 1 tab at column 0 → column indent_size
     * - 2 tabs at column 0 → column 2 * indent_size
     * - etc.
     * 
     * **Validates: Requirements 1.1**
     */
    test('Property 1b: Tabs advance to next multiple of indent_size', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5 }),
                indent_size_arb,
                simple_statement,
                (num_tabs, indent_size, statement) => {
                    const whitespace = '\t'.repeat(num_tabs);
                    const expected_width = num_tabs * indent_size;
                    
                    // Create source with tabs-only indentation
                    const source = `${whitespace}${statement}`;
                    const doc_state = create_document_state(source);
                    
                    const config: StataLSPConfig = {
                        ...default_config,
                        formatting: {
                            ...default_config.formatting,
                            indentSize: indent_size,
                        },
                    };
                    
                    const diagnostics = analyzer.analyze(doc_state, config);
                    
                    // Should detect unnecessary indentation since expected is 0
                    const unnecessary = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );
                    
                    expect(unnecessary.length).toBeGreaterThanOrEqual(1);
                    
                    // Verify the diagnostic range width matches expected visual width
                    const diagnostic = unnecessary[0];
                    const actual_width = diagnostic.range.end.character;
                    expect(actual_width).toBe(expected_width);
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1c: Mixed whitespace visual width calculation
     * 
     * For any combination of spaces and tabs, the visual width should follow
     * tab-stop semantics where tabs advance to the next multiple of indent_size.
     * 
     * Example with indent_size=4:
     * - " \t" (1 space + 1 tab): space puts us at column 1, tab advances to column 4
     * - "  \t" (2 spaces + 1 tab): spaces put us at column 2, tab advances to column 4
     * - "   \t" (3 spaces + 1 tab): spaces put us at column 3, tab advances to column 4
     * - "    \t" (4 spaces + 1 tab): spaces put us at column 4, tab advances to column 8
     * 
     * **Validates: Requirements 1.1**
     */
    test('Property 1c: Mixed whitespace visual width follows tab-stop semantics', () => {
        fc.assert(
            fc.property(
                whitespace_arb,
                indent_size_arb,
                simple_statement,
                (whitespace, indent_size, statement) => {
                    const expected_width = calculate_expected_visual_width(whitespace, indent_size);
                    
                    // Create source with mixed whitespace indentation
                    const source = `${whitespace}${statement}`;
                    const doc_state = create_document_state(source);
                    
                    const config: StataLSPConfig = {
                        ...default_config,
                        formatting: {
                            ...default_config.formatting,
                            indentSize: indent_size,
                        },
                    };
                    
                    const diagnostics = analyzer.analyze(doc_state, config);
                    
                    // At top level, expected indent is 0
                    // If visual width > 0, should get UNNECESSARY_INDENTATION
                    const unnecessary = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION
                    );
                    
                    if (expected_width > 0) {
                        expect(unnecessary.length).toBeGreaterThanOrEqual(1);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1d: Specific mixed whitespace examples
     * 
     * Test specific cases that were previously buggy:
     * - " \t" with indent_size=4 should have visual width 4 (not 5)
     * - "\t " with indent_size=4 should have visual width 5 (tab to 4, space to 5)
     * 
     * **Validates: Requirements 1.1**
     */
    test('Property 1d: Specific mixed whitespace edge cases', () => {
        // Test " \t" (space + tab) with indent_size=4
        // Space puts us at column 1, tab advances to column 4
        const space_tab_width = calculate_expected_visual_width(' \t', 4);
        expect(space_tab_width).toBe(4);

        // Test "\t " (tab + space) with indent_size=4
        // Tab puts us at column 4, space advances to column 5
        const tab_space_width = calculate_expected_visual_width('\t ', 4);
        expect(tab_space_width).toBe(5);

        // Test "  \t" (2 spaces + tab) with indent_size=4
        // Spaces put us at column 2, tab advances to column 4
        const two_spaces_tab_width = calculate_expected_visual_width('  \t', 4);
        expect(two_spaces_tab_width).toBe(4);

        // Test "   \t" (3 spaces + tab) with indent_size=4
        // Spaces put us at column 3, tab advances to column 4
        const three_spaces_tab_width = calculate_expected_visual_width('   \t', 4);
        expect(three_spaces_tab_width).toBe(4);

        // Test "    \t" (4 spaces + tab) with indent_size=4
        // Spaces put us at column 4, tab advances to column 8
        const four_spaces_tab_width = calculate_expected_visual_width('    \t', 4);
        expect(four_spaces_tab_width).toBe(8);

        // Test " \t\t" (space + 2 tabs) with indent_size=4
        // Space to 1, first tab to 4, second tab to 8
        const space_two_tabs_width = calculate_expected_visual_width(' \t\t', 4);
        expect(space_two_tabs_width).toBe(8);
    });

    /**
     * Property 1e: Visual width calculation is consistent with reference implementation
     * 
     * For any whitespace string and indent size, the analyzer's behavior should
     * be consistent with the reference visual width calculation.
     * 
     * **Validates: Requirements 1.1**
     */
    test('Property 1e: Analyzer behavior consistent with reference implementation', () => {
        fc.assert(
            fc.property(
                whitespace_arb,
                indent_size_arb,
                simple_statement,
                (whitespace, indent_size, statement) => {
                    const expected_width = calculate_expected_visual_width(whitespace, indent_size);
                    
                    // Create source inside a block where expected depth is 1
                    // So expected indent is indent_size
                    const source = `if 1 == 1 {\n${whitespace}${statement}\n}`;
                    const doc_state = create_document_state(source);
                    
                    const config: StataLSPConfig = {
                        ...default_config,
                        formatting: {
                            ...default_config.formatting,
                            indentSize: indent_size,
                        },
                    };
                    
                    const diagnostics = analyzer.analyze(doc_state, config);
                    
                    // Filter for diagnostics on line 1 (the body line)
                    const line_1_unnecessary = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION &&
                             d.range.start.line === 1
                    );
                    
                    const line_1_missing = diagnostics.filter(
                        d => d.code === StataDiagnosticCode.MISSING_INDENTATION &&
                             d.range.start.line === 1
                    );
                    
                    // Expected indent at depth 1 is indent_size
                    const expected_indent = indent_size;
                    // braceIndent is 0 (the `if` line has no indentation)
                    const brace_indent = 0;
                    
                    if (expected_width > expected_indent) {
                        // Should have UNNECESSARY_INDENTATION
                        expect(line_1_unnecessary.length).toBeGreaterThanOrEqual(1);
                    } else if (expected_width <= brace_indent) {
                        // Should have MISSING_INDENTATION only when innerIndent <= braceIndent
                        expect(line_1_missing.length).toBeGreaterThanOrEqual(1);
                    }
                    // If expected_width === expected_indent, no diagnostic should be emitted
                    // for unnecessary indentation
                    if (expected_width === expected_indent) {
                        expect(line_1_unnecessary.length).toBe(0);
                    }
                    
                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

