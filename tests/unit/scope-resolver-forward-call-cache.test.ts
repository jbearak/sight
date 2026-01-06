/**
 * Unit tests for forward call cache registration feature.
 * Tests that forward call relationships are registered when files are
 * added to the file cache, enabling proper revalidation when callees change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Forward Call Cache Registration', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver(create_test_scope_resolver_logger());
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-call-cache-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const create_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    describe('Property 1: Cache Population Registers Forward Call Relationships', () => {
        it('should register forward call relationships when file is added to cache', async () => {
            // Create files: loop.do calls import_metadata.do and survey.do
            // survey.do has @lsp-done-by: loop.do
            // bh_vars.do has @lsp-included-by: survey.do
            const import_metadata_path = create_file('import_metadata.do', 'global merp = 1');
            const loop_path = create_file('loop.do', `
global setup = 1
do "${import_metadata_path}"
do "survey.do"
`);
            const survey_path = create_file('survey.do', `// @lsp-done-by: "${loop_path}"\nlocal x = 1`);
            const bh_vars_path = create_file('bh_vars.do', `// @lsp-included-by: "${survey_path}"\nlocal y = $merp`);

            const import_metadata_uri = URI.file(import_metadata_path).toString();
            const loop_uri = URI.file(loop_path).toString();
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            // Resolve bh_vars.do - this should:
            // 1. Read survey.do from disk and cache it
            // 2. Read loop.do from disk and cache it
            // 3. Register loop.do's forward calls in callee_to_callers
            await resolver.resolve(bh_vars_uri, fs.readFileSync(bh_vars_path, 'utf8'));

            // Verify forward call relationships are registered
            // get_callers_for_callee(import_metadata.do) should return loop.do
            const callers = resolver.get_callers_for_callee(import_metadata_uri);
            expect(callers.has(loop_uri)).toBe(true);
        });

        it('should register multiple forward call relationships from same caller', async () => {
            // Create files: caller.do calls callee1.do and callee2.do
            const callee1_path = create_file('callee1.do', 'global g1 = 1');
            const callee2_path = create_file('callee2.do', 'global g2 = 2');
            const caller_path = create_file('caller.do', `
do "${callee1_path}"
do "${callee2_path}"
`);
            const child_path = create_file('child.do', `// @lsp-done-by: "${caller_path}"\nlocal x = 1`);

            const callee1_uri = URI.file(callee1_path).toString();
            const callee2_uri = URI.file(callee2_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const child_uri = URI.file(child_path).toString();

            // Resolve child.do - this caches caller.do with its forward calls
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));

            // Both callees should have caller registered
            expect(resolver.get_callers_for_callee(callee1_uri).has(caller_uri)).toBe(true);
            expect(resolver.get_callers_for_callee(callee2_uri).has(caller_uri)).toBe(true);
        });

        it('should skip dynamic paths with macro references', async () => {
            // Create files: caller.do has a dynamic path that can't be resolved
            const callee_path = create_file('callee.do', 'global g = 1');
            const caller_path = create_file('caller.do', `
local path = "some/path"
do "\`path'/callee.do"
`);
            const child_path = create_file('child.do', `// @lsp-done-by: "${caller_path}"\nlocal x = 1`);

            const callee_uri = URI.file(callee_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const child_uri = URI.file(child_path).toString();

            // Resolve child.do
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));

            // Dynamic path should not be registered
            const callers = resolver.get_callers_for_callee(callee_uri);
            expect(callers.has(caller_uri)).toBe(false);
        });
    });

    describe('Property 2: Cache Invalidation Clears Forward Call Relationships', () => {
        it('should clear forward call relationships when file cache is invalidated', async () => {
            // Create files
            const callee_path = create_file('callee.do', 'global g = 1');
            const caller_path = create_file('caller.do', `do "${callee_path}"`);
            const child_path = create_file('child.do', `// @lsp-done-by: "${caller_path}"\nlocal x = 1`);

            const callee_uri = URI.file(callee_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const child_uri = URI.file(child_path).toString();

            // Resolve to populate cache and register relationships
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));
            expect(resolver.get_callers_for_callee(callee_uri).has(caller_uri)).toBe(true);

            // Invalidate caller's file cache
            resolver.invalidate_file_cache(caller_uri);

            // Forward call relationship should be cleared
            expect(resolver.get_callers_for_callee(callee_uri).has(caller_uri)).toBe(false);
        });

        it('should maintain consistency after re-parsing with different forward calls', async () => {
            // Create files
            const callee1_path = create_file('callee1.do', 'global g1 = 1');
            const callee2_path = create_file('callee2.do', 'global g2 = 2');
            const caller_path = create_file('caller.do', `do "${callee1_path}"`);
            const child_path = create_file('child.do', `// @lsp-done-by: "${caller_path}"\nlocal x = 1`);

            const callee1_uri = URI.file(callee1_path).toString();
            const callee2_uri = URI.file(callee2_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const child_uri = URI.file(child_path).toString();

            // First resolve - caller calls callee1
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));
            expect(resolver.get_callers_for_callee(callee1_uri).has(caller_uri)).toBe(true);
            expect(resolver.get_callers_for_callee(callee2_uri).has(caller_uri)).toBe(false);

            // Update caller to call callee2 instead
            const new_caller_content = `do "${callee2_path}"`;
            fs.writeFileSync(caller_path, new_caller_content);

            // Invalidate and re-resolve
            resolver.invalidate_file_cache(caller_uri);
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));

            // Relationships should be updated
            expect(resolver.get_callers_for_callee(callee1_uri).has(caller_uri)).toBe(false);
            expect(resolver.get_callers_for_callee(callee2_uri).has(caller_uri)).toBe(true);
        });
    });

    describe('Property 3: Callee Lookup Finds Cached Callers', () => {
        it('should find callers from cached files that were never opened in editor', async () => {
            // This is the exact scenario from the bug report:
            // - loop.do calls import_metadata.do and survey.do
            // - survey.do has @lsp-done-by: loop.do
            // - bh_vars.do has @lsp-included-by: survey.do
            // - Only bh_vars.do and import_metadata.do are "open" (resolved)
            // - loop.do is only cached (read from disk during scope resolution)

            const import_metadata_path = create_file('import_metadata.do', 'global merp = 1');
            const survey_path_rel = 'survey.do';
            const loop_path = create_file('loop.do', `
global setup = 1
do "${import_metadata_path}"
do "${survey_path_rel}"
`);
            const survey_path = create_file('survey.do', `// @lsp-done-by: "${loop_path}"\nlocal survey_var = 1`);
            const bh_vars_path = create_file('bh_vars.do', `// @lsp-included-by: "${survey_path}"\nlocal result = $merp`);

            const import_metadata_uri = URI.file(import_metadata_path).toString();
            const loop_uri = URI.file(loop_path).toString();
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            // Only resolve bh_vars.do - loop.do is cached but never "opened"
            await resolver.resolve(bh_vars_uri, fs.readFileSync(bh_vars_path, 'utf8'));

            // get_callers_for_callee(import_metadata.do) should return loop.do
            // even though loop.do was never opened in the editor
            const callers = resolver.get_callers_for_callee(import_metadata_uri);
            expect(callers.has(loop_uri)).toBe(true);
        });
    });

    describe('Requirement 2: Consistent Relationship Tracking', () => {
        it('should not create duplicate relationships when file is both cached and opened', async () => {
            // Create files
            const callee_path = create_file('callee.do', 'global g = 1');
            const caller_path = create_file('caller.do', `do "${callee_path}"`);
            const child_path = create_file('child.do', `// @lsp-done-by: "${caller_path}"\nlocal x = 1`);

            const callee_uri = URI.file(callee_path).toString();
            const caller_uri = URI.file(caller_path).toString();
            const child_uri = URI.file(child_path).toString();

            // First, resolve child.do which caches caller.do
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));

            // Then, "open" caller.do by resolving it directly
            await resolver.resolve(caller_uri, fs.readFileSync(caller_path, 'utf8'));

            // Verify there's only one relationship (no duplicates)
            const callers = resolver.get_callers_for_callee(callee_uri);
            expect(callers.size).toBe(1);
            expect(callers.has(caller_uri)).toBe(true);
        });
    });
});
