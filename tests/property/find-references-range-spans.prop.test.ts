/**
 * Property Test: Complete Range Spans for Find References
 * 
 * Feature: find-references
 * Property 11: Complete Range Spans
 * 
 * For any reference in the results, the range SHALL span the complete symbol
 * reference including delimiters (e.g., `name' for local macros, $name for
 * global macros).
 * 
 * Validates: Requirements 5.3
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';

describe('Feature: find-references, Property 11: Complete Range Spans', () => {
    const provider = new ReferencesProvider();
    const lexer = new StataLexer();

    // Generator for valid Stata identifiers
    const arbitrary_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
        { minLength: 2, maxLength: 10 }
    ).filter(s => /^[a-zA-Z_]/.test(s));

    /**
     * Create a minimal DocumentState for testing.
     */
    function create_document_state(uri: string, content: string): DocumentState {
        const lexer_result = lexer.tokenize(content);
        return {
            uri,
            content,
            version: 1,
            tokens: lexer_result.tokens,
            ast: null as any,
            symbols: {
                localMacros: new Map(),
                globalMacros: new Map(),
                programs: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            diagnostics: [],
            context_ranges: [],
            line_offsets: null,
        };
    }

    it('should include backtick and quote in local macro ranges', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                async (macro_name) => {
                    // Create content with a local macro reference
                    const content = `display \`${macro_name}'`;
                    const document = create_document_state(
                        'file:///workspace/local.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should find the reference
                    expect(results.length).toBeGreaterThanOrEqual(1);

                    // Check that the range includes the full `name' syntax
                    for (const my_result of results) {
                        const start_char = my_result.range.start.character;
                        const end_char = my_result.range.end.character;
                        const range_text = content.substring(start_char, end_char);
                        
                        // Range should include backtick and quote
                        expect(range_text.startsWith('`')).toBe(true);
                        expect(range_text.endsWith("'")).toBe(true);
                        // Range should contain the macro name
                        expect(range_text.includes(macro_name)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should include $ in global macro ranges', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                async (macro_name) => {
                    // Create content with a global macro reference
                    const content = `display $${macro_name}`;
                    const document = create_document_state(
                        'file:///workspace/global.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    // Should find the reference
                    expect(results.length).toBeGreaterThanOrEqual(1);

                    // Check that the range includes the $ prefix
                    for (const my_result of results) {
                        const start_char = my_result.range.start.character;
                        const end_char = my_result.range.end.character;
                        const range_text = content.substring(start_char, end_char);
                        
                        // Range should include $
                        expect(range_text.startsWith('$')).toBe(true);
                        // Range should contain the macro name
                        expect(range_text.includes(macro_name)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should include ${} in braced global macro ranges', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                async (macro_name) => {
                    // Create content with a braced global macro reference
                    const content = `display \${${macro_name}}`;
                    const document = create_document_state(
                        'file:///workspace/braced.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 12 },
                        { includeDeclaration: false }
                    );

                    // Should find the reference
                    expect(results.length).toBeGreaterThanOrEqual(1);

                    // Check that the range includes the ${} syntax
                    for (const my_result of results) {
                        const start_char = my_result.range.start.character;
                        const end_char = my_result.range.end.character;
                        const range_text = content.substring(start_char, end_char);
                        
                        // Range should include ${ and }
                        expect(range_text.startsWith('${')).toBe(true);
                        expect(range_text.endsWith('}')).toBe(true);
                        // Range should contain the macro name
                        expect(range_text.includes(macro_name)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should span complete word for program references', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                async (program_name) => {
                    // Create content with a program call
                    const content = `${program_name} arg1 arg2`;
                    const document = create_document_state(
                        'file:///workspace/program.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 2 },
                        { includeDeclaration: false }
                    );

                    // Should find the reference
                    expect(results.length).toBeGreaterThanOrEqual(1);

                    // Check that the range spans the complete word
                    for (const my_result of results) {
                        const start_char = my_result.range.start.character;
                        const end_char = my_result.range.end.character;
                        const range_text = content.substring(start_char, end_char);
                        
                        // Range should be exactly the program name
                        expect(range_text).toBe(program_name);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
