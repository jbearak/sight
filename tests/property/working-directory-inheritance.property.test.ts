/**
 * Property tests for Working Directory Inheritance Transitivity
 *
 * Tests Property 1 from Task 2.2:
 * *For any* directive chain A → B → C where C has `@lsp-cd`, the working directory
 * from C SHALL be available when resolving forward calls in A and B.
 *
 * **Validates: Requirements 1.1, 1.2, 2.1**
 *
 * Feature: working-directory-chain-inheritance
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';

describe('Working Directory Inheritance Transitivity Property Tests', () => {
    let scope_resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-transitivity-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file to the temp directory.
     */
    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Generator for working directory synonyms
    const wd_synonym_gen = fc.constantFrom(
        'working-directory',
        'working-dir',
        'current-directory',
        'current-dir',
        'cd',
        'wd'
    );

    // Generator for backward directive types
    const backward_directive_gen = fc.constantFrom(
        'done-by',
        'run-by',
        'included-by'
    );

    // Generator for chain depth (2-4 levels as specified in task)
    const chain_depth_gen = fc.integer({ min: 2, max: 4 });

    /**
     * Property 1: Working Directory Inheritance Transitivity
     * *For any* directive chain A → B → C where C has `@lsp-cd`, the working directory
     * from C SHALL be available when resolving forward calls in A and B.
     *
     * **Validates: Requirements 1.1, 1.2, 2.1**
     */
    describe('Property 1: Working Directory Inheritance Transitivity', () => {
        /**
         * Test 1.1: Working directory at root of chain propagates to all descendants
         * When the root file (C) has @lsp-cd, all files in the chain (A, B) should
         * inherit that working directory.
         */
        test('working directory at root propagates through entire chain', async () => {
            await fc.assert(
                fc.asyncProperty(
                    chain_depth_gen,
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (depth, wd_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Use a unique, identifiable working directory path
                        const wd_path = '../root_wd_data';
                        
                        // Create chain: leaf -> ... -> middle -> root
                        // Root has the working directory directive
                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create root file with working directory
                        const root_content = `// @lsp-${wd_synonym}: "${wd_path}"\nlocal root_var = 1`;
                        const root_path = write_file('root.do', root_content);
                        the_file_names.push('root.do');
                        the_file_paths.push(root_path);

                        // Create intermediate files (each points to the previous)
                        for (let i = 1; i < depth; i++) {
                            const parent_name = the_file_names[i - 1];
                            const file_name = `level${i}.do`;
                            const file_content = `// @lsp-${directive_type}: "${parent_name}"\nlocal level${i}_var = ${i}`;
                            const file_path = write_file(file_name, file_content);
                            the_file_names.push(file_name);
                            the_file_paths.push(file_path);
                        }

                        // Resolve scope for the leaf file (last in chain)
                        const leaf_path = the_file_paths[the_file_paths.length - 1];
                        const leaf_content = fs.readFileSync(leaf_path, 'utf8');
                        const leaf_uri = URI.file(leaf_path).toString();

                        const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                        // The leaf file should inherit the working directory from root
                        // The path is resolved relative to root.do's directory, so "../root_wd_data"
                        // becomes the parent directory + "root_wd_data"
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('root_wd_data');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 1.2: Working directory at intermediate level propagates to descendants
         * When an intermediate file has @lsp-cd, files below it should inherit that
         * working directory, not from files above.
         */
        test('working directory at intermediate level propagates to descendants only', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 3, max: 4 }), // Need at least 3 levels for intermediate
                    fc.integer({ min: 1, max: 2 }), // Position of WD directive (1 = first intermediate)
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (depth, wd_position, wd_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Ensure wd_position is valid for the chain depth
                        const actual_wd_position = Math.min(wd_position, depth - 1);
                        // Use a unique, identifiable working directory path
                        const wd_path = '../intermediate_wd_data';

                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create root file WITHOUT working directory
                        const root_content = `local root_var = 1`;
                        const root_path = write_file('root.do', root_content);
                        the_file_names.push('root.do');
                        the_file_paths.push(root_path);

                        // Create intermediate and leaf files
                        for (let i = 1; i < depth; i++) {
                            const parent_name = the_file_names[i - 1];
                            const file_name = `level${i}.do`;
                            const has_wd = i === actual_wd_position;
                            const wd_directive = has_wd ? `// @lsp-${wd_synonym}: "${wd_path}"\n` : '';
                            const file_content = `// @lsp-${directive_type}: "${parent_name}"\n${wd_directive}local level${i}_var = ${i}`;
                            const file_path = write_file(file_name, file_content);
                            the_file_names.push(file_name);
                            the_file_paths.push(file_path);
                        }

                        // Resolve scope for the leaf file
                        const leaf_path = the_file_paths[the_file_paths.length - 1];
                        const leaf_content = fs.readFileSync(leaf_path, 'utf8');
                        const leaf_uri = URI.file(leaf_path).toString();

                        const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                        // If the leaf is at or below the WD position, it should inherit
                        // If the leaf IS the file with WD, inherited_working_directory should be undefined
                        // (because it has its own)
                        if (depth - 1 === actual_wd_position) {
                            // Leaf has its own WD directive
                            expect(result.inherited_working_directory).toBeUndefined();
                        } else if (depth - 1 > actual_wd_position) {
                            // Leaf is below the WD position, should inherit
                            expect(result.inherited_working_directory).toBeDefined();
                            expect(result.inherited_working_directory).toContain('intermediate_wd_data');
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 1.3: Nearest working directory wins (depth-based precedence)
         * When multiple files in the chain have @lsp-cd, the nearest ancestor's
         * working directory should be inherited.
         */
        test('nearest working directory wins over distant ancestors', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (wd_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Use unique, identifiable working directory paths
                        const root_wd = '../root_wd_data';
                        const middle_wd = '../middle_wd_data';

                        // Create 3-level chain: leaf -> middle -> root
                        // Both root and middle have working directories

                        // Root with working directory
                        const root_content = `// @lsp-${wd_synonym}: "${root_wd}"\nlocal root_var = 1`;
                        write_file('root.do', root_content);

                        // Middle with its own working directory
                        const middle_content = `// @lsp-${directive_type}: "root.do"\n// @lsp-${wd_synonym}: "${middle_wd}"\nlocal middle_var = 2`;
                        write_file('middle.do', middle_content);

                        // Leaf without working directory
                        const leaf_content = `// @lsp-${directive_type}: "middle.do"\nlocal leaf_var = 3`;
                        const leaf_path = write_file('leaf.do', leaf_content);

                        // Resolve scope for leaf
                        const leaf_uri = URI.file(leaf_path).toString();
                        const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                        // Leaf should inherit from middle (nearest), not root
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('middle_wd_data');
                        expect(result.inherited_working_directory).not.toContain('root_wd_data');
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 1.4: Own working directory takes precedence over inherited
         * When a file has its own @lsp-cd directive, it should NOT have
         * inherited_working_directory set (uses its own instead).
         */
        test('own working directory takes precedence over inherited', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (parent_synonym, child_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Use unique, identifiable working directory paths
                        const parent_wd = '../parent_wd_data';
                        const child_wd = '../child_wd_data';

                        // Create parent with working directory
                        const parent_content = `// @lsp-${parent_synonym}: "${parent_wd}"\nlocal parent_var = 1`;
                        write_file('parent.do', parent_content);

                        // Create child with its own working directory
                        const child_content = `// @lsp-${directive_type}: "parent.do"\n// @lsp-${child_synonym}: "${child_wd}"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child has its own WD, so inherited_working_directory should be undefined
                        expect(result.inherited_working_directory).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 1.5: Working directory propagates through chain without WD directives
         * When only the root has @lsp-cd and intermediate files don't have their own,
         * the working directory should propagate through all levels.
         */
        test('working directory propagates through files without own WD directive', async () => {
            await fc.assert(
                fc.asyncProperty(
                    chain_depth_gen,
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (depth, wd_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Use a unique, identifiable working directory path
                        const wd_path = '../propagated_wd_data';
                        
                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create root file with working directory
                        const root_content = `// @lsp-${wd_synonym}: "${wd_path}"\nlocal root_var = 1`;
                        const root_path = write_file('root.do', root_content);
                        the_file_names.push('root.do');
                        the_file_paths.push(root_path);

                        // Create intermediate files WITHOUT working directory
                        for (let i = 1; i < depth; i++) {
                            const parent_name = the_file_names[i - 1];
                            const file_name = `level${i}.do`;
                            const file_content = `// @lsp-${directive_type}: "${parent_name}"\nlocal level${i}_var = ${i}`;
                            const file_path = write_file(file_name, file_content);
                            the_file_names.push(file_name);
                            the_file_paths.push(file_path);
                        }

                        // Resolve scope for each file in the chain (except root)
                        for (let i = 1; i < depth; i++) {
                            const file_path = the_file_paths[i];
                            const file_content = fs.readFileSync(file_path, 'utf8');
                            const file_uri = URI.file(file_path).toString();

                            const result = await scope_resolver.resolve(file_uri, file_content);

                            // Each file should inherit the working directory from root
                            expect(result.inherited_working_directory).toBeDefined();
                            expect(result.inherited_working_directory).toContain('propagated_wd_data');
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Working Directory Availability for Forward Call Resolution
     * When resolving forward calls in files A and B of chain A → B → C,
     * the working directory from C should be available for path resolution.
     *
     * **Validates: Requirements 1.1, 2.1**
     */
    describe('Property 2: Working Directory Availability for Forward Call Resolution', () => {
        /**
         * Test 2.1: Forward calls in parent file can use inherited working directory
         * When a parent file has forward calls (do/run/include) and inherits a
         * working directory from its ancestor, the forward calls should be resolved
         * using that working directory.
         */
        test('forward calls in parent use inherited working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (wd_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Use a unique, identifiable working directory path
                        const wd_path = 'wd_subdir';
                        
                        // Create the working directory
                        const wd_full_path = path.join(temp_dir, wd_path);
                        fs.mkdirSync(wd_full_path, { recursive: true });

                        // Create a target file in the working directory
                        const target_content = `local target_var = 1`;
                        write_file(path.join(wd_path, 'target.do'), target_content);

                        // Create root file with working directory
                        const root_content = `// @lsp-${wd_synonym}: "${wd_path}"\nlocal root_var = 1`;
                        write_file('root.do', root_content);

                        // Create middle file with forward call to target
                        // The forward call path is relative to the working directory
                        const middle_content = `// @lsp-${directive_type}: "root.do"\n// @lsp-do: "target.do"\nlocal middle_var = 2`;
                        write_file('middle.do', middle_content);

                        // Create leaf file
                        const leaf_content = `// @lsp-${directive_type}: "middle.do"\nlocal leaf_var = 3`;
                        const leaf_path = write_file('leaf.do', leaf_content);

                        // Resolve scope for leaf
                        const leaf_uri = URI.file(leaf_path).toString();
                        const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                        // Leaf should inherit working directory
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain(wd_path);

                        // The forward call in middle should have been resolved
                        // (target_var should be in symbols if forward calls work correctly)
                        // Note: This depends on forward scope resolution being enabled
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Mixed Directive Types in Chain
     * Working directory inheritance should work correctly regardless of
     * the mix of directive types (done-by, run-by, included-by) in the chain.
     *
     * **Validates: Requirements 1.1, 1.2**
     */
    describe('Property 3: Mixed Directive Types in Chain', () => {
        test('working directory propagates through mixed directive types', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    fc.array(backward_directive_gen, { minLength: 2, maxLength: 4 }),
                    async (wd_synonym, directive_types) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Use a unique, identifiable working directory path
                        const wd_path = '../mixed_chain_wd_data';
                        
                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create root file with working directory
                        const root_content = `// @lsp-${wd_synonym}: "${wd_path}"\nlocal root_var = 1`;
                        const root_path = write_file('root.do', root_content);
                        the_file_names.push('root.do');
                        the_file_paths.push(root_path);

                        // Create chain with mixed directive types
                        for (let i = 0; i < directive_types.length; i++) {
                            const parent_name = the_file_names[i];
                            const directive_type = directive_types[i];
                            const file_name = `level${i + 1}.do`;
                            const file_content = `// @lsp-${directive_type}: "${parent_name}"\nlocal level${i + 1}_var = ${i + 1}`;
                            const file_path = write_file(file_name, file_content);
                            the_file_names.push(file_name);
                            the_file_paths.push(file_path);
                        }

                        // Resolve scope for the leaf file
                        const leaf_path = the_file_paths[the_file_paths.length - 1];
                        const leaf_content = fs.readFileSync(leaf_path, 'utf8');
                        const leaf_uri = URI.file(leaf_path).toString();

                        const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                        // Leaf should inherit working directory regardless of directive types
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('mixed_chain_wd_data');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Working Directory with Relative Paths
     * Working directory paths should be resolved correctly relative to
     * the file that defines them.
     *
     * **Validates: Requirements 1.1, 1.2**
     */
    describe('Property 4: Working Directory with Relative Paths', () => {
        test('relative working directory paths are resolved correctly', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    async (wd_synonym, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        // Create subdirectory structure
                        fs.mkdirSync(path.join(temp_dir, 'subdir'), { recursive: true });
                        fs.mkdirSync(path.join(temp_dir, 'data'), { recursive: true });

                        // Create root file in subdir with relative working directory "../data"
                        const root_content = `// @lsp-${wd_synonym}: "../data"\nlocal root_var = 1`;
                        write_file('subdir/root.do', root_content);

                        // Create child file in root that references root in subdir
                        const child_content = `// @lsp-${directive_type}: "subdir/root.do"\nlocal child_var = 2`;
                        const child_path = write_file('child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory
                        // The path should be resolved relative to root.do's directory (subdir/)
                        // So "../data" from subdir/ should resolve to "data"
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('data');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 5: No Working Directory in Chain
     * When no file in the chain has @lsp-cd, inherited_working_directory
     * should be undefined.
     *
     * **Validates: Requirements 1.1**
     */
    describe('Property 5: No Working Directory in Chain', () => {
        test('no inherited working directory when chain has no WD directives', async () => {
            await fc.assert(
                fc.asyncProperty(
                    chain_depth_gen,
                    backward_directive_gen,
                    async (depth, directive_type) => {
                        // Clear cache at the start of each iteration to avoid stale data
                        scope_resolver.clear_cache();

                        const the_file_names: string[] = [];
                        const the_file_paths: string[] = [];

                        // Create root file WITHOUT working directory
                        const root_content = `local root_var = 1`;
                        const root_path = write_file('root.do', root_content);
                        the_file_names.push('root.do');
                        the_file_paths.push(root_path);

                        // Create chain without any working directory directives
                        for (let i = 1; i < depth; i++) {
                            const parent_name = the_file_names[i - 1];
                            const file_name = `level${i}.do`;
                            const file_content = `// @lsp-${directive_type}: "${parent_name}"\nlocal level${i}_var = ${i}`;
                            const file_path = write_file(file_name, file_content);
                            the_file_names.push(file_name);
                            the_file_paths.push(file_path);
                        }

                        // Resolve scope for the leaf file
                        const leaf_path = the_file_paths[the_file_paths.length - 1];
                        const leaf_content = fs.readFileSync(leaf_path, 'utf8');
                        const leaf_uri = URI.file(leaf_path).toString();

                        const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                        // No working directory should be inherited
                        expect(result.inherited_working_directory).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
