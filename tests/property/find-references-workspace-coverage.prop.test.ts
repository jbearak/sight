/**
 * Property Test: Workspace Coverage for Find References
 * 
 * Feature: find-references
 * Property 7: Workspace Coverage
 * 
 * For any workspace, find-references SHALL search all files tracked by the
 * WorkspaceIndexer and SHALL NOT search files not tracked by the indexer.
 * 
 * Validates: Requirements 3.1, 3.2
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ReferencesProvider, ReferenceSearchContext } from '../../src/providers/references';
import { Token, ContextRange } from '../../src/types';
import { DocumentState } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { IndexedFileData } from '../../src/indexer';

describe('Feature: find-references, Property 7: Workspace Coverage', () => {
    const provider = new ReferencesProvider();
    const lexer = new StataLexer();

    // Generator for valid Stata identifiers
    const arbitrary_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')),
        { minLength: 1, maxLength: 20 }
    ).filter(s => /^[a-zA-Z_]/.test(s));

    // Generator for local macro tokens
    const arbitrary_local_macro_token = (name: string, line: number): Token => ({
        type: 'MACRO_REF_LOCAL',
        value: `\`${name}'`,
        range: {
            start: { line, character: 0 },
            end: { line, character: name.length + 2 }
        }
    });

    // Generator for global macro tokens
    const arbitrary_global_macro_token = (name: string, line: number): Token => ({
        type: 'MACRO_REF_GLOBAL',
        value: `$${name}`,
        range: {
            start: { line, character: 0 },
            end: { line, character: name.length + 1 }
        }
    });

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
            context_tracker: null as any,
            line_offsets: lexer_result.line_offsets,
            forward_calls: [],
        };
    }

    function create_mock_indexer(indexed_files: Map<string, IndexedFileData>) {
        return {
            get_indexed_files: () => indexed_files,
        } as any;
    }

    it('should find references in all indexed files', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 2, max: 5 }),
                async (symbol_name, file_count) => {
                    // Create current document with macro reference
                    const content = `display \`${symbol_name}'`;
                    const document = create_document_state('file:///workspace/current.do', content);

                    // Create indexed files with the same macro
                    const indexed_files = new Map<string, IndexedFileData>();
                    for (let i = 0; i < file_count; i++) {
                        const uri = `file:///workspace/file${i}.do`;
                        indexed_files.set(uri, {
                            uri,
                            tokens: [arbitrary_local_macro_token(symbol_name, 0)],
                            context_ranges: undefined,
                        });
                    }

                    const mock_indexer = create_mock_indexer(indexed_files);

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false },
                        mock_indexer
                    );

                    // Should find references in current doc + all indexed files
                    expect(results.length).toBe(1 + file_count);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should not find references in files without the symbol', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                arbitrary_identifier.filter(s => s.length > 1),
                fc.integer({ min: 1, max: 5 }),
                async (search_name, other_name, file_count) => {
                    // Ensure names are different
                    fc.pre(search_name !== other_name);

                    // Create current document with search_name
                    const content = `display $${search_name}`;
                    const document = create_document_state('file:///workspace/current.do', content);

                    // Create indexed files with different symbol
                    const indexed_files = new Map<string, IndexedFileData>();
                    for (let i = 0; i < file_count; i++) {
                        const uri = `file:///workspace/file${i}.do`;
                        indexed_files.set(uri, {
                            uri,
                            tokens: [arbitrary_global_macro_token(other_name, 0)],
                            context_ranges: undefined,
                        });
                    }

                    const mock_indexer = create_mock_indexer(indexed_files);

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false },
                        mock_indexer
                    );

                    // Should only find reference in current document
                    expect(results.length).toBe(1);
                    expect(results[0].uri).toBe(document.uri);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should only search files that are indexed', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbitrary_identifier,
                fc.integer({ min: 1, max: 3 }),
                async (symbol_name, indexed_count) => {
                    // Create current document
                    const content = `display \`${symbol_name}'`;
                    const document = create_document_state('file:///workspace/current.do', content);

                    // Only add indexed files to the mock indexer
                    // Unindexed files are simply not in the map
                    const indexed_files = new Map<string, IndexedFileData>();
                    for (let i = 0; i < indexed_count; i++) {
                        const uri = `file:///workspace/indexed${i}.do`;
                        indexed_files.set(uri, {
                            uri,
                            tokens: [arbitrary_local_macro_token(symbol_name, 0)],
                            context_ranges: undefined,
                        });
                    }

                    const mock_indexer = create_mock_indexer(indexed_files);

                    const results = await provider.get_references(
                        document,
                        { line: 0, character: 10 },
                        { includeDeclaration: false },
                        mock_indexer
                    );

                    // Should find: 1 (current doc) + indexed_count (indexed files)
                    expect(results.length).toBe(1 + indexed_count);

                    // Verify all results are from expected URIs
                    const result_uris = new Set(results.map(r => r.uri));
                    expect(result_uris.has(document.uri)).toBe(true);
                    for (let i = 0; i < indexed_count; i++) {
                        expect(result_uris.has(`file:///workspace/indexed${i}.do`)).toBe(true);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});
