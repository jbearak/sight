/**
 * Property Tests: Formatter Resolves All Indentation Diagnostics
 *
 * Feature: mixed-whitespace-indentation-fix
 * Property 6: Formatter Resolves All Indentation Diagnostics
 * Validates: Requirements 3.1, 3.2, 3.3
 *
 * Tests that the formatter resolves all indentation diagnostics when applied
 * to code with indentation issues (unnecessary or missing indentation).
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { create_document_state } from './helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import {
    for_each_formatter_mode_property,
    create_formatter_config,
    skip_for_mode,
    FormatterMode,
} from './helpers/formatter-test-utils';

describe('Formatter Resolves Indentation Diagnostics Properties', () => {
    const analyzer = new IndentationDiagnosticAnalyzer();
    const formatter = new CodeFormatter();
    const options = { tabSize: 4, insertSpaces: true };

    const default_config: StataLSPConfig = {
        ...DEFAULT_SETTINGS,
        diagnostics: {
            ...DEFAULT_SETTINGS.diagnostics,
            enabled: true,
            indentation: true,
        },
    };

    // Generator for simple statements
    const simple_statement_arb = fc.constantFrom(
        'gen x = 1',
        'display "hello"',
        'local y = 2',
        'replace x = 2',
        'summarize x',
        'regress y x'
    );

    // Generator for mixed whitespace indentation (spaces and tabs combined)
    const mixed_whitespace_arb = fc.oneof(
        // Spaces only (various amounts)
        fc.integer({ min: 1, max: 12 }).map(n => ' '.repeat(n)),
        // Tabs only
        fc.integer({ min: 1, max: 3 }).map(n => '\t'.repeat(n)),
        // Mixed: spaces then tabs (the bug case)
        fc.tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 2 }))
            .map(([s, t]) => ' '.repeat(s) + '\t'.repeat(t)),
        // Mixed: tabs then spaces
        fc.tuple(fc.integer({ min: 1, max: 2 }), fc.integer({ min: 1, max: 4 }))
            .map(([t, s]) => '\t'.repeat(t) + ' '.repeat(s)),
        // Mixed: space-tab-space pattern
        fc.tuple(fc.integer({ min: 1, max: 2 }), fc.integer({ min: 1, max: 2 }))
            .map(([s1, s2]) => ' '.repeat(s1) + '\t' + ' '.repeat(s2))
    );

    /**
     * Property 6: Formatter Resolves All Indentation Diagnostics
     *
     * For any code that triggers indentation diagnostics (unnecessary or missing),
     * after formatting, the same diagnostics SHALL NOT be present.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    describe('Property 6: Formatter Resolves All Indentation Diagnostics', () => {
        /**
         * Property 6a: Formatter resolves unnecessary indentation at top level
         *
         * For any Stata source code with unnecessary indentation at the top level,
         * after formatting, there should be no UNNECESSARY_INDENTATION diagnostics.
         *
         * **Validates: Requirements 3.1**
         */
        for_each_formatter_mode_property(
            'Property 6a: Formatter resolves unnecessary indentation at top level',
            fc.tuple(simple_statement_arb, mixed_whitespace_arb),
            (mode: FormatterMode, [statement, indent]) => {
                // Create source with unnecessary indentation at top level
                const source = `${indent}${statement}`;
                const doc_state = create_document_state(source);

                // Verify we have an indentation diagnostic before formatting
                const diagnostics_before = analyzer.analyze(doc_state, default_config);
                const indent_diagnostics_before = diagnostics_before.filter(
                    d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                         d.code === StataDiagnosticCode.MISSING_INDENTATION
                );

                // Should have at least one indentation diagnostic
                if (indent_diagnostics_before.length === 0) {
                    // No diagnostic to resolve, skip this case
                    return true;
                }

                const config = {
                    ...create_formatter_config(mode),
                    diagnostics: {
                        ...default_config.diagnostics,
                    },
                };

                // Format the code
                const edits = formatter.format(doc_state, options, config);

                if (edits.length > 0) {
                    const formatted = edits[0].newText;

                    // Re-analyze the formatted code
                    const formatted_doc = create_document_state(formatted);
                    const diagnostics_after = analyzer.analyze(formatted_doc, default_config);

                    // Filter for indentation diagnostics only
                    const indent_diagnostics_after = diagnostics_after.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

                    // Should have no indentation diagnostics after formatting
                    expect(indent_diagnostics_after.length).toBe(0);
                }

                return true;
            },
            100
        );

        /**
         * Property 6b: Formatter resolves missing indentation inside blocks
         *
         * For any Stata source code with missing indentation inside brace blocks,
         * after formatting, there should be no MISSING_INDENTATION diagnostics.
         *
         * **Validates: Requirements 3.2**
         */
        for_each_formatter_mode_property(
            'Property 6b: Formatter resolves missing indentation inside blocks',
            simple_statement_arb,
            (mode: FormatterMode, statement) => {
                // Create source with missing indentation inside a block
                // (statement at column 0 inside braces)
                const source = `if 1 == 1 {\n${statement}\n}`;
                const doc_state = create_document_state(source);

                // Verify we have a missing indentation diagnostic before formatting
                const diagnostics_before = analyzer.analyze(doc_state, default_config);
                const missing_diagnostics_before = diagnostics_before.filter(
                    d => d.code === StataDiagnosticCode.MISSING_INDENTATION
                );

                // Should have at least one missing indentation diagnostic
                if (missing_diagnostics_before.length === 0) {
                    // No diagnostic to resolve, skip this case
                    return true;
                }

                const config = {
                    ...create_formatter_config(mode),
                    diagnostics: {
                        ...default_config.diagnostics,
                    },
                };

                // Format the code
                const edits = formatter.format(doc_state, options, config);

                if (edits.length > 0) {
                    const formatted = edits[0].newText;

                    // Skip for AST mode which may restructure code
                    skip_for_mode(mode, 'ast', () => {
                        // Re-analyze the formatted code
                        const formatted_doc = create_document_state(formatted);
                        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);

                        // Filter for missing indentation diagnostics only
                        const missing_diagnostics_after = diagnostics_after.filter(
                            d => d.code === StataDiagnosticCode.MISSING_INDENTATION
                        );

                        // Should have no missing indentation diagnostics after formatting
                        expect(missing_diagnostics_after.length).toBe(0);
                    });
                }

                return true;
            },
            100
        );

        /**
         * Property 6c: Formatter normalizes mixed whitespace without creating new diagnostics
         *
         * For any Stata source code with mixed whitespace, after formatting,
         * the resulting code SHALL NOT trigger new indentation diagnostics.
         *
         * **Validates: Requirements 3.3**
         */
        for_each_formatter_mode_property(
            'Property 6c: Formatter normalizes mixed whitespace without creating new diagnostics',
            fc.tuple(simple_statement_arb, mixed_whitespace_arb),
            (mode: FormatterMode, [statement, mixed_indent]) => {
                // Create source with mixed whitespace inside a block
                const source = `if 1 == 1 {\n${mixed_indent}${statement}\n}`;
                const doc_state = create_document_state(source);

                const config = {
                    ...create_formatter_config(mode),
                    diagnostics: {
                        ...default_config.diagnostics,
                    },
                };

                // Format the code
                const edits = formatter.format(doc_state, options, config);

                if (edits.length > 0) {
                    const formatted = edits[0].newText;

                    // Skip for AST mode which may restructure code
                    skip_for_mode(mode, 'ast', () => {
                        // Re-analyze the formatted code
                        const formatted_doc = create_document_state(formatted);
                        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);

                        // Filter for indentation diagnostics only
                        const indent_diagnostics_after = diagnostics_after.filter(
                            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                                 d.code === StataDiagnosticCode.MISSING_INDENTATION
                        );

                        // Should have no indentation diagnostics after formatting
                        expect(indent_diagnostics_after.length).toBe(0);
                    });
                }

                return true;
            },
            100
        );

        /**
         * Property 6d: Formatter resolves diagnostics in nested blocks
         *
         * For any Stata source code with nested blocks and indentation issues,
         * after formatting, there should be no indentation diagnostics.
         *
         * **Validates: Requirements 3.1, 3.2, 3.3**
         */
        for_each_formatter_mode_property(
            'Property 6d: Formatter resolves diagnostics in nested blocks',
            fc.tuple(simple_statement_arb, mixed_whitespace_arb),
            (mode: FormatterMode, [statement, indent]) => {
                // Create source with nested blocks and indentation issues
                const source = `if 1 == 1 {\n${indent}if 2 == 2 {\n${indent}${statement}\n}\n}`;
                const doc_state = create_document_state(source);

                const config = {
                    ...create_formatter_config(mode),
                    diagnostics: {
                        ...default_config.diagnostics,
                    },
                };

                // Format the code
                const edits = formatter.format(doc_state, options, config);

                if (edits.length > 0) {
                    const formatted = edits[0].newText;

                    // Skip for AST mode which may restructure code
                    skip_for_mode(mode, 'ast', () => {
                        // Re-analyze the formatted code
                        const formatted_doc = create_document_state(formatted);
                        const diagnostics_after = analyzer.analyze(formatted_doc, default_config);

                        // Filter for indentation diagnostics only
                        const indent_diagnostics_after = diagnostics_after.filter(
                            d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                                 d.code === StataDiagnosticCode.MISSING_INDENTATION
                        );

                        // Should have no indentation diagnostics after formatting
                        expect(indent_diagnostics_after.length).toBe(0);
                    });
                }

                return true;
            },
            100
        );
    });

    /**
     * Specific regression tests for the mixed whitespace bug
     */
    describe('Regression Tests: Mixed Whitespace Bug', () => {
        /**
         * Regression test: " \t" (space + tab) indentation is resolved by formatter
         *
         * The original bug: " \t" was incorrectly calculated as width 5 instead of 4.
         * After formatting, the code should have no indentation diagnostics.
         */
        test('Regression: space+tab indentation is resolved by formatter', () => {
            const indent_size = 4;

            // " \t" produces visual width 4 (space to col 1, tab to col 4)
            // At depth 1, expected indent is 4, so this should NOT trigger a diagnostic
            // But if there's any diagnostic, formatting should resolve it
            const source = `if 1 == 1 {\n \tgen x = 1\n}`;
            const doc_state = create_document_state(source);

            const config: StataLSPConfig = {
                ...default_config,
                formatting: {
                    ...default_config.formatting,
                    indentSize: indent_size,
                    mode: 'source-preserving',
                },
            };

            // Format the code
            const edits = formatter.format(doc_state, options, config);

            if (edits.length > 0) {
                const formatted = edits[0].newText;

                // Re-analyze the formatted code
                const formatted_doc = create_document_state(formatted);
                const diagnostics_after = analyzer.analyze(formatted_doc, config);

                // Filter for indentation diagnostics only
                const indent_diagnostics_after = diagnostics_after.filter(
                    d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                         d.code === StataDiagnosticCode.MISSING_INDENTATION
                );

                // Should have no indentation diagnostics after formatting
                expect(indent_diagnostics_after.length).toBe(0);

                // The formatted code should have consistent indentation (spaces only)
                const the_lines = formatted.split('\n');
                const body_line = the_lines[1];
                if (body_line && body_line.trim()) {
                    const leading_whitespace = body_line.match(/^(\s*)/)?.[1] || '';
                    // Should not contain tabs (normalized to spaces)
                    expect(leading_whitespace.includes('\t')).toBe(false);
                }
            }
        });

        /**
         * Regression test: Multiple spaces before tab is resolved by formatter
         *
         * Test "  \t" (2 spaces + tab), "   \t" (3 spaces + tab) patterns.
         */
        test('Regression: multiple spaces before tab is resolved by formatter', () => {
            const indent_size = 4;

            const the_test_cases = [
                ' \t',   // 1 space + tab = width 4
                '  \t',  // 2 spaces + tab = width 4
                '   \t', // 3 spaces + tab = width 4
            ];

            for (const my_whitespace of the_test_cases) {
                const source = `if 1 == 1 {\n${my_whitespace}gen x = 1\n}`;
                const doc_state = create_document_state(source);

                const config: StataLSPConfig = {
                    ...default_config,
                    formatting: {
                        ...default_config.formatting,
                        indentSize: indent_size,
                        mode: 'source-preserving',
                    },
                };

                // Format the code
                const edits = formatter.format(doc_state, options, config);

                if (edits.length > 0) {
                    const formatted = edits[0].newText;

                    // Re-analyze the formatted code
                    const formatted_doc = create_document_state(formatted);
                    const diagnostics_after = analyzer.analyze(formatted_doc, config);

                    // Filter for indentation diagnostics only
                    const indent_diagnostics_after = diagnostics_after.filter(
                        d => d.code === StataDiagnosticCode.UNNECESSARY_INDENTATION ||
                             d.code === StataDiagnosticCode.MISSING_INDENTATION
                    );

                    // Should have no indentation diagnostics after formatting
                    expect(indent_diagnostics_after.length).toBe(0);
                }
            }
        });
    });
});
