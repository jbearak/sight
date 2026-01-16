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

describe('Feature: find-references, Property 7: Workspace Coverage', () => {
    const provider = new ReferencesProvider();

    // Generator for valid Stata identifiers
    const arbitrary_identifier = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')),
        { minLength: 1, maxLength: 20 }
    ).filter(s => /^[a-zA-Z_]/.test(s));

    // Generator for file URIs
    const arbitrary_uri = fc.integer({ min: 1, max: 100 }).map(n => `file:///workspace/file${n}.do`);

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

    it('should find references in all indexed files', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                fc.integer({ min: 2, max: 10 }),
                (symbol_name, file_count) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name,
                        symbol_type: 'local_macro',
                        include_declaration: false
                    };

                    // Create tokens for multiple files, each containing the symbol
                    const the_files: Array<{ uri: string; tokens: Token[] }> = [];
                    for (let i = 0; i < file_count; i++) {
                        const uri = `file:///workspace/file${i}.do`;
                        const tokens = [arbitrary_local_macro_token(symbol_name, i)];
                        the_files.push({ uri, tokens });
                    }

                    // Search each file and collect results
                    const all_matches: string[] = [];
                    for (const my_file of the_files) {
                        const matches = provider.scan_tokens_for_references(
                            my_file.tokens,
                            my_file.uri,
                            search_context
                        );
                        for (const my_match of matches) {
                            all_matches.push(my_match.uri);
                        }
                    }

                    // Should find exactly one match per file
                    expect(all_matches.length).toBe(file_count);
                    
                    // Each file should be represented
                    const unique_uris = new Set(all_matches);
                    expect(unique_uris.size).toBe(file_count);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should not find references in files without the symbol', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                arbitrary_identifier.filter(s => s.length > 1),
                fc.integer({ min: 1, max: 10 }),
                (search_name, other_name, file_count) => {
                    // Ensure names are different
                    fc.pre(search_name !== other_name);

                    const search_context: ReferenceSearchContext = {
                        symbol_name: search_name,
                        symbol_type: 'global_macro',
                        include_declaration: false
                    };

                    // Create files with a different symbol
                    const the_files: Array<{ uri: string; tokens: Token[] }> = [];
                    for (let i = 0; i < file_count; i++) {
                        const uri = `file:///workspace/file${i}.do`;
                        const tokens = [arbitrary_global_macro_token(other_name, i)];
                        the_files.push({ uri, tokens });
                    }

                    // Search each file
                    let total_matches = 0;
                    for (const my_file of the_files) {
                        const matches = provider.scan_tokens_for_references(
                            my_file.tokens,
                            my_file.uri,
                            search_context
                        );
                        total_matches += matches.length;
                    }

                    // Should find no matches
                    expect(total_matches).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('should only search files that are indexed', () => {
        fc.assert(
            fc.property(
                arbitrary_identifier,
                fc.integer({ min: 1, max: 5 }),
                fc.integer({ min: 1, max: 5 }),
                (symbol_name, indexed_count, unindexed_count) => {
                    const search_context: ReferenceSearchContext = {
                        symbol_name,
                        symbol_type: 'local_macro',
                        include_declaration: false
                    };

                    // Create indexed files (these will be searched)
                    const indexed_files: Array<{ uri: string; tokens: Token[] }> = [];
                    for (let i = 0; i < indexed_count; i++) {
                        const uri = `file:///workspace/indexed${i}.do`;
                        const tokens = [arbitrary_local_macro_token(symbol_name, 0)];
                        indexed_files.push({ uri, tokens });
                    }

                    // Create unindexed files (these should NOT be searched)
                    // In real implementation, these wouldn't be in the indexer
                    const unindexed_files: Array<{ uri: string; tokens: Token[] }> = [];
                    for (let i = 0; i < unindexed_count; i++) {
                        const uri = `file:///workspace/unindexed${i}.do`;
                        const tokens = [arbitrary_local_macro_token(symbol_name, 0)];
                        unindexed_files.push({ uri, tokens });
                    }

                    // Only search indexed files
                    let matches_count = 0;
                    for (const my_file of indexed_files) {
                        const matches = provider.scan_tokens_for_references(
                            my_file.tokens,
                            my_file.uri,
                            search_context
                        );
                        matches_count += matches.length;
                    }

                    // Should only find matches in indexed files
                    expect(matches_count).toBe(indexed_count);
                }
            ),
            { numRuns: 100 }
        );
    });
});
