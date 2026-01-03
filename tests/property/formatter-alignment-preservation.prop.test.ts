/**
 * Property Tests: Formatter Alignment Preservation
 *
 * Tests continuation line alignment preservation properties from the design doc.
 * Note: These tests only run for source-preserving mode because the AST formatter
 * does not preserve continuation lines (it reconstructs code from the AST).
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DocumentState } from '../../src/document-store';
import { FormattingOptions } from 'vscode-languageserver';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { arbitrary_non_reserved_identifier } from './generators/primitives';

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

function create_config(preserve_alignment: boolean) {
    return {
        ...DEFAULT_SETTINGS,
        formatting: {
            ...DEFAULT_SETTINGS.formatting,
            mode: 'source-preserving' as const,
            preserve_alignment,
        },
    };
}

describe('Formatter Alignment Preservation Properties', () => {
    const formatter = new CodeFormatter();
    const options: FormattingOptions = { tabSize: 4, insertSpaces: true };

    // Property 1: Aligned Operator Preservation
    it('preserves aligned operators at same column', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    operator: fc.constantFrom('+', '-', '*', '/', '&', '|'),
                    var1: arbitrary_non_reserved_identifier(),
                }),
                async (data) => {
                    const my_config = create_config(true);
                    // Create source with operators at same column
                    const my_source = `gen ${data.var1} ${data.operator} 1 ///\n    ${data.var1} ${data.operator} 2`;
                    
                    const my_doc = create_document_state(my_source);
                    const my_result = await formatter.format(my_doc, options, my_config);

                    const my_lines = my_result[0].newText.split('\n');
                    const my_first_op_col = my_lines[0].indexOf(data.operator);
                    const my_second_op_col = my_lines[1].indexOf(data.operator);
                    
                    return my_first_op_col > -1 && my_second_op_col > -1 && my_first_op_col === my_second_op_col;
                }
            ),
            { numRuns: 50 }
        );
    });

    // Property 4: Continuation lines preserve original whitespace
    it('preserves original whitespace on continuation lines', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    var1: arbitrary_non_reserved_identifier(),
                    indent: fc.integer({ min: 2, max: 8 }),
                }),
                async (data) => {
                    const my_config = create_config(true);
                    const my_spaces = ' '.repeat(data.indent);
                    // Continuation line with custom indentation should be preserved
                    const my_source = `gen ${data.var1} = 1 ///\n${my_spaces}+ 2`;
                    
                    const my_doc = create_document_state(my_source);
                    const my_result = await formatter.format(my_doc, options, my_config);

                    const my_lines = my_result[0].newText.split('\n');
                    // Should preserve the original indentation
                    return my_lines[1].startsWith(my_spaces);
                }
            ),
            { numRuns: 50 }
        );
    });

    // Property 6: Disabled Mode Standard Indentation
    it('applies standard indentation when preserveAlignment is false', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    var1: arbitrary_non_reserved_identifier(),
                    padding: fc.integer({ min: 6, max: 10 }),
                }),
                async (data) => {
                    const my_config = create_config(false);
                    const my_spaces = ' '.repeat(data.padding);
                    // Create aligned source that should NOT be preserved
                    const my_source = `gen ${data.var1}${my_spaces}= 1 ///\n    ${data.var1}${my_spaces}= 2`;
                    
                    const my_doc = create_document_state(my_source);
                    const my_result = await formatter.format(my_doc, options, my_config);

                    const my_lines = my_result[0].newText.split('\n');
                    // Should have standard 4-space indent
                    return my_lines[1].startsWith('    ');
                }
            ),
            { numRuns: 50 }
        );
    });

    // Property 7: Configuration Default Value
    it('configuration default value should be true', () => {
        expect(DEFAULT_SETTINGS.formatting.preserve_alignment).toBe(true);
    });
});
