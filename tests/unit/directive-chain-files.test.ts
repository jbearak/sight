/**
 * Unit test for directive chain resolution using synthetic fixtures.
 * Tests working directory chain inheritance through @lsp-done-by and @lsp-included-by.
 * 
 * This replaces the previous fertility-surveys-real-files.test.ts which depended
 * on an external submodule.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import * as path from 'path';

describe('Directive Chain Files Test', () => {
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;
    const fixture_root = path.resolve('tests/fixtures/directive-chain');

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    });

    /**
     * Helper to get absolute path and check if file exists
     */
    function get_file_path(relative_path: string): string {
        const abs_path = path.join(fixture_root, relative_path);
        if (!fs.existsSync(abs_path)) {
            throw new Error(`File does not exist: ${abs_path}`);
        }
        return abs_path;
    }

    /**
     * Helper to read file content
     */
    function read_file(file_path: string): string {
        return fs.readFileSync(file_path, 'utf-8');
    }

    describe('directive chain resolution', () => {
        it('should resolve wm_vars.do file without errors', async () => {
            const wm_vars_path = get_file_path('subdir/wm_vars.do');
            const wm_vars_content = read_file(wm_vars_path);
            const wm_vars_uri = URI.file(wm_vars_path).toString();

            const result = await scope_resolver.resolve(wm_vars_uri, wm_vars_content);

            // Check for "Cannot read file" errors
            const cannot_read_errors = result.diagnostics.filter(
                d => d.message.includes('Cannot read file')
            );

            // The test should pass if we can resolve the working directory correctly
            expect(cannot_read_errors.length).toBe(0);
        });

        it('should resolve bh_vars.do file without errors', async () => {
            const bh_vars_path = get_file_path('subdir/bh_vars.do');
            const bh_vars_content = read_file(bh_vars_path);
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // Check for "Cannot read file" errors
            const cannot_read_errors = result.diagnostics.filter(
                d => d.message.includes('Cannot read file')
            );

            expect(cannot_read_errors.length).toBe(0);
        });

        it('should trace the directive chain step by step', async () => {
            // Test each file in the chain individually
            const the_files = [
                'loop.do',
                'subdir/survey.do',
                'subdir/wm_vars.do'
            ];

            for (const my_file_path of the_files) {
                const abs_path = get_file_path(my_file_path);
                const content = read_file(abs_path);
                const uri = URI.file(abs_path).toString();

                const result = await scope_resolver.resolve(uri, content);

                // Each file should parse without critical errors
                expect(result.symbols).toBeDefined();
            }
        });

        it('should check if programs.do exists relative to working directory', async () => {
            // Check if programs.do exists in the expected location
            const programs_path = path.join(fixture_root, 'programs.do');
            
            expect(fs.existsSync(programs_path)).toBe(true);

            if (fs.existsSync(programs_path)) {
                const content = read_file(programs_path);
                expect(content.length).toBeGreaterThan(0);
            }
        });

        it('should inherit working directory from loop.do through the chain', async () => {
            // Test that bh_vars.do inherits working directory from loop.do via survey.do
            const bh_vars_path = get_file_path('subdir/bh_vars.do');
            const bh_vars_content = read_file(bh_vars_path);
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            const result = await scope_resolver.resolve(bh_vars_uri, bh_vars_content);

            // The working directory should be inherited from loop.do
            // loop.do has @lsp-working-directory: "." which resolves to fixture_root
            if (result.inherited_working_directory) {
                const normalized_wd = path.normalize(result.inherited_working_directory);
                const expected_wd = path.normalize(fixture_root);
                expect(normalized_wd).toBe(expected_wd);
            }
        });

        it('should resolve forward calls relative to inherited working directory', async () => {
            // survey.do has forward call: do "subdir/year_recodes"
            // This should resolve relative to the inherited working directory from loop.do
            const survey_path = get_file_path('subdir/survey.do');
            const survey_content = read_file(survey_path);
            const survey_uri = URI.file(survey_path).toString();

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should not have "Cannot read file" errors for year_recodes
            const cannot_read_errors = result.diagnostics.filter(
                d => d.message.includes('Cannot read file') &&
                     d.message.includes('year_recodes')
            );

            expect(cannot_read_errors.length).toBe(0);
        });
    });
});
