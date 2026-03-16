/**
 * Integration tests for Working Directory Inheritance via Backward Directives
 *
 * Tests the real-world scenario where:
 * - loop.do has @lsp-cd: "../" to set working directory
 * - survey.do has @lsp-done-by: "loop.do" to inherit symbols
 * - survey.do should also inherit the working directory from loop.do
 *
 * Feature: working-directory-inheritance
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

/**
 * Helper to normalize paths and remove trailing slashes for comparison.
 */
function normalize_path(p: string): string {
    const normalized = path.normalize(p);
    // Remove trailing slash if present (except for root paths like '/')
    if (normalized.length > 1 && normalized.endsWith(path.sep)) {
        return normalized.slice(0, -1);
    }
    return normalized;
}

describe('Working Directory Inheritance Integration Tests', () => {
    let test_dir: string;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-inheritance-integration-'));
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, { max_forward_depth: 10 });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        document_store = new DocumentStore();
        document_store.set_workspace_roots([test_dir]);
        document_store.set_scope_resolver(scope_resolver);
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

    describe('Real-World Scenario: loop.do with @lsp-cd, survey.do with @lsp-done-by', () => {
        it('should inherit working directory from loop.do to survey.do', async () => {
            // Create directory structure:
            // test_dir/
            //   data/
            //     load_data.do
            //   scripts/
            //     loop.do (has @lsp-cd: "../")
            //     dhs/
            //       survey.do (has @lsp-done-by: "../loop.do")

            // Create data/load_data.do
            write_file('data/load_data.do', `
* Load data file
use "mydata.dta", clear
`);

            // Create scripts/loop.do with @lsp-cd: "../"
            // This sets working directory to test_dir (parent of scripts/)
            const loop_content = `// @lsp-cd: "../"
* Loop through surveys
global survey_list "dhs mics"
foreach survey of global survey_list {
    do "scripts/dhs/survey.do"
}
`;
            write_file('scripts/loop.do', loop_content);

            // Create scripts/dhs/survey.do with @lsp-done-by: "../loop.do"
            // This should inherit working directory from loop.do
            const survey_content = `// @lsp-done-by: "../loop.do"
* Survey processing
local result \`survey_list'
do "data/load_data.do"
`;
            const survey_path = write_file('scripts/dhs/survey.do', survey_content);
            const survey_uri = URI.file(survey_path).toString();

            // Open survey.do in DocumentStore
            await document_store.open(survey_uri, survey_content, 1);
            const document_state = document_store.get(survey_uri);

            expect(document_state).toBeDefined();

            // survey.do should inherit working directory from loop.do
            // loop.do's @lsp-cd: "../" resolves to test_dir (parent of scripts/)
            expect(document_state!.working_directory).toBeDefined();
            
            // The inherited working directory should be test_dir
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(test_dir);
            expect(normalized_wd).toBe(expected_wd);
        });

        it('should resolve forward calls using inherited working directory', async () => {
            // Create directory structure similar to above
            write_file('data/load_data.do', `* Load data`);

            const loop_content = `// @lsp-cd: "../"
global survey_list "dhs"
`;
            write_file('scripts/loop.do', loop_content);

            const survey_content = `// @lsp-done-by: "../loop.do"
* Survey processing
do "data/load_data.do"
`;
            const survey_path = write_file('scripts/dhs/survey.do', survey_content);
            const survey_uri = URI.file(survey_path).toString();

            await document_store.open(survey_uri, survey_content, 1);
            const document_state = document_store.get(survey_uri);

            expect(document_state).toBeDefined();
            expect(document_state!.forward_calls.length).toBeGreaterThan(0);

            // Find the forward call to data/load_data.do
            const load_data_call = document_state!.forward_calls.find(
                fc => fc.raw_path === 'data/load_data.do'
            );

            expect(load_data_call).toBeDefined();

            // The resolved path should be relative to test_dir (inherited working directory)
            // not relative to scripts/dhs/ (survey.do's location)
            const expected_path = path.join(test_dir, 'data', 'load_data.do');
            expect(load_data_call!.path).toBe(expected_path);
        });

        it('should use child own working directory when present', async () => {
            // Create directory structure
            write_file('data/load_data.do', `* Load data`);

            const loop_content = `// @lsp-cd: "../"
global survey_list "dhs"
`;
            write_file('scripts/loop.do', loop_content);

            // survey.do has BOTH @lsp-done-by AND its own @lsp-cd
            const survey_content = `// @lsp-done-by: "../loop.do"
// @lsp-cd: "../../data"
* Survey processing
do "load_data.do"
`;
            const survey_path = write_file('scripts/dhs/survey.do', survey_content);
            const survey_uri = URI.file(survey_path).toString();

            await document_store.open(survey_uri, survey_content, 1);
            const document_state = document_store.get(survey_uri);

            expect(document_state).toBeDefined();

            // survey.do has its own @lsp-cd, so it should NOT inherit from loop.do
            // Its own @lsp-cd: "../../data" resolves to test_dir/data
            expect(document_state!.working_directory).toBeDefined();
            
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(path.join(test_dir, 'data'));
            expect(normalized_wd).toBe(expected_wd);
        });
    });

    describe('@lsp-run-by Synonym', () => {
        it('should inherit working directory via @lsp-run-by', async () => {
            // Create parent with working directory
            const parent_content = `// @lsp-cd: "../"
global parent_var = 1
`;
            write_file('scripts/parent.do', parent_content);

            // Create child with @lsp-run-by (synonym for @lsp-done-by)
            const child_content = `// @lsp-run-by: "parent.do"
local result \`parent_var'
`;
            const child_path = write_file('scripts/child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            await document_store.open(child_uri, child_content, 1);
            const document_state = document_store.get(child_uri);

            expect(document_state).toBeDefined();

            // child.do should inherit working directory from parent.do
            expect(document_state!.working_directory).toBeDefined();
            
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(test_dir);
            expect(normalized_wd).toBe(expected_wd);
        });
    });

    describe('Chain Propagation', () => {
        it('should propagate working directory through multi-level chain', async () => {
            // Create chain: root.do -> middle.do -> leaf.do
            // Only root.do has @lsp-cd

            const root_content = `// @lsp-cd: "../"
global root_var = 1
`;
            write_file('scripts/root.do', root_content);

            const middle_content = `// @lsp-done-by: "root.do"
global middle_var = 2
`;
            write_file('scripts/middle.do', middle_content);

            const leaf_content = `// @lsp-done-by: "middle.do"
local result \`root_var' \`middle_var'
`;
            const leaf_path = write_file('scripts/leaf.do', leaf_content);
            const leaf_uri = URI.file(leaf_path).toString();

            await document_store.open(leaf_uri, leaf_content, 1);
            const document_state = document_store.get(leaf_uri);

            expect(document_state).toBeDefined();

            // leaf.do should inherit working directory from root.do (propagated through middle.do)
            expect(document_state!.working_directory).toBeDefined();
            
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(test_dir);
            expect(normalized_wd).toBe(expected_wd);
        });

        it('should stop propagation at intermediate file with own working directory', async () => {
            // Create chain: root.do -> middle.do -> leaf.do
            // Both root.do and middle.do have @lsp-cd

            const root_content = `// @lsp-cd: "../"
global root_var = 1
`;
            write_file('scripts/root.do', root_content);

            // middle.do has its own @lsp-cd that overrides root's
            const middle_content = `// @lsp-done-by: "root.do"
// @lsp-cd: "./"
global middle_var = 2
`;
            write_file('scripts/middle.do', middle_content);

            const leaf_content = `// @lsp-done-by: "middle.do"
local result \`root_var' \`middle_var'
`;
            const leaf_path = write_file('scripts/leaf.do', leaf_content);
            const leaf_uri = URI.file(leaf_path).toString();

            await document_store.open(leaf_uri, leaf_content, 1);
            const document_state = document_store.get(leaf_uri);

            expect(document_state).toBeDefined();

            // leaf.do should inherit working directory from middle.do (not root.do)
            // middle.do's @lsp-cd: "./" resolves to test_dir/scripts
            expect(document_state!.working_directory).toBeDefined();
            
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(path.join(test_dir, 'scripts'));
            expect(normalized_wd).toBe(expected_wd);
        });
    });

    describe('Edge Cases', () => {
        it('should handle missing parent file gracefully', async () => {
            // Create child that references non-existent parent
            const child_content = `// @lsp-done-by: "nonexistent.do"
local result = 1
`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            await document_store.open(child_uri, child_content, 1);
            const document_state = document_store.get(child_uri);

            expect(document_state).toBeDefined();

            // Should not have inherited working directory (parent doesn't exist)
            expect(document_state!.working_directory).toBeUndefined();
        });

        it('should handle parent without working directory', async () => {
            // Create parent without @lsp-cd
            const parent_content = `global parent_var = 1`;
            write_file('parent.do', parent_content);

            const child_content = `// @lsp-done-by: "parent.do"
local result \`parent_var'
`;
            const child_path = write_file('child.do', child_content);
            const child_uri = URI.file(child_path).toString();

            await document_store.open(child_uri, child_content, 1);
            const document_state = document_store.get(child_uri);

            expect(document_state).toBeDefined();

            // Should not have inherited working directory (parent has none)
            expect(document_state!.working_directory).toBeUndefined();
        });

        it('should handle file without backward directives', async () => {
            const content = `* No directives
local var = 1
`;
            const file_path = write_file('standalone.do', content);
            const file_uri = URI.file(file_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();

            // Should not have working directory (no directives)
            expect(document_state!.working_directory).toBeUndefined();
        });
    });

    describe('Forward Call Path Resolution with Inherited Working Directory', () => {
        /**
         * Bug scenario: bh_vars.do → survey.do → loop.do
         *
         * Directory structure:
         * test_dir/
         * └── fertility_surveys/
         *     ├── dhs/
         *     │   ├── bh_vars.do      // @lsp-included-by: "survey.do"
         *     │   ├── survey.do       // @lsp-done-by: "../loop.do", contains: do "dhs/year_recodes"
         *     │   └── year_recodes.do // The target file
         *     └── loop.do             // @lsp-working-directory: "."
         *
         * The bug was that forward call `do "dhs/year_recodes"` in survey.do was being
         * resolved incorrectly as `fertility_surveys/dhs/dhs/year_recodes.do` instead of
         * `fertility_surveys/dhs/year_recodes.do`.
         *
         * This happened because the working directory from loop.do (fertility_surveys/)
         * was not being properly passed to survey.do when resolving its forward calls.
         */
        it('should resolve forward call paths correctly with inherited working directory (bh_vars → survey → loop scenario)', async () => {
            // Create directory structure:
            // test_dir/
            // └── fertility_surveys/
            //     ├── dhs/
            //     │   ├── bh_vars.do      // @lsp-included-by: "survey.do"
            //     │   ├── survey.do       // @lsp-done-by: "../loop.do", contains: do "dhs/year_recodes"
            //     │   └── year_recodes.do // The target file
            //     └── loop.do             // @lsp-working-directory: "."

            // Create year_recodes.do - the target file that should be found
            const year_recodes_content = `global year_recode = 2024
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with @lsp-working-directory: "."
            // This sets working directory to fertility_surveys/ (where loop.do is located)
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with @lsp-done-by: "../loop.do" and a forward call
            // The forward call `do "dhs/year_recodes"` should resolve relative to
            // the inherited working directory (fertility_surveys/), NOT relative to
            // survey.do's location (fertility_surveys/dhs/)
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 2
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do with @lsp-included-by: "survey.do"
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local my_var = 1
`;
            const bh_vars_path = write_file('fertility_surveys/dhs/bh_vars.do', bh_vars_content);
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            // Open bh_vars.do in DocumentStore
            await document_store.open(bh_vars_uri, bh_vars_content, 1);
            const document_state = document_store.get(bh_vars_uri);

            expect(document_state).toBeDefined();

            // bh_vars.do should inherit working directory from loop.do (via survey.do)
            // loop.do's @lsp-working-directory: "." resolves to fertility_surveys/
            expect(document_state!.working_directory).toBeDefined();
            
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(path.join(test_dir, 'fertility_surveys'));
            expect(normalized_wd).toBe(expected_wd);

            // Verify that the year_recode global from year_recodes.do is visible
            // Use scope_resolver.resolve() to get the full resolved scope including forward-called symbols
            const resolved_scope = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);
            expect(resolved_scope.symbols.globalMacros.has('year_recode')).toBe(true);
        });

        it('should NOT double-prefix paths when working directory is inherited', async () => {
            // This test specifically verifies the bug fix:
            // The path "dhs/year_recodes" should resolve to:
            //   CORRECT: fertility_surveys/dhs/year_recodes.do
            //   WRONG:   fertility_surveys/dhs/dhs/year_recodes.do (the bug)

            // Create the correct target file
            const year_recodes_content = `global correct_path = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create the WRONG path file (should NOT be found)
            // If this file's symbol appears, the bug is present
            const wrong_path_content = `global wrong_path = 1
`;
            write_file('fertility_surveys/dhs/dhs/year_recodes.do', wrong_path_content);

            // Create loop.do with working directory set to fertility_surveys/
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call to "dhs/year_recodes"
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 2
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local my_var = 1
`;
            const bh_vars_path = write_file('fertility_surveys/dhs/bh_vars.do', bh_vars_content);
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            await document_store.open(bh_vars_uri, bh_vars_content, 1);
            const document_state = document_store.get(bh_vars_uri);

            expect(document_state).toBeDefined();

            // Use scope_resolver.resolve() to get the full resolved scope including forward-called symbols
            const resolved_scope = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // The correct_path global should be visible (from the correct file)
            expect(resolved_scope.symbols.globalMacros.has('correct_path')).toBe(true);

            // The wrong_path global should NOT be visible (from the wrong file)
            // If this assertion fails, the bug is present
            expect(resolved_scope.symbols.globalMacros.has('wrong_path')).toBe(false);
        });

        it('should resolve forward calls in parent file using discovered working directory', async () => {
            // This test verifies that when resolving forward calls in a parent file,
            // the working directory is discovered from deeper ancestors BEFORE parsing

            // Create target file
            const data_file_content = `global data_loaded = 1
`;
            write_file('project/data/load.do', data_file_content);

            // Create root.do with working directory
            const root_content = `// @lsp-working-directory: "."
global root_var = 1
`;
            write_file('project/root.do', root_content);

            // Create middle.do that inherits working directory and has a forward call
            const middle_content = `// @lsp-done-by: "root.do"
do "data/load"
global middle_var = 2
`;
            write_file('project/middle.do', middle_content);

            // Create leaf.do
            const leaf_content = `// @lsp-done-by: "middle.do"
local leaf_var = 3
`;
            const leaf_path = write_file('project/leaf.do', leaf_content);
            const leaf_uri = URI.file(leaf_path).toString();

            await document_store.open(leaf_uri, leaf_content, 1);
            const document_state = document_store.get(leaf_uri);

            expect(document_state).toBeDefined();

            // Verify working directory is inherited
            expect(document_state!.working_directory).toBeDefined();
            const normalized_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(path.join(test_dir, 'project'));
            expect(normalized_wd).toBe(expected_wd);

            // Verify that data_loaded global is visible
            // Use scope_resolver.resolve() to get the full resolved scope including forward-called symbols
            const resolved_scope = await scope_resolver.resolve(leaf_uri, leaf_content);
            expect(resolved_scope.symbols.globalMacros.has('data_loaded')).toBe(true);
        });
    });
});
