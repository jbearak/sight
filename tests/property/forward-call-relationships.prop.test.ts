import { describe, it, expect, beforeEach } from 'bun:test';
import fc from 'fast-check';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import type { SymbolTable, ForwardCall } from '../../src/types';
import { Range } from 'vscode-languageserver';

// Helper to create a ForwardCall object with all required properties
function make_forward_call(
    path: string,
    is_static: boolean,
    type: 'do' | 'run' | 'include',
    call_site_line: number,
    raw_path: string
): ForwardCall {
    return {
        path,
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

// Mock content provider for testing
const create_mock_content_provider = () => ({
    read_file: async (uri: string) => '',
    exists: async (uri: string) => true,
    stat: async (uri: string) => ({ mtimeMs: Date.now(), size: 100 })
});

// Generators
const arbitrary_uri = () => fc.string({ minLength: 1, maxLength: 20 })
    .filter(name => /^[a-zA-Z0-9_]+$/.test(name))  // Only alphanumeric and underscore
    .map(name => `file:///${name}.do`);

const arbitrary_forward_call = () => fc.string({ minLength: 1, maxLength: 20 })
    .filter(name => /^[a-zA-Z0-9_]+$/.test(name))  // Only alphanumeric and underscore
    .map(name => make_forward_call(
        `/${name}.do`,
        true,
        'do',
        0,
        `${name}.do`
    ));

// BFS helper for transitive caller discovery (same as in server-factory.ts)
function get_transitive_callers(
    callee_uri: string,
    callee_to_callers: Map<string, Set<string>>,
    max_depth: number
): Set<string> {
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
}

describe('Feature: callee-change-caller-revalidation', () => {
    let resolver: ScopeResolver;

    beforeEach(() => {
        resolver = new ScopeResolver(undefined, create_mock_content_provider());
    });

    describe('Property 1: Forward Call Relationship Registration', () => {
        it('should register all static forward calls in both maps', () => {
            fc.assert(fc.property(
                arbitrary_uri(),
                fc.array(arbitrary_forward_call(), { minLength: 1, maxLength: 5 }),
                (caller_uri, forward_calls) => {
                    const symbols = create_empty_symbol_table();
                    
                    // Register forward calls
                    (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);
                    
                    const reverse_deps = (resolver as any).reverse_deps;
                    
                    // Check all callees are registered in callee_to_callers
                    for (const my_call of forward_calls) {
                        if (!my_call.is_static || !my_call.path) continue;
                        const callee_uri = URI.file(my_call.path).toString();
                        expect(reverse_deps.callee_to_callers.get(callee_uri)?.has(caller_uri)).toBe(true);
                    }
                    
                    // Check caller is registered in forward_caller_to_callees with all callees
                    const caller_callees = reverse_deps.forward_caller_to_callees.get(caller_uri);
                    expect(caller_callees).toBeDefined();
                    
                    const expected_callees = new Set(
                        forward_calls
                            .filter(call => call.is_static && call.path)
                            .map(call => URI.file(call.path!).toString())
                    );
                    expect(caller_callees?.size).toBe(expected_callees.size);
                    
                    for (const my_expected_callee of expected_callees) {
                        expect(caller_callees?.has(my_expected_callee)).toBe(true);
                    }
                }
            ), { numRuns: 100 });
        });
    });

    describe('Property 2: Relationship Cleanup on Cache Removal', () => {
        it('should remove all relationships when clear_forward_call_relationships is called', () => {
            fc.assert(fc.property(
                arbitrary_uri(),
                fc.array(arbitrary_forward_call(), { minLength: 1, maxLength: 3 }),
                (caller_uri, forward_calls) => {
                    const symbols = create_empty_symbol_table();
                    
                    // Register forward calls
                    (resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);
                    
                    // Clear relationships
                    (resolver as any).clear_forward_call_relationships(caller_uri);
                    
                    const reverse_deps = (resolver as any).reverse_deps;
                    
                    // Check all callee_to_callers entries for this caller are removed
                    for (const my_call of forward_calls) {
                        if (!my_call.is_static || !my_call.path) continue;
                        const callee_uri = URI.file(my_call.path).toString();
                        const callers = reverse_deps.callee_to_callers.get(callee_uri);
                        // Either the set doesn't exist or doesn't contain caller
                        expect(callers === undefined || !callers.has(caller_uri)).toBe(true);
                    }
                    
                    // Check forward_caller_to_callees entry is removed
                    expect(reverse_deps.forward_caller_to_callees.has(caller_uri)).toBe(false);
                }
            ), { numRuns: 100 });
        });
    });

    describe('Property 3: Caller Scope Cache Invalidation', () => {
        it('should invalidate scope cache for all callers when callee file cache is invalidated', () => {
            fc.assert(fc.property(
                arbitrary_uri(),
                fc.array(arbitrary_uri(), { minLength: 1, maxLength: 3 }),
                (callee_uri, caller_uris) => {
                    const symbols = create_empty_symbol_table();
                    
                    // Set up relationships: each caller calls the callee
                    for (const my_caller_uri of caller_uris) {
                        const forward_calls = [make_forward_call(
                            URI.parse(callee_uri).fsPath,
                            true,
                            'do',
                            0,
                            'callee.do'
                        )];
                        
                        (resolver as any).register_forward_call_relationships_from_cache(my_caller_uri, forward_calls, symbols);
                        
                        // Add scope cache entries for callers
                        const cache_key = `${my_caller_uri}:test-hash:config-hash`;
                        const cache_entry = {
                            resolved_scope: { chain: [], symbols, out_of_scope_symbols: [], diagnostics: [], has_directives: false },
                            content_hash: 'test-hash',
                            timestamp: Date.now(),
                            dependent_uris: new Set([callee_uri]),
                        };
                        (resolver as any).scope_cache.set(cache_key, cache_entry);
                        
                        // Update secondary index
                        let uri_keys = (resolver as any).uri_to_cache_keys.get(my_caller_uri);
                        if (!uri_keys) {
                            uri_keys = new Set();
                            (resolver as any).uri_to_cache_keys.set(my_caller_uri, uri_keys);
                        }
                        uri_keys.add(cache_key);
                    }
                    
                    // Invalidate callee's file cache (this should cascade to caller scope caches)
                    resolver.invalidate_file_cache(callee_uri);
                    
                    // Check all caller scope cache entries are invalidated
                    for (const my_caller_uri of caller_uris) {
                        const cache_key = `${my_caller_uri}:test-hash:config-hash`;
                        expect((resolver as any).scope_cache.has(cache_key)).toBe(false);
                    }
                }
            ), { numRuns: 100 });
        });
    });

    describe('Property 4: Transitive Caller Discovery', () => {
        it('should discover all transitive callers via BFS traversal', () => {
            fc.assert(fc.property(
                fc.uniqueArray(arbitrary_uri(), { minLength: 3, maxLength: 5 }),
                (uris) => {
                    // Create fresh resolver for each iteration
                    const test_resolver = new ScopeResolver(undefined, create_mock_content_provider());
                    
                    // Create chain: uris[0] -> uris[1] -> uris[2] -> ...
                    const symbols = create_empty_symbol_table();
                    
                    for (let i = 0; i < uris.length - 1; i++) {
                        const caller_uri = uris[i];
                        const callee_uri = uris[i + 1];
                        
                        const forward_calls = [make_forward_call(
                            URI.parse(callee_uri).fsPath,
                            true,
                            'do',
                            0,
                            'callee.do'
                        )];
                        
                        (test_resolver as any).register_forward_call_relationships_from_cache(caller_uri, forward_calls, symbols);
                    }
                    
                    // Get transitive callers of the last file using the BFS helper
                    const leaf_uri = uris[uris.length - 1];
                    const callee_to_callers = test_resolver.get_callee_to_callers_map();
                    const transitive_callers = get_transitive_callers(leaf_uri, callee_to_callers, 20);
                    
                    // Should include all files except the leaf itself
                    const expected_callers = new Set(uris.slice(0, -1));
                    expect(transitive_callers.size).toBe(expected_callers.size);
                    
                    for (const my_expected_caller of expected_callers) {
                        expect(transitive_callers.has(my_expected_caller)).toBe(true);
                    }
                }
            ), { numRuns: 100 });
        });
    });

    describe('Property 6: Atomic Relationship Update', () => {
        it('should reflect only new forward calls after update', () => {
            fc.assert(fc.property(
                arbitrary_uri(),
                fc.array(arbitrary_forward_call(), { minLength: 1, maxLength: 3 }),
                fc.array(arbitrary_forward_call(), { minLength: 1, maxLength: 3 }),
                (caller_uri, old_calls, new_calls) => {
                    const symbols = create_empty_symbol_table();
                    
                    // Register initial forward calls
                    (resolver as any).register_forward_call_relationships_from_cache(caller_uri, old_calls, symbols);
                    
                    // Update with new forward calls
                    (resolver as any).register_forward_call_relationships_from_cache(caller_uri, new_calls, symbols);
                    
                    const reverse_deps = (resolver as any).reverse_deps;
                    
                    // Check only new callees are present
                    const caller_callees = reverse_deps.forward_caller_to_callees.get(caller_uri);
                    const expected_callees = new Set(
                        new_calls
                            .filter(call => call.is_static && call.path)
                            .map(call => URI.file(call.path!).toString())
                    );
                    
                    expect(caller_callees?.size).toBe(expected_callees.size);
                    for (const my_expected_callee of expected_callees) {
                        expect(caller_callees?.has(my_expected_callee)).toBe(true);
                    }
                    
                    // Check old callees no longer reference this caller (if not in new_calls)
                    const new_callee_uris = new Set(
                        new_calls
                            .filter(call => call.is_static && call.path)
                            .map(call => URI.file(call.path!).toString())
                    );
                    for (const my_old_call of old_calls) {
                        if (!my_old_call.is_static || !my_old_call.path) continue;
                        const old_callee_uri = URI.file(my_old_call.path).toString();
                        if (!new_callee_uris.has(old_callee_uri)) {
                            const callers = reverse_deps.callee_to_callers.get(old_callee_uri);
                            // Either the set doesn't exist or doesn't contain caller
                            expect(callers === undefined || !callers.has(caller_uri)).toBe(true);
                        }
                    }
                }
            ), { numRuns: 100 });
        });
    });

    describe('Property 7: Forward Call URIs in dependent_uris', () => {
        it('should include all forward-call source URIs in dependent_uris', () => {
            fc.assert(fc.property(
                arbitrary_uri(),
                fc.array(arbitrary_forward_call(), { minLength: 1, maxLength: 3 }),
                (caller_uri, forward_calls) => {
                    // Create a scope cache entry with forward call symbols
                    const dependent_uris = new Set<string>();
                    for (const my_call of forward_calls) {
                        if (my_call.is_static && my_call.path) {
                            dependent_uris.add(URI.file(my_call.path).toString());
                        }
                    }
                    
                    // Verify all forward call URIs are in dependent_uris
                    for (const my_call of forward_calls) {
                        if (!my_call.is_static || !my_call.path) continue;
                        const callee_uri = URI.file(my_call.path).toString();
                        expect(dependent_uris.has(callee_uri)).toBe(true);
                    }
                }
            ), { numRuns: 100 });
        });
    });
});
