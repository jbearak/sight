/**
 * Unit tests for transitive backward directive discovery.
 * Tests that backward directive dependencies are registered when files are
 * added to the file cache, enabling transitive dependent discovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Transitive Backward Directive Discovery', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver(create_test_scope_resolver_logger());
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transitive-backward-test-'));
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

    describe('Property 1: Cache Population Registers Dependencies', () => {
        it('should register backward directive dependencies when file is added to cache', async () => {
            // Create a three-file chain: loop.do -> survey.do -> bh_vars.do
            const loop_path = create_file('loop.do', 'global merp = 1');
            const survey_path = create_file('survey.do', `// @lsp-done-by: "${loop_path}"\nlocal x = 1`);
            const bh_vars_path = create_file('bh_vars.do', `// @lsp-included-by: "${survey_path}"\nlocal y = $merp`);

            const loop_uri = URI.file(loop_path).toString();
            const survey_uri = URI.file(survey_path).toString();
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            // Resolve bh_vars.do - this should:
            // 1. Register survey.do -> bh_vars.do (from bh_vars.do's directive)
            // 2. Read survey.do from disk and cache it
            // 3. Register loop.do -> survey.do (from survey.do's cached directives)
            await resolver.resolve(bh_vars_uri, fs.readFileSync(bh_vars_path, 'utf8'));

            // Verify backward directive dependencies are registered
            const survey_children = resolver.get_backward_directive_children(survey_uri);
            expect(survey_children.has(bh_vars_uri)).toBe(true);

            const loop_children = resolver.get_backward_directive_children(loop_uri);
            expect(loop_children.has(survey_uri)).toBe(true);
        });

        it('should register dependencies for files with multiple directives', async () => {
            const parent1_path = create_file('parent1.do', 'global p1 = 1');
            const parent2_path = create_file('parent2.do', 'global p2 = 2');
            const child_path = create_file('child.do', `// @lsp-done-by: "${parent1_path}"\n// @lsp-done-by: "${parent2_path}"\nlocal x = 1`);

            const parent1_uri = URI.file(parent1_path).toString();
            const parent2_uri = URI.file(parent2_path).toString();
            const child_uri = URI.file(child_path).toString();

            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));

            // Both parent relationships should be registered
            expect(resolver.get_backward_directive_children(parent1_uri).has(child_uri)).toBe(true);
            expect(resolver.get_backward_directive_children(parent2_uri).has(child_uri)).toBe(true);
        });
    });

    describe('Property 2: Transitive Discovery Uses Cached Relationships', () => {
        it('should find transitive dependents through cached intermediate files', async () => {
            // Create chain: a.do -> b.do -> c.do
            const a_path = create_file('a.do', 'global from_a = 1');
            const b_path = create_file('b.do', `// @lsp-done-by: "${a_path}"\nglobal from_b = 2`);
            const c_path = create_file('c.do', `// @lsp-done-by: "${b_path}"\nlocal x = $from_a`);

            const a_uri = URI.file(a_path).toString();
            const b_uri = URI.file(b_path).toString();
            const c_uri = URI.file(c_path).toString();

            // Only open c.do - b.do is read from disk and cached
            await resolver.resolve(c_uri, fs.readFileSync(c_path, 'utf8'));

            // get_transitive_backward_directive_children(a.do) should return both b.do and c.do
            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);
            expect(transitive_children.has(b_uri)).toBe(true);
            expect(transitive_children.has(c_uri)).toBe(true);
        });

        it('should handle diamond dependency patterns', async () => {
            // Diamond: a.do -> b.do, a.do -> c.do, b.do -> d.do, c.do -> d.do
            const a_path = create_file('a.do', 'global from_a = 1');
            const b_path = create_file('b.do', `// @lsp-done-by: "${a_path}"\nglobal from_b = 2`);
            const c_path = create_file('c.do', `// @lsp-done-by: "${a_path}"\nglobal from_c = 3`);
            const d_path = create_file('d.do', `// @lsp-done-by: "${b_path}"\n// @lsp-done-by: "${c_path}"\nlocal x = 1`);

            const a_uri = URI.file(a_path).toString();
            const b_uri = URI.file(b_path).toString();
            const c_uri = URI.file(c_path).toString();
            const d_uri = URI.file(d_path).toString();

            // Only open d.do
            await resolver.resolve(d_uri, fs.readFileSync(d_path, 'utf8'));

            // get_transitive_backward_directive_children(a.do) should return b.do, c.do, and d.do
            const transitive_children = resolver.get_transitive_backward_directive_children(a_uri);
            expect(transitive_children.has(b_uri)).toBe(true);
            expect(transitive_children.has(c_uri)).toBe(true);
            expect(transitive_children.has(d_uri)).toBe(true);
        });
    });

    describe('Property 3: Cache Invalidation Clears Dependencies', () => {
        it('should clear backward directive dependencies when file cache is invalidated', async () => {
            const parent_path = create_file('parent.do', 'global p = 1');
            const child_path = create_file('child.do', `// @lsp-done-by: "${parent_path}"\nlocal x = 1`);

            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();

            // Resolve to populate cache and register dependencies
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));
            expect(resolver.get_backward_directive_children(parent_uri).has(child_uri)).toBe(true);

            // Invalidate child's file cache
            resolver.invalidate_file_cache(child_uri);

            // Dependency should be cleared
            expect(resolver.get_backward_directive_children(parent_uri).has(child_uri)).toBe(false);
        });

        it('should maintain consistency after re-parsing with different directives', async () => {
            const parent1_path = create_file('parent1.do', 'global p1 = 1');
            const parent2_path = create_file('parent2.do', 'global p2 = 2');
            const child_path = create_file('child.do', `// @lsp-done-by: "${parent1_path}"\nlocal x = 1`);

            const parent1_uri = URI.file(parent1_path).toString();
            const parent2_uri = URI.file(parent2_path).toString();
            const child_uri = URI.file(child_path).toString();

            // First resolve - depends on parent1
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));
            expect(resolver.get_backward_directive_children(parent1_uri).has(child_uri)).toBe(true);
            expect(resolver.get_backward_directive_children(parent2_uri).has(child_uri)).toBe(false);

            // Update child to depend on parent2 instead
            const new_content = `// @lsp-done-by: "${parent2_path}"\nlocal x = 1`;
            fs.writeFileSync(child_path, new_content);

            // Invalidate and re-resolve
            resolver.invalidate_file_cache(child_uri);
            await resolver.resolve(child_uri, new_content);

            // Dependencies should be updated
            expect(resolver.get_backward_directive_children(parent1_uri).has(child_uri)).toBe(false);
            expect(resolver.get_backward_directive_children(parent2_uri).has(child_uri)).toBe(true);
        });
    });

    describe('Integration: End-to-End Transitive Revalidation', () => {
        it('should enable revalidation of leaf files when root file changes', async () => {
            // Scenario from the bug report:
            // loop.do defines global merp
            // survey.do has @lsp-done-by: loop.do
            // bh_vars.do has @lsp-included-by: survey.do and uses $merp

            const loop_path = create_file('loop.do', 'global merp = 1');
            const survey_path = create_file('survey.do', `// @lsp-done-by: "${loop_path}"\nlocal survey_var = 1`);
            const bh_vars_path = create_file('bh_vars.do', `// @lsp-included-by: "${survey_path}"\nlocal result = $merp`);

            const loop_uri = URI.file(loop_path).toString();
            const bh_vars_uri = URI.file(bh_vars_path).toString();

            // Open only bh_vars.do (survey.do is cached but not opened)
            const result = await resolver.resolve(bh_vars_uri, fs.readFileSync(bh_vars_path, 'utf8'));

            // Should have resolved $merp from loop.do
            expect(result.symbols.globalMacros.has('merp')).toBe(true);

            // Now get transitive dependents of loop.do
            const transitive_children = resolver.get_transitive_backward_directive_children(loop_uri);

            // Should include bh_vars.do (through survey.do)
            expect(transitive_children.has(bh_vars_uri)).toBe(true);
        });

        it('should not include files that are not in cache or map', async () => {
            const parent_path = create_file('parent.do', 'global p = 1');
            const child_path = create_file('child.do', `// @lsp-done-by: "${parent_path}"\nlocal x = 1`);

            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();

            // Resolve child to register dependency
            await resolver.resolve(child_uri, fs.readFileSync(child_path, 'utf8'));

            // Create a new file that references parent but is never opened or cached
            const unrelated_path = create_file('unrelated.do', `// @lsp-done-by: "${parent_path}"\nlocal y = 2`);
            const unrelated_uri = URI.file(unrelated_path).toString();

            // Transitive children should NOT include unrelated.do (not in cache)
            const transitive_children = resolver.get_transitive_backward_directive_children(parent_uri);
            expect(transitive_children.has(child_uri)).toBe(true);
            expect(transitive_children.has(unrelated_uri)).toBe(false);
        });
    });
});
