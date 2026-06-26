/**
 * Integration tests for cache invalidation and symbol resolution accuracy.
 *
 * Tests verify:
 * 1. Cache invalidation happens properly on file changes
 * 2. Symbol resolution remains accurate with caching layers
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { WorkspaceIndexer } from '../../src/indexer';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { CompletionProvider } from '../../src/providers/completion';
import { URI } from 'vscode-uri';
import { create_document_state } from '../property/helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataDiagnosticCode } from '../../src/types';

describe('Cache Invalidation Integration Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-inv-test-'));

        const content_provider = {
            read_file: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                return fs.promises.readFile(fs_path, 'utf8');
            },
            exists: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                try {
                    await fs.promises.access(fs_path);
                    return true;
                } catch {
                    return false;
                }
            }
        };

        scope_resolver = new ScopeResolver(undefined, content_provider);
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    describe('File Cache Invalidation', () => {
        test('modifying parent file invalidates cached symbols', async () => {
            // Use relative path in directive
            write_file('parent.do', 'global old_var = 1');
            const parent_uri = URI.file(path.join(temp_dir, 'parent.do')).toString();

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $old_var`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            // First resolve
            const result1 = await scope_resolver.resolve(child_uri, child_content);
            expect(result1.symbols.globalMacros.has('old_var')).toBe(true);
            expect(result1.symbols.globalMacros.has('new_var')).toBe(false);

            // Modify parent file
            fs.writeFileSync(path.join(temp_dir, 'parent.do'), 'global new_var = 2');
            scope_resolver.invalidate_file_cache(parent_uri);

            // Resolve again - should see new symbol
            const result2 = await scope_resolver.resolve(child_uri, child_content);
            expect(result2.symbols.globalMacros.has('new_var')).toBe(true);
            expect(result2.symbols.globalMacros.has('old_var')).toBe(false);
        });

        test('deleting parent file produces diagnostic', async () => {
            const parent_path = write_file('parent.do', 'global parent_var = 1');
            const parent_uri = URI.file(parent_path).toString();

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $parent_var`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            // First resolve - works
            const result1 = await scope_resolver.resolve(child_uri, child_content);
            expect(result1.diagnostics.filter(d => d.message.includes('Cannot read'))).toHaveLength(0);

            // Delete parent
            fs.unlinkSync(parent_path);
            scope_resolver.invalidate_file_cache(parent_uri);

            // Resolve again - should have diagnostic
            const result2 = await scope_resolver.resolve(child_uri, child_content);
            expect(result2.diagnostics.filter(d => d.message.includes('Cannot read')).length).toBeGreaterThan(0);
        });

        test('scope cache invalidation preserves file cache', async () => {
            write_file('parent.do', 'global parent_var = 1');

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = 1`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            // First resolve
            await scope_resolver.resolve(child_uri, child_content);
            scope_resolver.reset_cache_metrics();

            // Invalidate scope cache only
            scope_resolver.invalidate_scope_cache(child_uri);

            // Resolve again - file cache should hit
            await scope_resolver.resolve(child_uri, child_content);
            const metrics = scope_resolver.get_cache_metrics();
            expect(metrics.file.hits).toBe(1);
            expect(metrics.file.misses).toBe(0);
        });

        test('cascading invalidation through directive chain', async () => {
            write_file('grandparent.do', 'global gp_var = 1');
            const grandparent_uri = URI.file(path.join(temp_dir, 'grandparent.do')).toString();

            write_file('parent.do', `// @lsp-done-by: "grandparent.do"\nglobal parent_var = 2`);

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $gp_var`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            // First resolve - loads entire chain
            const result1 = await scope_resolver.resolve(child_uri, child_content);
            expect(result1.symbols.globalMacros.has('gp_var')).toBe(true);

            // Modify grandparent
            fs.writeFileSync(path.join(temp_dir, 'grandparent.do'), 'global new_gp_var = 3');
            scope_resolver.invalidate_file_cache(grandparent_uri);

            // Resolve child - should see cascaded changes
            const result2 = await scope_resolver.resolve(child_uri, child_content);
            expect(result2.symbols.globalMacros.has('new_gp_var')).toBe(true);
            expect(result2.symbols.globalMacros.has('gp_var')).toBe(false);
        });
    });

    describe('Forward Call Cache Invalidation', () => {
        test('modifying callee file updates forward-resolved symbols', async () => {
            write_file('callee.do', 'global callee_var = 1');
            const callee_uri = URI.file(path.join(temp_dir, 'callee.do')).toString();

            const caller_content = `do "callee.do"\nlocal x = $callee_var`;
            const caller_path = write_file('caller.do', caller_content);
            const caller_uri = URI.file(caller_path).toString();

            // First resolve - forward calls are stored in forward_call_symbols
            const result1 = await scope_resolver.resolve(caller_uri, caller_content);
            expect(result1.forward_call_symbols).toBeDefined();
            expect(result1.forward_call_symbols?.length).toBeGreaterThan(0);
            const callee_symbols1 = result1.forward_call_symbols?.[0]?.symbols;
            expect(callee_symbols1?.globalMacros.has('callee_var')).toBe(true);

            // Modify callee
            fs.writeFileSync(path.join(temp_dir, 'callee.do'), 'global new_callee_var = 2');
            scope_resolver.invalidate_file_cache(callee_uri);

            // Resolve again - need to also invalidate scope cache since content changed
            scope_resolver.invalidate_scope_cache(caller_uri);
            const result2 = await scope_resolver.resolve(caller_uri, caller_content);
            const callee_symbols2 = result2.forward_call_symbols?.[0]?.symbols;
            expect(callee_symbols2?.globalMacros.has('new_callee_var')).toBe(true);
        });

        test('adding new forward call picks up new symbols', async () => {
            write_file('callee.do', 'global callee_var = 1');

            const caller_content_v1 = 'local x = 1';
            const caller_path = write_file('caller.do', caller_content_v1);
            const caller_uri = URI.file(caller_path).toString();

            const result1 = await scope_resolver.resolve(caller_uri, caller_content_v1);
            expect(result1.forward_call_symbols).toBeUndefined();

            const caller_content_v2 = `do "callee.do"\nlocal x = $callee_var`;
            scope_resolver.invalidate_scope_cache(caller_uri);

            const result2 = await scope_resolver.resolve(caller_uri, caller_content_v2);
            expect(result2.forward_call_symbols).toBeDefined();
            expect(result2.forward_call_symbols?.length).toBeGreaterThan(0);
        });
    });

    describe('Symbol Resolution Accuracy with Caching', () => {
        test('symbols from multiple parents merge correctly', async () => {
            write_file('parent1.do', 'global var1 = 1');
            write_file('parent2.do', 'global var2 = 2');

            const child_content = `// @lsp-done-by: "parent1.do"\n// @lsp-done-by: "parent2.do"\nlocal x = $var1 + $var2`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            const result = await scope_resolver.resolve(child_uri, child_content);
            expect(result.symbols.globalMacros.has('var1')).toBe(true);
            expect(result.symbols.globalMacros.has('var2')).toBe(true);
        });

        test('call-site filtering respects execution order', async () => {
            write_file('parent.do', `global before_call = 1
do "child.do"
global after_call = 2`);

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $before_call`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            const result = await scope_resolver.resolve(child_uri, child_content);
            expect(result.symbols.globalMacros.has('before_call')).toBe(true);
            expect(result.out_of_scope_symbols.some(s => s.name === 'after_call')).toBe(true);
        });

        test('local macros only inherited via include directive', async () => {
            write_file('parent.do', 'local parent_local = 1\nglobal parent_global = 2');

            // done-by should NOT inherit locals
            const child_done_content = `// @lsp-done-by: "parent.do"\nlocal x = \`parent_local'`;
            const child_done_path = write_file('child_done.do', child_done_content);
            const child_done_uri = URI.file(child_done_path).toString();

            const result_done = await scope_resolver.resolve(child_done_uri, child_done_content);
            expect(result_done.symbols.localMacros.has('parent_local')).toBe(false);
            expect(result_done.symbols.globalMacros.has('parent_global')).toBe(true);

            // included-by SHOULD inherit locals
            const child_include_content = `// @lsp-included-by: "parent.do"\nlocal x = \`parent_local'`;
            const child_include_path = write_file('child_include.do', child_include_content);
            const child_include_uri = URI.file(child_include_path).toString();

            const result_include = await scope_resolver.resolve(child_include_uri, child_include_content);
            expect(result_include.symbols.localMacros.has('parent_local')).toBe(true);
            expect(result_include.symbols.globalMacros.has('parent_global')).toBe(true);
        });

        test('current file symbols override inherited symbols', async () => {
            write_file('parent.do', 'global shared_var = "parent_value"');

            const child_content = `// @lsp-done-by: "parent.do"\nglobal shared_var = "child_value"`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            const result = await scope_resolver.resolve(child_uri, child_content);
            const shared_var = result.symbols.globalMacros.get('shared_var');
            expect(shared_var).toBeDefined();
            expect(shared_var?.location.uri).toBe(child_uri);
        });
    });

    describe('Diagnostics Accuracy with Caching', () => {
        test('undefined macro warning suppressed by cross-file resolution', async () => {
            write_file('parent.do', 'global fruit = 1\ndo "child.do"');

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $fruit\nlocal y = $other`;
            const child_path = write_file('child.do', child_content);

            const child_document = create_document_state(child_content);
            child_document.uri = URI.file(child_path).toString();

            const diagnostics_provider = new DiagnosticsProvider();
            const diagnostics = await diagnostics_provider.get_diagnostics(
                child_document,
                DEFAULT_SETTINGS,
                undefined,
                scope_resolver
            );

            // other SHOULD produce warning (not defined anywhere)
            const other_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'other'
            );
            expect(other_warnings).toHaveLength(1);

            // fruit should NOT produce warning (inherited from parent)
            const fruit_warnings = diagnostics.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'fruit'
            );
            expect(fruit_warnings).toHaveLength(0);
        });

        test('out-of-scope symbol produces information diagnostic', async () => {
            write_file('parent.do', `global before_call = 1
do "child.do"
global after_call = 2`);

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $after_call`;
            const child_path = write_file('child.do', child_content);

            const child_document = create_document_state(child_content);
            child_document.uri = URI.file(child_path).toString();

            const diagnostics_provider = new DiagnosticsProvider();
            const diagnostics = await diagnostics_provider.get_diagnostics(
                child_document,
                DEFAULT_SETTINGS,
                undefined,
                scope_resolver
            );

            // after_call should produce some diagnostic
            const after_call_diagnostics = diagnostics.filter(d =>
                d.message.includes('after_call')
            );
            expect(after_call_diagnostics.length).toBeGreaterThan(0);
        });
    });

    describe('Workspace Indexer Cache Behavior', () => {
        test('indexer updates symbols on file change', async () => {
            const indexer = new WorkspaceIndexer();

            const file_path = write_file('test.do', 'global old_indexed = 1');
            await indexer.initialize([temp_dir]);

            let symbols = indexer.get_all_symbols();
            expect(symbols.globalMacros.has('old_indexed')).toBe(true);

            fs.writeFileSync(file_path, 'global new_indexed = 2');
            await indexer.index_file(file_path);

            symbols = indexer.get_all_symbols();
            expect(symbols.globalMacros.has('new_indexed')).toBe(true);
            expect(symbols.globalMacros.has('old_indexed')).toBe(false);
        });

        test('indexer removes symbols on file delete', async () => {
            const indexer = new WorkspaceIndexer();

            const file_path = write_file('to_delete.do', 'global to_delete_var = 1');
            await indexer.initialize([temp_dir]);

            let symbols = indexer.get_all_symbols();
            expect(symbols.globalMacros.has('to_delete_var')).toBe(true);

            fs.unlinkSync(file_path);
            indexer.remove_file(file_path);

            symbols = indexer.get_all_symbols();
            expect(symbols.globalMacros.has('to_delete_var')).toBe(false);
        });
    });

    describe('Document Store Cache Behavior', () => {
        test('document store updates on content change', async () => {
            const document_store = new DocumentStore();

            const file_path = write_file('doc.do', 'local old_local = 1');
            const file_uri = URI.file(file_path).toString();

            await document_store.open(file_uri, 'local old_local = 1', 1);
            let state = document_store.get(file_uri);
            expect(state?.symbols.localMacros.has('old_local')).toBe(true);

            await document_store.update(file_uri, [{ text: 'local new_local = 2' }], 2);

            state = document_store.get(file_uri);
            expect(state?.symbols.localMacros.has('new_local')).toBe(true);
            expect(state?.symbols.localMacros.has('old_local')).toBe(false);
        });

        test('document store skips reparse on unchanged content', async () => {
            const document_store = new DocumentStore();

            const content = 'local x = 1';
            const file_uri = 'file:///test.do';

            await document_store.open(file_uri, content, 1);
            const metrics_before = document_store.get_metrics();

            await document_store.update(file_uri, [{ text: content }], 2);
            const metrics_after = document_store.get_metrics();

            expect(metrics_after.cache_hits).toBeGreaterThan(metrics_before.cache_hits);
        });
    });

    describe('Completion Accuracy with Caching', () => {
        test('completions include cross-file symbols via directive', async () => {
            write_file('parent.do', 'global parent_completion_var = 1\ndo "child.do"');

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $p`;
            const child_path = write_file('child.do', child_content);

            const child_document = create_document_state(child_content);
            child_document.uri = URI.file(child_path).toString();

            const completion_provider = new CompletionProvider();
            const completions = await completion_provider.get_completions(
                child_document,
                { line: 1, character: 12 },  // After $p
                undefined,  // trigger_character
                scope_resolver
            );

            const parent_var_completion = completions.find(c => c.label === 'parent_completion_var');
            expect(parent_var_completion).toBeDefined();
        });

        test('completions update after cache invalidation', async () => {
            write_file('parent.do', 'global old_completion = 1\ndo "child.do"');
            const parent_uri = URI.file(path.join(temp_dir, 'parent.do')).toString();

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = $o`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            const child_document = create_document_state(child_content);
            child_document.uri = child_uri;

            const completion_provider = new CompletionProvider();

            let completions = await completion_provider.get_completions(
                child_document,
                { line: 1, character: 12 },  // After $o
                undefined,  // trigger_character
                scope_resolver
            );
            expect(completions.find(c => c.label === 'old_completion')).toBeDefined();

            fs.writeFileSync(path.join(temp_dir, 'parent.do'), 'global new_completion = 2\ndo "child.do"');
            scope_resolver.invalidate_file_cache(parent_uri);

            // Update child content to match new prefix
            const child_content_v2 = `// @lsp-done-by: "parent.do"\nlocal x = $n`;
            const child_document_v2 = create_document_state(child_content_v2);
            child_document_v2.uri = child_uri;

            completions = await completion_provider.get_completions(
                child_document_v2,
                { line: 1, character: 12 },  // After $n
                undefined,  // trigger_character
                scope_resolver
            );
            expect(completions.find(c => c.label === 'new_completion')).toBeDefined();
            expect(completions.find(c => c.label === 'old_completion')).toBeUndefined();
        });
    });

    describe('Hash-based Cache Validation', () => {
        test('unchanged content returns cached scope', async () => {
            write_file('parent.do', 'global parent_var = 1');

            const child_content = `// @lsp-done-by: "parent.do"\nlocal x = 1`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            await scope_resolver.resolve(child_uri, child_content);
            scope_resolver.reset_cache_metrics();

            await scope_resolver.resolve(child_uri, child_content);
            const metrics = scope_resolver.get_cache_metrics();
            expect(metrics.scope.hits).toBe(1);
        });

        test('changed content invalidates scope cache', async () => {
            write_file('parent.do', 'global parent_var = 1');

            const child_content_v1 = `// @lsp-done-by: "parent.do"\nlocal x = 1`;
            const child_path = write_file('child.do', child_content_v1);
            const child_uri = URI.file(child_path).toString();

            await scope_resolver.resolve(child_uri, child_content_v1);
            scope_resolver.reset_cache_metrics();

            const child_content_v2 = `// @lsp-done-by: "parent.do"\nlocal y = 2`;
            await scope_resolver.resolve(child_uri, child_content_v2);
            const metrics = scope_resolver.get_cache_metrics();
            expect(metrics.scope.misses).toBe(1);
        });
    });
});
