/**
 * Feature: forward-scope-working-directory-fix, Property 2: Own Working Directory Precedence
 * Validates: Requirements 1.2
 *
 * Property 2: Own Working Directory Precedence
 * *For any* parent file that has its own @lsp-working-directory directive, when resolving
 * forward calls in that file, the file's own working directory SHALL take precedence over
 * any inherited working directory from deeper ancestors.
 *
 * This test validates that when a parent file has its own working directory directive,
 * forward calls in that file are resolved relative to its own working directory, not
 * any inherited working directory from deeper ancestors in the directive chain.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Property 2: Own Working Directory Precedence', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-wd-precedence-'));
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

    // Generator for simple directory names (safe for filesystem)
    const dir_name_gen = fc.stringMatching(/^[a-z][a-z0-9]{1,5}$/);

    /**
     * Test 2.1: Parent's own working directory takes precedence over inherited
     *
     * For any directive chain A → B → C where:
     * - C has working directory W1
     * - B has its own working directory W2
     * - B has a forward call to path P
     *
     * Then:
     * - The forward call P in B should be resolved relative to W2 (B's own)
     * - NOT relative to W1 (inherited from C)
     */
    test('should use own working directory over inherited for forward calls', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                wd_synonym_gen,
                wd_synonym_gen,
                backward_directive_gen,
                async (own_wd_name, inherited_wd_name, own_wd_synonym, inherited_wd_synonym, directive_type) => {
                    // Ensure the two directory names are different
                    let actual_own_wd = own_wd_name;
                    let actual_inherited_wd = inherited_wd_name;
                    if (actual_own_wd === actual_inherited_wd) {
                        actual_own_wd = actual_own_wd + 'own';
                    }

                    // Create structure:
                    // - ancestor.do has working directory pointing to inherited_wd_name
                    // - parent.do has its own working directory pointing to own_wd_name
                    // - parent.do has a forward call to "target.do"
                    // - child.do inherits from parent.do

                    // Create both working directories
                    fs.mkdirSync(path.join(temp_dir, actual_own_wd), { recursive: true });
                    fs.mkdirSync(path.join(temp_dir, actual_inherited_wd), { recursive: true });

                    // Create target file in BOTH directories with different content
                    // The one in own_wd_name should be found (not inherited_wd_name)
                    const own_target_content = `global own_target_marker = "found_in_own"`;
                    const inherited_target_content = `global inherited_target_marker = "found_in_inherited"`;
                    write_file(path.join(actual_own_wd, 'target.do'), own_target_content);
                    write_file(path.join(actual_inherited_wd, 'target.do'), inherited_target_content);

                    // Create ancestor.do with working directory pointing to inherited_wd_name
                    const ancestor_content = `// @lsp-${inherited_wd_synonym}: "${actual_inherited_wd}"\nglobal ancestor_var = 1`;
                    write_file('ancestor.do', ancestor_content);

                    // Create parent.do with:
                    // - backward directive to ancestor.do
                    // - its own working directory pointing to own_wd_name
                    // - forward call to target.do
                    const parent_content = `// @lsp-${directive_type}: "ancestor.do"
// @lsp-${own_wd_synonym}: "${actual_own_wd}"
do target.do
global parent_var = 2`;
                    write_file('parent.do', parent_content);

                    // Create child.do that inherits from parent.do
                    const child_content = `// @lsp-${directive_type}: "parent.do"\nglobal child_var = 3`;
                    const child_path = write_file('child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // The forward call in parent.do should have resolved to own_wd_name/target.do
                    // NOT inherited_wd_name/target.do
                    // This means own_target_marker should be in symbols, NOT inherited_target_marker
                    const has_own_marker = result.symbols.globalMacros.has('own_target_marker');
                    const has_inherited_marker = result.symbols.globalMacros.has('inherited_target_marker');

                    // Assert: forward call resolves to own_wd_name/target.do
                    expect(has_own_marker).toBe(true);
                    expect(has_inherited_marker).toBe(false);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Test 2.2: Parent without own WD uses inherited WD for forward calls
     *
     * For any directive chain A → B → C where:
     * - C has working directory W1
     * - B does NOT have its own working directory
     * - B has a forward call to path P
     *
     * Then:
     * - The forward call P in B should be resolved relative to W1 (inherited from C)
     */
    test('should use inherited working directory when parent has no own WD', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                async (inherited_wd_name, wd_synonym, directive_type) => {
                    // Create structure:
                    // - ancestor.do has working directory pointing to inherited_wd_name
                    // - parent.do does NOT have its own working directory
                    // - parent.do has a forward call to "target.do"
                    // - child.do inherits from parent.do

                    // Create the inherited working directory
                    fs.mkdirSync(path.join(temp_dir, inherited_wd_name), { recursive: true });

                    // Create target file ONLY in inherited_wd_name
                    const target_content = `global inherited_target_found = "yes"`;
                    write_file(path.join(inherited_wd_name, 'target.do'), target_content);

                    // Create ancestor.do with working directory
                    const ancestor_content = `// @lsp-${wd_synonym}: "${inherited_wd_name}"\nglobal ancestor_var = 1`;
                    write_file('ancestor.do', ancestor_content);

                    // Create parent.do WITHOUT its own working directory
                    // but with a forward call to target.do
                    const parent_content = `// @lsp-${directive_type}: "ancestor.do"
do target.do
global parent_var = 2`;
                    write_file('parent.do', parent_content);

                    // Create child.do that inherits from parent.do
                    const child_content = `// @lsp-${directive_type}: "parent.do"\nglobal child_var = 3`;
                    const child_path = write_file('child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // The forward call in parent.do should have resolved using inherited WD
                    // So inherited_target_found should be in symbols
                    const has_inherited_target = result.symbols.globalMacros.has('inherited_target_found');

                    // Assert: forward call resolves using inherited working directory
                    expect(has_inherited_target).toBe(true);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Test 2.3: Intermediate file's own WD overrides deeper ancestor's WD
     *
     * For any directive chain A → B → C → D where:
     * - D has working directory W1
     * - C has its own working directory W2
     * - B does NOT have its own working directory
     * - B has a forward call to path P
     *
     * Then:
     * - The forward call P in B should be resolved relative to W2 (from C)
     * - NOT relative to W1 (from D)
     */
    test('intermediate own WD overrides deeper ancestor WD for forward calls', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                wd_synonym_gen,
                wd_synonym_gen,
                backward_directive_gen,
                async (intermediate_wd_name, deep_wd_name, intermediate_wd_synonym, deep_wd_synonym, directive_type) => {
                    // Ensure the two directory names are different
                    let actual_intermediate_wd = intermediate_wd_name;
                    let actual_deep_wd = deep_wd_name;
                    if (actual_intermediate_wd === actual_deep_wd) {
                        actual_intermediate_wd = actual_intermediate_wd + 'int';
                    }

                    // Create structure:
                    // - deep_ancestor.do has working directory pointing to deep_wd_name
                    // - intermediate.do has its own working directory pointing to intermediate_wd_name
                    // - parent.do does NOT have its own working directory
                    // - parent.do has a forward call to "target.do"
                    // - child.do inherits from parent.do

                    // Create both working directories
                    fs.mkdirSync(path.join(temp_dir, actual_intermediate_wd), { recursive: true });
                    fs.mkdirSync(path.join(temp_dir, actual_deep_wd), { recursive: true });

                    // Create target file in BOTH directories with different content
                    const intermediate_target_content = `global intermediate_target_marker = "found_in_intermediate"`;
                    const deep_target_content = `global deep_target_marker = "found_in_deep"`;
                    write_file(path.join(actual_intermediate_wd, 'target.do'), intermediate_target_content);
                    write_file(path.join(actual_deep_wd, 'target.do'), deep_target_content);

                    // Create deep_ancestor.do with working directory
                    const deep_ancestor_content = `// @lsp-${deep_wd_synonym}: "${actual_deep_wd}"\nglobal deep_ancestor_var = 1`;
                    write_file('deep_ancestor.do', deep_ancestor_content);

                    // Create intermediate.do with its own working directory
                    const intermediate_content = `// @lsp-${directive_type}: "deep_ancestor.do"
// @lsp-${intermediate_wd_synonym}: "${actual_intermediate_wd}"
global intermediate_var = 2`;
                    write_file('intermediate.do', intermediate_content);

                    // Create parent.do WITHOUT its own working directory
                    // but with a forward call to target.do
                    const parent_content = `// @lsp-${directive_type}: "intermediate.do"
do target.do
global parent_var = 3`;
                    write_file('parent.do', parent_content);

                    // Create child.do that inherits from parent.do
                    const child_content = `// @lsp-${directive_type}: "parent.do"\nglobal child_var = 4`;
                    const child_path = write_file('child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // The forward call in parent.do should have resolved using intermediate's WD
                    // NOT deep_ancestor's WD
                    const has_intermediate_marker = result.symbols.globalMacros.has('intermediate_target_marker');
                    const has_deep_marker = result.symbols.globalMacros.has('deep_target_marker');

                    // Assert: forward call resolves to intermediate_wd_name/target.do
                    expect(has_intermediate_marker).toBe(true);
                    expect(has_deep_marker).toBe(false);
                }
            ),
            { numRuns: 20 }
        );
    });

    /**
     * Test 2.4: Multiple levels with own WD - nearest wins
     *
     * For any directive chain A → B → C → D where:
     * - D has working directory W1
     * - C has its own working directory W2
     * - B has its own working directory W3
     * - B has a forward call to path P
     *
     * Then:
     * - The forward call P in B should be resolved relative to W3 (B's own)
     * - NOT relative to W2 (from C) or W1 (from D)
     */
    test('own WD always takes precedence regardless of chain depth', async () => {
        await fc.assert(
            fc.asyncProperty(
                dir_name_gen,
                dir_name_gen,
                dir_name_gen,
                wd_synonym_gen,
                backward_directive_gen,
                async (own_wd_name, intermediate_wd_name, deep_wd_name, wd_synonym, directive_type) => {
                    // Ensure all directory names are different
                    let actual_own = own_wd_name;
                    let actual_int = intermediate_wd_name;
                    let actual_deep = deep_wd_name;
                    const the_names = new Set([actual_own, actual_int, actual_deep]);
                    if (the_names.size < 3) {
                        actual_own = 'own' + own_wd_name;
                        actual_int = 'int' + intermediate_wd_name;
                        actual_deep = 'deep' + deep_wd_name;
                    }

                    // Create all working directories
                    fs.mkdirSync(path.join(temp_dir, actual_own), { recursive: true });
                    fs.mkdirSync(path.join(temp_dir, actual_int), { recursive: true });
                    fs.mkdirSync(path.join(temp_dir, actual_deep), { recursive: true });

                    // Create target file in ALL directories with different content
                    write_file(path.join(actual_own, 'target.do'), `global own_marker = "own"`);
                    write_file(path.join(actual_int, 'target.do'), `global intermediate_marker = "intermediate"`);
                    write_file(path.join(actual_deep, 'target.do'), `global deep_marker = "deep"`);

                    // Create deep_ancestor.do with working directory
                    const deep_ancestor_content = `// @lsp-${wd_synonym}: "${actual_deep}"\nglobal deep_ancestor_var = 1`;
                    write_file('deep_ancestor.do', deep_ancestor_content);

                    // Create intermediate.do with its own working directory
                    const intermediate_content = `// @lsp-${directive_type}: "deep_ancestor.do"
// @lsp-${wd_synonym}: "${actual_int}"
global intermediate_var = 2`;
                    write_file('intermediate.do', intermediate_content);

                    // Create parent.do with its own working directory and forward call
                    const parent_content = `// @lsp-${directive_type}: "intermediate.do"
// @lsp-${wd_synonym}: "${actual_own}"
do target.do
global parent_var = 3`;
                    write_file('parent.do', parent_content);

                    // Create child.do that inherits from parent.do
                    const child_content = `// @lsp-${directive_type}: "parent.do"\nglobal child_var = 4`;
                    const child_path = write_file('child.do', child_content);

                    // Resolve scope for child
                    const child_uri = URI.file(child_path).toString();
                    const result = await scope_resolver.resolve(child_uri, child_content);

                    // The forward call in parent.do should have resolved using parent's own WD
                    const has_own_marker = result.symbols.globalMacros.has('own_marker');
                    const has_intermediate_marker = result.symbols.globalMacros.has('intermediate_marker');
                    const has_deep_marker = result.symbols.globalMacros.has('deep_marker');

                    // Assert: forward call resolves to own_wd_name/target.do
                    expect(has_own_marker).toBe(true);
                    expect(has_intermediate_marker).toBe(false);
                    expect(has_deep_marker).toBe(false);
                }
            ),
            { numRuns: 20 }
        );
    });
});
