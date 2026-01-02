/**
 * Property tests for Forward Call Path Resolution with Working Directory
 *
 * Tests Property 3 from Task 3.2:
 * *For any* forward call with a relative path and an inherited working directory,
 * the path SHALL resolve relative to the working directory, not the script's
 * containing directory.
 *
 * **Validates: Requirements 2.2, 2.3, 5.1, 5.2**
 *
 * Feature: working-directory-chain-inheritance
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';

describe('Forward Call Path Resolution with Working Directory Property Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-call-wd-test-'));
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
        'included-by'
    );

    // Generator for forward call directive types
    const forward_call_directive_gen = fc.constantFrom(
        'do',
        'run',
        'include'
    );

    // Generator for simple subdirectory names (alphanumeric, no special chars)
    const subdir_name_gen = fc.string({ minLength: 2, maxLength: 8 })
        .filter(s => /^[a-z0-9]+$/.test(s));

    // Generator for simple file names (alphanumeric with underscores)
    const file_name_gen = fc.string({ minLength: 2, maxLength: 12 })
        .filter(s => /^[a-z0-9_]+$/.test(s));

    /**
     * Property 3: Forward Call Path Resolution with Working Directory
     * *For any* forward call with a relative path and an inherited working directory,
     * the path SHALL resolve relative to the working directory, not the script's
     * containing directory.
     *
     * **Validates: Requirements 2.2, 2.3, 5.1, 5.2**
     */
    describe('Property 3: Forward Call Path Resolution with Working Directory', () => {
        /**
         * Test 3.1: Forward calls resolve relative to working directory when set
         * When a working directory is inherited, forward call paths should resolve
         * relative to that working directory, not the script's containing directory.
         *
         * **Validates: Requirements 2.2, 2.3, 5.1**
         */
        test('forward calls resolve relative to working directory when set', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    forward_call_directive_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (wd_synonym, backward_type, forward_type, subdir, target_file) => {
                        // Create directory structure:
                        // temp_dir/
                        //   scripts/
                        //     root.do (has @lsp-cd: "../data")
                        //     child.do (has @lsp-done-by: "root.do", do "subdir/target.do")
                        //   data/
                        //     subdir/
                        //       target.do (defines local target_var)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const data_dir = path.join(temp_dir, 'data');
                        const target_subdir = path.join(data_dir, subdir);
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(target_subdir, { recursive: true });

                        // Create target file in data/subdir/
                        const target_content = `local target_var = 42`;
                        write_file(`data/${subdir}/${target_file}.do`, target_content);

                        // Create root file with working directory pointing to ../data
                        const root_content = `// @lsp-${wd_synonym}: "../data"\nlocal root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create child file with backward directive and forward call
                        // The forward call path is relative to the working directory (../data)
                        const child_content = `// @lsp-${backward_type}: "root.do"\n// @lsp-${forward_type}: "${subdir}/${target_file}.do"\nlocal child_var = 2`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from root
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('data');

                        // The forward call should have resolved successfully
                        // (no "Cannot read file" diagnostic for the target)
                        const cannot_read_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file') && 
                                 d.message.includes(`${subdir}/${target_file}`)
                        );
                        expect(cannot_read_diagnostics.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 3.2: Forward calls resolve relative to script directory when no working directory
         * When no working directory is set, forward call paths should resolve
         * relative to the script's containing directory.
         *
         * **Validates: Requirements 2.2, 2.3**
         */
        test('forward calls resolve relative to script directory when no working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    backward_directive_gen,
                    forward_call_directive_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (backward_type, forward_type, subdir, target_file) => {
                        // Create directory structure:
                        // temp_dir/
                        //   scripts/
                        //     root.do (NO working directory)
                        //     child.do (has @lsp-done-by: "root.do", do "subdir/target.do")
                        //     subdir/
                        //       target.do (defines local target_var)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const target_subdir = path.join(scripts_dir, subdir);
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(target_subdir, { recursive: true });

                        // Create target file in scripts/subdir/ (relative to script)
                        const target_content = `local target_var = 42`;
                        write_file(`scripts/${subdir}/${target_file}.do`, target_content);

                        // Create root file WITHOUT working directory
                        const root_content = `local root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create child file with backward directive and forward call
                        // The forward call path should resolve relative to child.do's directory
                        const child_content = `// @lsp-${backward_type}: "root.do"\n// @lsp-${forward_type}: "${subdir}/${target_file}.do"\nlocal child_var = 2`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should NOT have inherited working directory
                        expect(result.inherited_working_directory).toBeUndefined();

                        // The forward call should have resolved successfully
                        // (no "Cannot read file" diagnostic for the target)
                        const cannot_read_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file') && 
                                 d.message.includes(`${subdir}/${target_file}`)
                        );
                        expect(cannot_read_diagnostics.length).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 3.3: Forward calls in parent file use inherited working directory
         * When resolving forward calls in a parent file during backward resolution,
         * the working directory context should be passed to the forward resolver.
         *
         * **Validates: Requirements 2.2, 5.1, 5.2**
         */
        test('forward calls in parent file use inherited working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    forward_call_directive_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (wd_synonym, backward_type, forward_type, subdir, target_file) => {
                        // Create directory structure:
                        // temp_dir/
                        //   scripts/
                        //     root.do (has @lsp-cd: "../data", do "subdir/target.do")
                        //     child.do (has @lsp-done-by: "root.do")
                        //   data/
                        //     subdir/
                        //       target.do (defines global target_global)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const data_dir = path.join(temp_dir, 'data');
                        const target_subdir = path.join(data_dir, subdir);
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(target_subdir, { recursive: true });

                        // Create target file in data/subdir/ with a global macro
                        const target_content = `global target_global = "found"`;
                        write_file(`data/${subdir}/${target_file}.do`, target_content);

                        // Create root file with working directory and forward call
                        // The forward call in root should resolve relative to ../data
                        const root_content = `// @lsp-${wd_synonym}: "../data"\ndo "${subdir}/${target_file}.do"\nlocal root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-${backward_type}: "root.do"\nlocal child_var = 2`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from root
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('data');

                        // The forward call in root should have resolved successfully
                        // Check that there's no "Cannot read file" diagnostic for the target
                        const cannot_read_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file') && 
                                 d.message.includes(`${subdir}/${target_file}`)
                        );
                        expect(cannot_read_diagnostics.length).toBe(0);

                        // If backward_type is 'done-by', globals should be inherited
                        // If backward_type is 'included-by', all symbols should be inherited
                        // In either case, the global from target should be visible
                        const has_target_global = result.symbols.globalMacros.has('target_global');
                        expect(has_target_global).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 3.4: Nested forward calls use propagated working directory
         * When forward calls are nested (A calls B, B calls C), the working
         * directory should propagate through the chain.
         *
         * **Validates: Requirements 2.2, 2.3, 5.1**
         */
        test('nested forward calls use propagated working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    subdir_name_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (wd_synonym, backward_type, subdir1, subdir2, target_file) => {
                        // Ensure subdirs are different
                        const actual_subdir2 = subdir1 === subdir2 ? subdir2 + '2' : subdir2;

                        // Create directory structure:
                        // temp_dir/
                        //   scripts/
                        //     root.do (has @lsp-cd: "../data", do "subdir1/middle.do")
                        //     child.do (has @lsp-done-by: "root.do")
                        //   data/
                        //     subdir1/
                        //       middle.do (do "subdir2/target.do" - relative to working dir)
                        //     subdir2/
                        //       target.do (defines global nested_global)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const data_dir = path.join(temp_dir, 'data');
                        const subdir1_path = path.join(data_dir, subdir1);
                        const subdir2_path = path.join(data_dir, actual_subdir2);
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(subdir1_path, { recursive: true });
                        fs.mkdirSync(subdir2_path, { recursive: true });

                        // Create target file in data/subdir2/
                        const target_content = `global nested_global = "deeply_nested"`;
                        write_file(`data/${actual_subdir2}/${target_file}.do`, target_content);

                        // Create middle file in data/subdir1/ that calls target
                        // Path is relative to working directory (data/)
                        const middle_content = `do "${actual_subdir2}/${target_file}.do"\nlocal middle_var = 1`;
                        write_file(`data/${subdir1}/middle.do`, middle_content);

                        // Create root file with working directory and forward call to middle
                        const root_content = `// @lsp-${wd_synonym}: "../data"\ndo "${subdir1}/middle.do"\nlocal root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-${backward_type}: "root.do"\nlocal child_var = 2`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from root
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('data');

                        // The nested forward call should have resolved successfully
                        // The global from the deeply nested target should be visible
                        const has_nested_global = result.symbols.globalMacros.has('nested_global');
                        expect(has_nested_global).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 3.5: Working directory from intermediate file overrides ancestor
         * When an intermediate file in the chain has its own @lsp-cd, forward calls
         * in that file should use its working directory, not the ancestor's.
         *
         * **Validates: Requirements 2.2, 2.3**
         */
        test('working directory from intermediate file overrides ancestor for forward calls', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    wd_synonym_gen,
                    backward_directive_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (root_wd_synonym, middle_wd_synonym, backward_type, subdir, target_file) => {
                        // Create directory structure:
                        // temp_dir/
                        //   scripts/
                        //     root.do (has @lsp-cd: "../root_data")
                        //     middle.do (has @lsp-done-by: "root.do", @lsp-cd: "../middle_data", do "subdir/target.do")
                        //     child.do (has @lsp-done-by: "middle.do")
                        //   root_data/
                        //     subdir/
                        //       wrong_target.do (should NOT be found)
                        //   middle_data/
                        //     subdir/
                        //       target.do (should be found)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const root_data_dir = path.join(temp_dir, 'root_data');
                        const middle_data_dir = path.join(temp_dir, 'middle_data');
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(path.join(root_data_dir, subdir), { recursive: true });
                        fs.mkdirSync(path.join(middle_data_dir, subdir), { recursive: true });

                        // Create wrong target in root_data (should NOT be found)
                        const wrong_target_content = `global wrong_target = "wrong"`;
                        write_file(`root_data/${subdir}/${target_file}.do`, wrong_target_content);

                        // Create correct target in middle_data (should be found)
                        const correct_target_content = `global correct_target = "correct"`;
                        write_file(`middle_data/${subdir}/${target_file}.do`, correct_target_content);

                        // Create root file with working directory
                        const root_content = `// @lsp-${root_wd_synonym}: "../root_data"\nlocal root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create middle file with its own working directory and forward call
                        const middle_content = `// @lsp-${backward_type}: "root.do"\n// @lsp-${middle_wd_synonym}: "../middle_data"\ndo "${subdir}/${target_file}.do"\nlocal middle_var = 2`;
                        write_file('scripts/middle.do', middle_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-${backward_type}: "middle.do"\nlocal child_var = 3`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from middle (nearest)
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('middle_data');

                        // The forward call in middle should have used middle's working directory
                        // So correct_target should be visible, not wrong_target
                        const has_correct_target = result.symbols.globalMacros.has('correct_target');
                        const has_wrong_target = result.symbols.globalMacros.has('wrong_target');
                        
                        expect(has_correct_target).toBe(true);
                        expect(has_wrong_target).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Test 3.6: Forward call commands in parent files resolve with working directory
         * Forward call commands (do, run, include) in parent files should
         * resolve paths relative to the working directory when set.
         *
         * Note: This test uses actual do/run/include commands (not @lsp-do directives)
         * because the analyzer receives the working directory context for command resolution.
         *
         * **Validates: Requirements 2.2, 2.3, 5.1**
         */
        test('forward call commands in parent files resolve with working directory', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    forward_call_directive_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (wd_synonym, backward_type, forward_type, subdir, target_file) => {
                        // Create directory structure:
                        // temp_dir/
                        //   scripts/
                        //     root.do (has @lsp-cd: "../data", do "subdir/target.do")
                        //     child.do (has @lsp-done-by: "root.do")
                        //   data/
                        //     subdir/
                        //       target.do (defines global command_target)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const data_dir = path.join(temp_dir, 'data');
                        const target_subdir = path.join(data_dir, subdir);
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(target_subdir, { recursive: true });

                        // Create target file in data/subdir/
                        const target_content = `global command_target = "from_command"`;
                        write_file(`data/${subdir}/${target_file}.do`, target_content);

                        // Create root file with working directory AND forward call command
                        // The forward call command in root should resolve relative to ../data
                        const root_content = `// @lsp-${wd_synonym}: "../data"\n${forward_type} "${subdir}/${target_file}.do"\nlocal root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create child file with backward directive only
                        const child_content = `// @lsp-${backward_type}: "root.do"\nlocal child_var = 2`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from root
                        expect(result.inherited_working_directory).toBeDefined();
                        expect(result.inherited_working_directory).toContain('data');

                        // The forward call command in root should have resolved successfully
                        // The global from target should be visible
                        const has_command_target = result.symbols.globalMacros.has('command_target');
                        expect(has_command_target).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Path Resolution Fallback Behavior
     * When a path cannot be found with the working directory, the system should
     * emit appropriate diagnostics.
     *
     * **Validates: Requirements 5.3**
     */
    describe('Property 4: Path Resolution Fallback Behavior', () => {
        /**
         * Test 4.1: Diagnostic emitted when forward call path not found in parent file
         * When a forward call path in a parent file cannot be resolved even with the
         * working directory, a diagnostic should be emitted.
         *
         * **Validates: Requirements 5.3**
         */
        test('diagnostic emitted when forward call path not found in parent file', async () => {
            await fc.assert(
                fc.asyncProperty(
                    wd_synonym_gen,
                    backward_directive_gen,
                    subdir_name_gen,
                    file_name_gen,
                    async (wd_synonym, backward_type, subdir, target_file) => {
                        // Create directory structure WITHOUT the target file:
                        // temp_dir/
                        //   scripts/
                        //     root.do (has @lsp-cd: "../data", do "subdir/nonexistent.do")
                        //     child.do (has @lsp-done-by: "root.do")
                        //   data/
                        //     (empty - no target file)

                        const scripts_dir = path.join(temp_dir, 'scripts');
                        const data_dir = path.join(temp_dir, 'data');
                        
                        fs.mkdirSync(scripts_dir, { recursive: true });
                        fs.mkdirSync(data_dir, { recursive: true });

                        // Create root file with working directory and forward call to nonexistent file
                        const nonexistent_path = `${subdir}/${target_file}.do`;
                        const root_content = `// @lsp-${wd_synonym}: "../data"\ndo "${nonexistent_path}"\nlocal root_var = 1`;
                        write_file('scripts/root.do', root_content);

                        // Create child file with backward directive
                        const child_content = `// @lsp-${backward_type}: "root.do"\nlocal child_var = 2`;
                        const child_path = write_file('scripts/child.do', child_content);

                        // Resolve scope for child
                        const child_uri = URI.file(child_path).toString();
                        const result = await scope_resolver.resolve(child_uri, child_content);

                        // Child should inherit working directory from root
                        expect(result.inherited_working_directory).toBeDefined();

                        // A "Cannot read file" diagnostic should be emitted for the nonexistent file
                        const cannot_read_diagnostics = result.diagnostics.filter(
                            d => d.message.includes('Cannot read file')
                        );
                        expect(cannot_read_diagnostics.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
