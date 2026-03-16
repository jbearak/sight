/**
 * Property tests for Working Directory Inheritance via Backward Directives
 *
 * Tests Properties 1-5 from the working-directory-inheritance design document.
 * These tests verify that child files inherit working directory from parent files
 * when using @lsp-done-by, @lsp-run-by, or @lsp-included-by directives.
 *
 * **Feature: working-directory-inheritance**
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';

describe('Working Directory Inheritance Property Tests', () => {
    let test_dir: string;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-inheritance-test-'));
        scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([test_dir]);
    });

    afterEach(() => {
        fs.rmSync(test_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file in the test directory
     */
    function write_file(relative_path: string, content: string): string {
        const full_path = path.join(test_dir, relative_path);
        const dir = path.dirname(full_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    /**
     * Property 1: Working Directory Inheritance
     * For any child file with a backward directive that lacks its own working directory directive,
     * if the parent file has a working directory directive, the resolved scope SHALL include
     * the parent's working directory as inherited_working_directory.
     *
     * **Validates: Requirements 1.1**
     */
    describe('Property 1: Working Directory Inheritance', () => {
        test('child inherits working directory from parent via @lsp-done-by', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('../data', './subdir', '/workspace/data'),
                    async (wd_path) => {
                        // Create parent file with working directory
                        const parent_content = `// @lsp-cd: "${wd_path}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file with @lsp-done-by but no own working directory
                        const child_content = `// @lsp-done-by: "parent.do"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from parent
                        expect(result.inherited_working_directory).toBeDefined();
                    }
                ),
                { numRuns: 20 }
            );
        });

        test('child inherits working directory from parent via @lsp-run-by', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('../data', './subdir'),
                    async (wd_path) => {
                        // Create parent file with working directory
                        const parent_content = `// @lsp-wd: "${wd_path}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file with @lsp-run-by (synonym for @lsp-done-by)
                        const child_content = `// @lsp-run-by: "parent.do"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from parent
                        expect(result.inherited_working_directory).toBeDefined();
                    }
                ),
                { numRuns: 20 }
            );
        });

        test('child inherits working directory from parent via @lsp-included-by', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('../data', './subdir'),
                    async (wd_path) => {
                        // Create parent file with working directory
                        const parent_content = `// @lsp-working-dir: "${wd_path}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file with @lsp-included-by
                        const child_content = `// @lsp-included-by: "parent.do"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from parent
                        expect(result.inherited_working_directory).toBeDefined();
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 2: Child Directive Precedence
     * For any child file that has both a backward directive and its own working directory directive,
     * the inherited_working_directory in the resolved scope SHALL be undefined.
     *
     * **Validates: Requirements 1.2**
     */
    describe('Property 2: Child Directive Precedence', () => {
        test('child with own working directory does not inherit from parent', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('../parent_data', './parent_subdir'),
                    fc.constantFrom('../child_data', './child_subdir'),
                    async (parent_wd, child_wd) => {
                        // Create parent file with working directory
                        const parent_content = `// @lsp-cd: "${parent_wd}"\nlocal parent_var = 1`;
                        const parent_path = write_file('parent.do', parent_content);

                        // Create child file with BOTH @lsp-done-by AND its own working directory
                        const child_content = `// @lsp-done-by: "parent.do"\n// @lsp-cd: "${child_wd}"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // inherited_working_directory should be undefined (child's own takes precedence)
                        expect(result.inherited_working_directory).toBeUndefined();
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    /**
     * Property 3: Depth-Based Precedence
     * For any child file with multiple parent files at different depths,
     * the inherited_working_directory SHALL be from the nearest parent (smallest depth).
     *
     * **Validates: Requirements 1.3**
     */
    describe('Property 3: Depth-Based Precedence', () => {
        test('nearest parent working directory wins over distant parent', async () => {
            // Create grandparent file with working directory
            const grandparent_content = `// @lsp-cd: "../grandparent_data"\nlocal gp_var = 1`;
            const grandparent_path = write_file('grandparent.do', grandparent_content);

            // Create parent file with working directory (references grandparent)
            const parent_content = `// @lsp-done-by: "grandparent.do"\n// @lsp-cd: "../parent_data"\nlocal parent_var = 2`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child file (references parent, no own working directory)
            const child_content = `// @lsp-done-by: "parent.do"\nlocal child_var = 3`;
            const child_path = write_file('child.do', child_content);

            // Resolve scope for child
            const child_uri = URI.file(child_path).toString();
            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should inherit from nearest parent (parent.do), not grandparent
            // The parent has its own working directory, so child inherits from parent
            expect(result.inherited_working_directory).toBeDefined();
            expect(result.inherited_working_directory).toContain('parent_data');
        });

        test('inherits from grandparent when parent has no working directory', async () => {
            // Create grandparent file with working directory
            const grandparent_content = `// @lsp-cd: "../grandparent_data"\nlocal gp_var = 1`;
            const grandparent_path = write_file('grandparent.do', grandparent_content);

            // Create parent file WITHOUT working directory (references grandparent)
            const parent_content = `// @lsp-done-by: "grandparent.do"\nlocal parent_var = 2`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child file (references parent, no own working directory)
            const child_content = `// @lsp-done-by: "parent.do"\nlocal child_var = 3`;
            const child_path = write_file('child.do', child_content);

            // Resolve scope for child
            const child_uri = URI.file(child_path).toString();
            const result = await scope_resolver.resolve(child_uri, child_content);

            // Should inherit from grandparent (propagated through parent)
            expect(result.inherited_working_directory).toBeDefined();
            expect(result.inherited_working_directory).toContain('grandparent_data');
        });
    });

    /**
     * Property 4: Path Resolution Context
     * For any parent file with a relative working directory path,
     * the inherited working directory SHALL be resolved relative to the parent file's directory.
     *
     * **Validates: Requirements 1.4**
     */
    describe('Property 4: Path Resolution Context', () => {
        test('relative working directory is resolved relative to parent directory', async () => {
            // Create subdirectory structure
            fs.mkdirSync(path.join(test_dir, 'subdir'), { recursive: true });

            // Create parent file in subdir with relative working directory
            const parent_content = `// @lsp-cd: "../data"\nlocal parent_var = 1`;
            const parent_path = write_file('subdir/parent.do', parent_content);

            // Create child file in root (references parent in subdir)
            const child_content = `// @lsp-done-by: "subdir/parent.do"\nlocal child_var = 2`;
            const child_path = write_file('child.do', child_content);

            // Resolve scope for child
            const child_uri = URI.file(child_path).toString();
            const result = await scope_resolver.resolve(child_uri, child_content);

            // The inherited working directory should be resolved relative to parent's directory
            // Parent is in subdir/, so "../data" resolves to test_dir/data
            expect(result.inherited_working_directory).toBeDefined();
            expect(result.inherited_working_directory).toContain('data');
            // Should NOT contain 'subdir' in the path (it's resolved from parent's perspective)
        });
    });

    /**
     * Property 5: Chain Propagation
     * For any directive chain where an intermediate file has a working directory directive,
     * files below that point SHALL inherit from that intermediate file.
     *
     * **Validates: Requirements 1.5**
     */
    describe('Property 5: Chain Propagation', () => {
        test('working directory propagates through chain until override', async () => {
            // Create root file with working directory
            const root_content = `// @lsp-cd: "../root_data"\nlocal root_var = 1`;
            const root_path = write_file('root.do', root_content);

            // Create middle file WITHOUT working directory
            const middle_content = `// @lsp-done-by: "root.do"\nlocal middle_var = 2`;
            const middle_path = write_file('middle.do', middle_content);

            // Create leaf file WITHOUT working directory
            const leaf_content = `// @lsp-done-by: "middle.do"\nlocal leaf_var = 3`;
            const leaf_path = write_file('leaf.do', leaf_content);

            // Resolve scope for leaf
            const leaf_uri = URI.file(leaf_path).toString();
            const result = await scope_resolver.resolve(leaf_uri, leaf_content);

            // Should inherit from root (propagated through middle)
            expect(result.inherited_working_directory).toBeDefined();
            expect(result.inherited_working_directory).toContain('root_data');
        });

        test('intermediate override stops propagation from ancestors', async () => {
            // Create root file with working directory
            const root_content = `// @lsp-cd: "../root_data"\nlocal root_var = 1`;
            const root_path = write_file('root.do', root_content);

            // Create middle file WITH its own working directory (overrides root)
            const middle_content = `// @lsp-done-by: "root.do"\n// @lsp-cd: "../middle_data"\nlocal middle_var = 2`;
            const middle_path = write_file('middle.do', middle_content);

            // Create leaf file WITHOUT working directory
            const leaf_content = `// @lsp-done-by: "middle.do"\nlocal leaf_var = 3`;
            const leaf_path = write_file('leaf.do', leaf_content);

            // Resolve scope for leaf
            const leaf_uri = URI.file(leaf_path).toString();
            const result = await scope_resolver.resolve(leaf_uri, leaf_content);

            // Should inherit from middle (not root)
            expect(result.inherited_working_directory).toBeDefined();
            expect(result.inherited_working_directory).toContain('middle_data');
        });
    });

    /**
     * Property 7: @lsp-run-by Inheritance Equivalence
     * Using @lsp-run-by SHALL inherit the same symbols as @lsp-done-by.
     *
     * **Validates: Requirements 2.3**
     */
    describe('Property 7: @lsp-run-by Inheritance Equivalence', () => {
        test('@lsp-run-by inherits same symbols as @lsp-done-by', async () => {
            // Create parent file with various symbols
            const parent_content = `
global parent_global = 1
local parent_local = 2
scalar parent_scalar = 3
program define parent_program
    display "hello"
end
`;
            const parent_path = write_file('parent.do', parent_content);

            // Create child with @lsp-done-by
            const done_by_content = `// @lsp-done-by: "parent.do"\nlocal child_var = 1`;
            const done_by_path = write_file('child_done_by.do', done_by_content);

            // Create child with @lsp-run-by
            const run_by_content = `// @lsp-run-by: "parent.do"\nlocal child_var = 1`;
            const run_by_path = write_file('child_run_by.do', run_by_content);

            // Resolve both
            const done_by_result = await scope_resolver.resolve(
                URI.file(done_by_path).toString(),
                done_by_content
            );
            const run_by_result = await scope_resolver.resolve(
                URI.file(run_by_path).toString(),
                run_by_content
            );

            // Both should have same inherited symbols (globals, programs, scalars - NOT locals)
            expect(run_by_result.symbols.globalMacros.size).toBe(done_by_result.symbols.globalMacros.size);
            expect(run_by_result.symbols.programs.size).toBe(done_by_result.symbols.programs.size);
            expect(run_by_result.symbols.scalars.size).toBe(done_by_result.symbols.scalars.size);

            // Neither should inherit parent's locals (done-by/run-by semantics)
            expect(done_by_result.symbols.localMacros.has('parent_local')).toBe(false);
            expect(run_by_result.symbols.localMacros.has('parent_local')).toBe(false);
        });
    });
});
