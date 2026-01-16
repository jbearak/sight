/**
 * Property Test: Find References - Invalid Position
 * 
 * Tests that cursor on whitespace, comments, operators returns empty array.
 * 
 * Tag: Feature: find-references, Property 2: Empty Result for Invalid Position
 */

import * as fc from 'fast-check';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentState } from '../../src/document-store';
import { Position } from 'vscode-languageserver';

describe('ReferencesProvider - Invalid Position Property Tests', () => {
    const references_provider = new ReferencesProvider();

    test('Property 2: Empty Result for Invalid Position', async () => {
        await fc.assert(
            fc.asyncProperty(
                // Generate documents with various invalid cursor positions
                fc.record({
                    content: fc.oneof(
                        // Whitespace-only content
                        fc.constantFrom('   ', '\t\t', '\n\n', '  \n  \t  \n'),
                        // Comment-only content
                        fc.constantFrom('* This is a comment', '// Another comment', '/* Block comment */'),
                        // Operator-only content
                        fc.constantFrom('+ - * /', '== != < >', '& | !'),
                        // Mixed invalid content
                        fc.constantFrom('  * comment  ', '\t// comment\n', '  +  -  ')
                    ),
                    line: fc.integer({ min: 0, max: 5 }),
                    character: fc.integer({ min: 0, max: 20 })
                }),
                async ({ content, line, character }) => {
                    const document: DocumentState = {
                        uri: 'test://test.do',
                        content,
                        version: 1,
                        tokens: [],
                        ast: { nodes: [] },
                        symbols: {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        },
                        line_offsets: undefined,
                    };

                    const position: Position = { line, character };
                    const context = { includeDeclaration: true };

                    const result = await references_provider.get_references(
                        document,
                        position,
                        context
                    );

                    // Should return empty array for invalid positions
                    expect(result).toEqual([]);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 2: Empty Result for Out-of-Bounds Position', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    content: fc.constantFrom('local x = 1', 'display "hello"', 'gen y = 2'),
                    line: fc.integer({ min: 10, max: 100 }), // Way beyond content
                    character: fc.integer({ min: 0, max: 50 })
                }),
                async ({ content, line, character }) => {
                    const document: DocumentState = {
                        uri: 'test://test.do',
                        content,
                        version: 1,
                        tokens: [],
                        ast: { nodes: [] },
                        symbols: {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        },
                        line_offsets: undefined,
                    };

                    const position: Position = { line, character };
                    const context = { includeDeclaration: true };

                    const result = await references_provider.get_references(
                        document,
                        position,
                        context
                    );

                    // Should return empty array for out-of-bounds positions
                    expect(result).toEqual([]);
                }
            ),
            { numRuns: 100 }
        );
    });
});