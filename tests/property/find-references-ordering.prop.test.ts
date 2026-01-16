/**
 * Property Test: Deterministic Ordering for Find References
 * 
 * Feature: find-references
 * Property 6: Deterministic Ordering
 * 
 * For any set of references, the results SHALL be sorted first by file URI
 * (ascending lexicographic), then by line number (ascending), then by
 * character position (ascending).
 * 
 * Validates: Requirements 6.1, 6.2, 6.3
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { Location } from 'vscode-languageserver';

describe('Feature: find-references, Property 6: Deterministic Ordering', () => {
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

    /**
     * Check if locations are sorted correctly.
     */
    function is_sorted(locations: Location[]): boolean {
        for (let i = 1; i < locations.length; i++) {
            const prev = locations[i - 1];
            const curr = locations[i];
            
            // Compare by URI first
            if (prev.uri > curr.uri) return false;
            if (prev.uri < curr.uri) continue;
            
            // Same URI, compare by line
            if (prev.range.start.line > curr.range.start.line) return false;
            if (prev.range.start.line < curr.range.start.line) continue;
            
            // Same line, compare by character
            if (prev.range.start.character > curr.range.start.character) return false;
        }
        return true;
    }

    it('should sort results by URI, then line, then character', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 2, max: 5 }),
                async (macro_name, line_count) => {
                    // Create content with multiple references on different lines
                    const the_lines: string[] = [];
                    for (let i = 0; i < line_count; i++) {
                        // Add some padding to vary character positions
                        const padding = '    '.repeat(line_count - i);
                        the_lines.push(`${padding}display \`${macro_name}'`);
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/test.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 12 },
                        { includeDeclaration: false }
                    );

                    // Results should be sorted
                    expect(is_sorted(results)).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should return same order on multiple calls', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 2, max: 5 }),
                async (macro_name, ref_count) => {
                    // Create content with multiple references
                    const the_lines: string[] = [];
                    for (let i = 0; i < ref_count; i++) {
                        the_lines.push(`display \`${macro_name}'`);
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/deterministic.do',
                        content
                    );

                    // Call get_references multiple times
                    const results1 = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    const results2 = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    const results3 = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false }
                    );

                    // All results should be identical
                    expect(results1.length).toBe(results2.length);
                    expect(results2.length).toBe(results3.length);

                    for (let i = 0; i < results1.length; i++) {
                        expect(results1[i].uri).toBe(results2[i].uri);
                        expect(results1[i].uri).toBe(results3[i].uri);
                        expect(results1[i].range.start.line).toBe(results2[i].range.start.line);
                        expect(results1[i].range.start.line).toBe(results3[i].range.start.line);
                        expect(results1[i].range.start.character).toBe(results2[i].range.start.character);
                        expect(results1[i].range.start.character).toBe(results3[i].range.start.character);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should sort by line number within same file', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 2, maxLength: 10 }),
                async (macro_name, line_numbers) => {
                    // Create content with references at specific line numbers
                    const max_line = Math.max(...line_numbers);
                    const the_lines: string[] = [];
                    
                    for (let i = 0; i <= max_line; i++) {
                        if (line_numbers.includes(i)) {
                            the_lines.push(`display \`${macro_name}'`);
                        } else {
                            the_lines.push('* comment');
                        }
                    }
                    const content = the_lines.join('\n');
                    
                    const document = create_document_state(
                        'file:///workspace/lines.do',
                        content
                    );

                    const results = await provider.get_references(
                        document,
                        { line: line_numbers[0], character: 10 },
                        { includeDeclaration: false }
                    );

                    // Verify line numbers are in ascending order
                    for (let i = 1; i < results.length; i++) {
                        expect(results[i].range.start.line).toBeGreaterThanOrEqual(
                            results[i - 1].range.start.line
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
