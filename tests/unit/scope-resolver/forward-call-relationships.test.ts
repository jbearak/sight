import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopeResolver } from '../../../src/scope-resolver';
import { URI } from 'vscode-uri';
import type { SymbolTable } from '../../../src/types';

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

// Mock content provider for testing
const create_mock_content_provider = () => ({
    read_file: async (uri: string) => '',
    exists: async (uri: string) => true,
    stat: async (uri: string) => ({ mtimeMs: Date.now(), size: 100 })
});

describe('Forward Call Relationship Tracking', () => {
    let resolver: ScopeResolver;

    beforeEach(() => {
        resolver = new ScopeResolver(undefined, create_mock_content_provider());
    });

    describe('register_forward_call_relationships_from_cache', () => {
        it('should register single forward call', () => {
            const caller_uri = 'file:///caller.do';
            const callee_uri = 'file:///callee.do';
            const forward_calls = [{
                path: URI.parse(callee_uri).fsPath,
                is_static: true,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            const symbols = create_empty_symbol_table();

            // Access private method via type casting
            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);

            const reverse_deps = (resolver as any).reverse_deps;
            expect(reverse_deps.callee_to_callers.get(callee_uri)?.has(caller_uri)).toBe(true);
            expect(reverse_deps.forward_caller_to_callees.get(caller_uri)?.has(callee_uri)).toBe(true);
        });

        it('should register multiple forward calls', () => {
            const caller_uri = 'file:///caller.do';
            const callee1_uri = 'file:///callee1.do';
            const callee2_uri = 'file:///callee2.do';
            const forward_calls = [
                {
                    path: URI.parse(callee1_uri).fsPath,
                    is_static: true,
                    call_type: 'do' as const,
                    line: 1,
                    match: undefined
                },
                {
                    path: URI.parse(callee2_uri).fsPath,
                    is_static: true,
                    call_type: 'run' as const,
                    line: 2,
                    match: undefined
                }
            ];
            const symbols = create_empty_symbol_table();

            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);

            const reverse_deps = (resolver as any).reverse_deps;
            expect(reverse_deps.callee_to_callers.get(callee1_uri)?.has(caller_uri)).toBe(true);
            expect(reverse_deps.callee_to_callers.get(callee2_uri)?.has(caller_uri)).toBe(true);
            expect(reverse_deps.forward_caller_to_callees.get(caller_uri)?.size).toBe(2);
        });

        it('should skip dynamic paths (is_static=false)', () => {
            const caller_uri = 'file:///caller.do';
            const forward_calls = [{
                path: '/some/path.do',
                is_static: false,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            const symbols = create_empty_symbol_table();

            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);

            const reverse_deps = (resolver as any).reverse_deps;
            expect(reverse_deps.forward_caller_to_callees.has(caller_uri)).toBe(false);
        });

        it('should clear existing relationships before registration', () => {
            const caller_uri = 'file:///caller.do';
            const old_callee_uri = 'file:///old_callee.do';
            const new_callee_uri = 'file:///new_callee.do';
            const symbols = create_empty_symbol_table();

            // Register initial relationship
            const old_calls = [{
                path: URI.parse(old_callee_uri).fsPath,
                is_static: true,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, old_calls, symbols);

            // Register new relationship (should clear old one)
            const new_calls = [{
                path: URI.parse(new_callee_uri).fsPath,
                is_static: true,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, new_calls, symbols);

            const reverse_deps = (resolver as any).reverse_deps;
            // Old callee should no longer have caller in its set (set may be deleted entirely)
            const old_callers = reverse_deps.callee_to_callers.get(old_callee_uri);
            expect(old_callers === undefined || !old_callers.has(caller_uri)).toBe(true);
            expect(reverse_deps.callee_to_callers.get(new_callee_uri)?.has(caller_uri)).toBe(true);
        });

        it('should update both callee_to_callers and forward_caller_to_callees', () => {
            const caller_uri = 'file:///caller.do';
            const callee_uri = 'file:///callee.do';
            const forward_calls = [{
                path: URI.parse(callee_uri).fsPath,
                is_static: true,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            const symbols = create_empty_symbol_table();

            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);

            const reverse_deps = (resolver as any).reverse_deps;
            // Check bidirectional mapping
            expect(reverse_deps.callee_to_callers.get(callee_uri)?.has(caller_uri)).toBe(true);
            expect(reverse_deps.forward_caller_to_callees.get(caller_uri)?.has(callee_uri)).toBe(true);
        });
    });

    describe('clear_forward_call_relationships', () => {
        it('should clear relationships for caller with multiple callees', () => {
            const caller_uri = 'file:///caller.do';
            const callee1_uri = 'file:///callee1.do';
            const callee2_uri = 'file:///callee2.do';
            const forward_calls = [
                {
                    path: URI.parse(callee1_uri).fsPath,
                    is_static: true,
                    call_type: 'do' as const,
                    line: 1,
                    match: undefined
                },
                {
                    path: URI.parse(callee2_uri).fsPath,
                    is_static: true,
                    call_type: 'run' as const,
                    line: 2,
                    match: undefined
                }
            ];
            const symbols = create_empty_symbol_table();

            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);
            (resolver as any).clear_forward_call_relationships(caller_uri);

            const reverse_deps = (resolver as any).reverse_deps;
            // Callee sets should be deleted or not contain caller
            const callers1 = reverse_deps.callee_to_callers.get(callee1_uri);
            const callers2 = reverse_deps.callee_to_callers.get(callee2_uri);
            expect(callers1 === undefined || !callers1.has(caller_uri)).toBe(true);
            expect(callers2 === undefined || !callers2.has(caller_uri)).toBe(true);
            expect(reverse_deps.forward_caller_to_callees.has(caller_uri)).toBe(false);
        });

        it('should be no-op when caller has no relationships', () => {
            const caller_uri = 'file:///caller.do';
            const reverse_deps = (resolver as any).reverse_deps;
            const initial_size = reverse_deps.callee_to_callers.size;

            (resolver as any).clear_forward_call_relationships(caller_uri);

            expect(reverse_deps.callee_to_callers.size).toBe(initial_size);
        });

        it('should preserve other callers relationships', () => {
            const caller1_uri = 'file:///caller1.do';
            const caller2_uri = 'file:///caller2.do';
            const callee_uri = 'file:///callee.do';
            const forward_calls = [{
                path: URI.parse(callee_uri).fsPath,
                is_static: true,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            const symbols = create_empty_symbol_table();

            // Register both callers
            (resolver as any).register_forward_call_relationships_from_cache(caller1_uri, forward_calls, symbols);
            (resolver as any).register_forward_call_relationships_from_cache(caller2_uri, forward_calls, symbols);

            // Clear only caller1
            (resolver as any).clear_forward_call_relationships(caller1_uri);

            const reverse_deps = (resolver as any).reverse_deps;
            expect(reverse_deps.callee_to_callers.get(callee_uri)?.has(caller1_uri)).toBe(false);
            expect(reverse_deps.callee_to_callers.get(callee_uri)?.has(caller2_uri)).toBe(true);
        });

        it('should clear interface_hashes entry', () => {
            const caller_uri = 'file:///caller.do';
            const callee_uri = 'file:///callee.do';
            const forward_calls = [{
                path: URI.parse(callee_uri).fsPath,
                is_static: true,
                call_type: 'do' as const,
                line: 1,
                match: undefined
            }];
            const symbols = create_empty_symbol_table();

            (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);
            (resolver as any).clear_forward_call_relationships(caller_uri);

            const reverse_deps = (resolver as any).reverse_deps;
            expect(reverse_deps.interface_hashes.has(caller_uri)).toBe(false);
        });
    });

    describe('scope cache secondary index', () => {
        it('should update uri_to_cache_keys on cache add via resolve', async () => {
            const uri = 'file:///test.do';
            await resolver.resolve(uri, 'local x = 1');

            const uri_to_cache_keys = (resolver as any).uri_to_cache_keys;
            expect(uri_to_cache_keys.has(uri)).toBe(true);
        });

        it('should use O(1) lookup in invalidate_scope_cache_for_uri', () => {
            const uri = 'file:///test.do';
            const uri_to_cache_keys = (resolver as any).uri_to_cache_keys;
            const scope_cache = (resolver as any).scope_cache;

            // Manually add cache entry
            const cache_key = `${uri}:config_hash`;
            scope_cache.set(cache_key, { dependent_uris: new Set() });
            uri_to_cache_keys.set(uri, new Set([cache_key]));

            const removed_count = (resolver as any).invalidate_scope_cache_for_uri(uri);

            expect(removed_count).toBe(1);
            expect(scope_cache.has(cache_key)).toBe(false);
            expect(uri_to_cache_keys.has(uri)).toBe(false);
        });
    });

    describe('cache invalidation cascade', () => {
        it('should invalidate caller scope caches when callee file cache changes', () => {
            const caller_uri = 'file:///caller.do';
            const callee_uri = 'file:///callee.do';
            
            // Setup relationship
            const reverse_deps = (resolver as any).reverse_deps;
            reverse_deps.callee_to_callers.set(callee_uri, new Set([caller_uri]));

            // Setup scope cache for caller
            const scope_cache = (resolver as any).scope_cache;
            const uri_to_cache_keys = (resolver as any).uri_to_cache_keys;
            const cache_key = `${caller_uri}:config_hash`;
            scope_cache.set(cache_key, { dependent_uris: new Set([callee_uri]) });
            uri_to_cache_keys.set(caller_uri, new Set([cache_key]));

            // Invalidate callee file cache
            resolver.invalidate_file_cache(callee_uri);

            expect(scope_cache.has(cache_key)).toBe(false);
        });

        it('should handle multiple callers of same callee', () => {
            const caller1_uri = 'file:///caller1.do';
            const caller2_uri = 'file:///caller2.do';
            const callee_uri = 'file:///callee.do';
            
            // Setup relationships
            const reverse_deps = (resolver as any).reverse_deps;
            reverse_deps.callee_to_callers.set(callee_uri, new Set([caller1_uri, caller2_uri]));

            // Setup scope caches
            const scope_cache = (resolver as any).scope_cache;
            const uri_to_cache_keys = (resolver as any).uri_to_cache_keys;
            const cache_key1 = `${caller1_uri}:config_hash`;
            const cache_key2 = `${caller2_uri}:config_hash`;
            
            scope_cache.set(cache_key1, { dependent_uris: new Set([callee_uri]) });
            scope_cache.set(cache_key2, { dependent_uris: new Set([callee_uri]) });
            uri_to_cache_keys.set(caller1_uri, new Set([cache_key1]));
            uri_to_cache_keys.set(caller2_uri, new Set([cache_key2]));

            // Invalidate callee
            resolver.invalidate_file_cache(callee_uri);

            expect(scope_cache.has(cache_key1)).toBe(false);
            expect(scope_cache.has(cache_key2)).toBe(false);
        });

        it('should not affect callers not in callee_to_callers', () => {
            const caller_uri = 'file:///caller.do';
            const unrelated_uri = 'file:///unrelated.do';
            const callee_uri = 'file:///callee.do';
            
            // Setup only caller relationship
            const reverse_deps = (resolver as any).reverse_deps;
            reverse_deps.callee_to_callers.set(callee_uri, new Set([caller_uri]));

            // Setup scope caches for both
            const scope_cache = (resolver as any).scope_cache;
            const uri_to_cache_keys = (resolver as any).uri_to_cache_keys;
            const caller_key = `${caller_uri}:config_hash`;
            const unrelated_key = `${unrelated_uri}:config_hash`;
            
            scope_cache.set(caller_key, { dependent_uris: new Set([callee_uri]) });
            scope_cache.set(unrelated_key, { dependent_uris: new Set() });
            uri_to_cache_keys.set(caller_uri, new Set([caller_key]));
            uri_to_cache_keys.set(unrelated_uri, new Set([unrelated_key]));

            // Invalidate callee
            resolver.invalidate_file_cache(callee_uri);

            expect(scope_cache.has(caller_key)).toBe(false);
            expect(scope_cache.has(unrelated_key)).toBe(true);
        });
    });

    describe('transitive caller discovery (get_transitive_callers)', () => {
        // Helper function to simulate get_transitive_callers from server-factory
        const get_transitive_callers = (
            callee_uri: string,
            callee_to_callers: Map<string, Set<string>>,
            max_depth: number
        ): Set<string> => {
            const all_callers = new Set<string>();
            const queue: Array<{uri: string, depth: number}> = [{uri: callee_uri, depth: 0}];
            const visited = new Set<string>([callee_uri]);
            
            while (queue.length > 0) {
                const {uri: current_uri, depth} = queue.shift()!;
                if (depth >= max_depth) continue;
                
                const immediate_callers = callee_to_callers.get(current_uri);
                if (!immediate_callers) continue;
                
                for (const my_caller_uri of immediate_callers) {
                    if (visited.has(my_caller_uri)) continue;
                    visited.add(my_caller_uri);
                    all_callers.add(my_caller_uri);
                    queue.push({uri: my_caller_uri, depth: depth + 1});
                }
            }
            
            return all_callers;
        };

        it('should find A→B→C chain: changing C finds both A and B', () => {
            const callee_to_callers = new Map<string, Set<string>>();
            callee_to_callers.set('file:///C.do', new Set(['file:///B.do']));
            callee_to_callers.set('file:///B.do', new Set(['file:///A.do']));

            const result = get_transitive_callers('file:///C.do', callee_to_callers, 10);

            expect(result.has('file:///A.do')).toBe(true);
            expect(result.has('file:///B.do')).toBe(true);
            expect(result.size).toBe(2);
        });

        it('should handle diamond pattern: A→B, A→C, B→D, C→D', () => {
            const callee_to_callers = new Map<string, Set<string>>();
            callee_to_callers.set('file:///D.do', new Set(['file:///B.do', 'file:///C.do']));
            callee_to_callers.set('file:///B.do', new Set(['file:///A.do']));
            callee_to_callers.set('file:///C.do', new Set(['file:///A.do']));

            const result = get_transitive_callers('file:///D.do', callee_to_callers, 10);

            expect(result.has('file:///A.do')).toBe(true);
            expect(result.has('file:///B.do')).toBe(true);
            expect(result.has('file:///C.do')).toBe(true);
            expect(result.size).toBe(3);
        });

        it('should handle cycles: A→B→A', () => {
            const callee_to_callers = new Map<string, Set<string>>();
            callee_to_callers.set('file:///A.do', new Set(['file:///B.do']));
            callee_to_callers.set('file:///B.do', new Set(['file:///A.do']));

            const result = get_transitive_callers('file:///A.do', callee_to_callers, 10);

            expect(result.has('file:///B.do')).toBe(true);
            expect(result.size).toBe(1);
        });

        it('should respect max_chain_depth limiting', () => {
            const callee_to_callers = new Map<string, Set<string>>();
            callee_to_callers.set('file:///D.do', new Set(['file:///C.do']));
            callee_to_callers.set('file:///C.do', new Set(['file:///B.do']));
            callee_to_callers.set('file:///B.do', new Set(['file:///A.do']));

            const result = get_transitive_callers('file:///D.do', callee_to_callers, 2);

            expect(result.has('file:///C.do')).toBe(true);
            expect(result.has('file:///B.do')).toBe(true);
            expect(result.has('file:///A.do')).toBe(false); // Beyond max depth
            expect(result.size).toBe(2);
        });
    });
});
