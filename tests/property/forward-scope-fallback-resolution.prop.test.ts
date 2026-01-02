/**
 * Feature: forward-scope-working-directory-fix, Property 3: Fallback to Script-Relative Resolution
 * Validates: Requirements 1.4
 *
 * Property 3: Fallback to Script-Relative Resolution
 * *For any* directive chain where no working directory is set at any level, when resolving
 * forward calls, the paths SHALL be resolved relative to the containing script's directory.
 *
 * This test validates that when NO working directory is set anywhere in the directive chain,
 * forward calls resolve relative to the script's own directory (script-relative resolution).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Property 3: Fallback to Script-Relative Resolution', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-relative-fallback-'));
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
     * Test 3.1: Forward calls resolve relative to script directory when no WD is set
     *
     * For any directive chain A → B → C where:
     * - NO file in the chain has a working directory directive
     * - B has a forward call to path P
     *
     * Then:
     * - The forward call P in B should be resolved relative to B's directory
     * - NOT relative to any other directory
     *
     * **Validates: Requirements 1.4**
     */
    test('forward calls resolve relative to script directory when no WD is set', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                backward_directive_gen,
                forward_call_directive_gen,
                async (
                    target_subdir,
                    target_file_name,
                    child_backward_type,
                    parent_backward_type,
                    forward_type
                ) => {
                    // Create directory structure:
                    // temp_dir/
                    //   scripts/
                    //     child.do                  <- A: inherits from parent.do
                    //     parent.do                 <- B: has forward call to target_subdir/target.do
                    //     target_subdir/
                    //       target.do               <- Target file (relative to parent.do's directory)
                    //     ancestor.do               <- C: NO working directory

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const target_dir = path.join(scripts_dir, target_subdir);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_dir, { recursive: true });

                    // Create target file in scripts/target_subdir/ (relative to parent.do)
                    const target_content = `global script_relative_target = "found_via_script_relative"`;
                    write_file(`scripts/${target_subdir}/${target_file_name}.do`, target_content);

                    // Create ancestor.do WITHOUT working directory
                    const ancestor_content = `local ancestor_var = 1`;
                    write_file('scripts/ancestor.do', ancestor_content);

                    // Create parent.do with backward directive to ancestor and forward call command
                    // The forward call path is relative to parent.do's directory
                    const forward_call_path = `${target_subdir}/${target_file_name}.do`;
                    const parent_content = `// @lsp-${parent_backward_type}: "ancestor.do"\n${forward_type} "${forward_call_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do with backward directive to parent
                    const child_content = `// @lsp-${child_backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should NOT have an inherited working directory (none set in chain)
                    expect(result.inherited_working_directory).toBeUndefined();

                    // The forward call in parent should have resolved relative to parent's directory
                    // This means the target file should have been found and its global should be visible
                    const has_target_global = result.symbols.globalMacros.has('script_relative_target');
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
     * Test 3.2: Forward calls fail when target only exists in non-script directory (negative test)
     *
     * This test verifies that if the target file only exists in a directory that is NOT
     * relative to the script's directory, the forward call will fail. This confirms that
     * script-relative resolution is being used.
     *
     * **Validates: Requirements 1.4**
     */
    test('forward calls fail when target only exists in non-script directory', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                backward_directive_gen,
                async (
                    target_subdir,
                    target_file_name,
                    child_backward_type,
                    parent_backward_type
                ) => {
                    // Create directory structure where target ONLY exists in a different location:
                    // temp_dir/
                    //   other_location/              <- Target file EXISTS HERE (not script-relative)
                    //     target_subdir/
                    //       target.do
                    //   scripts/
                    //     target_subdir/             <- This directory does NOT have the target
                    //     child.do
                    //     parent.do
                    //     ancestor.do

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const other_location = path.join(temp_dir, 'other_location');
                    const other_target_dir = path.join(other_location, target_subdir);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(other_target_dir, { recursive: true });

                    // Create target file ONLY in other_location (not script-relative)
                    const target_content = `global wrong_location_target = "should_not_be_found"`;
                    write_file(`other_location/${target_subdir}/${target_file_name}.do`, target_content);

                    // Create ancestor.do WITHOUT working directory
                    const ancestor_content = `local ancestor_var = 1`;
                    write_file('scripts/ancestor.do', ancestor_content);

                    // Create parent.do with backward directive and forward call command
                    const forward_call_path = `${target_subdir}/${target_file_name}.do`;
                    const parent_content = `// @lsp-${parent_backward_type}: "ancestor.do"\ndo "${forward_call_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do
                    const child_content = `// @lsp-${child_backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // The forward call should NOT have found the target (it's not script-relative)
                    const has_wrong_target = result.symbols.globalMacros.has('wrong_location_target');
                    expect(has_wrong_target).toBe(false);

                    // Should have a "Cannot read file" diagnostic
                    const cannot_read_diagnostics = result.diagnostics.filter(
                        d => d.message.includes('Cannot read file')
                    );
                    expect(cannot_read_diagnostics.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 3.3: Multi-level directive chains without WD use script-relative resolution
     *
     * For any directive chain with 3+ levels where NO file has a working directory,
     * forward calls in any file should resolve relative to that file's own directory.
     *
     * **Validates: Requirements 1.4**
     */
    test('multi-level directive chains without WD use script-relative resolution', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                backward_directive_gen,
                backward_directive_gen,
                async (
                    target_subdir,
                    target_file_name,
                    leaf_backward_type,
                    middle_backward_type,
                    parent_backward_type
                ) => {
                    // Create directory structure with 4 levels, NO working directories:
                    // temp_dir/
                    //   scripts/
                    //     leaf.do                   <- Level 0: inherits from middle.do
                    //     middle.do                 <- Level 1: has forward call, inherits from parent.do
                    //     target_subdir/
                    //       target.do               <- Target file (relative to middle.do's directory)
                    //     parent.do                 <- Level 2: inherits from root.do
                    //     root.do                   <- Level 3: NO working directory

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const target_dir = path.join(scripts_dir, target_subdir);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_dir, { recursive: true });

                    // Create target file
                    const target_content = `global multilevel_script_relative = "found_through_chain"`;
                    write_file(`scripts/${target_subdir}/${target_file_name}.do`, target_content);

                    // Create root.do (Level 3) WITHOUT working directory
                    const root_content = `local root_var = 1`;
                    write_file('scripts/root.do', root_content);

                    // Create parent.do (Level 2) with backward directive to root, NO working directory
                    const parent_content = `// @lsp-${parent_backward_type}: "root.do"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create middle.do (Level 1) with backward directive and forward call command
                    const forward_call_path = `${target_subdir}/${target_file_name}.do`;
                    const middle_content = `// @lsp-${middle_backward_type}: "parent.do"\ndo "${forward_call_path}"\nlocal middle_var = 3`;
                    write_file('scripts/middle.do', middle_content);

                    // Create leaf.do (Level 0) with backward directive
                    const leaf_content = `// @lsp-${leaf_backward_type}: "middle.do"\nlocal leaf_var = 4`;
                    const leaf_path = write_file('scripts/leaf.do', leaf_content);

                    // Resolve scope for leaf
                    const leaf_uri = URI.file(leaf_path).toString();
                    const result = await scope_resolver.resolve(leaf_uri, leaf_content);

                    // Leaf should NOT have an inherited working directory
                    expect(result.inherited_working_directory).toBeUndefined();

                    // The forward call in middle should have resolved using script-relative resolution
                    const has_target_global = result.symbols.globalMacros.has('multilevel_script_relative');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 3.4: Forward calls in different directories resolve relative to their own script
     *
     * When files are in different directories and none have working directories,
     * each file's forward calls should resolve relative to its own directory.
     *
     * **Validates: Requirements 1.4**
     */
    test('forward calls in different directories resolve relative to their own script', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                async (
                    parent_dir_name,
                    target_subdir,
                    target_file_name,
                    backward_type
                ) => {
                    // Ensure directory names are different
                    let actual_parent_dir = parent_dir_name;
                    let actual_target_subdir = target_subdir;
                    if (actual_parent_dir === actual_target_subdir) {
                        actual_target_subdir = actual_target_subdir + 'sub';
                    }

                    // Create directory structure:
                    // temp_dir/
                    //   child.do                    <- Child in root, inherits from parent_dir/parent.do
                    //   parent_dir/
                    //     parent.do                 <- Parent in subdirectory, has forward call
                    //     target_subdir/
                    //       target.do               <- Target relative to parent.do's directory

                    const parent_dir = path.join(temp_dir, actual_parent_dir);
                    const target_dir = path.join(parent_dir, actual_target_subdir);
                    
                    fs.mkdirSync(parent_dir, { recursive: true });
                    fs.mkdirSync(target_dir, { recursive: true });

                    // Create target file in parent_dir/target_subdir/ (relative to parent.do)
                    const target_content = `global different_dir_target = "found_in_parent_subdir"`;
                    write_file(`${actual_parent_dir}/${actual_target_subdir}/${target_file_name}.do`, target_content);

                    // Create parent.do in parent_dir with forward call
                    const forward_call_path = `${actual_target_subdir}/${target_file_name}.do`;
                    const parent_content = `do "${forward_call_path}"\nlocal parent_var = 1`;
                    write_file(`${actual_parent_dir}/parent.do`, parent_content);

                    // Create child.do in root with backward directive to parent
                    const child_content = `// @lsp-${backward_type}: "${actual_parent_dir}/parent.do"\nlocal child_var = 2`;
                    const child_path = write_file('child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should NOT have an inherited working directory
                    expect(result.inherited_working_directory).toBeUndefined();

                    // The forward call in parent should have resolved relative to parent's directory
                    const has_target_global = result.symbols.globalMacros.has('different_dir_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 3.5: Script-relative resolution works with all forward call types
     *
     * Verifies that do, run, and include commands all use script-relative resolution
     * when no working directory is set.
     *
     * **Validates: Requirements 1.4**
     */
    test('script-relative resolution works with all forward call types', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                forward_call_directive_gen,
                async (
                    target_subdir,
                    target_file_name,
                    backward_type,
                    forward_type
                ) => {
                    // Create directory structure:
                    // temp_dir/
                    //   scripts/
                    //     child.do                  <- Inherits from parent.do
                    //     parent.do                 <- Has forward call (do/run/include)
                    //     target_subdir/
                    //       target.do               <- Target file

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const target_dir = path.join(scripts_dir, target_subdir);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_dir, { recursive: true });

                    // Create target file
                    const target_content = `global all_types_target = "found_with_${forward_type}"`;
                    write_file(`scripts/${target_subdir}/${target_file_name}.do`, target_content);

                    // Create parent.do with forward call command (varies by forward_type)
                    const forward_call_path = `${target_subdir}/${target_file_name}.do`;
                    const parent_content = `${forward_type} "${forward_call_path}"\nlocal parent_var = 1`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do with backward directive
                    const child_content = `// @lsp-${backward_type}: "parent.do"\nlocal child_var = 2`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should NOT have an inherited working directory
                    expect(result.inherited_working_directory).toBeUndefined();

                    // The forward call should have resolved using script-relative resolution
                    const has_target_global = result.symbols.globalMacros.has('all_types_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 3.6: Nested forward calls without WD each resolve relative to their own script
     *
     * When a forward call leads to another file that also has forward calls,
     * and no working directory is set, each file's forward calls should resolve
     * relative to that file's own directory.
     *
     * **Validates: Requirements 1.4**
     */
    test('nested forward calls without WD each resolve relative to their own script', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                async (
                    first_subdir,
                    second_subdir,
                    target_file_name,
                    backward_type
                ) => {
                    // Ensure directory names are different
                    let actual_first_subdir = first_subdir;
                    let actual_second_subdir = second_subdir;
                    if (actual_first_subdir === actual_second_subdir) {
                        actual_second_subdir = actual_second_subdir + 'nested';
                    }

                    // Create directory structure:
                    // temp_dir/
                    //   scripts/
                    //     child.do                  <- Inherits from parent.do
                    //     parent.do                 <- Has forward call to first_subdir/intermediate.do
                    //     first_subdir/
                    //       intermediate.do         <- Has forward call to second_subdir/target.do
                    //       second_subdir/
                    //         target.do             <- Final target (relative to intermediate.do)

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const first_dir = path.join(scripts_dir, actual_first_subdir);
                    const second_dir = path.join(first_dir, actual_second_subdir);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(first_dir, { recursive: true });
                    fs.mkdirSync(second_dir, { recursive: true });

                    // Create final target file
                    const target_content = `global nested_forward_target = "found_through_nested_calls"`;
                    write_file(`scripts/${actual_first_subdir}/${actual_second_subdir}/${target_file_name}.do`, target_content);

                    // Create intermediate.do with forward call to target (relative to intermediate.do)
                    const intermediate_forward_path = `${actual_second_subdir}/${target_file_name}.do`;
                    const intermediate_content = `do "${intermediate_forward_path}"\nlocal intermediate_var = 1`;
                    write_file(`scripts/${actual_first_subdir}/intermediate.do`, intermediate_content);

                    // Create parent.do with forward call to intermediate (relative to parent.do)
                    const parent_forward_path = `${actual_first_subdir}/intermediate.do`;
                    const parent_content = `do "${parent_forward_path}"\nlocal parent_var = 2`;
                    write_file('scripts/parent.do', parent_content);

                    // Create child.do with backward directive
                    const child_content = `// @lsp-${backward_type}: "parent.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should NOT have an inherited working directory
                    expect(result.inherited_working_directory).toBeUndefined();

                    // The nested forward calls should have resolved using script-relative resolution
                    // Each file's forward call resolves relative to its own directory
                    const has_target_global = result.symbols.globalMacros.has('nested_forward_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Test 3.7: Script-relative resolution is used when only backward directives exist
     *
     * When a file has backward directives but no working directory is set anywhere,
     * forward calls should still resolve relative to the script's directory.
     *
     * **Validates: Requirements 1.4**
     */
    test('script-relative resolution is used when only backward directives exist', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                file_name_gen,
                backward_directive_gen,
                backward_directive_gen,
                async (
                    target_subdir,
                    target_file_name,
                    first_backward_type,
                    second_backward_type
                ) => {
                    // Create directory structure with multiple backward directives, no WD:
                    // temp_dir/
                    //   scripts/
                    //     child.do                  <- Has two backward directives
                    //     parent1.do                <- First parent, has forward call
                    //     parent2.do                <- Second parent, no forward call
                    //     target_subdir/
                    //       target.do               <- Target file

                    const scripts_dir = path.join(temp_dir, 'scripts');
                    const target_dir = path.join(scripts_dir, target_subdir);
                    
                    fs.mkdirSync(scripts_dir, { recursive: true });
                    fs.mkdirSync(target_dir, { recursive: true });

                    // Create target file
                    const target_content = `global backward_only_target = "found_with_backward_directives"`;
                    write_file(`scripts/${target_subdir}/${target_file_name}.do`, target_content);

                    // Create parent1.do with forward call
                    const forward_call_path = `${target_subdir}/${target_file_name}.do`;
                    const parent1_content = `do "${forward_call_path}"\nlocal parent1_var = 1`;
                    write_file('scripts/parent1.do', parent1_content);

                    // Create parent2.do without forward call
                    const parent2_content = `local parent2_var = 2`;
                    write_file('scripts/parent2.do', parent2_content);

                    // Create child.do with two backward directives
                    const child_content = `// @lsp-${first_backward_type}: "parent1.do"\n// @lsp-${second_backward_type}: "parent2.do"\nlocal child_var = 3`;
                    const child_path = write_file('scripts/child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // Child should NOT have an inherited working directory
                    expect(result.inherited_working_directory).toBeUndefined();

                    // The forward call in parent1 should have resolved using script-relative resolution
                    const has_target_global = result.symbols.globalMacros.has('backward_only_target');
                    expect(has_target_global).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });
});
