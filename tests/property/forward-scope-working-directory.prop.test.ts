/**
 * Feature: forward-scope-working-directory-fix, Property 1: Working Directory Inheritance for Forward Calls
 * Validates: Requirements 1.1, 1.3, 2.2
 *
 * Property 1: Working Directory Inheritance for Forward Calls
 * *For any* directive chain where a deeper ancestor has a working directory, when resolving
 * forward calls in an intermediate parent file, the forward call paths SHALL be resolved
 * relative to the effective working directory from the directive chain, not relative to
 * the parent file's directory.
 *
 * This test validates that the two-phase working directory discovery correctly propagates
 * working directories from deeper ancestors to intermediate parent files for forward call
 * path resolution.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';

describe('Property 1: Working Directory Inheritance for Forward Calls', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-inherit-forward-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file to the temp directory.
     */
    const write_file = (relative_path: string, content: string): string => {
        const full_path = path.join(temp_dir, relative_path);
        const dir = path.dirname(full_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(full_path, content);
        return full_path;
    };

    // Generator for simple directory names (alphanumeric, lowercase, safe for filesystem)
    const dir_name_gen = fc.string({ minLength: 2, maxLength: 8 })
        .filter(s => /^[a-z][a-z0-9]*$/.test(s));

    // Generator for simple file names (alphanumeric with underscores)
    const file_name_gen = fc.string({ minLength: 2, maxLength: 12 })
        .filter(s => /^[a-z][a-z0-9_]*$/.test(s));

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

    /**
     * Test 1.1: Forward calls in parent files resolve relative to inherited working directory
     *
     * For any directive chain A → B → C where:
     * - C has a working directory W
     * - B has a forward call to path P
     * - A inherits from B
     *
     * Then:
     * - The forward call P in B should be resolved relative to W
     * - NOT relative to B's directory
     *
     * **Validates: Requirements 1.1, 1.3, 2.2**
     */
    test('forward calls in parent files resolve relative to inherited working directory', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                backward_directive_gen,
                forward_call_directive_gen,
                async (
                    forward_call_subpath,
                    target_file_name,
                    wd_synonym,
                    child_backward_type,
                    parent_backward_type,
                    forward_type
                ) => {
                    // Create directory structure:
                    // temp_dir/
                    //   data/                       <- Working directory (W)
                    //     forward_call_subpath/
                    //       target.do               <- Target file (defines global)
                    //   scripts/
                    //     child.do                  <- A: inherits from parent.do
                    //     parent.do                 <- B: has forward call to P, inherits from ancestor.do
                    //     ancestor.do               <- C: has working directory pointing to ../data

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const data_dir = path.join(temp_dir, 'data');
                    const target_subdir = path.join(data_dir, forward_call_subpath);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_subdir, { recursive: true });

                    // Create target file in data/forward_call_subpath/
                    const target_content = `global inherited_wd_target = "found_via_inherited_wd"`;
                    write_file(`data/${forward_call_subpath}/${target_file_name}.do`, target_content);

                    // Create ancestor.do (C) with working directory pointing to ../data
                    const ancestor_content = `// @lsp-${wd_synonym}: "../data"\nlocal ancestor_var = 1`;
                    write_file('scripts/ancestor.do', ancestor_content);

                    // Create parent.do (B) with backward directive to ancestor and forward call command
                    // The forward call path is relative to the working directory (../data)
                    const forward_call_path = `${forward_call_subpath}/${target_file_name}.do`;
                    const parent_content = `// @lsp-${parent_backward_type}: "ancestor.do"\n${forward_type} "${forward_call_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do (A) with backward directive to parent
                    const child_content = `// @lsp-${child_backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should inherit working directory from ancestor (through parent)
                    expect(result.inherited_working_directory).toBeDefined();
                    expect(result.inherited_working_directory).toContain('data');

                    // The forward call in parent should have resolved relative to the inherited
                    // working directory (data), NOT relative to parent's directory
                    // This means the target file should have been found and its global should be visible
                    const has_target_global = result.symbols.globalMacros.has('inherited_wd_target');
                    expect(has_target_global).toBe(true);

                    // Verify no "Cannot read file" diagnostic for the target
                    const cannot_read_diagnostics = result.diagnostics.filter(
                        d => d.message.includes('Cannot read file') &&
                             d.message.includes(forward_call_path)
                    );
                    expect(cannot_read_diagnostics.length).toBe(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 1.2: Forward calls fail when resolved relative to parent's directory (negative test)
     *
     * This test verifies that if the target file only exists in the working directory
     * (not in the parent's directory), the forward call would fail if resolved relative
     * to the parent's directory. This confirms the fix is necessary.
     *
     * **Validates: Requirements 1.1, 1.3, 2.2**
     */
    test('forward calls would fail if resolved relative to parent directory instead of working directory', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                backward_directive_gen,
                async (
                    forward_call_subpath,
                    target_file_name,
                    wd_synonym,
                    child_backward_type,
                    parent_backward_type
                ) => {
                    // Create directory structure where target ONLY exists in working directory:
                    // temp_dir/
                    //   data/                       <- Working directory (W)
                    //     forward_call_subpath/
                    //       target.do               <- Target file EXISTS HERE
                    //   scripts/
                    //     forward_call_subpath/     <- This directory does NOT exist
                    //     child.do
                    //     parent.do
                    //     ancestor.do

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const data_dir = path.join(temp_dir, 'data');
                    const target_subdir = path.join(data_dir, forward_call_subpath);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_subdir, { recursive: true });

                    // Create target file ONLY in data/forward_call_subpath/
                    const target_content = `global wd_only_target = "only_in_working_dir"`;
                    write_file(`data/${forward_call_subpath}/${target_file_name}.do`, target_content);

                    // Create ancestor.do with working directory pointing to ../data
                    const ancestor_content = `// @lsp-${wd_synonym}: "../data"\nlocal ancestor_var = 1`;
                    write_file('scripts/ancestor.do', ancestor_content);

                    // Create parent.do with backward directive and forward call command
                    const forward_call_path = `${forward_call_subpath}/${target_file_name}.do`;
                    const parent_content = `// @lsp-${parent_backward_type}: "ancestor.do"\ndo "${forward_call_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do
                    const child_content = `// @lsp-${child_backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // The forward call should have resolved successfully using the inherited
                    // working directory. If it had been resolved relative to parent's directory,
                    // it would have failed because scripts/forward_call_subpath/ doesn't exist.
                    const has_target_global = result.symbols.globalMacros.has('wd_only_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 1.3: Multi-level directive chains propagate working directory correctly
     *
     * For any directive chain with 3+ levels where the deepest ancestor has a working
     * directory, forward calls in any intermediate file should resolve relative to
     * that working directory.
     *
     * **Validates: Requirements 1.1, 1.3, 2.2**
     */
    test('multi-level directive chains propagate working directory to all intermediate files', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                backward_directive_gen,
                backward_directive_gen,
                async (
                    forward_call_subpath,
                    target_file_name,
                    wd_synonym,
                    leaf_backward_type,
                    middle_backward_type,
                    parent_backward_type
                ) => {
                    // Create directory structure with 4 levels:
                    // temp_dir/
                    //   data/                       <- Working directory (W)
                    //     forward_call_subpath/
                    //       target.do               <- Target file
                    //   scripts/
                    //     leaf.do                   <- Level 0: inherits from middle.do
                    //     middle.do                 <- Level 1: has forward call, inherits from parent.do
                    //     parent.do                 <- Level 2: inherits from root.do
                    //     root.do                   <- Level 3: has working directory

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const data_dir = path.join(temp_dir, 'data');
                    const target_subdir = path.join(data_dir, forward_call_subpath);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_subdir, { recursive: true });

                    // Create target file
                    const target_content = `global multilevel_target = "found_through_chain"`;
                    write_file(`data/${forward_call_subpath}/${target_file_name}.do`, target_content);

                    // Create root.do (Level 3) with working directory pointing to ../data
                    const root_content = `// @lsp-${wd_synonym}: "../data"\nlocal root_var = 1`;
                    write_file('scripts/root.do', root_content);

                    // Create parent.do (Level 2) with backward directive to root
                    const parent_content = `// @lsp-${parent_backward_type}: "root.do"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create middle.do (Level 1) with backward directive and forward call command
                    const forward_call_path = `${forward_call_subpath}/${target_file_name}.do`;
                    const middle_content = `// @lsp-${middle_backward_type}: "parent.do"\ndo "${forward_call_path}"\nlocal middle_var = 3`;
                    write_file('scripts/middle.do', middle_content);

                    // Create leaf.do (Level 0) with backward directive
                    const leaf_content = `// @lsp-${leaf_backward_type}: "middle.do"\nlocal leaf_var = 4`;
                    const leaf_path = write_file('scripts/leaf.do', leaf_content);

                    // Resolve scope for leaf
                    const leaf_uri = URI.file(leaf_path).toString();
                    const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                    // Leaf should inherit working directory from root (through parent and middle)
                    expect(result.inherited_working_directory).toBeDefined();
                    expect(result.inherited_working_directory).toContain('data');

                    // The forward call in middle should have resolved using the inherited
                    // working directory from root
                    const has_target_global = result.symbols.globalMacros.has('multilevel_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 1.4: Working directory from deeper ancestor used when intermediate has none
     *
     * When an intermediate file in the chain does NOT have its own working directory,
     * forward calls in that file should use the working directory from deeper ancestors.
     *
     * **Validates: Requirements 1.1, 1.3, 2.2**
     */
    test('working directory from deeper ancestor used when intermediate has none', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                backward_directive_gen,
                async (
                    forward_call_subpath,
                    target_file_name,
                    wd_synonym,
                    child_backward_type,
                    parent_backward_type
                ) => {
                    // Create directory structure:
                    // temp_dir/
                    //   data/                       <- Working directory from ancestor
                    //     forward_call_subpath/
                    //       target.do
                    //   scripts/
                    //     child.do                  <- Inherits from parent.do
                    //     parent.do                 <- Has forward call, NO own working dir, inherits from ancestor
                    //     ancestor.do               <- Has working directory

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const data_dir = path.join(temp_dir, 'data');
                    const target_subdir = path.join(data_dir, forward_call_subpath);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_subdir, { recursive: true });

                    // Create target file
                    const target_content = `global deeper_ancestor_target = "from_deeper_ancestor_wd"`;
                    write_file(`data/${forward_call_subpath}/${target_file_name}.do`, target_content);

                    // Create ancestor.do with working directory pointing to ../data
                    const ancestor_content = `// @lsp-${wd_synonym}: "../data"\nlocal ancestor_var = 1`;
                    write_file('scripts/ancestor.do', ancestor_content);

                    // Create parent.do WITHOUT its own working directory, but with forward call command
                    const forward_call_path = `${forward_call_subpath}/${target_file_name}.do`;
                    const parent_content = `// @lsp-${parent_backward_type}: "ancestor.do"\ndo "${forward_call_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do
                    const child_content = `// @lsp-${child_backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should inherit working directory from ancestor
                    expect(result.inherited_working_directory).toBeDefined();
                    expect(result.inherited_working_directory).toContain('data');

                    // The forward call in parent should have used ancestor's working directory
                    const has_target_global = result.symbols.globalMacros.has('deeper_ancestor_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 1.5: Forward call commands (not just directives) use inherited working directory
     *
     * This test verifies that actual do/run/include commands in parent files
     * (not just @lsp-do directives) also resolve relative to the inherited working directory.
     *
     * **Validates: Requirements 1.1, 1.3, 2.2**
     */
    test('forward call commands in parent files use inherited working directory', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                backward_directive_gen,
                forward_call_directive_gen,
                async (
                    forward_call_subpath,
                    target_file_name,
                    wd_synonym,
                    child_backward_type,
                    parent_backward_type,
                    forward_type
                ) => {
                    // Create directory structure:
                    // temp_dir/
                    //   data/
                    //     forward_call_subpath/
                    //       target.do
                    //   scripts/
                    //     child.do
                    //     parent.do                 <- Has actual do/run/include command
                    //     ancestor.do               <- Has working directory

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const data_dir = path.join(temp_dir, 'data');
                    const target_subdir = path.join(data_dir, forward_call_subpath);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_subdir, { recursive: true });

                    // Create target file
                    const target_content = `global command_inherited_target = "from_command_with_inherited_wd"`;
                    write_file(`data/${forward_call_subpath}/${target_file_name}.do`, target_content);

                    // Create ancestor.do with working directory pointing to ../data
                    const ancestor_content = `// @lsp-${wd_synonym}: "../data"\nlocal ancestor_var = 1`;
                    write_file('scripts/ancestor.do', ancestor_content);

                    // Create parent.do with actual forward call command (not directive)
                    const forward_call_path = `${forward_call_subpath}/${target_file_name}.do`;
                    const parent_content = `// @lsp-${parent_backward_type}: "ancestor.do"\n${forward_type} "${forward_call_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do
                    const child_content = `// @lsp-${child_backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should inherit working directory from ancestor
                    expect(result.inherited_working_directory).toBeDefined();
                    expect(result.inherited_working_directory).toContain('data');

                    // The forward call command in parent should have used inherited working directory
                    const has_target_global = result.symbols.globalMacros.has('command_inherited_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });
});
