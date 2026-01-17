/**
 * Unit tests for find-references includeDeclaration handling
 */

import { describe, it, expect } from 'bun:test';
import { Position, ReferenceContext } from 'vscode-languageserver';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';

describe('References Provider - Include Declaration', () => {
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

    it('should include definition when includeDeclaration is true', async () => {
        const content = `local myvar "value"\ndisplay "\`myvar'"`;
        const document = create_document_with_symbols(content);

        // Position on the reference (second line)
        const position: Position = { line: 1, character: 12 };
        const context: ReferenceContext = { includeDeclaration: true };

        const results = await references_provider.get_references(document, position, context);

        // Should have at least 2 results (definition + reference)
        expect(results.length).toBeGreaterThanOrEqual(2);

        // First result should be the definition (line 0)
        expect(results[0].range.start.line).toBe(0);

        // Should contain the reference (line 1)
        const has_reference = results.some(loc => loc.range.start.line === 1);
        expect(has_reference).toBe(true);
    });

    it('should exclude definition when includeDeclaration is false', async () => {
        const content = `local myvar "value"\ndisplay "\`myvar'"`;
        const document = create_document_with_symbols(content);

        // Position on the reference (second line)
        const position: Position = { line: 1, character: 12 };
        const context: ReferenceContext = { includeDeclaration: false };

        const results = await references_provider.get_references(document, position, context);

        // Should not include the definition (line 0)
        const has_definition = results.some(loc => loc.range.start.line === 0);
        expect(has_definition).toBe(false);

        // Should still contain the reference (line 1) if any results
        if (results.length > 0) {
            const has_reference = results.some(loc => loc.range.start.line === 1);
            expect(has_reference).toBe(true);
        }
    });

    it('should handle case where definition does not exist', async () => {
        const content = `display "\`undefined_var'"`;
        const document = create_document_with_symbols(content);

        // Position on the undefined reference
        const position: Position = { line: 0, character: 12 };
        const context: ReferenceContext = { includeDeclaration: true };

        const results = await references_provider.get_references(document, position, context);

        // Should still return the reference even without definition
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].range.start.line).toBe(0);
    });
});