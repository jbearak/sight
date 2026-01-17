/**
 * Property-based tests for find-references includeDeclaration handling
 * 
 * Tests the behavior of the includeDeclaration flag in reference search results.
 */

import * as fc from 'fast-check';
import { Position, Range, ReferenceContext } from 'vscode-languageserver';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer, AnalysisResult } from '../../src/analyzer';
import { SymbolTable, MacroSymbol, ProgramSymbol, VariableSymbol, ScalarSymbol, MatrixSymbol } from '../../src/types';
import { arbitrary_non_reserved_identifier } from './generators';

describe('Find References - Include Declaration Properties', () => {
    const references_provider = new ReferencesProvider();

    // Helper to create a document with symbols
    function create_document_with_symbols(
        content: string,
        uri: string = 'file:///test.do'
    ): DocumentState {
        const lexer = new StataLexer();
        const parser = new StataParser();
        const analyzer = new SemanticAnalyzer();

        const lex_result = lexer.tokenize(content);
        const parse_result = parser.parse(lex_result.tokens);
        const analysis_result = analyzer.analyze(parse_result.ast, uri, undefined, undefined, lex_result.tokens);

        return {
            uri,
            version: 1,
            content,
            tokens: lex_result.tokens,
            ast: parse_result.ast,
            symbols: analysis_result.symbols,
            diagnostics: [],
            context_ranges: [],
            context_tracker: null as any,
            line_offsets: lex_result.line_offsets,
            forward_calls: analysis_result.forward_calls
        };
    }

    // Arbitraries for generating test data (excludes reserved qualifiers like if/in)
    const symbol_name_arb = arbitrary_non_reserved_identifier();
    const position_arb = fc.record({
        line: fc.integer({ min: 0, max: 10 }),
        character: fc.integer({ min: 0, max: 50 })
    });

    test('Property 3: Include Declaration When Requested', async () => {
        await fc.assert(
            fc.asyncProperty(
                symbol_name_arb,
                position_arb,
                async (symbol_name, ref_position) => {
                    // Create content with a local macro definition and reference
                    const content = `local ${symbol_name} "value"\ndisplay "\`${symbol_name}'"`;
                    const document = create_document_with_symbols(content);

                    // Find the reference position (second line)
                    const reference_pos: Position = { line: 1, character: 10 + symbol_name.length };

                    const context: ReferenceContext = { includeDeclaration: true };
                    const results = await references_provider.get_references(
                        document,
                        reference_pos,
                        context
                    );

                    // Should include both definition and reference
                    expect(results.length).toBeGreaterThanOrEqual(2);

                    // First result should be the definition (line 0)
                    expect(results[0].range.start.line).toBe(0);

                    // Should contain the reference (line 1)
                    const has_reference = results.some(loc => loc.range.start.line === 1);
                    expect(has_reference).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    }, 30000);

    test('Property 4: Exclude Declaration When Not Requested', async () => {
        await fc.assert(
            fc.asyncProperty(
                symbol_name_arb,
                position_arb,
                async (symbol_name, ref_position) => {
                    // Create content with a local macro definition and reference
                    const content = `local ${symbol_name} "value"\ndisplay "\`${symbol_name}'"`;
                    const document = create_document_with_symbols(content);

                    // Find the reference position (second line)
                    const reference_pos: Position = { line: 1, character: 10 + symbol_name.length };

                    const context: ReferenceContext = { includeDeclaration: false };
                    const results = await references_provider.get_references(
                        document,
                        reference_pos,
                        context
                    );

                    // Should not include the definition (line 0)
                    const has_definition = results.some(loc => loc.range.start.line === 0);
                    expect(has_definition).toBe(false);

                    // Should still contain the reference (line 1)
                    if (results.length > 0) {
                        const has_reference = results.some(loc => loc.range.start.line === 1);
                        expect(has_reference).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    }, 30000);
});