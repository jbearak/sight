/**
 * Integration tests for parent forward call inheritance.
 *
 * Tests the full resolution chain where a child file uses @lsp-done-by
 * to reference a parent file, and the parent file has forward calls
 * (do/run/include) that execute before calling the child.
 *
 * This mimics the real-world fertility_surveys structure:
 * - survey.do has @lsp-done-by loop.do
 * - loop.do has `run programs.do` before calling survey.do
 * - programs.do defines `global aww_programs_are_ready 1`
 * - survey.do uses `${aww_programs_are_ready}` which should be recognized
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Parent Forward Call Inheritance Integration', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-forward-integration-'));
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

    const to_uri = (file_path: string): string => {
        return `file://${file_path}`;
    };

    describe('fertility_surveys-like structure', () => {
        it('should recognize global from programs.do in survey.do via loop.do', async () => {
            // Create programs.do that defines a global
            const programs_path = create_file('programs.do', `
* Programs file
global aww_programs_are_ready 1
`);

            // Create loop.do that runs programs.do before calling survey.do
            const loop_content = `
* Loop file
run "${programs_path}"
do "survey.do"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
if ( "\${aww_programs_are_ready}" != "1" ) {
    display "Programs not ready"
}
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have aww_programs_are_ready from programs.do
            expect(result.symbols.globalMacros.has('aww_programs_are_ready')).toBe(true);
        });

        it('should handle nested forward calls (programs.do -> helper.do)', async () => {
            // Create helper.do that defines a global
            const helper_path = create_file('helper.do', `
* Helper file
global helper_global = "from helper"
`);

            // Create programs.do that runs helper.do and defines its own global
            const programs_content = `
* Programs file
run "${helper_path}"
global aww_programs_are_ready 1
`;
            const programs_path = create_file('programs.do', programs_content);

            // Create loop.do that runs programs.do before calling survey.do
            const loop_content = `
* Loop file
run "${programs_path}"
do "survey.do"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
display "\${aww_programs_are_ready}"
display "\${helper_global}"
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have both globals
            expect(result.symbols.globalMacros.has('aww_programs_are_ready')).toBe(true);
            expect(result.symbols.globalMacros.has('helper_global')).toBe(true);
        });

        it('should NOT include globals from forward calls after the call site', async () => {
            // Create programs.do that defines a global
            const programs_path = create_file('programs.do', `
* Programs file
global aww_programs_are_ready 1
`);

            // Create cleanup.do that defines a global (called after survey.do)
            const cleanup_path = create_file('cleanup.do', `
* Cleanup file
global cleanup_done 1
`);

            // Create loop.do that runs programs.do before survey.do, and cleanup.do after
            const loop_content = `
* Loop file
run "${programs_path}"
do "survey.do"
run "${cleanup_path}"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
display "\${aww_programs_are_ready}"
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have aww_programs_are_ready (before call site)
            expect(result.symbols.globalMacros.has('aww_programs_are_ready')).toBe(true);
            // Should NOT have cleanup_done (after call site)
            expect(result.symbols.globalMacros.has('cleanup_done')).toBe(false);
        });
    });

    describe('working directory context', () => {
        it('should resolve forward call paths using parent working directory', async () => {
            // Create subdirectory structure
            const subdir = path.join(temp_dir, 'subdir');
            fs.mkdirSync(subdir, { recursive: true });

            // Create programs.do in root
            const programs_path = create_file('programs.do', `
* Programs file
global programs_loaded 1
`);

            // Create loop.do in subdir with @lsp-cd to parent
            const loop_content = `// @lsp-cd ../
* Loop file
run "programs.do"
do "subdir/survey.do"
`;
            const loop_path = create_file('subdir/loop.do', loop_content);

            // Create survey.do in subdir with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
display "\${programs_loaded}"
`;
            const survey_path = create_file('subdir/survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have programs_loaded from programs.do (resolved via working directory)
            expect(result.symbols.globalMacros.has('programs_loaded')).toBe(true);
        });
    });

    describe('inheritance rules', () => {
        it('should exclude locals from forward calls when using @lsp-done-by', async () => {
            // Create programs.do with both local and global
            const programs_path = create_file('programs.do', `
* Programs file
global programs_global = "global"
local programs_local = "local"
`);

            // Create loop.do that runs programs.do before calling survey.do
            const loop_content = `
* Loop file
run "${programs_path}"
do "survey.do"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have global
            expect(result.symbols.globalMacros.has('programs_global')).toBe(true);
            // Should NOT have local (done-by + run both exclude locals)
            expect(result.symbols.localMacros.has('programs_local')).toBe(false);
        });

        it('should include locals from forward calls when using @lsp-included-by with include', async () => {
            // Create programs.do with both local and global
            const programs_path = create_file('programs.do', `
* Programs file
global programs_global = "global"
local programs_local = "local"
`);

            // Create loop.do that includes programs.do before including survey.do
            const loop_content = `
* Loop file
include "${programs_path}"
include "survey.do"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-included-by loop.do
            const survey_content = `// @lsp-included-by: "${loop_path}" match="survey.do"
* Survey file
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have both global and local
            expect(result.symbols.globalMacros.has('programs_global')).toBe(true);
            expect(result.symbols.localMacros.has('programs_local')).toBe(true);
        });
    });

    describe('error handling', () => {
        it('should handle missing forward call target gracefully', async () => {
            // Create loop.do that runs a non-existent file before calling survey.do
            const loop_content = `
* Loop file
run "nonexistent.do"
do "survey.do"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have a diagnostic about the missing file
            const missing_diagnostics = result.diagnostics.filter(
                d => d.message.includes('Cannot read file') && d.message.includes('nonexistent')
            );
            expect(missing_diagnostics.length).toBeGreaterThan(0);
        });

        it('should handle circular forward calls gracefully', async () => {
            // Create a.do that calls b.do
            const b_path = path.join(temp_dir, 'b.do');
            const a_content = `
* A file
global a_global = "from a"
do "${b_path}"
`;
            const a_path = create_file('a.do', a_content);

            // Create b.do that calls a.do (circular)
            const b_content = `
* B file
global b_global = "from b"
do "${a_path}"
`;
            create_file('b.do', b_content);

            // Create loop.do that runs a.do before calling survey.do
            const loop_content = `
* Loop file
run "${a_path}"
do "survey.do"
`;
            const loop_path = create_file('loop.do', loop_content);

            // Create survey.do with @lsp-done-by loop.do
            const survey_content = `// @lsp-done-by: "${loop_path}" match="survey.do"
* Survey file
`;
            const survey_path = create_file('survey.do', survey_content);
            const survey_uri = to_uri(survey_path);

            const result = await scope_resolver.resolve(survey_uri, survey_content);

            // Should have globals from both a.do and b.do (before cycle is detected)
            expect(result.symbols.globalMacros.has('a_global')).toBe(true);
            expect(result.symbols.globalMacros.has('b_global')).toBe(true);

            // Cycles should be handled gracefully without emitting diagnostics
            // Expected cycles occur when backward resolution leads to a parent, then forward resolution encounters the original file
            const cycle_diagnostics = result.diagnostics.filter(
                d => d.message.toLowerCase().includes('circular') || d.message.toLowerCase().includes('cycle')
            );
            expect(cycle_diagnostics.length).toBe(0);
        });
    });
});
