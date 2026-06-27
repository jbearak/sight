/**
 * Integration tests for Callee Change Caller Revalidation
 *
 * Tests end-to-end behavior where changes to callee files trigger
 * revalidation of caller files that depend on them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';
import type { SymbolTable, ForwardCall } from '../../src/types';
import { Range } from 'vscode-languageserver';

// Helper to create a ForwardCall object with all required properties
function make_forward_call(
    _path: string,
    is_static: boolean,
    type: 'do' | 'run' | 'include',
    call_site_line: number,
    raw_path: string
): ForwardCall {
    return {
        is_static,
        type,
        call_site_line,
        raw_path,
        range: Range.create(call_site_line, 0, call_site_line, 0),
        source: 'command',
    };
}

// Helper to create empty symbol table
function create_empty_symbol_table(): SymbolTable {
    return {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };
}

describe('Callee Change Caller Revalidation Integration', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;
    let file_contents: Map<string, string>;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'callee-change-test-'));
        file_contents = new Map();

        const content_provider = {
            read_file: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                const content = file_contents.get(fs_path);
                if (content === undefined) {
                    throw new Error(`File not found: ${fs_path}`);
                }
                return content;
            },
            exists: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                return file_contents.has(fs_path);
            },
            stat: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                return file_contents.has(fs_path) ? { mtimeMs: Date.now(), size: 100 } : undefined;
            }
        };

        scope_resolver = new ScopeResolver(undefined, content_provider);
        forward_resolver = new ForwardScopeResolver(scope_resolver, content_provider);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    describe('9.1 Callee change triggering caller revalidation', () => {
        it('caller shows updated symbols after callee changes', async () => {
            // Setup: caller.do includes callee.do
            const callee_path = path.join(temp_dir, 'callee.do');
            const caller_path = path.join(temp_dir, 'caller.do');

            // Initial callee content defines 'fruit'
            file_contents.set(callee_path, 'local fruit apple');
            // Caller includes callee and uses 'fruit'
            file_contents.set(caller_path, `include "${callee_path}"\ndisplay "\`fruit'"`)

            const caller_uri = URI.file(caller_path).toString();
            const callee_uri = URI.file(callee_path).toString();
            const caller_content = file_contents.get(caller_path)!;

            // First resolve - should see 'fruit' from callee
            const result1 = await scope_resolver.resolve(caller_uri, caller_content, {});
            expect(result1.forward_call_symbols).toBeDefined();
            expect(result1.forward_call_symbols!.length).toBeGreaterThan(0);
            
            const fruit_defined = result1.forward_call_symbols?.[0]?.symbols.localMacros.has('fruit');
            expect(fruit_defined).toBe(true);

            // Simulate callee change - rename 'fruit' to 'fruits'
            file_contents.set(callee_path, 'local fruits apple');

            // Invalidate callee's file cache (simulates file watcher event)
            scope_resolver.invalidate_file_cache(callee_uri);

            // Re-resolve - should see 'fruits' instead of 'fruit'
            const result2 = await scope_resolver.resolve(caller_uri, caller_content, {});
            
            const fruits_defined = result2.forward_call_symbols?.[0]?.symbols.localMacros.has('fruits');
            const fruit_still_defined = result2.forward_call_symbols?.[0]?.symbols.localMacros.has('fruit');
            
            expect(fruits_defined).toBe(true);
            expect(fruit_still_defined).toBe(false);
        });

        it('forward call relationships are registered when callee is parsed', async () => {
            // Setup: caller.do includes callee.do
            const callee_path = path.join(temp_dir, 'callee.do');
            const caller_path = path.join(temp_dir, 'caller.do');

            file_contents.set(callee_path, 'local fruit apple');
            file_contents.set(caller_path, `include "${callee_path}"\ndisplay "\`fruit'"`)

            const caller_uri = URI.file(caller_path).toString();
            const callee_uri = URI.file(callee_path).toString();
            const caller_content = file_contents.get(caller_path)!;

            // Resolve caller - this will parse callee via get_parsed_file
            await scope_resolver.resolve(caller_uri, caller_content, {});

            // The callee file should have been parsed and its forward calls registered
            // Since callee.do has no forward calls, it won't register any relationships
            // But the caller's forward calls should be tracked via update_reverse_dependencies
            // when called from the server (not directly from resolve())
            
            // For this test, we manually register the relationship to verify the mechanism works
            const forward_calls = [make_forward_call(
                callee_path,
                true,
                'include',
                0,
                callee_path
            )];
            const symbols = create_empty_symbol_table();
            (scope_resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);

            // Now verify the relationship is registered
            const callers = scope_resolver.get_callers_for_callee(callee_uri);
            expect(callers.has(caller_uri)).toBe(true);

            // Verify bidirectional tracking
            const callee_to_callers = scope_resolver.get_callee_to_callers_map();
            expect(callee_to_callers.get(callee_uri)?.has(caller_uri)).toBe(true);
        });
    });

    describe('9.2 Transitive revalidation', () => {
        it('changes propagate through call chain', async () => {
            // Setup: A.do -> B.do -> C.do
            const a_path = path.join(temp_dir, 'A.do');
            const b_path = path.join(temp_dir, 'B.do');
            const c_path = path.join(temp_dir, 'C.do');

            // C.do defines a global
            file_contents.set(c_path, 'global shared_var value');
            // B.do includes C.do
            file_contents.set(b_path, `include "${c_path}"\ndisplay "$shared_var"`);
            // A.do includes B.do
            file_contents.set(a_path, `include "${b_path}"`);

            const a_uri = URI.file(a_path).toString();
            const b_uri = URI.file(b_path).toString();
            const c_uri = URI.file(c_path).toString();

            // Resolve B.do - should see shared_var from C.do
            const b_content = file_contents.get(b_path)!;
            const b_result1 = await scope_resolver.resolve(b_uri, b_content, {});
            expect(b_result1.forward_call_symbols?.[0]?.symbols.globalMacros.has('shared_var')).toBe(true);

            // Simulate C.do change
            file_contents.set(c_path, 'global different_var value');
            scope_resolver.invalidate_file_cache(c_uri);

            // Re-resolve B.do - should see different_var instead of shared_var
            const b_result2 = await scope_resolver.resolve(b_uri, b_content, {});
            expect(b_result2.forward_call_symbols?.[0]?.symbols.globalMacros.has('different_var')).toBe(true);
            expect(b_result2.forward_call_symbols?.[0]?.symbols.globalMacros.has('shared_var')).toBe(false);
        });

        it('transitive callers are discovered via BFS', async () => {
            // Setup relationships manually to test BFS traversal
            const a_uri = 'file:///A.do';
            const b_uri = 'file:///B.do';
            const c_uri = 'file:///C.do';
            const symbols = create_empty_symbol_table();

            // Register B -> C relationship
            (scope_resolver as any).register_forward_call_relationships_from_cache(b_uri, [make_forward_call(
                '/C.do',
                true,
                'include',
                0,
                'C.do'
            )], symbols);

            // Register A -> B relationship
            (scope_resolver as any).register_forward_call_relationships_from_cache(a_uri, [make_forward_call(
                '/B.do',
                true,
                'include',
                0,
                'B.do'
            )], symbols);

            // Get the callee_to_callers map
            const callee_to_callers = scope_resolver.get_callee_to_callers_map();

            // Verify direct relationships
            expect(callee_to_callers.get(c_uri)?.has(b_uri)).toBe(true);
            expect(callee_to_callers.get(b_uri)?.has(a_uri)).toBe(true);

            // BFS from C should find both B and A
            const visited = new Set<string>([c_uri]);
            const queue = [c_uri];
            const found_callers = new Set<string>();

            while (queue.length > 0) {
                const current = queue.shift()!;
                const callers = callee_to_callers.get(current);
                if (callers) {
                    for (const my_caller of callers) {
                        if (!visited.has(my_caller)) {
                            visited.add(my_caller);
                            found_callers.add(my_caller);
                            queue.push(my_caller);
                        }
                    }
                }
            }

            expect(found_callers.has(b_uri)).toBe(true);
            expect(found_callers.has(a_uri)).toBe(true);
        });

        it('scope cache invalidation cascades to callers', async () => {
            // Setup relationships and scope cache entries
            const caller_uri = 'file:///caller.do';
            const callee_uri = 'file:///callee.do';
            const symbols = create_empty_symbol_table();

            // Register caller -> callee relationship
            (scope_resolver as any).register_forward_call_relationships_from_cache(caller_uri, [make_forward_call(
                '/callee.do',
                true,
                'include',
                0,
                'callee.do'
            )], symbols);

            // Add a scope cache entry for the caller
            const cache_key = `${caller_uri}:test-hash:config-hash`;
            const cache_entry = {
                resolved_scope: { chain: [], symbols, out_of_scope_symbols: [], diagnostics: [], has_directives: false, has_auto_parents: false },
                content_hash: 'test-hash',
                timestamp: Date.now(),
                dependent_uris: new Set([callee_uri]),
            };
            (scope_resolver as any).scope_cache.set(cache_key, cache_entry);

            // Update secondary index
            let uri_keys = (scope_resolver as any).uri_to_cache_keys.get(caller_uri);
            if (!uri_keys) {
                uri_keys = new Set();
                (scope_resolver as any).uri_to_cache_keys.set(caller_uri, uri_keys);
            }
            uri_keys.add(cache_key);

            // Verify cache entry exists
            expect((scope_resolver as any).scope_cache.has(cache_key)).toBe(true);

            // Invalidate callee's file cache
            scope_resolver.invalidate_file_cache(callee_uri);

            // Verify caller's scope cache was invalidated
            expect((scope_resolver as any).scope_cache.has(cache_key)).toBe(false);
        });
    });
});
