/**
 * Property tests for Scope Caching (Tasks 8.1-8.4)
 *
 * Tests cache behavior, invalidation, and hit/miss tracking.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { DirectiveParser } from '../../src/directive-parser';
import { DocumentStore } from '../../src/document-store';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

describe('Scope Caching Property Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-cache-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Task 8.1: Cache Hit/Miss Behavior
    describe('Task 8.1: Cache Hit/Miss Behavior', () => {
        test('cache miss on first resolution', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();
            await resolver.resolve(file_uri, content);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(0);
            expect(metrics.misses).toBe(1);
        });

        test('cache hit on repeated resolution with same content', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // First resolution - miss
            const result1 = await resolver.resolve(file_uri, content);
            
            // Second resolution - hit
            const result2 = await resolver.resolve(file_uri, content);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(1);
            expect(metrics.misses).toBe(1);
            
            // Results should be identical
            expect(result1).toEqual(result2);
        });

        test('cache miss on content change', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content1 = 'local x = 1';
            const content2 = 'local y = 2';

            resolver.reset_cache_metrics();
            
            // First resolution
            await resolver.resolve(file_uri, content1);
            
            // Second resolution with different content
            await resolver.resolve(file_uri, content2);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(0);
            expect(metrics.misses).toBe(2);
        });

        test('cache miss on config change', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // First resolution with default config
            await resolver.resolve(file_uri, content);
            
            // Second resolution with different config
            await resolver.resolve(file_uri, content, { assume_call_site: 'start' });

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(0);
            expect(metrics.misses).toBe(2);
        });
    });

    // Task 8.2: Cache Invalidation
    describe('Task 8.2: Cache Invalidation', () => {
        test('invalidate_file_cache removes entries for specific file', async () => {
            const file1_path = write_file('file1.do', 'local x = 1');
            const file2_path = write_file('file2.do', 'local y = 2');
            const file1_uri = URI.file(file1_path).toString();
            const file2_uri = URI.file(file2_path).toString();
            const content1 = fs.readFileSync(file1_path, 'utf8');
            const content2 = fs.readFileSync(file2_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Cache both files
            await resolver.resolve(file1_uri, content1);
            await resolver.resolve(file2_uri, content2);
            
            // Invalidate file1
            resolver.invalidate_file_cache(file1_uri);
            
            // Resolve again
            await resolver.resolve(file1_uri, content1); // Should miss
            await resolver.resolve(file2_uri, content2); // Should hit

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(1); // file2 hit
            expect(metrics.misses).toBe(3); // 2 initial + 1 file1 after invalidation
            expect(metrics.invalidations).toBe(1);
        });

        test('clear_cache removes all entries', async () => {
            const file1_path = write_file('file1.do', 'local x = 1');
            const file2_path = write_file('file2.do', 'local y = 2');
            const file1_uri = URI.file(file1_path).toString();
            const file2_uri = URI.file(file2_path).toString();
            const content1 = fs.readFileSync(file1_path, 'utf8');
            const content2 = fs.readFileSync(file2_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Cache both files
            await resolver.resolve(file1_uri, content1);
            await resolver.resolve(file2_uri, content2);
            
            // Clear all caches
            resolver.clear_cache();
            
            // Resolve again - both should miss
            await resolver.resolve(file1_uri, content1);
            await resolver.resolve(file2_uri, content2);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(0);
            expect(metrics.misses).toBe(4); // 2 initial + 2 after clear
        });

        test('invalidation cascades to dependent files', async () => {
            const parent_path = write_file('parent.do', 'global parent_var = 1');
            const child_path = write_file('child.do', '// @lsp-done-by "parent.do"\nlocal x = $parent_var');
            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();
            const parent_content = fs.readFileSync(parent_path, 'utf8');
            const child_content = fs.readFileSync(child_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Cache both files
            await resolver.resolve(parent_uri, parent_content);
            await resolver.resolve(child_uri, child_content);
            
            // Invalidate parent - should cascade to child
            resolver.invalidate_file_cache(parent_uri);
            
            // Resolve child again - should miss due to cascade
            await resolver.resolve(child_uri, child_content);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.misses).toBeGreaterThan(2); // At least parent + child initial + child after invalidation
        });

        test('invalidation cascades to callers via forward call dependencies', async () => {
            // Create a caller file that calls a callee via 'do' command
            const callee_path = write_file('callee.do', 'global callee_var = 1');
            const caller_path = write_file('caller.do', 'do callee.do\ndisplay $callee_var');
            const callee_uri = URI.file(callee_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const callee_content = fs.readFileSync(callee_path, 'utf8');
            const caller_content = fs.readFileSync(caller_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Resolve caller first
            const caller_result = await resolver.resolve(caller_uri, caller_content);
            
            // Manually update reverse dependencies (simulating what the server does on didChange)
            // This populates the callee_to_callers map so invalidation can cascade
            const forward_calls = [{
                type: 'do' as const,
                path: callee_path,
                raw_path: 'callee.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
                source: 'command' as const,
                is_static: true,
            }];
            resolver.update_reverse_dependencies(caller_uri, forward_calls, caller_result.symbols);
            
            // Verify caller is cached
            await resolver.resolve(caller_uri, caller_content);
            const metrics_before = resolver.get_cache_metrics();
            expect(metrics_before.hits).toBe(1); // Should hit on second resolve
            
            // Invalidate callee - should cascade to caller's scope cache
            resolver.invalidate_file_cache(callee_uri);
            
            // Resolve caller again - should miss because callee changed
            resolver.reset_cache_metrics();
            await resolver.resolve(caller_uri, caller_content);

            const metrics_after = resolver.get_cache_metrics();
            expect(metrics_after.misses).toBe(1); // Should miss after callee invalidation
        });

        test('invalidate_scope_cache cascades to callers via forward call dependencies (in-memory edits)', async () => {
            // This tests the scenario where a callee file is edited in the editor (not on disk)
            // The server calls invalidate_scope_cache (not invalidate_file_cache) for in-memory edits
            const callee_path = write_file('callee2.do', 'global callee_var2 = 1');
            const caller_path = write_file('caller2.do', 'do callee2.do\ndisplay $callee_var2');
            const callee_uri = URI.file(callee_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const callee_content = fs.readFileSync(callee_path, 'utf8');
            const caller_content = fs.readFileSync(caller_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Resolve caller first
            const caller_result = await resolver.resolve(caller_uri, caller_content);
            
            // Manually update reverse dependencies (simulating what the server does on didChange)
            const forward_calls = [{
                type: 'do' as const,
                path: callee_path,
                raw_path: 'callee2.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 13 } },
                source: 'command' as const,
                is_static: true,
            }];
            resolver.update_reverse_dependencies(caller_uri, forward_calls, caller_result.symbols);
            
            // Verify caller is cached
            await resolver.resolve(caller_uri, caller_content);
            const metrics_before = resolver.get_cache_metrics();
            expect(metrics_before.hits).toBe(1); // Should hit on second resolve
            
            // Invalidate callee using invalidate_scope_cache (simulating in-memory edit)
            // This should also cascade to caller's scope cache
            resolver.invalidate_scope_cache(callee_uri);
            
            // Resolve caller again - should miss because callee changed
            resolver.reset_cache_metrics();
            await resolver.resolve(caller_uri, caller_content);

            const metrics_after = resolver.get_cache_metrics();
            expect(metrics_after.misses).toBe(1); // Should miss after callee invalidation
        });

        test('backward directive dependencies are tracked and can be queried', async () => {
            // This tests the backward directive dependency tracking feature
            // When a child file uses @lsp-done-by or @lsp-included-by, we track that
            // the child depends on the parent, so when the parent changes, we can
            // find and revalidate the child.
            const parent_path = write_file('parent_bd.do', `
local parent_local = 1
global parent_global = 2
`);
            const child_path = write_file('child_bd.do', `// @lsp-included-by "parent_bd.do"
local child_local = 3
display \`parent_local'
`);
            
            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            // Before resolving, no backward directive dependencies should exist
            const children_before = resolver.get_backward_directive_children(parent_uri);
            expect(children_before.size).toBe(0);

            // Resolve the child file - this should register the backward directive dependency
            await resolver.resolve(child_uri, child_content);

            // Now the parent should have the child as a backward directive dependent
            const children_after = resolver.get_backward_directive_children(parent_uri);
            expect(children_after.size).toBe(1);
            expect(children_after.has(child_uri)).toBe(true);
        });

        test('backward directive dependencies are cleared and re-registered on re-resolve', async () => {
            // Test that when a file is re-resolved, its backward directive dependencies
            // are cleared and re-registered (in case the directives changed)
            const parent1_path = write_file('parent1_bd.do', 'local p1 = 1');
            const parent2_path = write_file('parent2_bd.do', 'local p2 = 2');
            const child_path = write_file('child_switch.do', `// @lsp-included-by "parent1_bd.do"
local child = 3
`);
            
            const parent1_uri = URI.file(parent1_path).toString();
            const parent2_uri = URI.file(parent2_path).toString();
            const child_uri = URI.file(child_path).toString();
            const child_content1 = fs.readFileSync(child_path, 'utf8');

            // Resolve with first parent
            await resolver.resolve(child_uri, child_content1);
            expect(resolver.get_backward_directive_children(parent1_uri).has(child_uri)).toBe(true);
            expect(resolver.get_backward_directive_children(parent2_uri).has(child_uri)).toBe(false);

            // Change the directive to point to parent2
            const child_content2 = `// @lsp-included-by "parent2_bd.do"
local child = 3
`;
            // Invalidate scope cache to force re-resolution
            resolver.invalidate_scope_cache(child_uri);
            await resolver.resolve(child_uri, child_content2);

            // Now child should depend on parent2, not parent1
            expect(resolver.get_backward_directive_children(parent1_uri).has(child_uri)).toBe(false);
            expect(resolver.get_backward_directive_children(parent2_uri).has(child_uri)).toBe(true);
        });

        test('backward directive dependencies can be synced without resolving', async () => {
            // Syncing directly should register dependencies even if resolve() is not called
            const parent_path = write_file('parent_sync.do', 'local sync_parent = 1');
            const child_path = write_file('child_sync.do', `// @lsp-included-by "parent_sync.do"
local child = 3
`);

            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const parser = new DirectiveParser();
            const directives = parser.parse(child_content, child_uri).directives;

            // Sync dependencies without performing a full resolve
            resolver.sync_backward_directive_dependencies(child_uri, directives);

            expect(resolver.get_backward_directive_children(parent_uri).has(child_uri)).toBe(true);
        });

        test('set_scope_resolver re-syncs backward directive dependencies for already-open docs', async () => {
            const parent_path = write_file('parent_resync.do', 'local p = 1');
            const child_path = write_file('child_resync.do', `// @lsp-included-by "parent_resync.do"
local c = 2
`);
            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const resolver = new ScopeResolver();
            const store = new DocumentStore();

            // Open child before scope_resolver is attached
            const doc = TextDocument.create(child_uri, 'stata', 1, child_content);
            await store.open(child_uri, child_content, doc.version);

            // No deps registered yet
            expect(resolver.get_backward_directive_children(parent_uri).size).toBe(0);

            // Attaching scope_resolver should re-sync directives for existing docs
            store.set_scope_resolver(resolver);
            expect(resolver.get_backward_directive_children(parent_uri).has(child_uri)).toBe(true);
        });

        test('partial invalidation preserves unrelated entries', async () => {
            const files = Array.from({ length: 5 }, (_, i) => {
                const file_path = write_file(`file${i}.do`, `local var${i} = ${i}`);
                return {
                    uri: URI.file(file_path).toString(),
                    content: fs.readFileSync(file_path, 'utf8'),
                };
            });

            resolver.reset_cache_metrics();
            
            // Cache all files
            for (const file of files) {
                await resolver.resolve(file.uri, file.content);
            }
            
            // Invalidate middle file
            resolver.invalidate_file_cache(files[2].uri);
            
            // Resolve all files again
            for (const file of files) {
                await resolver.resolve(file.uri, file.content);
            }

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(4); // 4 files should hit (excluding invalidated one)
            expect(metrics.misses).toBe(6); // 5 initial + 1 after invalidation
        });

        test('invalidation handles non-existent files gracefully', async () => {
            const file_path = write_file('existing.do', 'local x = 1');
            const existing_uri = URI.file(file_path).toString();
            const non_existent_uri = 'file:///non/existent.do';
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Cache existing file
            await resolver.resolve(existing_uri, content);
            
            // Try to invalidate non-existent file - should not crash
            resolver.invalidate_file_cache(non_existent_uri);
            
            // Existing file should still be cached
            await resolver.resolve(existing_uri, content);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(1);
            expect(metrics.misses).toBe(1);
        });

        test('invalidation metrics are accurate', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Cache file with different configs to create multiple entries
            await resolver.resolve(file_uri, content);
            await resolver.resolve(file_uri, content, { assume_call_site: 'start' });
            
            // Invalidate - should remove both entries
            resolver.invalidate_file_cache(file_uri);

            const metrics = resolver.get_cache_metrics();
            expect(metrics.invalidations).toBe(2); // Both cache entries
        });

        test('clear_cache resets all metrics', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();
            
            // Generate some cache activity
            await resolver.resolve(file_uri, content); // miss
            await resolver.resolve(file_uri, content); // hit
            resolver.invalidate_file_cache(file_uri); // invalidation
            
            // Clear cache
            resolver.clear_cache();
            
            // Metrics should be preserved (clear_cache doesn't reset metrics)
            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(1);
            expect(metrics.misses).toBe(1);
            expect(metrics.invalidations).toBeGreaterThan(0);
        });

        test('concurrent invalidation and resolution', async () => {
            const files = Array.from({ length: 3 }, (_, i) => {
                const file_path = write_file(`concurrent${i}.do`, `local var${i} = ${i}`);
                return {
                    uri: URI.file(file_path).toString(),
                    content: fs.readFileSync(file_path, 'utf8'),
                };
            });

            resolver.reset_cache_metrics();
            
            // Simulate concurrent operations
            for (let round = 0; round < 3; round++) {
                for (const file of files) {
                    await resolver.resolve(file.uri, file.content);
                    if (round === 1) {
                        resolver.invalidate_file_cache(file.uri);
                    }
                }
            }

            const metrics = resolver.get_cache_metrics();
            // Should handle concurrent operations without crashing
            expect(metrics.hits + metrics.misses).toBeGreaterThan(0);
            expect(metrics.invalidations).toBeGreaterThan(0);
        });
    });

    // Task 8.3: Cache Correctness
    describe('Task 8.3: Cache Correctness', () => {
        test('cached results are identical to fresh results', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\0')),
                    fc.string({ minLength: 1, maxLength: 20 })
                        .filter(s => /^[a-zA-Z0-9_-]+$/.test(s)), // Valid filename characters only
                    async (content, filename) => {
                        const file_path = write_file(`${filename}.do`, content);
                        const file_uri = URI.file(file_path).toString();

                        // Fresh resolver for uncached result
                        const fresh_resolver = new ScopeResolver();
                        const fresh_result = await fresh_resolver.resolve(file_uri, content);

                        // Cached result
                        await resolver.resolve(file_uri, content); // Prime cache
                        const cached_result = await resolver.resolve(file_uri, content);

                        // Results should be identical
                        expect(cached_result).toEqual(fresh_result);
                    }
                ),
                { numRuns: 20 }
            );
        });

        test('cache preserves cross-file relationships', async () => {
            const parent_path = write_file('parent.do', `
local parent_local = 1
global parent_global = 2
`);
            const child_path = write_file('child.do', `// @lsp-included-by "parent.do"
local child_local = 3
`);
            
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            // Fresh result
            const fresh_resolver = new ScopeResolver();
            const fresh_result = await fresh_resolver.resolve(child_uri, child_content);

            // Cached result
            await resolver.resolve(child_uri, child_content); // Prime cache
            const cached_result = await resolver.resolve(child_uri, child_content);

            // Should have same symbols
            expect(cached_result.symbols.localMacros.has('parent_local')).toBe(
                fresh_result.symbols.localMacros.has('parent_local')
            );
            expect(cached_result.symbols.globalMacros.has('parent_global')).toBe(
                fresh_result.symbols.globalMacros.has('parent_global')
            );
            expect(cached_result.symbols.localMacros.has('child_local')).toBe(
                fresh_result.symbols.localMacros.has('child_local')
            );
        });
    });

    // Task 8.4: Performance Properties
    describe('Task 8.4: Performance Properties', () => {
        test('cache hits are faster than misses', async () => {
            const file_path = write_file('large.do', `
// Large file to make parsing time measurable
local var1 = 1
local var2 = 2
local var3 = 3
program define test_prog
    local x = 1
    local y = 2
    local z = 3
end
global g1 = "value1"
global g2 = "value2"
global g3 = "value3"
`);
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            // Time first resolution (miss)
            const miss_start = performance.now();
            await resolver.resolve(file_uri, content);
            const miss_time = performance.now() - miss_start;

            // Time second resolution (hit)
            const hit_start = performance.now();
            await resolver.resolve(file_uri, content);
            const hit_time = performance.now() - hit_start;

            // Cache hit should be significantly faster
            expect(hit_time).toBeLessThan(miss_time * 0.5);
        });

        test('cache metrics are accurate', async () => {
            const file_path = write_file('test.do', 'local x = 1');
            const file_uri = URI.file(file_path).toString();
            const content = fs.readFileSync(file_path, 'utf8');

            resolver.reset_cache_metrics();

            // 3 misses, 2 hits, 2 invalidations (both cache entries for the file)
            await resolver.resolve(file_uri, content); // miss
            await resolver.resolve(file_uri, content); // hit
            await resolver.resolve(file_uri, content + '\n// comment'); // miss (different content)
            resolver.invalidate_file_cache(file_uri); // invalidation (removes 2 entries)
            await resolver.resolve(file_uri, content); // miss (after invalidation)
            await resolver.resolve(file_uri, content); // hit

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(2);
            expect(metrics.misses).toBe(3);
            expect(metrics.invalidations).toBe(2); // Both cache entries invalidated
        });

        test('cache handles concurrent access patterns', async () => {
            const files = Array.from({ length: 5 }, (_, i) => {
                const file_path = write_file(`file${i}.do`, `local var${i} = ${i}`);
                return {
                    uri: URI.file(file_path).toString(),
                    content: fs.readFileSync(file_path, 'utf8'),
                };
            });

            resolver.reset_cache_metrics();

            // Simulate concurrent access pattern
            for (let round = 0; round < 3; round++) {
                for (const file of files) {
                    await resolver.resolve(file.uri, file.content);
                }
            }

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(10); // 5 files × 2 additional rounds
            expect(metrics.misses).toBe(5); // 5 files × 1 initial round
        });
    });

    // Edge Cases
    describe('Edge Cases', () => {
        test('handles empty content caching', async () => {
            const file_path = write_file('empty.do', '');
            const file_uri = URI.file(file_path).toString();
            const content = '';

            resolver.reset_cache_metrics();
            
            await resolver.resolve(file_uri, content); // miss
            await resolver.resolve(file_uri, content); // hit

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(1);
            expect(metrics.misses).toBe(1);
        });

        test('handles very long content', async () => {
            const long_content = 'local x = 1\n'.repeat(1000);
            const file_path = write_file('long.do', long_content);
            const file_uri = URI.file(file_path).toString();

            resolver.reset_cache_metrics();
            
            await resolver.resolve(file_uri, long_content); // miss
            await resolver.resolve(file_uri, long_content); // hit

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(1);
            expect(metrics.misses).toBe(1);
        });

        test('cache key uniqueness', async () => {
            // Test that different files with same content get different cache keys
            const content = 'local x = 1';
            const file1_path = write_file('file1.do', content);
            const file2_path = write_file('file2.do', content);
            const file1_uri = URI.file(file1_path).toString();
            const file2_uri = URI.file(file2_path).toString();

            resolver.reset_cache_metrics();
            
            await resolver.resolve(file1_uri, content); // miss
            await resolver.resolve(file2_uri, content); // miss (different URI)
            await resolver.resolve(file1_uri, content); // hit
            await resolver.resolve(file2_uri, content); // hit

            const metrics = resolver.get_cache_metrics();
            expect(metrics.hits).toBe(2);
            expect(metrics.misses).toBe(2);
        });
    });
});
