/**
 * Integration tests for Forward Call Transitive Invalidation
 *
 * Tests verify that when a callee file changes (e.g., a global macro is removed),
 * all files that transitively depend on the callers via backward directives
 * receive updated diagnostics.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 *
 * **Property 1: Callee Change Propagates to Backward Directive Dependents**
 * For any file A that calls file B via do/run/include, and file C that depends
 * on A via backward directives, when B's interface changes, C shall be included
 * in the set of files to revalidate.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { URI } from 'vscode-uri';
import { create_document_state } from '../property/helpers/document-utils';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { ForwardCall, StataDiagnosticCode } from '../../src/types';

describe('Forward Call Transitive Invalidation Integration Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let diagnostics_provider: DiagnosticsProvider;
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-call-transitive-test-'));

        const content_provider = {
            read_file: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                return fs.promises.readFile(fs_path, 'utf8');
            },
            exists: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                try {
                    await fs.promises.access(fs_path);
                    return true;
                } catch {
                    return false;
                }
            }
        };

        const mock_connection = { sendDiagnostics: () => {} } as any;
        scope_resolver = new ScopeResolver(undefined, content_provider);
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        diagnostics_provider = new DiagnosticsProvider(mock_connection);
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const file_uri = (file_path: string): string => URI.file(file_path).toString();

    const parse_and_analyze = (content: string, uri: string) => {
        const lex_result = lexer.tokenize(content);
        const parse_result = parser.parse(lex_result.tokens);
        const analysis_result = analyzer.analyze(parse_result.ast, uri);
        return { symbols: analysis_result.symbols, ast: parse_result.ast };
    };

    const extract_forward_calls = (content: string, file_path: string): ForwardCall[] => {
        const calls: ForwardCall[] = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^(do|run|include)\s+["']?([^"'\s]+)["']?/);
            if (match) {
                const [, type, raw_path] = match;
                const resolved_path = path.resolve(path.dirname(file_path), raw_path.replace(/\.do$/, '') + '.do');
                if (fs.existsSync(resolved_path)) {
                    calls.push({
                        type: type as 'do' | 'run' | 'include',
                        raw_path,
                        call_site_line: i,
                        range: { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
                        source: 'command',
                        is_static: true,
                    });
                }
            }
        }
        return calls;
    };

    const get_diagnostics_for_file = async (
        file_path: string,
        content: string
    ) => {
        const document = create_document_state(content);
        document.uri = file_uri(file_path);

        return diagnostics_provider.get_diagnostics(
            document,
            DEFAULT_SETTINGS,
            undefined,
            scope_resolver
        );
    };

    describe('Bug scenario: callee change propagates to backward directive dependents', () => {
        /**
         * This test reproduces the exact bug scenario from the requirements:
         *
         * - loop.do calls do "import_metadata.do" (forward call)
         * - loop.do calls do "survey.do" (forward call)
         * - survey.do has @lsp-done-by: loop.do (backward directive)
         * - bh_vars.do has @lsp-included-by: survey.do (backward directive)
         * - import_metadata.do defines global merp
         * - bh_vars.do uses $merp
         *
         * When import_metadata.do is edited to remove global merp:
         * - loop.do should be revalidated (direct caller)
         * - survey.do should be revalidated (depends on loop.do via backward directive)
         * - bh_vars.do should be revalidated (depends on survey.do via backward directive)
         * - bh_vars.do should show "undefined macro" warning for $merp
         */
        test('editing callee propagates to transitive backward directive dependents', async () => {
            // Create the file structure from the bug report
            const import_metadata_content_v1 = `global merp "metadata_value"`;
            const import_metadata_path = write_file('import_metadata.do', import_metadata_content_v1);
            const import_metadata_uri = file_uri(import_metadata_path);

            const loop_content = `do "import_metadata.do"
do "survey.do"`;
            const loop_path = write_file('loop.do', loop_content);
            const loop_uri = file_uri(loop_path);

            const survey_content = `// @lsp-done-by: "loop.do"
local survey_result = "$merp"`;
            const survey_path = write_file('survey.do', survey_content);
            const survey_uri = file_uri(survey_path);

            const bh_vars_content = `// @lsp-included-by: "survey.do"
local bh_result = "$merp"`;
            const bh_vars_path = write_file('bh_vars.do', bh_vars_content);
            const bh_vars_uri = file_uri(bh_vars_path);

            // Set up reverse dependencies for loop.do
            const { symbols: loop_symbols } = parse_and_analyze(loop_content, loop_uri);
            const loop_forward_calls = extract_forward_calls(loop_content, loop_path);
            scope_resolver.update_reverse_dependencies(loop_uri, loop_forward_calls, loop_symbols);

            // Initial diagnostics - bh_vars.do should NOT have undefined warning for merp
            const bh_vars_diagnostics_v1 = await get_diagnostics_for_file(bh_vars_path, bh_vars_content);
            const undefined_merp_v1 = bh_vars_diagnostics_v1.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'merp'
            );
            expect(undefined_merp_v1).toHaveLength(0);

            // Now edit import_metadata.do to remove global merp
            const import_metadata_content_v2 = `global other_macro "different"`;
            fs.writeFileSync(import_metadata_path, import_metadata_content_v2);

            // Simulate what server-factory does when a callee changes:
            // 1. Invalidate file cache for the changed file
            scope_resolver.invalidate_file_cache(import_metadata_uri);

            // 2. Get callers for the callee (import_metadata.do)
            const caller_uris = scope_resolver.get_callers_for_callee(import_metadata_uri);
            expect(caller_uris.has(loop_uri)).toBe(true);

            // 3. For each caller, get transitive backward directive dependents
            // This is the FIX being tested - we now include backward directive dependents
            const all_uris_to_revalidate = new Set<string>(caller_uris);
            for (const my_caller_uri of caller_uris) {
                const backward_dependents = scope_resolver.get_transitive_backward_directive_children(my_caller_uri);
                for (const my_dependent_uri of backward_dependents) {
                    all_uris_to_revalidate.add(my_dependent_uri);
                }
            }

            // Verify that survey.do and bh_vars.do are in the revalidation set
            expect(all_uris_to_revalidate.has(loop_uri)).toBe(true);
            expect(all_uris_to_revalidate.has(survey_uri)).toBe(true);
            expect(all_uris_to_revalidate.has(bh_vars_uri)).toBe(true);

            // 4. Invalidate scope caches for all files to revalidate
            for (const uri of all_uris_to_revalidate) {
                scope_resolver.invalidate_scope_cache(uri);
            }

            // 5. Re-resolve diagnostics - bh_vars.do should now have undefined warning for merp
            const bh_vars_diagnostics_v2 = await get_diagnostics_for_file(bh_vars_path, bh_vars_content);
            const undefined_merp_v2 = bh_vars_diagnostics_v2.filter(d =>
                d.code === StataDiagnosticCode.UNDEFINED_MACRO && (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'merp'
            );
            expect(undefined_merp_v2.length).toBeGreaterThan(0);
        });

        test('multiple callers propagate to all their backward directive dependents', async () => {
            // Create scenario where multiple callers call the same callee
            // and each caller has its own backward directive dependents
            const shared_callee_content_v1 = `global shared_global "value"`;
            const shared_callee_path = write_file('shared_callee.do', shared_callee_content_v1);
            const shared_callee_uri = file_uri(shared_callee_path);

            // Caller A and its dependent
            const caller_a_content = `do "shared_callee.do"`;
            const caller_a_path = write_file('caller_a.do', caller_a_content);
            const caller_a_uri = file_uri(caller_a_path);

            const dependent_a_content = `// @lsp-done-by: "caller_a.do"
local a_result = "$shared_global"`;
            const dependent_a_path = write_file('dependent_a.do', dependent_a_content);
            const dependent_a_uri = file_uri(dependent_a_path);

            // Caller B and its dependent
            const caller_b_content = `do "shared_callee.do"`;
            const caller_b_path = write_file('caller_b.do', caller_b_content);
            const caller_b_uri = file_uri(caller_b_path);

            const dependent_b_content = `// @lsp-done-by: "caller_b.do"
local b_result = "$shared_global"`;
            const dependent_b_path = write_file('dependent_b.do', dependent_b_content);
            const dependent_b_uri = file_uri(dependent_b_path);

            // Set up reverse dependencies
            const { symbols: caller_a_symbols } = parse_and_analyze(caller_a_content, caller_a_uri);
            const caller_a_forward_calls = extract_forward_calls(caller_a_content, caller_a_path);
            scope_resolver.update_reverse_dependencies(caller_a_uri, caller_a_forward_calls, caller_a_symbols);

            const { symbols: caller_b_symbols } = parse_and_analyze(caller_b_content, caller_b_uri);
            const caller_b_forward_calls = extract_forward_calls(caller_b_content, caller_b_path);
            scope_resolver.update_reverse_dependencies(caller_b_uri, caller_b_forward_calls, caller_b_symbols);

            // Initial diagnostics - both dependents should NOT have undefined warnings
            const dependent_a_diagnostics_v1 = await get_diagnostics_for_file(dependent_a_path, dependent_a_content);
            const dependent_b_diagnostics_v1 = await get_diagnostics_for_file(dependent_b_path, dependent_b_content);

            expect(dependent_a_diagnostics_v1.filter(d => (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'shared_global' && d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toHaveLength(0);
            expect(dependent_b_diagnostics_v1.filter(d => (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'shared_global' && d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toHaveLength(0);

            // Edit shared_callee.do to remove the global
            const shared_callee_content_v2 = `global other_global "different"`;
            fs.writeFileSync(shared_callee_path, shared_callee_content_v2);

            // Simulate the fix
            scope_resolver.invalidate_file_cache(shared_callee_uri);
            const caller_uris = scope_resolver.get_callers_for_callee(shared_callee_uri);

            // Both callers should be found
            expect(caller_uris.has(caller_a_uri)).toBe(true);
            expect(caller_uris.has(caller_b_uri)).toBe(true);

            // Expand to include backward directive dependents
            const all_uris_to_revalidate = new Set<string>(caller_uris);
            for (const my_caller_uri of caller_uris) {
                const backward_dependents = scope_resolver.get_transitive_backward_directive_children(my_caller_uri);
                for (const my_dependent_uri of backward_dependents) {
                    all_uris_to_revalidate.add(my_dependent_uri);
                }
            }

            // Both dependents should be in the revalidation set
            expect(all_uris_to_revalidate.has(dependent_a_uri)).toBe(true);
            expect(all_uris_to_revalidate.has(dependent_b_uri)).toBe(true);

            // Invalidate and re-resolve
            for (const uri of all_uris_to_revalidate) {
                scope_resolver.invalidate_scope_cache(uri);
            }

            const dependent_a_diagnostics_v2 = await get_diagnostics_for_file(dependent_a_path, dependent_a_content);
            const dependent_b_diagnostics_v2 = await get_diagnostics_for_file(dependent_b_path, dependent_b_content);

            // Both should now have undefined warnings
            expect(dependent_a_diagnostics_v2.filter(d => (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'shared_global' && d.code === StataDiagnosticCode.UNDEFINED_MACRO).length).toBeGreaterThan(0);
            expect(dependent_b_diagnostics_v2.filter(d => (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'shared_global' && d.code === StataDiagnosticCode.UNDEFINED_MACRO).length).toBeGreaterThan(0);
        });

        test('deep chain: callee -> caller -> backward dep -> backward dep', async () => {
            // Create a deep chain to test transitive propagation
            const callee_content_v1 = `global deep_global "value"`;
            const callee_path = write_file('callee.do', callee_content_v1);
            const callee_uri = file_uri(callee_path);

            const caller_content = `do "callee.do"`;
            const caller_path = write_file('caller.do', caller_content);
            const caller_uri = file_uri(caller_path);

            const level1_content = `// @lsp-done-by: "caller.do"
local level1 = "$deep_global"`;
            const level1_path = write_file('level1.do', level1_content);
            const level1_uri = file_uri(level1_path);

            const level2_content = `// @lsp-done-by: "level1.do"
local level2 = "$deep_global"`;
            const level2_path = write_file('level2.do', level2_content);
            const level2_uri = file_uri(level2_path);

            const level3_content = `// @lsp-done-by: "level2.do"
local level3 = "$deep_global"`;
            const level3_path = write_file('level3.do', level3_content);
            const level3_uri = file_uri(level3_path);

            // Set up reverse dependencies
            const { symbols: caller_symbols } = parse_and_analyze(caller_content, caller_uri);
            const caller_forward_calls = extract_forward_calls(caller_content, caller_path);
            scope_resolver.update_reverse_dependencies(caller_uri, caller_forward_calls, caller_symbols);

            // Initial diagnostics - level3 should NOT have undefined warning
            const level3_diagnostics_v1 = await get_diagnostics_for_file(level3_path, level3_content);
            expect(level3_diagnostics_v1.filter(d => (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'deep_global' && d.code === StataDiagnosticCode.UNDEFINED_MACRO)).toHaveLength(0);

            // Edit callee to remove the global
            const callee_content_v2 = `global other_global "different"`;
            fs.writeFileSync(callee_path, callee_content_v2);

            // Simulate the fix
            scope_resolver.invalidate_file_cache(callee_uri);
            const caller_uris = scope_resolver.get_callers_for_callee(callee_uri);

            const all_uris_to_revalidate = new Set<string>(caller_uris);
            for (const my_caller_uri of caller_uris) {
                const backward_dependents = scope_resolver.get_transitive_backward_directive_children(my_caller_uri);
                for (const my_dependent_uri of backward_dependents) {
                    all_uris_to_revalidate.add(my_dependent_uri);
                }
            }

            // All levels should be in the revalidation set
            expect(all_uris_to_revalidate.has(caller_uri)).toBe(true);
            expect(all_uris_to_revalidate.has(level1_uri)).toBe(true);
            expect(all_uris_to_revalidate.has(level2_uri)).toBe(true);
            expect(all_uris_to_revalidate.has(level3_uri)).toBe(true);

            // Invalidate and re-resolve
            for (const uri of all_uris_to_revalidate) {
                scope_resolver.invalidate_scope_cache(uri);
            }

            const level3_diagnostics_v2 = await get_diagnostics_for_file(level3_path, level3_content);
            expect(level3_diagnostics_v2.filter(d => (d.data as { symbol_name?: string } | undefined)?.symbol_name === 'deep_global' && d.code === StataDiagnosticCode.UNDEFINED_MACRO).length).toBeGreaterThan(0);
        });
    });

    describe('Property 2: No Duplicate Revalidations', () => {
        test('same file reachable through multiple paths is only included once', async () => {
            // Create diamond: callee -> caller_a -> shared_dep, callee -> caller_b -> shared_dep
            const callee_content = `global diamond_global "value"`;
            const callee_path = write_file('callee.do', callee_content);
            const callee_uri = file_uri(callee_path);

            const caller_a_content = `do "callee.do"`;
            const caller_a_path = write_file('caller_a.do', caller_a_content);
            const caller_a_uri = file_uri(caller_a_path);

            const caller_b_content = `do "callee.do"`;
            const caller_b_path = write_file('caller_b.do', caller_b_content);
            const caller_b_uri = file_uri(caller_b_path);

            // shared_dep depends on both caller_a and caller_b
            const shared_dep_content = `// @lsp-done-by: "caller_a.do"
// @lsp-done-by: "caller_b.do"
local result = "$diamond_global"`;
            const shared_dep_path = write_file('shared_dep.do', shared_dep_content);
            const shared_dep_uri = file_uri(shared_dep_path);

            // Set up reverse dependencies
            const { symbols: caller_a_symbols } = parse_and_analyze(caller_a_content, caller_a_uri);
            const caller_a_forward_calls = extract_forward_calls(caller_a_content, caller_a_path);
            scope_resolver.update_reverse_dependencies(caller_a_uri, caller_a_forward_calls, caller_a_symbols);

            const { symbols: caller_b_symbols } = parse_and_analyze(caller_b_content, caller_b_uri);
            const caller_b_forward_calls = extract_forward_calls(caller_b_content, caller_b_path);
            scope_resolver.update_reverse_dependencies(caller_b_uri, caller_b_forward_calls, caller_b_symbols);

            // Resolve shared_dep to register backward directive dependencies
            await scope_resolver.resolve(shared_dep_uri, shared_dep_content);

            // Get callers and expand
            const caller_uris = scope_resolver.get_callers_for_callee(callee_uri);
            expect(caller_uris.has(caller_a_uri)).toBe(true);
            expect(caller_uris.has(caller_b_uri)).toBe(true);

            const all_uris_to_revalidate = new Set<string>(caller_uris);
            for (const my_caller_uri of caller_uris) {
                const backward_dependents = scope_resolver.get_transitive_backward_directive_children(my_caller_uri);
                for (const my_dependent_uri of backward_dependents) {
                    all_uris_to_revalidate.add(my_dependent_uri);
                }
            }

            // shared_dep should only appear once (Set guarantees this)
            const shared_dep_count = Array.from(all_uris_to_revalidate).filter(uri => uri === shared_dep_uri).length;
            expect(shared_dep_count).toBe(1);

            // Total should be 3: caller_a, caller_b, shared_dep
            expect(all_uris_to_revalidate.size).toBe(3);
        });
    });

    describe('Efficient Propagation (Requirement 2)', () => {
        test('uses existing transitive backward directive lookup', async () => {
            // This test verifies that we use the existing get_transitive_backward_directive_children
            // method rather than implementing a new traversal
            const callee_path = write_file('callee.do', `global test_global "value"`);
            const callee_uri = file_uri(callee_path);

            const caller_content = `do "callee.do"`;
            const caller_path = write_file('caller.do', caller_content);
            const caller_uri = file_uri(caller_path);

            const dep_content = `// @lsp-done-by: "caller.do"
local result = "$test_global"`;
            const dep_path = write_file('dep.do', dep_content);
            const dep_uri = file_uri(dep_path);

            // Set up reverse dependencies
            const { symbols: caller_symbols } = parse_and_analyze(caller_content, caller_uri);
            const caller_forward_calls = extract_forward_calls(caller_content, caller_path);
            scope_resolver.update_reverse_dependencies(caller_uri, caller_forward_calls, caller_symbols);

            // Resolve dep to register backward directive dependencies
            await scope_resolver.resolve(dep_uri, dep_content);

            // Verify that get_transitive_backward_directive_children returns the expected result
            const backward_dependents = scope_resolver.get_transitive_backward_directive_children(caller_uri);
            expect(backward_dependents.has(dep_uri)).toBe(true);
        });
    });
});
