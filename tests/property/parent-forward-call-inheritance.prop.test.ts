/**
 * Property tests for Parent Forward Call Inheritance
 *
 * Tests the correctness properties defined in the design document for
 * the parent-forward-call-inheritance feature.
 *
 * Feature: parent-forward-call-inheritance
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Parent Forward Call Inheritance Property Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-forward-prop-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const to_uri = (file_path: string): string => {
        return `file://${file_path}`;
    };

    // Generator for valid Stata identifiers
    const identifier_gen = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
        { minLength: 1, maxLength: 10 }
    ).filter(s => /^[a-z_][a-z0-9_]*$/i.test(s));

    /**
     * Property 1: Forward calls before call site are included
     *
     * *For any* parent file with forward calls and any child file with a backward directive,
     * symbols from forward calls that occur before the call site SHALL be included in the
     * child's resolved scope.
     *
     * **Validates: Requirements 1.1, 2.1, 2.2**
     */
    describe('Property 1: Forward calls before call site are included', () => {
        test('symbols from forward calls before call site are included', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (global_name) => {
                        // Create helper file with a global
                        const helper_path = create_file(`helper_${global_name}.do`, `
global ${global_name} = "value"
`);

                        // Create parent file that calls helper BEFORE child
                        const parent_content = `
run "${helper_path}"
do "child_${global_name}.do"
`;
                        const parent_path = create_file(`parent_${global_name}.do`, parent_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-done-by: "${parent_path}" match="child_${global_name}.do"
local x = 1
`;
                        const child_path = create_file(`child_${global_name}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Symbol from forward call before call site should be included
                        expect(result.symbols.globalMacros.has(global_name)).toBe(true);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 2: Forward calls after call site are excluded
     *
     * *For any* parent file with forward calls after the call site, symbols from those
     * forward calls SHALL NOT be included in the child's resolved scope.
     *
     * **Validates: Requirements 2.1**
     */
    describe('Property 2: Forward calls after call site are excluded', () => {
        test('symbols from forward calls after call site are excluded', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (global_name) => {
                        // Create helper file with a global
                        const helper_path = create_file(`after_helper_${global_name}.do`, `
global ${global_name}_after = "value"
`);

                        // Create parent file that calls helper AFTER child
                        const parent_content = `
do "after_child_${global_name}.do"
run "${helper_path}"
`;
                        const parent_path = create_file(`after_parent_${global_name}.do`, parent_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-done-by: "${parent_path}" match="after_child_${global_name}.do"
local x = 1
`;
                        const child_path = create_file(`after_child_${global_name}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Symbol from forward call after call site should NOT be included
                        expect(result.symbols.globalMacros.has(`${global_name}_after`)).toBe(false);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 3: do/run inheritance excludes locals
     *
     * *For any* parent file with `do` or `run` forward calls, local macros from the called
     * scripts SHALL NOT be included in the child's scope, while globals, scalars, matrices,
     * and programs SHALL be included.
     *
     * **Validates: Requirements 1.2, 1.3**
     */
    describe('Property 3: do/run inheritance excludes locals', () => {
        test('do command excludes locals from forward-called scripts', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    fc.constantFrom('do', 'run'),
                    async (name, call_type) => {
                        // Create helper file with both local and global
                        const helper_path = create_file(`dorun_helper_${name}_${call_type}.do`, `
global ${name}_global = "global"
local ${name}_local = "local"
`);

                        // Create parent file that calls helper before child
                        const parent_content = `
${call_type} "${helper_path}"
do "dorun_child_${name}_${call_type}.do"
`;
                        const parent_path = create_file(`dorun_parent_${name}_${call_type}.do`, parent_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-done-by: "${parent_path}" match="dorun_child_${name}_${call_type}.do"
local x = 1
`;
                        const child_path = create_file(`dorun_child_${name}_${call_type}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Global should be included
                        expect(result.symbols.globalMacros.has(`${name}_global`)).toBe(true);
                        // Local should NOT be included (do/run excludes locals)
                        expect(result.symbols.localMacros.has(`${name}_local`)).toBe(false);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 4: include inheritance includes all symbols
     *
     * *For any* parent file with `include` forward calls AND a child using `@lsp-included-by`,
     * ALL symbols including locals from the included scripts SHALL be included in the child's scope.
     *
     * **Validates: Requirements 1.4, 3.2**
     */
    describe('Property 4: include inheritance includes all symbols', () => {
        test('include command includes locals when using @lsp-included-by', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (name) => {
                        // Create helper file with both local and global
                        const helper_path = create_file(`inc_helper_${name}.do`, `
global ${name}_global = "global"
local ${name}_local = "local"
`);

                        // Create parent file that includes helper before child
                        const parent_content = `
include "${helper_path}"
include "inc_child_${name}.do"
`;
                        const parent_path = create_file(`inc_parent_${name}.do`, parent_content);

                        // Create child file with @lsp-included-by directive
                        const child_content = `// @lsp-included-by: "${parent_path}" match="inc_child_${name}.do"
local x = 1
`;
                        const child_path = create_file(`inc_child_${name}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Both global and local should be included
                        expect(result.symbols.globalMacros.has(`${name}_global`)).toBe(true);
                        expect(result.symbols.localMacros.has(`${name}_local`)).toBe(true);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 5: Effective call type propagation
     *
     * *For any* child using `@lsp-done-by` or `@lsp-run-by`, all forward calls in the parent
     * SHALL be treated with effective type `do`, excluding locals from all forward-called
     * scripts regardless of the original call type.
     *
     * **Validates: Requirements 3.1, 3.3**
     */
    describe('Property 5: Effective call type propagation', () => {
        test('done-by treats all forward calls as do (excludes locals)', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (name) => {
                        // Create helper file with both local and global
                        const helper_path = create_file(`eff_helper_${name}.do`, `
global ${name}_global = "global"
local ${name}_local = "local"
`);

                        // Create parent file that INCLUDES helper (would normally preserve locals)
                        // but child uses done-by (which should exclude locals)
                        const parent_content = `
include "${helper_path}"
do "eff_child_${name}.do"
`;
                        const parent_path = create_file(`eff_parent_${name}.do`, parent_content);

                        // Create child file with @lsp-done-by directive
                        const child_content = `// @lsp-done-by: "${parent_path}" match="eff_child_${name}.do"
local x = 1
`;
                        const child_path = create_file(`eff_child_${name}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Global should be included
                        expect(result.symbols.globalMacros.has(`${name}_global`)).toBe(true);
                        // Local should NOT be included (done-by forces do semantics)
                        expect(result.symbols.localMacros.has(`${name}_local`)).toBe(false);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 6: Nested forward calls are resolved
     *
     * *For any* parent file with nested forward calls (A calls B, B calls C), symbols from
     * all levels SHALL be included in the child's scope (up to max depth), with correct
     * inheritance rules applied at each level.
     *
     * **Validates: Requirements 1.5**
     */
    describe('Property 6: Nested forward calls are resolved', () => {
        test('nested forward calls are resolved up to max depth', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (name) => {
                        // Create nested chain: helper2 -> helper1 -> parent -> child
                        const helper2_path = create_file(`nest2_${name}.do`, `
global ${name}_from_helper2 = "value"
`);

                        const helper1_path = create_file(`nest1_${name}.do`, `
global ${name}_from_helper1 = "value"
run "${helper2_path}"
`);

                        const parent_content = `
run "${helper1_path}"
do "nest_child_${name}.do"
`;
                        const parent_path = create_file(`nest_parent_${name}.do`, parent_content);

                        const child_content = `// @lsp-done-by: "${parent_path}" match="nest_child_${name}.do"
local x = 1
`;
                        const child_path = create_file(`nest_child_${name}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Symbols from both levels should be included
                        expect(result.symbols.globalMacros.has(`${name}_from_helper1`)).toBe(true);
                        expect(result.symbols.globalMacros.has(`${name}_from_helper2`)).toBe(true);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 7: Cycle detection prevents infinite loops
     *
     * *For any* forward call chain that creates a cycle, the resolver SHALL detect the cycle
     * and terminate gracefully without hanging. Expected cycles occur during two-phase resolution.
     *
     * **Validates: Requirements 4.1**
     */
    describe('Property 7: Cycle detection prevents infinite loops', () => {
        test('cycles are detected and handled gracefully', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (name) => {
                        // Create a cycle: a -> b -> a
                        const a_path = path.join(temp_dir, `cycle_a_${name}.do`);
                        const b_path = path.join(temp_dir, `cycle_b_${name}.do`);

                        fs.writeFileSync(a_path, `
global ${name}_from_a = "value"
run "${b_path}"
`);
                        fs.writeFileSync(b_path, `
global ${name}_from_b = "value"
run "${a_path}"
`);

                        const parent_content = `
run "${a_path}"
do "cycle_child_${name}.do"
`;
                        const parent_path = create_file(`cycle_parent_${name}.do`, parent_content);

                        const child_content = `// @lsp-done-by: "${parent_path}" match="cycle_child_${name}.do"
local x = 1
`;
                        const child_path = create_file(`cycle_child_${name}.do`, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Cycles should be handled gracefully without emitting diagnostics
                        // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
                        const cycle_diagnostics = result.diagnostics.filter(
                            d => d.message.toLowerCase().includes('circular') || d.message.toLowerCase().includes('cycle')
                        );
                        expect(cycle_diagnostics.length).toBe(0);

                        // Should still resolve symbols from the current file
                        expect(result.symbols.localMacros.has('x')).toBe(true);
                    }
                ),
                { numRuns: 10 }
            );
        });
    });

    /**
     * Property 8: Depth limiting is enforced
     *
     * *For any* combined backward + forward resolution that exceeds max depth, the resolver
     * SHALL stop at the limit and emit a warning.
     *
     * **Validates: Requirements 4.2**
     */
    describe('Property 8: Depth limiting is enforced', () => {
        test('resolution stops at max depth', async () => {
            // Create a deep chain that exceeds max depth
            const chain_length = 15;
            const the_files: string[] = [];

            for (let i = chain_length - 1; i >= 0; i--) {
                const next_file = i < chain_length - 1 ? the_files[0] : undefined;
                const content = next_file
                    ? `global deep_global_${i} = ${i}\nrun "${next_file}"`
                    : `global deep_global_${i} = ${i}`;
                the_files.unshift(create_file(`deep_${i}.do`, content));
            }

            const parent_content = `
run "${the_files[0]}"
do "deep_child.do"
`;
            const parent_path = create_file('deep_parent.do', parent_content);

            const child_content = `// @lsp-done-by: "${parent_path}" match="deep_child.do"
local x = 1
`;
            const child_path = create_file('deep_child.do', child_content);
            const child_uri = to_uri(child_path);

            const result = await scope_resolver.resolve(child_uri, child_content, {
                max_chain_depth: 5,
            });

            // Should have a diagnostic about max depth
            const depth_diagnostics = result.diagnostics.filter(
                d => d.message.toLowerCase().includes('depth') || d.message.toLowerCase().includes('maximum')
            );
            expect(depth_diagnostics.length).toBeGreaterThan(0);
        });
    });

    /**
     * Property 9: Working directory context is used
     *
     * *For any* parent file with a working directory directive (`@lsp-cd`), forward call
     * paths SHALL be resolved relative to that working directory.
     *
     * **Validates: Requirements 5.1, 5.2, 5.3**
     */
    describe('Property 9: Working directory context is used', () => {
        test('forward call paths are resolved using parent working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    identifier_gen,
                    async (name) => {
                        // Create subdirectory structure
                        const subdir = path.join(temp_dir, `wd_subdir_${name}`);
                        fs.mkdirSync(subdir, { recursive: true });

                        // Create helper in root
                        const helper_path = create_file(`wd_helper_${name}.do`, `
global ${name}_from_helper = "value"
`);

                        // Create parent in subdir with @lsp-cd to root
                        const parent_content = `// @lsp-cd ../
run "wd_helper_${name}.do"
do "wd_subdir_${name}/wd_child_${name}.do"
`;
                        const parent_path = path.join(subdir, `wd_parent_${name}.do`);
                        fs.writeFileSync(parent_path, parent_content);

                        // Create child in subdir
                        const child_content = `// @lsp-done-by: "${parent_path}" match="wd_child_${name}.do"
local x = 1
`;
                        const child_path = path.join(subdir, `wd_child_${name}.do`);
                        fs.writeFileSync(child_path, child_content);
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Symbol from helper should be included (resolved via working directory)
                        expect(result.symbols.globalMacros.has(`${name}_from_helper`)).toBe(true);
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});
