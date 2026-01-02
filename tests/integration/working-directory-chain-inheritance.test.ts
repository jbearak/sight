/**
 * Integration test for working directory chain inheritance.
 * Tests the real-world scenario from fertility_surveys/dhs/ files.
 *
 * Directive chain: bh_vars.do → survey.do → loop.do
 * - bh_vars.do has @lsp-included-by survey.do
 * - survey.do has @lsp-done-by loop.do
 * - loop.do has @lsp-cd ../
 *
 * This test validates:
 * - Working directory inheritance through the directive chain
 * - Diagnostic source attribution for errors from parent files
 * - Diagnostic range remapping to the active file's directive line
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';

describe('Working Directory Chain Inheritance Integration Tests', () => {
    let temp_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-chain-test-'));
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper to create a file in the temp directory.
     */
    function create_file(relative_path: string, content: string): string {
        const file_path = path.join(temp_dir, relative_path);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    /**
     * Helper to create a file URI.
     */
    function file_uri(file_path: string): string {
        return URI.file(file_path).toString();
    }

    describe('Real-world scenario: bh_vars.do → survey.do → loop.do', () => {
        it('should inherit working directory from loop.do through the chain', async () => {
            // Create the directory structure similar to fertility_surveys
            // fertility_surveys/
            //   programs.do
            //   dhs/
            //     loop.do (has @lsp-cd ../)
            //     survey.do (has @lsp-done-by loop.do)
            //     bh_vars.do (has @lsp-included-by survey.do)

            // Create programs.do at the root level (fertility_surveys/)
            create_file('programs.do', `
* programs.do - utility programs
program define my_program
    display "Hello"
end
`);

            // Create loop.do with @lsp-cd ../
            create_file('dhs/loop.do', `
// @lsp-cd ../
* loop.do - main loop script
do "programs.do"
local loop_var = 1
`);

            // Create survey.do with @lsp-done-by loop.do
            create_file('dhs/survey.do', `
// @lsp-done-by loop.do
* survey.do - survey processing script
do "programs.do"
local survey_var = 1
`);

            // Create bh_vars.do with @lsp-included-by survey.do
            const bh_vars_content = `
// @lsp-included-by survey.do
* bh_vars.do - birth history variables
do "programs.do"
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // The working directory should be inherited from loop.do's @lsp-cd ../
            // This means paths like "programs.do" should resolve relative to fertility_surveys/
            expect(result.inherited_working_directory).toBeDefined();
            
            // The inherited working directory should be the parent of dhs/
            if (result.inherited_working_directory) {
                const expected_wd = path.resolve(temp_dir);
                // Normalize both paths to handle trailing slash differences
                const normalized_inherited = result.inherited_working_directory.replace(/\/$/, '');
                const normalized_expected = expected_wd.replace(/\/$/, '');
                expect(normalized_inherited).toBe(normalized_expected);
            }
        });

        it('should resolve forward calls using inherited working directory', async () => {
            // Create programs.do at the root level
            create_file('programs.do', `
* programs.do
global my_global = 1
`);

            // Create loop.do with @lsp-cd ../ and a forward call to programs.do
            create_file('dhs/loop.do', `
// @lsp-cd ../
do "programs.do"
local loop_var = 1
`);

            // Create survey.do
            create_file('dhs/survey.do', `
// @lsp-done-by loop.do
local survey_var = 1
`);

            // Create bh_vars.do
            const bh_vars_content = `
// @lsp-included-by survey.do
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // Should have the global from programs.do (resolved via inherited working directory)
            expect(result.symbols.globalMacros.has('my_global')).toBe(true);
        });

        it('should emit diagnostics with source attribution when forward call fails', async () => {
            // Create loop.do with @lsp-cd ../ and a forward call to a missing file
            create_file('dhs/loop.do', `
// @lsp-cd ../
do "missing_programs.do"
local loop_var = 1
`);

            // Create survey.do
            create_file('dhs/survey.do', `
// @lsp-done-by loop.do
local survey_var = 1
`);

            // Create bh_vars.do
            const bh_vars_content = `
// @lsp-included-by survey.do
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // Should have a diagnostic about the missing file
            const missing_file_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Cannot read file') && d.message.includes('missing_programs.do')
            );

            expect(missing_file_diagnostics.length).toBeGreaterThan(0);

            // The diagnostic should have source attribution
            for (const diagnostic of missing_file_diagnostics) {
                expect(diagnostic.source).toBeDefined();
                if (diagnostic.source) {
                    expect(diagnostic.source.source_file).toBeDefined();
                    expect(typeof diagnostic.source.source_line).toBe('number');
                }
            }
        });

        it('should remap diagnostic ranges to the active file directive line', async () => {
            // Create loop.do with @lsp-cd ../ and a forward call to a missing file
            create_file('dhs/loop.do', `
// @lsp-cd ../
do "missing_programs.do"
local loop_var = 1
`);

            // Create survey.do
            create_file('dhs/survey.do', `
// @lsp-done-by loop.do
local survey_var = 1
`);

            // Create bh_vars.do with directive on line 1 (after blank line 0)
            const bh_vars_content = `
// @lsp-included-by survey.do
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // Find diagnostics with source attribution
            const remapped_diagnostics = result.diagnostics.filter(
                d => d.source !== undefined
            );

            // All remapped diagnostics should point to line 1 (the directive line in bh_vars.do)
            for (const diagnostic of remapped_diagnostics) {
                expect(diagnostic.range.start.line).toBe(1);
            }
        });

        it('should include source file and line in diagnostic message', async () => {
            // Create loop.do with @lsp-cd ../ and a forward call to a missing file
            create_file('dhs/loop.do', `
// @lsp-cd ../
do "missing_programs.do"
local loop_var = 1
`);

            // Create survey.do
            create_file('dhs/survey.do', `
// @lsp-done-by loop.do
local survey_var = 1
`);

            // Create bh_vars.do
            const bh_vars_content = `
// @lsp-included-by survey.do
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // Find diagnostics with source attribution
            const remapped_diagnostics = result.diagnostics.filter(
                d => d.source !== undefined
            );

            // Message should include source file info
            // When source_line is known: "... : source_file line N"
            // When source_line is unknown: "... : source_file"
            for (const diagnostic of remapped_diagnostics) {
                if (diagnostic.source?.source_line !== undefined) {
                    expect(diagnostic.message).toMatch(/: .+ line \d+/);
                } else {
                    // source_line is omitted when call site is unknown
                    expect(diagnostic.message).toContain(`: ${diagnostic.source?.source_file}`);
                }
            }
        });
    });

    describe('Edge cases', () => {
        it('should handle missing intermediate file in chain', async () => {
            // Create bh_vars.do pointing to non-existent survey.do
            const bh_vars_content = `
// @lsp-included-by survey.do
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // Should have a diagnostic about the missing survey.do
            const missing_file_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Cannot read file') && d.message.includes('survey.do')
            );

            expect(missing_file_diagnostics.length).toBeGreaterThan(0);

            // The diagnostic should have source attribution
            for (const diagnostic of missing_file_diagnostics) {
                expect(diagnostic.source).toBeDefined();
            }
        });

        it('should handle circular dependency in chain', async () => {
            // Create a circular dependency: A -> B -> A
            create_file('dhs/file_a.do', `
// @lsp-done-by file_b.do
local a_var = 1
`);

            const file_b_content = `
// @lsp-done-by file_a.do
local b_var = 1
`;
            const file_b_path = create_file('dhs/file_b.do', file_b_content);

            const result = await scope_resolver.resolve(
                file_uri(file_b_path),
                file_b_content
            );

            // Cycles should be handled gracefully without emitting diagnostics
            // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
            const cycle_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Circular dependency')
            );

            expect(cycle_diagnostics.length).toBe(0);

            // Should still resolve symbols from the current file
            expect(result.symbols.localMacros.has('b_var')).toBe(true);
        });

        it('should handle working directory override in intermediate file', async () => {
            // Create loop.do with @lsp-cd ../
            create_file('dhs/loop.do', `
// @lsp-cd ../
local loop_var = 1
`);

            // Create survey.do with its own @lsp-cd (should override loop.do's)
            create_file('dhs/survey.do', `
// @lsp-done-by loop.do
// @lsp-cd ./subdir
local survey_var = 1
`);

            // Create bh_vars.do
            const bh_vars_content = `
// @lsp-included-by survey.do
local bh_var = 1
`;
            const bh_vars_path = create_file('dhs/bh_vars.do', bh_vars_content);

            const result = await scope_resolver.resolve(
                file_uri(bh_vars_path),
                bh_vars_content
            );

            // The inherited working directory should be from survey.do's @lsp-cd ./subdir
            // (nearest parent's working directory wins)
            if (result.inherited_working_directory) {
                expect(result.inherited_working_directory).toContain('subdir');
            }
        });
    });
});
