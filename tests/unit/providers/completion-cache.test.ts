/**
 * Unit tests for CompletionProvider merged symbol cache functionality.
 */

import { describe, it, expect, beforeEach, spyOn, mock } from 'bun:test';
import { CompletionProvider } from '../../../src/providers/completion';
import { CommandDatabase } from '../../../src/command-database';
import { DocumentState } from '../../../src/document-store';
import { SymbolTable } from '../../../src/types';
import { Position } from 'vscode-languageserver';
import { CompletionPrefixCache } from '../../../src/utils/lru-cache';
import * as analyzer from '../../../src/analyzer';

describe('CompletionProvider Cache', () => {
    let provider: CompletionProvider;
    let command_db: CommandDatabase;
    let mock_document: DocumentState;
    let mock_workspace_symbols: SymbolTable;

    beforeEach(() => {
        command_db = new CommandDatabase();
        provider = new CompletionProvider(command_db);
        
        // Mock document state
        mock_document = {
            uri: 'file:///test.do',
            content: 'local test = 1',
            version: 1,
            symbols: {
                programs: new Map(),
                localMacros: new Map([['test', { name: 'test', value: '1', sourceUri: 'file:///test.do' }]]),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            tokens: [],
            ast: null,
            diagnostics: [],
            line_offsets: [0, 15],
            context_ranges: [],
            context_tracker: undefined,
            forward_calls: [],
        } as unknown as DocumentState;

        // Mock workspace symbols
        mock_workspace_symbols = {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map([['workspace_global', { name: 'workspace_global', value: 'test', sourceUri: 'file:///other.do' }]]),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        } as unknown as SymbolTable;
    });

    describe('merged symbol cache hits', () => {
        it('should hit cache on second request (no merge_symbol_tables call)', async () => {
            const merge_spy = spyOn(analyzer, 'merge_symbol_tables');
            const position = Position.create(0, 10);
            const workspace_version = 1;

            // First call - should call merge_symbol_tables
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            const first_call_count = merge_spy.mock.calls.length;
            expect(first_call_count).toBeGreaterThan(0);

            // Second call with same doc/version - should NOT call merge_symbol_tables again
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            // Call count should be unchanged (cache hit)
            expect(merge_spy.mock.calls.length).toBe(first_call_count);

            merge_spy.mockRestore();
        });

        it('should return identical results from cache', async () => {
            const position = Position.create(0, 10);
            const workspace_version = 1;

            const completions1 = await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            const completions2 = await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            expect(completions1).toEqual(completions2);
        });
    });

    describe('cache invalidation on document changes', () => {
        it('should invalidate cache when document version changes', async () => {
            const merge_spy = spyOn(analyzer, 'merge_symbol_tables');
            const position = Position.create(0, 10);
            const workspace_version = 1;

            // First call
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            const first_call_count = merge_spy.mock.calls.length;

            // Second call with different document version - should rebuild
            const updated_document = { ...mock_document, version: 2 };
            await provider.get_completions(
                updated_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            // Should have called merge_symbol_tables again
            expect(merge_spy.mock.calls.length).toBeGreaterThan(first_call_count);

            merge_spy.mockRestore();
        });

        it('should invalidate cache when workspace version changes', async () => {
            const merge_spy = spyOn(analyzer, 'merge_symbol_tables');
            const position = Position.create(0, 10);

            // First call with workspace version 1
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                1
            );

            const first_call_count = merge_spy.mock.calls.length;

            // Second call with workspace version 2 - should rebuild
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                2
            );

            // Should have called merge_symbol_tables again
            expect(merge_spy.mock.calls.length).toBeGreaterThan(first_call_count);

            merge_spy.mockRestore();
        });

    });

    describe('cache isolation by document URI', () => {
        it('should maintain separate cache entries per document URI', async () => {
            const merge_spy = spyOn(analyzer, 'merge_symbol_tables');
            const position = Position.create(0, 10);
            const workspace_version = 1;

            // First document
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            const after_first_doc = merge_spy.mock.calls.length;

            // Second document with different URI - should build new cache entry
            const other_document = { 
                ...mock_document, 
                uri: 'file:///other.do',
            };

            await provider.get_completions(
                other_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            expect(merge_spy.mock.calls.length).toBeGreaterThan(after_first_doc);

            // Third call to first document - should hit cache
            await provider.get_completions(
                mock_document,
                position,
                undefined,
                undefined,
                mock_workspace_symbols,
                undefined,
                undefined,
                workspace_version
            );

            // No additional merge calls for first document
            const after_third_call = merge_spy.mock.calls.length;
            expect(after_third_call).toBe(after_first_doc + 1); // Only one extra for other.do

            merge_spy.mockRestore();
        });
    });

    describe('symbol merging behavior', () => {
        it('should merge document symbols on top of workspace symbols', async () => {
            const position = Position.create(0, 10);
            const workspace_version = 1;

            // Add conflicting symbol in workspace
            const conflicting_workspace = {
                ...mock_workspace_symbols,
                localMacros: new Map([['test', { name: 'test', value: 'workspace', sourceUri: 'file:///other.do' }]])
            } as unknown as SymbolTable;

            const completions = await provider.get_completions(
                mock_document,
                position,
                '`',  // Trigger local macro completion
                undefined,
                conflicting_workspace,
                undefined,
                undefined,
                workspace_version
            );

            // Should find the local macro completion
            const test_completion = completions.find(c => c.label === 'test');
            expect(test_completion).toBeDefined();
            expect(test_completion?.documentation).toContain('Value: 1'); // Document version wins
        });
    });

    describe('prefix cache top-N trimming', () => {
        it('should trim cached results when storing in the prefix cache', () => {
            const small_cache = new CompletionPrefixCache(5, 3);
            const completions = new Array(6).fill(null).map((_, i) => ({ label: `item${i}` }));
            const stored = small_cache.set_with_context('pre', 'command', completions, 1);
            expect(stored.length).toBe(3);
            const cached = small_cache.get_with_context('pre', 'command', 1);
            expect(cached?.length).toBe(3);
        });
    });
});
