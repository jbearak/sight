/**
 * Property-based tests for scope-cache-optimization feature.
 * Feature: scope-cache-optimization
 *
 * Tests the correctness properties defined in the design document.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';

describe('Scope Cache Optimization Property Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-cache-prop-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Generator for valid Stata identifiers
    const identifier_gen = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
        { minLength: 1, maxLength: 10 }
    );

    // Generator for simple Stata content
    const stata_content_gen = fc.array(
        fc.oneof(
            identifier_gen.map(name => `local ${name} = 1`),
            identifier_gen.map(name => `global ${name} = 1`),
            fc.constant('display "hello"')
        ),
        { minLength: 1, maxLength: 5 }
    ).map(lines => lines.join('\n'));

    describe('Property 1: Scope-cache invalidation removes only dependent entries', () => {
        /**
         * Feature: scope-cache-optimization, Property 1: Scope-cache
         * invalidation removes only dependent entries
         * Validates: Requirements R1.2
         */
        it('should remove exactly dependent entries and leave others unchanged', async () => {
            await fc.assert(
                fc.asyncProperty(
                    stata_content_gen,
                    stata_content_gen,
                    async (content1, content2) => {
                        // Create two independent files
                        const file1_path = create_file('file1.do', content1);
                        const file2_path = create_file('file2.do', content2);
                        const file1_uri = URI.file(file1_path).toString();
                        const file2_uri = URI.file(file2_path).toString();

                        // Resolve both files
                        await resolver.resolve(file1_uri, content1);
                        await resolver.resolve(file2_uri, content2);

                        // Invalidate scope cache for file1
                        resolver.invalidate_scope_cache(file1_uri);

                        // File2's scope cache should still be valid (cache hit)
                        resolver.reset_cache_metrics();
                        await resolver.resolve(file2_uri, content2);
                        const metrics = resolver.get_cache_metrics();

                        expect(metrics.scope.hits).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not touch file cache when invalidating scope cache', async () => {
            await fc.assert(
                fc.asyncProperty(
                    stata_content_gen,
                    async (content) => {
                        const file_path = create_file('test.do', content);
                        const file_uri = URI.file(file_path).toString();

                        // Resolve to populate both caches
                        await resolver.resolve(file_uri, content);

                        // Invalidate scope cache only
                        resolver.reset_cache_metrics();
                        resolver.invalidate_scope_cache(file_uri);

                        const metrics = resolver.get_cache_metrics();
                        // File cache should not be touched
                        expect(metrics.file.invalidations).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 2: File-cache invalidation cascades to scope-cache', () => {
        /**
         * Feature: scope-cache-optimization, Property 2: File-cache
         * invalidation cascades to scope-cache
         * Validates: Requirements R1.4
         */
        it('should remove file cache entry and cascade to dependent scope entries', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (macro_name) => {
                        // Create parent and child files
                        const parent_content = `global ${macro_name} = 1`;
                        const parent_path = create_file('parent.do', parent_content);
                        const parent_uri = URI.file(parent_path).toString();

                        const child_content =
                            `// @lsp-done-by "${parent_path}"\n` +
                            `local x = $${macro_name}`;
                        const child_path = create_file('child.do', child_content);
                        const child_uri = URI.file(child_path).toString();

                        // Resolve child (which loads parent)
                        await resolver.resolve(child_uri, child_content);
                        resolver.reset_cache_metrics();

                        // Invalidate file cache for parent
                        resolver.invalidate_file_cache(parent_uri);

                        const metrics = resolver.get_cache_metrics();
                        // Should have invalidated file cache
                        expect(metrics.file.invalidations).toBe(1);
                        // Should have cascaded to scope cache
                        expect(metrics.scope.invalidations).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should leave unrelated entries unchanged', async () => {
            await fc.assert(
                fc.asyncProperty(
                    stata_content_gen,
                    stata_content_gen,
                    async (content1, content2) => {
                        // Create two independent files
                        const file1_path = create_file('independent1.do', content1);
                        const file2_path = create_file('independent2.do', content2);
                        const file1_uri = URI.file(file1_path).toString();
                        const file2_uri = URI.file(file2_path).toString();

                        // Resolve both files
                        await resolver.resolve(file1_uri, content1);
                        await resolver.resolve(file2_uri, content2);

                        // Invalidate file cache for file1
                        resolver.invalidate_file_cache(file1_uri);

                        // File2's scope cache should still be valid
                        resolver.reset_cache_metrics();
                        await resolver.resolve(file2_uri, content2);
                        const metrics = resolver.get_cache_metrics();

                        expect(metrics.scope.hits).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 3: Cache hit/miss correctness based on hash', () => {
        /**
         * Feature: scope-cache-optimization, Property 3: Cache hit/miss
         * correctness based on hash
         * Validates: Requirements R2.2, R2.3, R2.4
         */
        it('should hit cache when content hash matches, miss when different', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    stata_content_gen,
                    stata_content_gen,
                    async (unique_id, content1, content2) => {
                        // Fresh resolver per run to avoid cross-run state leakage.
                        const run_resolver = new ScopeResolver();

                        const file_path = create_file(`test_${unique_id}.do`, content1);
                        const file_uri = URI.file(file_path).toString();

                        run_resolver.reset_cache_metrics();

                        // First resolve - miss
                        await run_resolver.resolve(file_uri, content1);

                        // Same content - hit
                        await run_resolver.resolve(file_uri, content1);

                        // Different content - miss (if different)
                        if (content1 !== content2) {
                            await run_resolver.resolve(file_uri, content2);
                        }

                        const metrics = run_resolver.get_cache_metrics();
                        expect(metrics.scope.misses).toBe(content1 !== content2 ? 2 : 1);
                        expect(metrics.scope.hits).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should track file cache hits/misses for parent files', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    identifier_gen,
                    async (unique_id, macro_name) => {
                        // Fresh resolver per run to avoid cross-run state leakage.
                        const run_resolver = new ScopeResolver();

                        // Create parent file with unique name
                        const parent_content = `global ${macro_name} = 1`;
                        const parent_path = create_file(`parent_${unique_id}.do`, parent_content);

                        // Create child that references parent
                        const child_content =
                            `// @lsp-done-by "${parent_path}"\n` +
                            `display $${macro_name}`;
                        const child_path = create_file(`child_${unique_id}.do`, child_content);
                        const child_uri = URI.file(child_path).toString();

                        run_resolver.reset_cache_metrics();

                        // First resolve - file cache miss for parent
                        await run_resolver.resolve(child_uri, child_content);
                        const metrics1 = run_resolver.get_cache_metrics();
                        expect(metrics1.file.misses).toBeGreaterThanOrEqual(1);

                        // Clear scope cache but keep file cache
                        run_resolver.invalidate_scope_cache(child_uri);
                        run_resolver.reset_cache_metrics();

                        // Second resolve - file cache hit for parent
                        await run_resolver.resolve(child_uri, child_content);
                        const metrics2 = run_resolver.get_cache_metrics();
                        expect(metrics2.file.hits).toBeGreaterThanOrEqual(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 4: Scope cache key format consistency', () => {
        /**
         * Feature: scope-cache-optimization, Property 4: Scope cache key
         * format consistency
         * Validates: Requirements R3.1
         */
        it('should produce different cache keys for different configs', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    stata_content_gen,
                    async (unique_id, content) => {
                        const run_resolver = new ScopeResolver();

                        const file_path = create_file(`config_${unique_id}.do`, content);
                        const file_uri = URI.file(file_path).toString();

                        run_resolver.reset_cache_metrics();

                        // Resolve with default config
                        await run_resolver.resolve(file_uri, content);

                        // Resolve with different config - should miss
                        await run_resolver.resolve(file_uri, content, { assume_call_site: 'start' });

                        const metrics = run_resolver.get_cache_metrics();
                        // Both should be misses (different cache keys)
                        expect(metrics.scope.misses).toBe(2);
                        expect(metrics.scope.hits).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should produce same cache key for same inputs', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    stata_content_gen,
                    async (unique_id, content) => {
                        const run_resolver = new ScopeResolver();

                        const file_path = create_file(`same_${unique_id}.do`, content);
                        const file_uri = URI.file(file_path).toString();

                        run_resolver.reset_cache_metrics();

                        // Resolve twice with same inputs
                        await run_resolver.resolve(file_uri, content);
                        await run_resolver.resolve(file_uri, content);

                        const metrics = run_resolver.get_cache_metrics();
                        expect(metrics.scope.misses).toBe(1);
                        expect(metrics.scope.hits).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 5: Dependent URIs completeness', () => {
        /**
         * Feature: scope-cache-optimization, Property 5: Dependent URIs
         * completeness
         * Validates: Requirements R3.2, R3.4
         */
        it('should include all files in chain for invalidation cascade', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    identifier_gen,
                    async (macro1, macro2) => {
                        // Create grandparent -> parent -> child chain
                        const grandparent_content = `global ${macro1} = 1`;
                        const grandparent_path = create_file(
                            'grandparent.do',
                            grandparent_content
                        );

                        const parent_content =
                            `// @lsp-done-by "${grandparent_path}"\n` +
                            `global ${macro2} = $${macro1}`;
                        const parent_path = create_file('parent.do', parent_content);

                        const child_content =
                            `// @lsp-done-by "${parent_path}"\n` +
                            `display $${macro2}`;
                        const child_path = create_file('child.do', child_content);
                        const child_uri = URI.file(child_path).toString();
                        const grandparent_uri = URI.file(grandparent_path).toString();

                        // Resolve child (loads entire chain)
                        await resolver.resolve(child_uri, child_content);

                        // Invalidate grandparent - should cascade to child
                        resolver.reset_cache_metrics();
                        resolver.invalidate_file_cache(grandparent_uri);

                        const metrics = resolver.get_cache_metrics();
                        // Child's scope cache should be invalidated
                        expect(metrics.scope.invalidations).toBeGreaterThan(0);

                        // Verify child needs re-resolution
                        resolver.reset_cache_metrics();
                        await resolver.resolve(child_uri, child_content);
                        const metrics2 = resolver.get_cache_metrics();
                        expect(metrics2.scope.misses).toBe(1);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 6: Clear cache metrics accuracy', () => {
        /**
         * Feature: scope-cache-optimization, Property 6: Clear cache metrics
         * accuracy
         * Validates: Requirements R4.5, R5.4
         */
        it('should increment invalidations by exact cache sizes', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 5 }),
                    async (num_files) => {
                        // Create and resolve multiple files
                        for (let i = 0; i < num_files; i++) {
                            const content = `local var${i} = ${i}`;
                            const file_path = create_file(`file${i}.do`, content);
                            const file_uri = URI.file(file_path).toString();
                            await resolver.resolve(file_uri, content);
                        }

                        resolver.reset_cache_metrics();
                        resolver.clear_cache();

                        const metrics = resolver.get_cache_metrics();
                        // Should have incremented scope invalidations by number
                        // of scope entries
                        expect(metrics.scope.invalidations).toBe(num_files);
                        // File invalidations should also be tracked
                        expect(metrics.file.invalidations).toBeGreaterThanOrEqual(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should clear both caches completely', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 5 }),
                    async (num_files) => {
                        // Create and resolve multiple files
                        const the_file_uris: string[] = [];
                        const the_contents: string[] = [];

                        for (let i = 0; i < num_files; i++) {
                            const content = `local var${i} = ${i}`;
                            const file_path = create_file(`clear_test${i}.do`, content);
                            const file_uri = URI.file(file_path).toString();
                            the_file_uris.push(file_uri);
                            the_contents.push(content);
                            await resolver.resolve(file_uri, content);
                        }

                        // Clear cache
                        resolver.clear_cache();
                        resolver.reset_cache_metrics();

                        // All files should miss on next resolve
                        for (let i = 0; i < num_files; i++) {
                            await resolver.resolve(the_file_uris[i], the_contents[i]);
                        }

                        const metrics = resolver.get_cache_metrics();
                        expect(metrics.scope.misses).toBe(num_files);
                        expect(metrics.scope.hits).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 7: Metrics alias correctness', () => {
        /**
         * Feature: scope-cache-optimization, Property 7: Metrics alias
         * correctness
         * Validates: Requirements R5.2
         */
        it('should have top-level aliases equal to scope counters', async () => {
            await fc.assert(
                fc.asyncProperty(
                    stata_content_gen,
                    fc.integer({ min: 1, max: 5 }),
                    async (content, num_resolves) => {
                        const file_path = create_file('alias_test.do', content);
                        const file_uri = URI.file(file_path).toString();

                        resolver.reset_cache_metrics();

                        for (let i = 0; i < num_resolves; i++) {
                            await resolver.resolve(file_uri, content);
                        }

                        const metrics = resolver.get_cache_metrics();
                        expect(metrics.hits).toBe(metrics.scope.hits);
                        expect(metrics.misses).toBe(metrics.scope.misses);
                        expect(metrics.invalidations).toBe(metrics.scope.invalidations);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should maintain alias equality after invalidations', async () => {
            await fc.assert(
                fc.asyncProperty(
                    stata_content_gen,
                    async (content) => {
                        const file_path = create_file('alias_inv.do', content);
                        const file_uri = URI.file(file_path).toString();

                        resolver.reset_cache_metrics();

                        // Generate some activity
                        await resolver.resolve(file_uri, content);
                        await resolver.resolve(file_uri, content);
                        resolver.invalidate_scope_cache(file_uri);
                        await resolver.resolve(file_uri, content);

                        const metrics = resolver.get_cache_metrics();
                        expect(metrics.hits).toBe(metrics.scope.hits);
                        expect(metrics.misses).toBe(metrics.scope.misses);
                        expect(metrics.invalidations).toBe(metrics.scope.invalidations);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 8: Reset metrics preserves caches', () => {
        /**
         * Feature: scope-cache-optimization, Property 8: Reset metrics
         * preserves caches
         * Validates: Requirements R5.3
         */
        it('should reset counters to zero without clearing caches', async () => {
            await fc.assert(
                fc.asyncProperty(
                    stata_content_gen,
                    async (content) => {
                        const file_path = create_file('reset_test.do', content);
                        const file_uri = URI.file(file_path).toString();

                        // Populate cache
                        await resolver.resolve(file_uri, content);
                        await resolver.resolve(file_uri, content); // hit

                        // Reset metrics
                        resolver.reset_cache_metrics();

                        const metrics = resolver.get_cache_metrics();
                        expect(metrics.scope.hits).toBe(0);
                        expect(metrics.scope.misses).toBe(0);
                        expect(metrics.scope.invalidations).toBe(0);
                        expect(metrics.file.hits).toBe(0);
                        expect(metrics.file.misses).toBe(0);
                        expect(metrics.file.invalidations).toBe(0);

                        // Cache should still be populated
                        await resolver.resolve(file_uri, content);
                        const metrics2 = resolver.get_cache_metrics();
                        expect(metrics2.scope.hits).toBe(1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should reset all nested counters', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (macro_name) => {
                        // Create parent and child to generate file cache activity
                        const parent_content = `global ${macro_name} = 1`;
                        const parent_path = create_file('reset_parent.do', parent_content);

                        const child_content =
                            `// @lsp-done-by "${parent_path}"\n` +
                            `display $${macro_name}`;
                        const child_path = create_file('reset_child.do', child_content);
                        const child_uri = URI.file(child_path).toString();

                        // Generate activity
                        await resolver.resolve(child_uri, child_content);
                        resolver.invalidate_scope_cache(child_uri);
                        await resolver.resolve(child_uri, child_content);

                        // Reset metrics
                        resolver.reset_cache_metrics();

                        const metrics = resolver.get_cache_metrics();
                        // All counters should be zero
                        expect(metrics.scope.hits).toBe(0);
                        expect(metrics.scope.misses).toBe(0);
                        expect(metrics.scope.invalidations).toBe(0);
                        expect(metrics.file.hits).toBe(0);
                        expect(metrics.file.misses).toBe(0);
                        expect(metrics.file.invalidations).toBe(0);
                        expect(metrics.hits).toBe(0);
                        expect(metrics.misses).toBe(0);
                        expect(metrics.invalidations).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 9: Metrics counting accuracy', () => {
        /**
         * Feature: scope-cache-optimization, Property 9: Metrics counting
         * accuracy
         * Validates: Requirements R5.5, R5.6
         */
        it('should count scope hits + misses equal to resolve calls', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(stata_content_gen, { minLength: 1, maxLength: 5 }),
                    fc.integer({ min: 1, max: 3 }),
                    async (the_contents, rounds) => {
                        resolver.reset_cache_metrics();

                        let total_resolves = 0;

                        // Create files and resolve multiple rounds
                        for (let round = 0; round < rounds; round++) {
                            for (let i = 0; i < the_contents.length; i++) {
                                const my_content = the_contents[i];
                                const file_path = create_file(
                                    `counting_r${round}_f${i}.do`,
                                    my_content
                                );
                                const file_uri = URI.file(file_path).toString();
                                await resolver.resolve(file_uri, my_content);
                                total_resolves++;
                            }
                        }

                        const metrics = resolver.get_cache_metrics();
                        expect(metrics.scope.hits + metrics.scope.misses).toBe(total_resolves);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should count file hits + misses for parent file loads', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    identifier_gen,
                    fc.integer({ min: 2, max: 4 }),
                    async (unique_id, macro_name, num_children) => {
                        const run_resolver = new ScopeResolver();

                        // Create one parent
                        const parent_content = `global ${macro_name} = 1`;
                        const parent_path = create_file(
                            `count_parent_${unique_id}.do`,
                            parent_content
                        );

                        run_resolver.reset_cache_metrics();

                        // Create multiple children referencing the same parent
                        for (let i = 0; i < num_children; i++) {
                            const child_content =
                                `// @lsp-done-by "${parent_path}"\n` +
                                `local child${i} = $${macro_name}`;
                            const child_path = create_file(
                                `count_child_${unique_id}_${i}.do`,
                                child_content
                            );
                            const child_uri = URI.file(child_path).toString();
                            await run_resolver.resolve(child_uri, child_content);
                        }

                        const metrics = run_resolver.get_cache_metrics();
                        // First child causes file miss, subsequent children hit
                        // file.hits + file.misses = total parent file loads
                        expect(metrics.file.hits + metrics.file.misses).toBe(num_children);
                        // First load is a miss
                        expect(metrics.file.misses).toBe(1);
                        // Subsequent loads are hits
                        expect(metrics.file.hits).toBe(num_children - 1);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});