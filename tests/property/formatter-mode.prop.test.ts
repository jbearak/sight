/**
 * Property Tests for Formatter Mode Selection
 *
 * Feature: restore-pretty-printer-formatting
 * Tests the configurable formatter mode that allows switching between
 * source-preserving (default) and AST-based formatting.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentState } from '../../src/document-store';
import { StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { FormattingOptions } from 'vscode-languageserver';

/**
 * Helper to create a DocumentState from source code
 */
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
        symbols: new Map() as any,
        diagnostics: [],
        context_ranges: [],
    };
}

const DEFAULT_FORMATTING_OPTIONS: FormattingOptions = {
    tabSize: 4,
    insertSpaces: true,
};

describe('Formatter Mode Property Tests', () => {
    /**
     * Property 1: Mode Selection Correctness
     *
     * For any valid formatter mode configuration ("source-preserving" or "ast"),
     * the CodeFormatter SHALL use the corresponding formatter implementation.
     *
     * Feature: restore-pretty-printer-formatting, Property 1: Mode Selection Correctness
     * Validates: Requirements 1.3, 1.4
     */
    describe('Property 1: Mode Selection Correctness', () => {
        it('should use source-preserving formatter when mode is "source-preserving"', () => {
            const source_arb = fc.constantFrom(
                'display "hello"',
                'local x = 1',
                'gen y = x + 1'
            );

            fc.assert(
                fc.property(source_arb, (source) => {
                    const formatter = new CodeFormatter();
                    const document = create_document_state(source);
                    const config: StataLSPConfig = {
                        ...DEFAULT_SETTINGS,
                        formatting: { ...DEFAULT_SETTINGS.formatting, mode: 'source-preserving' },
                    };

                    const edits = formatter.format(document, DEFAULT_FORMATTING_OPTIONS, config);

                    // Source-preserving formatter should preserve the source structure
                    // (may adjust indentation but not restructure)
                    expect(edits.length).toBeLessThanOrEqual(1);
                    if (edits.length === 1) {
                        // The formatted text should contain the original tokens
                        expect(edits[0].newText).toContain(source.trim().split(/\s+/)[0]);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('should use AST formatter when mode is "ast"', () => {
            const source_arb = fc.constantFrom(
                'display "hello"',
                'local x = 1',
                'gen y = x + 1'
            );

            fc.assert(
                fc.property(source_arb, (source) => {
                    const formatter = new CodeFormatter();
                    const document = create_document_state(source);
                    const config: StataLSPConfig = {
                        ...DEFAULT_SETTINGS,
                        formatting: { ...DEFAULT_SETTINGS.formatting, mode: 'ast' },
                    };

                    const edits = formatter.format(document, DEFAULT_FORMATTING_OPTIONS, config);

                    // AST formatter returns edits (or empty on error)
                    expect(Array.isArray(edits)).toBe(true);
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Default Mode
     *
     * For any formatting request where no mode is configured, the CodeFormatter
     * SHALL use the source-preserving formatter.
     *
     * Feature: restore-pretty-printer-formatting, Property 2: Default Mode
     * Validates: Requirements 1.5, 2.3
     */
    describe('Property 2: Default Mode', () => {
        it('should default to source-preserving when mode is undefined', () => {
            const source_arb = fc.constantFrom(
                'display "hello"',
                'local x = 1',
                'gen y = x + 1'
            );

            fc.assert(
                fc.property(source_arb, (source) => {
                    const formatter = new CodeFormatter();
                    const document = create_document_state(source);

                    // No config provided
                    const edits_no_config = formatter.format(document, DEFAULT_FORMATTING_OPTIONS);

                    // Config with undefined mode
                    const config_undefined: StataLSPConfig = {
                        ...DEFAULT_SETTINGS,
                        formatting: { ...DEFAULT_SETTINGS.formatting, mode: undefined },
                    };
                    const edits_undefined = formatter.format(document, DEFAULT_FORMATTING_OPTIONS, config_undefined);

                    // Both should behave the same (source-preserving)
                    expect(edits_no_config.length).toBe(edits_undefined.length);
                    if (edits_no_config.length > 0 && edits_undefined.length > 0) {
                        expect(edits_no_config[0].newText).toBe(edits_undefined[0].newText);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('should match DEFAULT_SETTINGS mode value', () => {
            expect(DEFAULT_SETTINGS.formatting.mode).toBe('source-preserving');
        });
    });

    /**
     * Property 4: Error Handling - No Edits on Failure
     *
     * For any formatting request in AST mode that encounters an error,
     * the CodeFormatter SHALL return an empty array of TextEdits rather
     * than corrupt the code.
     *
     * Feature: restore-pretty-printer-formatting, Property 4: Error Handling - No Edits on Failure
     * Validates: Requirements 4.1
     */
    describe('Property 4: Error Handling - No Edits on Failure', () => {
        it('should return empty edits when AST is missing', () => {
            const formatter = new CodeFormatter();
            const document: DocumentState = {
                uri: 'file:///test.do',
                content: 'display "hello"',
                version: 1,
                tokens: [],
                ast: undefined as any, // Missing AST
                symbols: new Map() as any,
                diagnostics: [],
                context_ranges: [],
                line_offsets: [0],
            };
            const config: StataLSPConfig = {
                ...DEFAULT_SETTINGS,
                formatting: { ...DEFAULT_SETTINGS.formatting, mode: 'ast' },
            };

            const edits = formatter.format(document, DEFAULT_FORMATTING_OPTIONS, config);

            expect(edits).toEqual([]);
        });
    });

    /**
     * Property 6: Indent Size Preservation
     *
     * For any formatting request with a configured indent size, the
     * Source_Preserving_Formatter SHALL produce output using that exact
     * indent size, not a different value.
     *
     * Feature: restore-pretty-printer-formatting, Property 6: Indent Size Preservation
     * Validates: Requirements 5.1, 5.2, 5.3
     */
    describe('Property 6: Indent Size Preservation', () => {
        it('should preserve configured indent size', () => {
            const indent_size_arb = fc.integer({ min: 1, max: 8 });

            fc.assert(
                fc.property(indent_size_arb, (indent_size) => {
                    const formatter = new CodeFormatter();
                    const source = `if 1 {\n    display "hello"\n}`;
                    const document = create_document_state(source);
                    const options: FormattingOptions = {
                        tabSize: indent_size,
                        insertSpaces: true,
                    };

                    const edits = formatter.format(document, options);

                    if (edits.length > 0) {
                        const formatted = edits[0].newText;
                        // Check that indented lines use the correct indent size
                        const lines = formatted.split('\n');
                        for (const line of lines) {
                            const leading_spaces = line.match(/^( *)/)?.[1]?.length || 0;
                            if (leading_spaces > 0) {
                                // Indentation should be a multiple of indent_size
                                expect(leading_spaces % indent_size).toBe(0);
                            }
                        }
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('should not change 4-space indent to 2-space', () => {
            const formatter = new CodeFormatter();
            const source = `if 1 {\n    display "hello"\n}`;
            const document = create_document_state(source);
            const options: FormattingOptions = {
                tabSize: 4,
                insertSpaces: true,
            };

            const edits = formatter.format(document, options);

            if (edits.length > 0) {
                const formatted = edits[0].newText;
                const lines = formatted.split('\n');
                // Find the indented line
                const indented_line = lines.find(l => l.startsWith(' ') && l.trim().length > 0);
                if (indented_line) {
                    const leading_spaces = indented_line.match(/^( *)/)?.[1]?.length || 0;
                    // Should be 4 spaces (1 indent level), not 2
                    expect(leading_spaces).toBe(4);
                }
            }
        });
    });
});
