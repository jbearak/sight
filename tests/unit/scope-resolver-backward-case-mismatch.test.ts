/**
 * Tests for path_case_mismatch diagnostics emitted by ScopeResolver when
 * backward header directives (@lsp-done-by, @lsp-included-by) reference a
 * parent file by a path whose casing differs from the on-disk name.
 *
 * Acceptance criteria (from task-8 brief):
 * (a) Wrong-cased @lsp-done-by / @lsp-included-by → resolves the parent's
 *     symbols into scope AND emits EXACTLY ONE backward-worded
 *     path_case_mismatch diagnostic.  Message must:
 *       - mention the raw path and the real on-disk name.
 *       - NOT contain "Stata will" / "execute" (backward directives are
 *         LSP hints; Stata never executes them).
 * (b) Ambiguous (two case-insensitive matches) → parent unresolved, NO
 *     path_case_mismatch.
 * (c) Invalidation (M3): a case-only parent registers under the real-cased
 *     URI; correcting the directive (or editing the parent) invalidates the
 *     right cache entry.
 *
 * Strategy: inject a RichResolveFs into ScopeResolver so tests are
 * host-filesystem-regime independent.  Real files are written to a temp
 * dir so the default content provider can read them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { StataDiagnosticCode } from '../../src/types';
import { URI } from 'vscode-uri';
import type { RichResolveFs } from '../../src/utils/file-path-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function to_uri(fs_path: string): string {
    return URI.file(fs_path).toString();
}

/**
 * Build a RichResolveFs backed by real Node fs, with per-directory
 * overrides that simulate case-sensitive on-disk naming different from
 * what the source writes.
 */
function make_patched_fs(
    overrides: Map<string, Array<{ name: string; is_file: boolean }>>,
): RichResolveFs {
    return {
        readdirSync(dir: string, _opts: { withFileTypes: true }) {
            const my_norm = path.normalize(dir);
            for (const [my_dir, my_entries] of overrides) {
                if (path.normalize(my_dir) === my_norm) {
                    return my_entries.map(e => ({
                        name: e.name,
                        isFile:         () => e.is_file,
                        isDirectory:    () => !e.is_file,
                        isSymbolicLink: () => false,
                    }));
                }
            }
            return fs.readdirSync(dir, { withFileTypes: true }) as Array<{
                name: string;
                isFile(): boolean;
                isDirectory(): boolean;
                isSymbolicLink(): boolean;
            }>;
        },
        existsSync(p: string) {
            return fs.existsSync(p);
        },
        statSync(p: string) {
            return fs.statSync(p);
        },
    };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe(
    'ScopeResolver backward directives — path_case_mismatch',
    () => {
        let scope_resolver: ScopeResolver;
        let forward_resolver: ForwardScopeResolver;
        let temp_dir: string;

        beforeEach(() => {
            temp_dir = fs.mkdtempSync(
                path.join(os.tmpdir(), 'sr-bwd-case-'),
            );
            scope_resolver = new ScopeResolver();
            forward_resolver = new ForwardScopeResolver(scope_resolver);
            scope_resolver.set_forward_scope_resolver(forward_resolver);
            scope_resolver.set_workspace_roots([temp_dir]);
        });

        afterEach(() => {
            fs.rmSync(temp_dir, { recursive: true, force: true });
        });

        function write_file(rel: string, content: string): string {
            const full = path.join(temp_dir, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content);
            return full;
        }

        // ─── (a) Wrong-cased @lsp-done-by ─────────────────────────────────

        describe(
            '(a) wrong-cased @lsp-done-by resolves parent + emits one ' +
                'backward-worded path_case_mismatch',
            () => {
                it(
                    'resolves parent symbols and emits exactly one ' +
                        'path_case_mismatch with correct wording',
                    async () => {
                        // On-disk: parent.do (lowercase p); directive uses
                        // "Parent.do" (uppercase P).
                        const parent_path = write_file(
                            'parent.do',
                            'global from_parent = 1\n',
                        );
                        // Directive references wrong casing
                        const child_content =
                            '// @lsp-done-by: "Parent.do"\n' +
                            'display $from_parent\n';
                        const child_path = write_file(
                            'child.do',
                            child_content,
                        );
                        const child_uri = to_uri(child_path);

                        // Inject fs: temp_dir lists 'parent.do' (real casing)
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(temp_dir, [
                            { name: 'parent.do', is_file: true },
                            { name: 'child.do', is_file: true },
                        ]);
                        scope_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );

                        const result = await scope_resolver.resolve(
                            child_uri,
                            child_content,
                        );

                        // Exactly one path_case_mismatch
                        const the_case_diags = result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        expect(the_case_diags).toHaveLength(1);
                        const the_diag = the_case_diags[0]!;

                        // Structured fields
                        expect(the_diag.code).toBe(
                            StataDiagnosticCode.PATH_CASE_MISMATCH,
                        );

                        // Message must show raw path and real-cased name
                        expect(the_diag.message).toContain('Parent.do');
                        expect(the_diag.message).toContain('parent.do');

                        // Backward directive: NO execution claim
                        expect(the_diag.message).not.toContain('Stata will');
                        expect(the_diag.message).not.toContain('execute');

                        // Range must point to the directive line (line 0)
                        expect(the_diag.range.start.line).toBe(0);

                        // Parent symbols should be in scope (no cascade)
                        const the_chain = result.chain;
                        const the_parent_entry = the_chain.find(
                            e => e.uri === to_uri(parent_path),
                        );
                        expect(the_parent_entry).toBeDefined();
                    },
                );

                it(
                    'works for wrong-cased @lsp-included-by too',
                    async () => {
                        const parent_path = write_file(
                            'lib.do',
                            'local from_lib = 1\n',
                        );
                        const child_content =
                            '// @lsp-included-by: "Lib.do"\n' +
                            'display $from_lib\n';
                        const child_path = write_file(
                            'child.do',
                            child_content,
                        );
                        const child_uri = to_uri(child_path);

                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(temp_dir, [
                            { name: 'lib.do', is_file: true },
                            { name: 'child.do', is_file: true },
                        ]);
                        scope_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );

                        const result = await scope_resolver.resolve(
                            child_uri,
                            child_content,
                        );

                        const the_case_diags = result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        expect(the_case_diags).toHaveLength(1);

                        // No execution claim in message
                        expect(the_case_diags[0]!.message).not.toContain(
                            'Stata will',
                        );
                        expect(the_case_diags[0]!.message).not.toContain(
                            'execute',
                        );
                        // Shows both raw and real-cased paths
                        expect(the_case_diags[0]!.message).toContain('Lib.do');
                        expect(the_case_diags[0]!.message).toContain('lib.do');

                        // The parent (lib.do) must be connected: its entry
                        // appears in the chain and its local macro is visible.
                        const the_parent_uri = to_uri(parent_path);
                        const the_parent_entry = result.chain.find(
                            e => e.uri === the_parent_uri,
                        );
                        expect(the_parent_entry).toBeDefined();
                        // included-by inherits locals — from_lib must be in
                        // the merged symbol table.
                        expect(
                            result.symbols.localMacros.has('from_lib'),
                        ).toBe(true);
                    },
                );

                it(
                    'does not emit path_case_mismatch when casing is correct',
                    async () => {
                        const parent_path = write_file(
                            'parent.do',
                            'global g = 1\n',
                        );
                        const child_content =
                            `// @lsp-done-by: "${parent_path}"\n` +
                            'display $g\n';
                        const child_path = write_file(
                            'child.do',
                            child_content,
                        );
                        const child_uri = to_uri(child_path);

                        const result = await scope_resolver.resolve(
                            child_uri,
                            child_content,
                        );

                        const the_case_diags = result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        expect(the_case_diags).toHaveLength(0);
                    },
                );
            },
        );

        // ─── (b) Ambiguous → no path_case_mismatch ────────────────────────

        describe(
            '(b) ambiguous case-insensitive matches → unresolved, NO ' +
                'path_case_mismatch',
            () => {
                it(
                    'emits no path_case_mismatch when two ci matches exist',
                    async () => {
                        // Two files whose names both case-insensitively match
                        // the directive path "HELPER.do" (but neither matches
                        // it exactly), forcing resolve_path_rich to return
                        // 'ambiguous'.
                        const helper_lower_path = write_file(
                            'helper.do',
                            'global a = 1\n',
                        );
                        const helper_upper_path = write_file(
                            'Helper.do',
                            'global a = 2\n',
                        );

                        // Directive uses "HELPER.do" — no exact match in the
                        // injected listing, so two ci matches → ambiguous.
                        const child_content =
                            '// @lsp-done-by: "HELPER.do"\n' +
                            'display $a\n';
                        const child_path = write_file(
                            'child.do',
                            child_content,
                        );
                        const child_uri = to_uri(child_path);

                        // Inject fs that returns BOTH 'helper.do' and
                        // 'Helper.do' so resolve_path_rich sees ambiguous.
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(temp_dir, [
                            { name: 'helper.do', is_file: true },
                            { name: 'Helper.do', is_file: true },
                            { name: 'child.do', is_file: true },
                        ]);
                        scope_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );

                        const result = await scope_resolver.resolve(
                            child_uri,
                            child_content,
                        );

                        const the_case_diags = result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        // Ambiguous → no path_case_mismatch
                        expect(the_case_diags).toHaveLength(0);

                        // Regression for CodeRabbit #6 / #10:
                        // Ambiguous → neither candidate must be selected as
                        // parent.  The chain must NOT include either helper.do
                        // or Helper.do, and 'a' (defined only in those files)
                        // must NOT appear in the merged symbol table.
                        const the_helper_lower_uri = to_uri(helper_lower_path);
                        const the_helper_upper_uri = to_uri(helper_upper_path);
                        const the_chain_uris = result.chain.map(e => e.uri);
                        expect(the_chain_uris).not.toContain(
                            the_helper_lower_uri,
                        );
                        expect(the_chain_uris).not.toContain(
                            the_helper_upper_uri,
                        );
                        expect(result.symbols.globalMacros.has('a')).toBe(
                            false,
                        );
                    },
                );
            },
        );

        // ─── (c) M3 invalidation ──────────────────────────────────────────

        describe(
            '(c) M3: case-only parent registers under real-cased URI; ' +
                'correct-cased edit invalidates the right cache entry',
            () => {
                it(
                    'backward_directive_children key is the real-cased URI, ' +
                        'not the as-typed URI',
                    async () => {
                        // On-disk: parent.do; directive uses "Parent.do"
                        const parent_path = write_file(
                            'parent.do',
                            'global p = 1\n',
                        );
                        const child_content =
                            '// @lsp-done-by: "Parent.do"\n';
                        const child_path = write_file(
                            'child.do',
                            child_content,
                        );
                        const child_uri = to_uri(child_path);
                        const real_parent_uri = to_uri(parent_path);
                        const wrong_parent_uri = to_uri(
                            path.join(temp_dir, 'Parent.do'),
                        );

                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(temp_dir, [
                            { name: 'parent.do', is_file: true },
                            { name: 'child.do', is_file: true },
                        ]);
                        scope_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );

                        // Resolve to populate backward_directive_children
                        await scope_resolver.resolve(child_uri, child_content);

                        // The real-cased URI must be registered
                        const the_children_real =
                            scope_resolver.get_backward_directive_children(
                                real_parent_uri,
                            );
                        expect(the_children_real.has(child_uri)).toBe(true);

                        // The wrong-cased URI must NOT be registered
                        const the_children_wrong =
                            scope_resolver.get_backward_directive_children(
                                wrong_parent_uri,
                            );
                        expect(the_children_wrong.has(child_uri)).toBe(false);
                    },
                );

                it(
                    'invalidating by real-cased URI removes the dependent ' +
                        'scope-cache entry',
                    async () => {
                        const parent_path = write_file(
                            'parent.do',
                            'global p = 1\n',
                        );
                        const child_content =
                            '// @lsp-done-by: "Parent.do"\n' +
                            'display $p\n';
                        const child_path = write_file(
                            'child.do',
                            child_content,
                        );
                        const child_uri = to_uri(child_path);
                        const real_parent_uri = to_uri(parent_path);

                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(temp_dir, [
                            { name: 'parent.do', is_file: true },
                            { name: 'child.do', is_file: true },
                        ]);
                        scope_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );

                        // First resolve (populates scope cache)
                        await scope_resolver.resolve(child_uri, child_content);
                        scope_resolver.reset_cache_metrics();

                        // Invalidate by the real-cased parent URI
                        scope_resolver.invalidate_scope_cache(real_parent_uri);

                        const the_metrics = scope_resolver.get_cache_metrics();
                        // At least one scope cache entry should have been
                        // invalidated
                        expect(the_metrics.scope.invalidations).toBeGreaterThan(0);
                    },
                );
            },
        );
    },
);
