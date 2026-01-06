/**
 * Property tests for Transitive Backward Directive Invalidation
 *
 * Tests the get_transitive_backward_directive_children method which computes
 * all files that transitively depend on a parent file via backward directives.
 *
 * **Feature: transitive-backward-directive-invalidation**
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';

describe('Transitive Backward Directive Invalidation Property Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transitive-bd-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const file_uri = (file_path: string): string => URI.file(file_path).toString();

    /**
     * Property 1: Transitive Invalidation Propagation
     *
     * *For any* directive chain where file A is the root, file B depends on A via
     * `@lsp-done-by`, and file C depends on B via `@lsp-done-by`, when A's interface
     * changes, both B and C should be included in the set of URIs to revalidate.
     *
     * **Validates: Requirements 1.1, 1.2, 1.3**
     */
    describe('Property 1: Transitive Invalidation Propagation', () => {
        test('transitive dependents are included in invalidation set', async () => {
            // Create a chain: a.do → b.do → c.do
            // where b.do has @lsp-done-by: a.do and c.do has @lsp-done-by: b.do
            const a_path = write_file('a.do', 'global root_var = 1');
            const b_path = write_file('b.do', `// @lsp-done-by "a.do"
global middle_var = 2`);
            const c_path = write_file('c.do', `// @lsp-done-by "b.do"
global leaf_var = 3`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);
            const c_uri = file_uri(c_path);

            const b_content = fs.readFileSync(b_path, 'utf8');
            const c_content = fs.readFileSync(c_path, 'utf8');

            // Resolve b and c to register backward directive dependencies
            await resolver.resolve(b_uri, b_content);
            await resolver.resolve(c_uri, c_content);

            // Get transitive dependents of a
            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);

            // Both b and c should be in the transitive dependents
            expect(transitive_children.has(b_uri)).toBe(true);
            expect(transitive_children.has(c_uri)).toBe(true);
            expect(transitive_children.size).toBe(2);
        });

        test('property: chain of any length propagates to all dependents', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 5 }), // Chain length (2-5 files)
                    async (chain_length) => {
                        // Create a chain of files: file0 → file1 → file2 → ... → fileN
                        const the_paths: string[] = [];
                        const the_uris: string[] = [];

                        // Create root file (no directive)
                        const root_path = write_file(`chain_${chain_length}_0.do`, 'global root = 1');
                        the_paths.push(root_path);
                        the_uris.push(file_uri(root_path));

                        // Create chain files with @lsp-done-by pointing to previous file
                        for (let i = 1; i < chain_length; i++) {
                            const prev_filename = `chain_${chain_length}_${i - 1}.do`;
                            const content = `// @lsp-done-by "${prev_filename}"
global var_${i} = ${i}`;
                            const my_path = write_file(`chain_${chain_length}_${i}.do`, content);
                            the_paths.push(my_path);
                            the_uris.push(file_uri(my_path));
                        }

                        // Resolve all files except root to register dependencies
                        for (let i = 1; i < chain_length; i++) {
                            const content = fs.readFileSync(the_paths[i], 'utf8');
                            await resolver.resolve(the_uris[i], content);
                        }

                        // Get transitive dependents of root
                        const transitive_children = resolver.get_transitive_backward_directive_children(the_uris[0]);

                        // All files except root should be in transitive dependents
                        for (let i = 1; i < chain_length; i++) {
                            expect(transitive_children.has(the_uris[i])).toBe(true);
                        }
                        expect(transitive_children.size).toBe(chain_length - 1);
                    }
                ),
                { numRuns: 10 }
            );
        });

        test('diamond dependency includes all paths', async () => {
            // Create a diamond: a.do → b.do, a.do → c.do, b.do → d.do, c.do → d.do
            const a_path = write_file('diamond_a.do', 'global a_var = 1');
            const b_path = write_file('diamond_b.do', `// @lsp-done-by "diamond_a.do"
global b_var = 2`);
            const c_path = write_file('diamond_c.do', `// @lsp-done-by "diamond_a.do"
global c_var = 3`);
            const d_path = write_file('diamond_d.do', `// @lsp-done-by "diamond_b.do"
// @lsp-done-by "diamond_c.do"
global d_var = 4`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);
            const c_uri = file_uri(c_path);
            const d_uri = file_uri(d_path);

            // Resolve all files to register dependencies
            await resolver.resolve(b_uri, fs.readFileSync(b_path, 'utf8'));
            await resolver.resolve(c_uri, fs.readFileSync(c_path, 'utf8'));
            await resolver.resolve(d_uri, fs.readFileSync(d_path, 'utf8'));

            // Get transitive dependents of a
            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);

            // All of b, c, d should be in transitive dependents
            expect(transitive_children.has(b_uri)).toBe(true);
            expect(transitive_children.has(c_uri)).toBe(true);
            expect(transitive_children.has(d_uri)).toBe(true);
            expect(transitive_children.size).toBe(3);
        });
    });


    /**
     * Property 2: Cycle Detection Terminates
     *
     * *For any* backward directive dependency graph containing cycles (e.g., A → B → C → A),
     * the `get_transitive_backward_directive_children` function should terminate and return
     * a finite set of URIs without entering an infinite loop.
     *
     * **Validates: Requirements 1.4**
     */
    describe('Property 2: Cycle Detection Terminates', () => {
        test('cycle in dependency graph terminates', async () => {
            // Create a cycle: a.do → b.do → c.do → a.do
            const a_path = write_file('cycle_a.do', `// @lsp-done-by "cycle_c.do"
global a_var = 1`);
            const b_path = write_file('cycle_b.do', `// @lsp-done-by "cycle_a.do"
global b_var = 2`);
            const c_path = write_file('cycle_c.do', `// @lsp-done-by "cycle_b.do"
global c_var = 3`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);
            const c_uri = file_uri(c_path);

            // Resolve all files to register dependencies
            await resolver.resolve(a_uri, fs.readFileSync(a_path, 'utf8'));
            await resolver.resolve(b_uri, fs.readFileSync(b_path, 'utf8'));
            await resolver.resolve(c_uri, fs.readFileSync(c_path, 'utf8'));

            // Get transitive dependents - should terminate without infinite loop
            const start_time = Date.now();
            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);
            const elapsed_ms = Date.now() - start_time;

            // Should complete quickly (< 1 second)
            expect(elapsed_ms).toBeLessThan(1000);

            // Should return a finite set (b and c, but not a since a is the starting point)
            expect(transitive_children.size).toBeLessThanOrEqual(2);
        });

        test('property: cycles of any size terminate', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 2, max: 5 }), // Cycle size
                    async (cycle_size) => {
                        // Create a cycle: file0 → file1 → ... → fileN → file0
                        const the_paths: string[] = [];
                        const the_uris: string[] = [];

                        for (let i = 0; i < cycle_size; i++) {
                            const prev_index = (i - 1 + cycle_size) % cycle_size;
                            const prev_filename = `cycle_${cycle_size}_${prev_index}.do`;
                            const content = `// @lsp-done-by "${prev_filename}"
global var_${i} = ${i}`;
                            const my_path = write_file(`cycle_${cycle_size}_${i}.do`, content);
                            the_paths.push(my_path);
                            the_uris.push(file_uri(my_path));
                        }

                        // Resolve all files to register dependencies
                        for (let i = 0; i < cycle_size; i++) {
                            const content = fs.readFileSync(the_paths[i], 'utf8');
                            await resolver.resolve(the_uris[i], content);
                        }

                        // Get transitive dependents - should terminate
                        const start_time = Date.now();
                        const transitive_children = resolver.get_transitive_backward_directive_children(the_uris[0]);
                        const elapsed_ms = Date.now() - start_time;

                        // Should complete quickly
                        expect(elapsed_ms).toBeLessThan(1000);

                        // Should return a finite set
                        expect(transitive_children.size).toBeLessThanOrEqual(cycle_size);
                    }
                ),
                { numRuns: 10 }
            );
        });

        test('self-referencing file terminates', async () => {
            // Create a file that references itself
            const self_path = write_file('self_ref.do', `// @lsp-done-by "self_ref.do"
global self_var = 1`);
            const self_uri = file_uri(self_path);

            await resolver.resolve(self_uri, fs.readFileSync(self_path, 'utf8'));

            // Should terminate without infinite loop
            const start_time = Date.now();
            const transitive_children = resolver.get_transitive_backward_directive_children(self_uri);
            const elapsed_ms = Date.now() - start_time;

            expect(elapsed_ms).toBeLessThan(1000);
            // Self-reference creates a dependency from self to self, but since we start
            // with self in visited, it won't be added to result
            expect(transitive_children.size).toBeLessThanOrEqual(1);
        });
    });

    /**
     * Property 3: Depth Limiting Respected
     *
     * *For any* directive chain of length N where N > max_depth, the
     * `get_transitive_backward_directive_children` function should return only
     * dependents within max_depth levels, not the entire chain.
     *
     * **Validates: Requirements 1.5**
     */
    describe('Property 3: Depth Limiting Respected', () => {
        test('depth limit restricts traversal', async () => {
            // Create a chain of 5 files: a → b → c → d → e
            const a_path = write_file('depth_a.do', 'global a_var = 1');
            const b_path = write_file('depth_b.do', `// @lsp-done-by "depth_a.do"
global b_var = 2`);
            const c_path = write_file('depth_c.do', `// @lsp-done-by "depth_b.do"
global c_var = 3`);
            const d_path = write_file('depth_d.do', `// @lsp-done-by "depth_c.do"
global d_var = 4`);
            const e_path = write_file('depth_e.do', `// @lsp-done-by "depth_d.do"
global e_var = 5`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);
            const c_uri = file_uri(c_path);
            const d_uri = file_uri(d_path);
            const e_uri = file_uri(e_path);

            // Resolve all files to register dependencies
            await resolver.resolve(b_uri, fs.readFileSync(b_path, 'utf8'));
            await resolver.resolve(c_uri, fs.readFileSync(c_path, 'utf8'));
            await resolver.resolve(d_uri, fs.readFileSync(d_path, 'utf8'));
            await resolver.resolve(e_uri, fs.readFileSync(e_path, 'utf8'));

            // With max_depth=2, should only get b and c (depth 1 and 2)
            const depth_2_children = resolver.get_transitive_backward_directive_children(a_uri, 2);
            expect(depth_2_children.has(b_uri)).toBe(true);
            expect(depth_2_children.has(c_uri)).toBe(true);
            expect(depth_2_children.has(d_uri)).toBe(false);
            expect(depth_2_children.has(e_uri)).toBe(false);
            expect(depth_2_children.size).toBe(2);

            // With max_depth=4, should get b, c, d, e
            const depth_4_children = resolver.get_transitive_backward_directive_children(a_uri, 4);
            expect(depth_4_children.has(b_uri)).toBe(true);
            expect(depth_4_children.has(c_uri)).toBe(true);
            expect(depth_4_children.has(d_uri)).toBe(true);
            expect(depth_4_children.has(e_uri)).toBe(true);
            expect(depth_4_children.size).toBe(4);
        });

        test('property: depth limit is respected for chains of any length', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 3, max: 6 }), // Chain length
                    fc.integer({ min: 1, max: 3 }), // Max depth
                    async (chain_length, max_depth) => {
                        // Create a chain of files
                        const the_paths: string[] = [];
                        const the_uris: string[] = [];

                        // Create root file
                        const root_path = write_file(`depth_chain_${chain_length}_${max_depth}_0.do`, 'global root = 1');
                        the_paths.push(root_path);
                        the_uris.push(file_uri(root_path));

                        // Create chain files
                        for (let i = 1; i < chain_length; i++) {
                            const prev_filename = `depth_chain_${chain_length}_${max_depth}_${i - 1}.do`;
                            const content = `// @lsp-done-by "${prev_filename}"
global var_${i} = ${i}`;
                            const my_path = write_file(`depth_chain_${chain_length}_${max_depth}_${i}.do`, content);
                            the_paths.push(my_path);
                            the_uris.push(file_uri(my_path));
                        }

                        // Resolve all files except root
                        for (let i = 1; i < chain_length; i++) {
                            const content = fs.readFileSync(the_paths[i], 'utf8');
                            await resolver.resolve(the_uris[i], content);
                        }

                        // Get transitive dependents with depth limit
                        const transitive_children = resolver.get_transitive_backward_directive_children(
                            the_uris[0],
                            max_depth
                        );

                        // Should have at most min(max_depth, chain_length - 1) dependents
                        const expected_max = Math.min(max_depth, chain_length - 1);
                        expect(transitive_children.size).toBeLessThanOrEqual(expected_max);

                        // Files within depth limit should be included
                        for (let i = 1; i <= Math.min(max_depth, chain_length - 1); i++) {
                            expect(transitive_children.has(the_uris[i])).toBe(true);
                        }

                        // Files beyond depth limit should NOT be included
                        for (let i = max_depth + 1; i < chain_length; i++) {
                            expect(transitive_children.has(the_uris[i])).toBe(false);
                        }
                    }
                ),
                { numRuns: 10 }
            );
        });

        test('depth 0 returns empty set', async () => {
            const a_path = write_file('depth0_a.do', 'global a_var = 1');
            const b_path = write_file('depth0_b.do', `// @lsp-done-by "depth0_a.do"
global b_var = 2`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);

            await resolver.resolve(b_uri, fs.readFileSync(b_path, 'utf8'));

            // With max_depth=0, should return empty set
            const depth_0_children = resolver.get_transitive_backward_directive_children(a_uri, 0);
            expect(depth_0_children.size).toBe(0);
        });

        test('depth 1 returns only direct children', async () => {
            // Create: a → b → c
            const a_path = write_file('depth1_a.do', 'global a_var = 1');
            const b_path = write_file('depth1_b.do', `// @lsp-done-by "depth1_a.do"
global b_var = 2`);
            const c_path = write_file('depth1_c.do', `// @lsp-done-by "depth1_b.do"
global c_var = 3`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);
            const c_uri = file_uri(c_path);

            await resolver.resolve(b_uri, fs.readFileSync(b_path, 'utf8'));
            await resolver.resolve(c_uri, fs.readFileSync(c_path, 'utf8'));

            // With max_depth=1, should only get b (direct child)
            const depth_1_children = resolver.get_transitive_backward_directive_children(a_uri, 1);
            expect(depth_1_children.has(b_uri)).toBe(true);
            expect(depth_1_children.has(c_uri)).toBe(false);
            expect(depth_1_children.size).toBe(1);
        });
    });

    // Edge cases
    describe('Edge Cases', () => {
        test('no dependents returns empty set', async () => {
            const a_path = write_file('no_deps.do', 'global a_var = 1');
            const a_uri = file_uri(a_path);

            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);
            expect(transitive_children.size).toBe(0);
        });

        test('non-existent file returns empty set', async () => {
            const non_existent_uri = file_uri(path.join(temp_dir, 'non_existent.do'));

            const transitive_children = resolver.get_transitive_backward_directive_children(non_existent_uri);
            expect(transitive_children.size).toBe(0);
        });

        test('direct children equals transitive children for depth-1 graph', async () => {
            // Create: a → b, a → c (no further dependencies)
            const a_path = write_file('flat_a.do', 'global a_var = 1');
            const b_path = write_file('flat_b.do', `// @lsp-done-by "flat_a.do"
global b_var = 2`);
            const c_path = write_file('flat_c.do', `// @lsp-done-by "flat_a.do"
global c_var = 3`);

            const a_uri = file_uri(a_path);
            const b_uri = file_uri(b_path);
            const c_uri = file_uri(c_path);

            await resolver.resolve(b_uri, fs.readFileSync(b_path, 'utf8'));
            await resolver.resolve(c_uri, fs.readFileSync(c_path, 'utf8'));

            const direct_children = resolver.get_backward_directive_children(a_uri);
            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);

            // For a flat graph, direct and transitive should be the same
            expect(transitive_children.size).toBe(direct_children.size);
            for (const child of direct_children) {
                expect(transitive_children.has(child)).toBe(true);
            }
        });
    });
});
