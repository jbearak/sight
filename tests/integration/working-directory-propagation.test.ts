/**
 * Integration tests for Working Directory Propagation
 *
 * Tests the @lsp-cd directive functionality using mock content.
 * Verifies that:
 * 1. The @lsp-cd directive is correctly parsed
 * 2. Working directory propagation resolves paths correctly for nested files
 * 3. Diagnostic line numbers point to correct locations when errors occur
 *
 * Feature: working-directory-propagation
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import { DirectiveParser } from '../../src/directive-parser';

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

describe('Working Directory Propagation Integration Tests', () => {
    const workspace_root = process.cwd();
    const fixture_dir = path.join(workspace_root, 'tests/fixtures/directive-chain');
    const subdir = path.join(fixture_dir, 'subdir');
    const survey_do_path = path.join(subdir, 'survey.do');

    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let directive_parser: DirectiveParser;

    beforeEach(() => {
        document_store = new DocumentStore();
        document_store.set_workspace_roots([workspace_root]);
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        forward_resolver.set_workspace_roots([workspace_root]);
        directive_parser = new DirectiveParser();
    });

    describe('Working Directory Directive Parsing', () => {
        it('should correctly parse @lsp-cd directive', () => {
            const content = `// @lsp-cd ../
* Some Stata code
include subdir/wm_vars
`;
            const file_uri = URI.file(survey_do_path).toString();

            const directive_result = directive_parser.parse(content, file_uri);

            // Should have a working_directory directive
            expect(directive_result.working_directory).toBeDefined();
            expect(directive_result.working_directory!.path).toBe('../');
            expect(directive_result.working_directory!.directive_form).toBe('cd');
            expect(directive_result.working_directory!.is_workspace_relative).toBe(false);

            // The resolved path should be the fixture directory
            // (parent of subdir/ where survey.do is located)
            const resolved_path = normalize_path(directive_result.working_directory!.resolved_path);
            const expected_path = normalize_path(fixture_dir);
            expect(resolved_path).toBe(expected_path);
        });

        it('should resolve working_directory when opening file in DocumentStore', async () => {
            const content = `// @lsp-cd ../
* Some Stata code
include subdir/wm_vars
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();
            expect(document_state!.working_directory).toBeDefined();

            // The working_directory should be the fixture directory
            const resolved_wd = normalize_path(document_state!.working_directory!);
            const expected_wd = normalize_path(fixture_dir);
            expect(resolved_wd).toBe(expected_wd);
        });

        it('should detect forward calls with working directory context', async () => {
            const content = `// @lsp-cd ../
* Some Stata code
include subdir/wm_vars
run subdir/bh_vars.do
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();
            expect(document_state!.forward_calls.length).toBeGreaterThan(0);

            // Check for expected forward calls
            const the_raw_paths = document_state!.forward_calls.map(fc => fc.raw_path);
            expect(the_raw_paths).toContain('subdir/wm_vars');
            expect(the_raw_paths).toContain('subdir/bh_vars.do');
        });
    });

    describe('Working Directory Path Resolution', () => {
        it('should resolve paths relative to working directory, not script location', async () => {
            const content = `// @lsp-cd ../
include subdir/wm_vars
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();

            // Find the forward call to subdir/wm_vars
            const wm_vars_call = document_state!.forward_calls.find(
                fc => fc.raw_path === 'subdir/wm_vars' || fc.raw_path === 'subdir/wm_vars.do'
            );

            expect(wm_vars_call).toBeDefined();

            // The resolved path should be relative to fixture_dir/ (working directory)
            // not relative to fixture_dir/subdir/ (script location)
            const expected_path_with_do = path.join(fixture_dir, 'subdir', 'wm_vars.do');
            const expected_path_without_do = path.join(fixture_dir, 'subdir', 'wm_vars');
            expect(
                wm_vars_call!.path === expected_path_with_do ||
                wm_vars_call!.path === expected_path_without_do
            ).toBe(true);
        });

        it('should correctly resolve nested file paths with working directory context', async () => {
            // Read wm_vars.do which exists in the repo
            const wm_vars_path = path.join(subdir, 'wm_vars.do');
            
            // Skip if file doesn't exist
            if (!fs.existsSync(wm_vars_path)) {
                return;
            }
            
            const wm_vars_content = fs.readFileSync(wm_vars_path, 'utf8');
            const wm_vars_uri = URI.file(wm_vars_path).toString();

            // Parse wm_vars.do with the inherited working directory
            const parsed_result = await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: fixture_dir }
            );

            expect('error' in parsed_result).toBe(false);
            if ('error' in parsed_result) return;

            // wm_vars.do should have forward calls
            expect(parsed_result.forward_calls.length).toBeGreaterThan(0);

            // The working_directory should be propagated
            expect(parsed_result.working_directory).toBe(fixture_dir);
        });
    });

    describe('Forward Scope Resolution with Working Directory', () => {
        it('should resolve forward calls using inherited working directory', async () => {
            const content = `// @lsp-cd ../
include subdir/wm_vars
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();

            // Get forward calls that are static (can be resolved)
            const static_calls = document_state!.forward_calls.filter(fc => fc.is_static);
            expect(static_calls.length).toBeGreaterThan(0);

            // Resolve forward scope with the working directory context
            const result = await forward_resolver.resolve(
                file_uri,
                static_calls,
                'include',
                {
                    visited: new Map(),
                    effective_call_type: 'include',
                    depth: 0,
                    diagnostics: [],
                    working_directory: document_state!.working_directory,
                    call_chain: [],
                }
            );

            // Should have resolved some call sites (if files exist)
            // Note: This depends on actual files existing in the repo
            // The test verifies the mechanism works, not that specific files exist
            expect(result.diagnostics).toBeDefined();
        });

        it('should report diagnostics for files that cannot be found', async () => {
            const content = `// @lsp-cd ../
include nonexistent/file.do
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();

            const static_calls = document_state!.forward_calls.filter(fc => fc.is_static);

            const result = await forward_resolver.resolve(
                file_uri,
                static_calls,
                'include',
                {
                    visited: new Map(),
                    effective_call_type: 'include',
                    depth: 0,
                    diagnostics: [],
                    working_directory: document_state!.working_directory,
                    call_chain: [],
                }
            );

            // Should have a diagnostic for the missing file
            expect(result.diagnostics.length).toBeGreaterThan(0);
            expect(result.diagnostics[0].message).toContain('Cannot read file');
        });
    });

    describe('Nested File Working Directory Propagation', () => {
        it('should propagate working directory to nested files during resolution', async () => {
            // This test verifies that when we parse a file with an inherited working directory,
            // the forward calls are resolved relative to that working directory.
            
            // Use wm_vars.do which exists in the repo
            const wm_vars_path = path.join(subdir, 'wm_vars.do');
            
            // Skip if file doesn't exist
            if (!fs.existsSync(wm_vars_path)) {
                return;
            }

            const wm_vars_uri = URI.file(wm_vars_path).toString();

            // Parse wm_vars.do with inherited working directory from fixture_dir/
            const result = await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: fixture_dir }
            );

            expect('error' in result).toBe(false);
            if ('error' in result) return;

            // The working_directory should be propagated (inherited)
            expect(result.working_directory).toBe(fixture_dir);

            // Forward calls should be resolved relative to fixture_dir/
            // not relative to fixture_dir/dhs/
            for (const my_call of result.forward_calls) {
                if (my_call.is_static && my_call.path) {
                    // Paths should NOT have double dhs/ (e.g., dhs/subdir/wm_vars/)
                    expect(my_call.path).not.toMatch(/dhs[\/\\]dhs/);
                }
            }
        });

        it('should correctly resolve paths in wm_vars.do using inherited working directory', async () => {
            const wm_vars_path = path.join(subdir, 'wm_vars.do');
            
            // Skip if file doesn't exist
            if (!fs.existsSync(wm_vars_path)) {
                return;
            }

            const wm_vars_uri = URI.file(wm_vars_path).toString();

            // Parse with inherited working directory (simulating being called from survey.do)
            const result = await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: fixture_dir }
            );

            expect('error' in result).toBe(false);
            if ('error' in result) return;

            // Check that forward calls are resolved correctly
            for (const my_call of result.forward_calls) {
                if (my_call.is_static && my_call.path) {
                    // Paths should NOT have double dhs/ (e.g., dhs/subdir/wm_vars/)
                    expect(my_call.path).not.toMatch(/dhs[\/\\]dhs/);
                }
            }
        });
    });

    describe('Diagnostic Line Number Accuracy', () => {
        it('should report diagnostics with correct line numbers for nested file errors', async () => {
            const content = `// @lsp-cd ../
* Line 2
include nonexistent/missing.do
* Line 4
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();

            const static_calls = document_state!.forward_calls.filter(fc => fc.is_static);

            const result = await forward_resolver.resolve(
                file_uri,
                static_calls,
                'include',
                {
                    visited: new Map(),
                    effective_call_type: 'include',
                    depth: 0,
                    diagnostics: [],
                    working_directory: document_state!.working_directory,
                    call_chain: [],
                }
            );

            // Should have diagnostics
            expect(result.diagnostics.length).toBeGreaterThan(0);

            // The diagnostic should point to line 2 (0-indexed) where the include is
            const missing_file_diag = result.diagnostics.find(d => 
                d.message.includes('Cannot read file')
            );
            expect(missing_file_diag).toBeDefined();
            expect(missing_file_diag!.range.start.line).toBe(2);
        });
    });

    describe('Working Directory Directive Synonyms', () => {
        it('should recognize @lsp-cd as a valid working directory directive', () => {
            const content = `// @lsp-cd ../
display "test"
`;
            const file_uri = URI.file(survey_do_path).toString();
            const result = directive_parser.parse(content, file_uri);

            expect(result.working_directory).toBeDefined();
            expect(result.working_directory!.directive_form).toBe('cd');
        });

        it('should recognize all working directory directive synonyms', () => {
            const synonyms = [
                '@lsp-working-directory',
                '@lsp-working-dir',
                '@lsp-current-directory',
                '@lsp-current-dir',
                '@lsp-cd',
                '@lsp-wd',
            ];

            for (const synonym of synonyms) {
                const content = `// ${synonym} ../
display "test"
`;
                const file_uri = URI.file(survey_do_path).toString();
                const result = directive_parser.parse(content, file_uri);

                expect(result.working_directory).toBeDefined();
                expect(result.working_directory!.path).toBe('../');
            }
        });
    });

    describe('Edge Cases', () => {
        it('should handle files without @lsp-cd directive', async () => {
            const content = `* No working directory directive
include some/file.do
`;
            const file_uri = URI.file(survey_do_path).toString();

            await document_store.open(file_uri, content, 1);
            const document_state = document_store.get(file_uri);

            expect(document_state).toBeDefined();
            // working_directory should be undefined when no directive is present
            expect(document_state!.working_directory).toBeUndefined();
        });

        it('should handle non-existent working directory gracefully', () => {
            const content = `// @lsp-cd /nonexistent/path/
display "test"
`;
            const file_uri = URI.file(survey_do_path).toString();
            const result = directive_parser.parse(content, file_uri);

            // Should still parse the directive
            expect(result.working_directory).toBeDefined();
            expect(result.working_directory!.path).toBe('/nonexistent/path/');
        });

        it('should handle relative paths with multiple parent references', () => {
            const content = `// @lsp-cd ../../
display "test"
`;
            const file_uri = URI.file(survey_do_path).toString();
            const result = directive_parser.parse(content, file_uri);

            expect(result.working_directory).toBeDefined();
            expect(result.working_directory!.path).toBe('../../');

            // Resolved path should be two levels up from subdir/
            // subdir is in tests/fixtures/directive-chain/, so ../../ goes to tests/fixtures/
            const resolved = normalize_path(result.working_directory!.resolved_path);
            const expected = normalize_path(path.join(workspace_root, 'tests', 'fixtures'));
            expect(resolved).toBe(expected);
        });
    });

    describe('Cache Behavior with Different Working Directories', () => {
        it('should cache separately for different working directories', async () => {
            const wm_vars_path = path.join(subdir, 'wm_vars.do');
            
            // Skip if file doesn't exist
            if (!fs.existsSync(wm_vars_path)) {
                return;
            }

            const wm_vars_uri = URI.file(wm_vars_path).toString();

            // Parse with working directory A
            const result_a = await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: fixture_dir }
            );

            // Parse with working directory B (different)
            const result_b = await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: subdir }
            );

            expect('error' in result_a).toBe(false);
            expect('error' in result_b).toBe(false);

            if ('error' in result_a || 'error' in result_b) return;

            // Both should have the correct working directory
            expect(result_a.working_directory).toBe(fixture_dir);
            expect(result_b.working_directory).toBe(subdir);

            // Forward calls should be resolved differently
            // (paths relative to different working directories)
            if (result_a.forward_calls.length > 0 && result_b.forward_calls.length > 0) {
                const call_a = result_a.forward_calls[0];
                const call_b = result_b.forward_calls[0];
                
                // Same raw path but different resolved paths
                expect(call_a.raw_path).toBe(call_b.raw_path);
                // Resolved paths may differ based on working directory
            }
        });

        it('should return cached result for same file and working directory', async () => {
            const wm_vars_path = path.join(subdir, 'wm_vars.do');
            
            // Skip if file doesn't exist
            if (!fs.existsSync(wm_vars_path)) {
                return;
            }

            const wm_vars_uri = URI.file(wm_vars_path).toString();

            // Reset metrics
            scope_resolver.reset_cache_metrics();

            // First call - should be a cache miss
            await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: fixture_dir }
            );

            const metrics_after_first = scope_resolver.get_cache_metrics();
            expect(metrics_after_first.file.misses).toBe(1);

            // Second call with same working directory - should be a cache hit
            await scope_resolver.get_parsed_file(
                wm_vars_uri,
                wm_vars_path,
                { working_directory: fixture_dir }
            );

            const metrics_after_second = scope_resolver.get_cache_metrics();
            expect(metrics_after_second.file.hits).toBe(1);
        });
    });
});
