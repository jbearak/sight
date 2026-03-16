/**
 * Integration test for the forward scope working directory bug.
 *
 * Tests the specific bug scenario from the spec:
 * - bh_vars.do → survey.do → loop.do with working directory
 * - Verify "dhs/year_recodes" resolves to "fertility_surveys/dhs/year_recodes"
 * - NOT "fertility_surveys/dhs/dhs/year_recodes" (the doubled path bug)
 *
 * Validates: Requirements 3.1
 *
 * Directory structure:
 * test_dir/
 * └── fertility_surveys/
 *     ├── dhs/
 *     │   ├── bh_vars.do      // @lsp-included-by: "survey.do"
 *     │   ├── survey.do       // @lsp-done-by: "../loop.do", contains: do "dhs/year_recodes"
 *     │   └── year_recodes.do // The target file that should be found
 *     └── loop.do             // @lsp-working-directory: "."
 *
 * The bug was that forward call `do "dhs/year_recodes"` in survey.do was being
 * resolved incorrectly as `fertility_surveys/dhs/dhs/year_recodes.do` instead of
 * `fertility_surveys/dhs/year_recodes.do`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

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

describe('Forward Scope Working Directory Bug - Doubled Path Scenario', () => {
    let test_dir: string;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-bug-test-'));
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        document_store = new DocumentStore();
        document_store.set_workspace_roots([test_dir]);
        document_store.set_scope_resolver(scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(test_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file in the test directory.
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
     * Helper to create a file URI.
     */
    function file_uri(file_path: string): string {
        return URI.file(file_path).toString();
    }

    describe('Bug Scenario: bh_vars.do → survey.do → loop.do', () => {
        /**
         * This test verifies the specific bug scenario from the spec:
         *
         * Directory structure:
         * fertility_surveys/
         * ├── dhs/
         * │   ├── bh_vars.do      // @lsp-included-by: "survey.do"
         * │   ├── survey.do       // @lsp-done-by: "../loop.do", contains: do "dhs/year_recodes"
         * │   └── year_recodes.do // The target file
         * └── loop.do             // @lsp-working-directory: "."
         *
         * The forward call "dhs/year_recodes" in survey.do should resolve to:
         *   CORRECT: fertility_surveys/dhs/year_recodes.do
         *   WRONG:   fertility_surveys/dhs/dhs/year_recodes.do (the doubled path bug)
         */
        it('should resolve "dhs/year_recodes" to correct path NOT doubled path', async () => {
            // Create year_recodes.do - the target file that should be found
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with @lsp-working-directory: "."
            const loop_content = `// @lsp-working-directory: "."
* Main loop file
global loop_initialized = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with @lsp-done-by: "../loop.do" and a forward call
            const survey_content = `// @lsp-done-by: "../loop.do"
* Survey processing file
do "dhs/year_recodes"
local survey_processed = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do with @lsp-included-by: "survey.do"
            const bh_vars_content = `// @lsp-included-by: "survey.do"
* Birth history variables
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope (including inherited symbols)
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Verify working directory is inherited from loop.do
            expect(result.inherited_working_directory).toBeDefined();
            const normalized_wd = normalize_path(result.inherited_working_directory!);
            const expected_wd = normalize_path(
                path.join(test_dir, 'fertility_surveys')
            );
            expect(normalized_wd).toBe(expected_wd);

            // Verify that the year_recode_loaded global is visible (from forward call in survey.do)
            const symbols = result.symbols;
            expect(symbols.globalMacros.has('year_recode_loaded')).toBe(true);

            // Also verify loop_initialized is visible (from loop.do)
            expect(symbols.globalMacros.has('loop_initialized')).toBe(true);
        });

        it('should NOT find symbols from doubled path file if it exists', async () => {
            // Create the CORRECT target file
            const correct_file_content = `* Correct year recodes file
global correct_path_symbol = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', correct_file_content);

            // Create the WRONG path file (should NOT be found)
            const wrong_file_content = `* Wrong year recodes file (doubled path)
global wrong_path_symbol = 1
`;
            write_file(
                'fertility_surveys/dhs/dhs/year_recodes.do',
                wrong_file_content
            );

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call to "dhs/year_recodes"
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            const symbols = result.symbols;

            // The correct_path_symbol should be visible
            expect(symbols.globalMacros.has('correct_path_symbol')).toBe(true);

            // The wrong_path_symbol should NOT be visible
            expect(symbols.globalMacros.has('wrong_path_symbol')).toBe(false);
        });

        it('should NOT produce "Cannot read file" diagnostic with doubled path', async () => {
            // Create the target file at the correct location
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            await document_store.open(bh_vars_uri, bh_vars_content, 1);
            const document_state = document_store.get(bh_vars_uri);

            expect(document_state).toBeDefined();

            // Check diagnostics for any "Cannot read file" errors with doubled path
            const doubled_path_diagnostics = document_state!.diagnostics.filter(
                d => d.message.includes('Cannot read file') &&
                     d.message.includes('dhs/dhs/year_recodes')
            );

            // There should be NO diagnostics with the doubled path
            expect(doubled_path_diagnostics.length).toBe(0);

            // Also verify no general "Cannot read file" errors for year_recodes
            const year_recodes_diagnostics = document_state!.diagnostics.filter(
                d => d.message.includes('Cannot read file') &&
                     d.message.includes('year_recodes')
            );
            expect(year_recodes_diagnostics.length).toBe(0);
        });
    });

    describe('ScopeResolver Direct Resolution', () => {
        it('should resolve forward calls correctly via ScopeResolver.resolve()', async () => {
            // Create year_recodes.do
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Resolve scope directly
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Verify working directory is inherited
            expect(result.inherited_working_directory).toBeDefined();
            const normalized_wd = normalize_path(result.inherited_working_directory!);
            const expected_wd = normalize_path(
                path.join(test_dir, 'fertility_surveys')
            );
            expect(normalized_wd).toBe(expected_wd);

            // Verify symbols from year_recodes.do are visible
            expect(result.symbols.globalMacros.has('year_recode_loaded')).toBe(true);

            // Verify no doubled path diagnostics
            const doubled_path_diagnostics = result.diagnostics.filter(
                d => d.message.includes('dhs/dhs/year_recodes') ||
                     d.message.includes('dhs\\dhs\\year_recodes')
            );
            expect(doubled_path_diagnostics.length).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        it('should handle multiple levels of forward calls with working directory', async () => {
            // Create helper.do
            const helper_content = `* Helper file
global helper_loaded = 1
`;
            write_file('fertility_surveys/dhs/helper.do', helper_content);

            // Create year_recodes.do that calls helper.do
            const year_recodes_content = `* Year recodes file
do "dhs/helper"
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            const symbols = result.symbols;

            // All globals should be visible
            expect(symbols.globalMacros.has('loop_var')).toBe(true);
            expect(symbols.globalMacros.has('year_recode_loaded')).toBe(true);
            expect(symbols.globalMacros.has('helper_loaded')).toBe(true);
        });

        it('should handle forward call with .do extension explicitly specified', async () => {
            // Create year_recodes.do
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call using explicit .do extension
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes.do"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Verify symbol is visible
            expect(result.symbols.globalMacros.has('year_recode_loaded')).toBe(
                true
            );
        });

        it('should handle @lsp-cd synonym for working directory directive', async () => {
            // Create year_recodes.do
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with @lsp-cd (synonym for @lsp-working-directory)
            const loop_content = `// @lsp-cd: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Verify working directory is inherited
            expect(result.inherited_working_directory).toBeDefined();

            // Verify symbol is visible
            expect(result.symbols.globalMacros.has('year_recode_loaded')).toBe(
                true
            );
        });

        it('should handle run command in addition to do command', async () => {
            // Create year_recodes.do
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with run command instead of do
            const survey_content = `// @lsp-done-by: "../loop.do"
run "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Verify symbol is visible
            expect(result.symbols.globalMacros.has('year_recode_loaded')).toBe(
                true
            );
        });

        it('should handle include command in addition to do command', async () => {
            // Create year_recodes.do
            const year_recodes_content = `* Year recodes file
global year_recode_loaded = 1
local year_recode_local = 2
`;
            write_file('fertility_surveys/dhs/year_recodes.do', year_recodes_content);

            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with include command
            const survey_content = `// @lsp-included-by: "../loop.do"
include "dhs/year_recodes"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do with @lsp-included-by
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get full scope
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Verify global symbol is visible
            expect(result.symbols.globalMacros.has('year_recode_loaded')).toBe(
                true
            );

            // For include command with @lsp-included-by chain, locals should be visible
            expect(result.symbols.localMacros.has('year_recode_local')).toBe(
                true
            );
        });
    });

    describe('Diagnostic Source Attribution', () => {
        /**
         * Test diagnostic source attribution using ScopeResolver directly.
         * The ScopeResolver returns DirectiveDiagnostic[] which includes source attribution.
         */
        it('should attribute diagnostics to correct source file when forward call fails', async () => {
            // Create loop.do with working directory
            const loop_content = `// @lsp-working-directory: "."
global loop_var = 1
`;
            write_file('fertility_surveys/loop.do', loop_content);

            // Create survey.do with forward call to non-existent file
            const survey_content = `// @lsp-done-by: "../loop.do"
do "dhs/nonexistent_file"
local survey_var = 1
`;
            write_file('fertility_surveys/dhs/survey.do', survey_content);

            // Create bh_vars.do
            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_var = 1
`;
            const bh_vars_path = write_file(
                'fertility_surveys/dhs/bh_vars.do',
                bh_vars_content
            );
            const bh_vars_uri = file_uri(bh_vars_path);

            // Use ScopeResolver directly to get DirectiveDiagnostic[] with source attribution
            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Should have a diagnostic about the missing file
            const missing_file_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Cannot read file') &&
                     d.message.includes('nonexistent_file')
            );

            expect(missing_file_diagnostics.length).toBeGreaterThan(0);

            // The diagnostic should have source attribution
            for (const my_diagnostic of missing_file_diagnostics) {
                expect(my_diagnostic.source).toBeDefined();
                if (my_diagnostic.source) {
                    expect(my_diagnostic.source.source_file).toBeDefined();
                    expect(typeof my_diagnostic.source.source_line).toBe('number');
                }
            }

            // The diagnostic should NOT mention doubled path
            for (const my_diagnostic of missing_file_diagnostics) {
                expect(my_diagnostic.message).not.toContain('dhs/dhs/');
                expect(my_diagnostic.message).not.toContain('dhs\\dhs\\');
            }
        });
    });
});
