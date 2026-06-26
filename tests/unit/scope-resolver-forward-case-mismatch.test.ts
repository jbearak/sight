/**
 * Production-path tests for path_case_mismatch diagnostics via
 * ScopeResolver.resolve() — the real LSP entry point.
 *
 * These tests cover the wiring defect where diagnostic_owner_uri was never
 * set when ScopeResolver drove ForwardScopeResolver.resolve(), causing the
 * single-emission guard to suppress ALL path_case_mismatch diagnostics.
 *
 * Acceptance criteria:
 * (1) A document whose OWN source contains a case-only do/run/include emits
 *     EXACTLY ONE path_case_mismatch when resolved through ScopeResolver.
 * (2) Grandparent→parent→child chain where the GRANDPARENT has a case-only
 *     `do`:
 *     - diagnosing grandparent → 1 path_case_mismatch
 *     - diagnosing parent     → 0 path_case_mismatch
 *     - diagnosing child      → 0 path_case_mismatch
 *
 * Strategy: inject a RichResolveFs into ForwardScopeResolver that reports
 * different-cased on-disk entries for a target directory, so tests are
 * host-filesystem-regime independent.  Real files are written to a temp dir
 * so ScopeResolver's content provider can read them.
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

function to_uri(file_path: string): string {
    return URI.file(file_path).toString();
}

/**
 * Minimal RichResolveFs backed by real Node fs, with per-directory overrides
 * to simulate a case-sensitive on-disk layout that differs from what the
 * source code references.
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe(
    'ScopeResolver production path — path_case_mismatch via forward calls',
    () => {
        let scope_resolver: ScopeResolver;
        let forward_resolver: ForwardScopeResolver;
        let temp_dir: string;

        beforeEach(() => {
            temp_dir = fs.mkdtempSync(
                path.join(os.tmpdir(), 'sr-case-mismatch-'),
            );
            scope_resolver = new ScopeResolver();
            forward_resolver = new ForwardScopeResolver(scope_resolver);
            scope_resolver.set_forward_scope_resolver(forward_resolver);
        });

        afterEach(() => {
            fs.rmSync(temp_dir, { recursive: true, force: true });
        });

        function write_file(rel_path: string, content: string): string {
            const full_path = path.join(temp_dir, rel_path);
            fs.mkdirSync(path.dirname(full_path), { recursive: true });
            fs.writeFileSync(full_path, content);
            return full_path;
        }

        // ─── (1) own case-only call → exactly one diagnostic ─────────────────

        describe(
            '(1) own source with case-only do: emits exactly one ' +
                'path_case_mismatch via ScopeResolver.resolve()',
            () => {
                it(
                    'resolves the callee symbols and emits exactly one ' +
                        'path_case_mismatch in result.diagnostics',
                    async () => {
                        // On-disk: helpers/Clean.do; source code: do helpers/clean
                        write_file('helpers/Clean.do', 'global from_clean = 1\n');
                        const helpers_dir = path.join(temp_dir, 'helpers');

                        // Caller references the wrong-cased path
                        const caller_content = 'do helpers/clean\n';
                        const caller_path = write_file(
                            'main.do',
                            caller_content,
                        );
                        const caller_uri = to_uri(caller_path);

                        // Inject fs: helpers_dir lists Clean.do (real casing)
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        forward_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );
                        forward_resolver.set_workspace_roots([temp_dir]);

                        // Drive via ScopeResolver — the production entry point
                        const result = await scope_resolver.resolve(
                            caller_uri,
                            caller_content,
                        );

                        // Callee symbols must resolve (no undefined cascade)
                        // forward_call_symbols carries the callee's symbols
                        const the_case_diags = result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        // EXACTLY one path_case_mismatch — the guard must fire
                        expect(the_case_diags).toHaveLength(1);
                        expect(the_case_diags[0]!.code).toBe(
                            StataDiagnosticCode.PATH_CASE_MISMATCH,
                        );
                        expect(the_case_diags[0]!.severity).toBe('warning');
                        // Call-site range must point to line 0
                        expect(the_case_diags[0]!.range.start.line).toBe(0);

                        // No spurious missing-file diagnostic for the same
                        // path (case-only paths DO resolve)
                        const the_missing_diags = result.diagnostics.filter(
                            d =>
                                d.kind === 'missing_file' &&
                                d.message.includes('helpers/clean'),
                        );
                        expect(the_missing_diags).toHaveLength(0);
                    },
                );
            },
        );

        // ─── (2) grandparent→parent→child chain ──────────────────────────────

        describe(
            '(2) chain: grandparent has case-only do; diagnostic only when ' +
                'grandparent is diagnosed',
            () => {
                /**
                 * Layout:
                 *   grandparent.do  → `do helpers/clean`  (case-only mismatch)
                 *   parent.do       → `do grandparent.do` (exact)
                 *   child.do        → `do parent.do`      (exact)
                 *
                 * Each file declares @lsp-done-by pointing to its parent so
                 * ScopeResolver knows the backward chain.
                 */

                it(
                    'emits 1 path_case_mismatch when grandparent is the ' +
                        'diagnosed document',
                    async () => {
                        write_file(
                            'helpers/Clean.do',
                            'global clean_sym = 42\n',
                        );
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const gp_path = write_file(
                            'grandparent.do',
                            'do helpers/clean\n',
                        );
                        // parent.do and child.do are created but not needed for
                        // diagnosing grandparent.do directly
                        write_file(
                            'parent.do',
                            `// @lsp-done-by: "${gp_path}"\n`,
                        );

                        // Inject case-only fs override
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        forward_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );
                        forward_resolver.set_workspace_roots([temp_dir]);

                        // Diagnose the grandparent itself
                        const gp_content = fs.readFileSync(gp_path, 'utf8');
                        const gp_uri = to_uri(gp_path);
                        const gp_result = await scope_resolver.resolve(
                            gp_uri,
                            gp_content,
                        );

                        const the_case_diags = gp_result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        // grandparent's own forward call → must emit exactly 1
                        expect(the_case_diags).toHaveLength(1);
                    },
                );

                it(
                    'suppresses path_case_mismatch when parent is the ' +
                        'diagnosed document (grandparent call at depth > 0)',
                    async () => {
                        write_file(
                            'helpers/Clean.do',
                            'global clean_sym = 42\n',
                        );
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const gp_path = write_file(
                            'grandparent.do',
                            'do helpers/clean\n',
                        );
                        const parent_path = write_file(
                            'parent.do',
                            `// @lsp-done-by: "${gp_path}"\nglobal parent_sym = 1\n`,
                        );

                        // Inject case-only fs override
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        forward_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );
                        forward_resolver.set_workspace_roots([temp_dir]);

                        // Diagnose the PARENT — grandparent's case-only call
                        // must NOT appear in parent's diagnostics
                        const parent_content = fs.readFileSync(
                            parent_path,
                            'utf8',
                        );
                        const parent_uri = to_uri(parent_path);
                        const parent_result = await scope_resolver.resolve(
                            parent_uri,
                            parent_content,
                        );

                        const the_case_diags = parent_result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        // grandparent's call is resolved via resolve_parent_forward_calls
                        // which does NOT set diagnostic_owner_uri → suppressed
                        expect(the_case_diags).toHaveLength(0);
                    },
                );

                it(
                    'suppresses path_case_mismatch when child is the ' +
                        'diagnosed document (grandparent call at depth > 0)',
                    async () => {
                        write_file(
                            'helpers/Clean.do',
                            'global clean_sym = 42\n',
                        );
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const gp_path = write_file(
                            'grandparent.do',
                            'do helpers/clean\n',
                        );
                        const parent_path = write_file(
                            'parent.do',
                            `// @lsp-done-by: "${gp_path}"\nglobal parent_sym = 1\n`,
                        );
                        const child_path = write_file(
                            'child.do',
                            `// @lsp-done-by: "${parent_path}"\nglobal child_sym = 2\n`,
                        );

                        // Inject case-only fs override
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        forward_resolver.set_resolve_fs(
                            make_patched_fs(the_overrides),
                        );
                        forward_resolver.set_workspace_roots([temp_dir]);

                        // Diagnose the CHILD — grandparent's case-only call
                        // must NOT appear in child's diagnostics either
                        const child_content = fs.readFileSync(
                            child_path,
                            'utf8',
                        );
                        const child_uri = to_uri(child_path);
                        const child_result = await scope_resolver.resolve(
                            child_uri,
                            child_content,
                        );

                        const the_case_diags = child_result.diagnostics.filter(
                            d => d.kind === 'path_case_mismatch',
                        );
                        // grandparent's call is at depth 2 relative to child
                        // and is suppressed entirely
                        expect(the_case_diags).toHaveLength(0);
                    },
                );
            },
        );

        // ─── (3) M3: forward callee reverse-dep map uses real-cased URI ───────

        describe(
            '(3) M3: case-only forward callee registers under real-cased URI ' +
                'in callee_to_callers; editing real-cased callee invalidates caller',
            () => {
                it(
                    'register_forward_call_relationships_from_cache keys by ' +
                        'real-cased URI, not as-typed URI',
                    async () => {
                        // On-disk: helpers/Clean.do; source: do helpers/clean
                        write_file('helpers/Clean.do', 'global g = 1\n');
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const caller_path = write_file('main.do', '');
                        const caller_uri = to_uri(caller_path);

                        // Real on-disk path/URI (correct casing)
                        const real_callee_path = path.join(
                            temp_dir, 'helpers', 'Clean.do',
                        );
                        const real_callee_uri = to_uri(real_callee_path);

                        // As-typed path/URI (wrong casing in source: clean.do)
                        const wrong_callee_path = path.join(
                            temp_dir, 'helpers', 'clean.do',
                        );
                        const wrong_callee_uri = to_uri(wrong_callee_path);

                        // Inject fs so resolve_path_rich maps clean.do → Clean.do
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        const my_patched_fs = make_patched_fs(the_overrides);
                        scope_resolver.set_resolve_fs(my_patched_fs);
                        scope_resolver.set_workspace_roots([temp_dir]);

                        // Build a ForwardCall as the analyzer would produce it:
                        // raw_path is what the source typed; path is the
                        // pre-joined (wrong-cased) absolute path.
                        const { Range } = await import(
                            'vscode-languageserver'
                        );
                        const my_forward_call = {
                            path: wrong_callee_path,
                            raw_path: 'helpers/clean',
                            is_static: true,
                            type: 'do' as const,
                            call_site_line: 0,
                            range: Range.create(0, 0, 0, 14),
                            source: 'command' as const,
                        };

                        // Register via the private method (same path the
                        // server takes when a callee is parsed from disk).
                        const the_symbols = {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };
                        (scope_resolver as any)
                            .register_forward_call_relationships_from_cache(
                                caller_uri,
                                [my_forward_call],
                                the_symbols,
                            );

                        // callee_to_callers MUST key by the real-cased URI
                        const the_callers_real =
                            scope_resolver.get_callers_for_callee(
                                real_callee_uri,
                            );
                        expect(the_callers_real.has(caller_uri)).toBe(true);

                        // Wrong-cased URI must NOT appear as a callee key
                        const the_callers_wrong =
                            scope_resolver.get_callers_for_callee(
                                wrong_callee_uri,
                            );
                        expect(the_callers_wrong.has(caller_uri)).toBe(false);
                    },
                );

                it(
                    'update_reverse_dependencies keys by real-cased URI so ' +
                        'that invalidating the real callee cascades to caller',
                    async () => {
                        write_file('helpers/Clean.do', 'global g = 1\n');
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const caller_path = write_file('main.do', '');
                        const caller_uri = to_uri(caller_path);
                        const real_callee_path = path.join(
                            temp_dir, 'helpers', 'Clean.do',
                        );
                        const real_callee_uri = to_uri(real_callee_path);
                        const wrong_callee_path = path.join(
                            temp_dir, 'helpers', 'clean.do',
                        );

                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        const my_patched_fs = make_patched_fs(the_overrides);
                        scope_resolver.set_resolve_fs(my_patched_fs);
                        scope_resolver.set_workspace_roots([temp_dir]);

                        const { Range } = await import(
                            'vscode-languageserver'
                        );
                        const my_forward_call = {
                            path: wrong_callee_path,
                            raw_path: 'helpers/clean',
                            is_static: true,
                            type: 'do' as const,
                            call_site_line: 0,
                            range: Range.create(0, 0, 0, 14),
                            source: 'command' as const,
                        };
                        const the_symbols = {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Simulate what the server does on open-document change
                        scope_resolver.update_reverse_dependencies(
                            caller_uri,
                            [my_forward_call],
                            the_symbols,
                        );

                        // callee_to_callers must key by real-cased URI
                        const the_callers_real =
                            scope_resolver.get_callers_for_callee(
                                real_callee_uri,
                            );
                        expect(the_callers_real.has(caller_uri)).toBe(true);

                        // Wrong-cased URI must NOT be a key
                        const the_callers_wrong =
                            scope_resolver.get_callers_for_callee(
                                to_uri(wrong_callee_path),
                            );
                        expect(the_callers_wrong.has(caller_uri)).toBe(false);
                    },
                );

                it(
                    // RB2: stored resolved_uri at registration time is used
                    // for deletion cleanup so a case-only callee is removed
                    // from last_forward_calls even after the file is deleted
                    // (when the filesystem can no longer re-resolve it).
                    'deleting a case-only callee removes its entry from ' +
                        'last_forward_calls (uses stored resolved URI)',
                    async () => {
                        // On-disk: helpers/Clean.do; source: do helpers/clean
                        write_file('helpers/Clean.do', 'global g = 1\n');
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const caller_path = write_file('main.do', '');
                        const caller_uri = to_uri(caller_path);
                        const real_callee_path = path.join(
                            temp_dir, 'helpers', 'Clean.do',
                        );
                        const real_callee_uri = to_uri(real_callee_path);
                        const wrong_callee_path = path.join(
                            temp_dir, 'helpers', 'clean.do',
                        );

                        // Inject fs so resolve_path_rich maps clean.do →
                        // Clean.do (case-only resolution).
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        const my_patched_fs = make_patched_fs(the_overrides);
                        scope_resolver.set_resolve_fs(my_patched_fs);
                        scope_resolver.set_workspace_roots([temp_dir]);

                        const { Range } = await import(
                            'vscode-languageserver'
                        );
                        // ForwardCall with wrong-cased pre-joined path (as the
                        // analyzer produces): raw_path is source-typed,
                        // path is the script-relative pre-join.
                        const my_forward_call = {
                            path: wrong_callee_path,
                            raw_path: 'helpers/clean',
                            is_static: true,
                            type: 'do' as const,
                            call_site_line: 0,
                            range: Range.create(0, 0, 0, 14),
                            source: 'command' as const,
                        };
                        const the_symbols = {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Register via register_forward_call_relationships_from_cache
                        // (same path the server takes after parsing a file from disk).
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (scope_resolver as any)
                            .register_forward_call_relationships_from_cache(
                                caller_uri,
                                [my_forward_call],
                                the_symbols,
                            );

                        // Verify that last_forward_calls was stored with the
                        // real-cased resolved URI (not the wrong-cased path).
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const the_rdeps = (scope_resolver as any).reverse_deps;
                        const pre_stored: Array<{
                            call: unknown;
                            resolved_uri: string;
                        }> = the_rdeps.last_forward_calls.get(caller_uri) ?? [];
                        expect(pre_stored.length).toBeGreaterThanOrEqual(1);
                        const pre_entry = pre_stored.find(
                            e => e.resolved_uri === real_callee_uri,
                        );
                        expect(pre_entry).toBeDefined();

                        // Now simulate callee deletion: override fs to return
                        // no entries for helpers_dir (file is gone from disk).
                        // A re-resolve via the filesystem would now fail to
                        // find 'Clean.do' and return the wrong-cased URI.
                        the_overrides.set(helpers_dir, []);

                        scope_resolver.remove_uri_from_reverse_deps(
                            real_callee_uri,
                        );

                        // After deletion cleanup, last_forward_calls must NOT
                        // contain a stale entry for the deleted callee — it
                        // must have been matched by the stored resolved_uri,
                        // NOT re-resolved from the now-empty filesystem.
                        const post_stored: Array<{
                            call: unknown;
                            resolved_uri: string;
                        }> = the_rdeps.last_forward_calls.get(caller_uri) ?? [];
                        const stale_entry = post_stored.find(
                            e => e.resolved_uri === real_callee_uri,
                        );
                        expect(stale_entry).toBeUndefined();
                    },
                );

                it(
                    // RD1: when a caller removes a case-only forward call via
                    // update_reverse_dependencies (live-edit path), the diff
                    // uses the stored resolved_uri — not a re-resolve from the
                    // filesystem — so callee_to_callers and last_forward_calls
                    // are both cleaned up correctly even after the file is gone.
                    'removing a case-only forward call via ' +
                        'update_reverse_dependencies cleans up maps using ' +
                        'stored resolved URI (no re-resolve of old call)',
                    async () => {
                        // On-disk: helpers/Clean.do; source: do helpers/clean
                        write_file('helpers/Clean.do', 'global g = 1\n');
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const caller_path = write_file('main.do', '');
                        const caller_uri = to_uri(caller_path);
                        const real_callee_path = path.join(
                            temp_dir, 'helpers', 'Clean.do',
                        );
                        const real_callee_uri = to_uri(real_callee_path);
                        const wrong_callee_path = path.join(
                            temp_dir, 'helpers', 'clean.do',
                        );

                        // Inject fs so resolve_path_rich maps clean.do →
                        // Clean.do (case-only resolution).
                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        const my_patched_fs = make_patched_fs(the_overrides);
                        scope_resolver.set_resolve_fs(my_patched_fs);
                        scope_resolver.set_workspace_roots([temp_dir]);

                        const { Range } = await import(
                            'vscode-languageserver'
                        );
                        // ForwardCall with wrong-cased pre-joined path (as the
                        // analyzer produces): raw_path is source-typed,
                        // path is the script-relative pre-join.
                        const my_forward_call = {
                            path: wrong_callee_path,
                            raw_path: 'helpers/clean',
                            is_static: true,
                            type: 'do' as const,
                            call_site_line: 0,
                            range: Range.create(0, 0, 0, 14),
                            source: 'command' as const,
                        };
                        const the_empty_symbols = {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        };

                        // Step 1: register the forward call while callee exists.
                        // This stores the real-cased URI in last_forward_calls.
                        scope_resolver.update_reverse_dependencies(
                            caller_uri,
                            [my_forward_call],
                            the_empty_symbols,
                        );

                        // Confirm callee_to_callers is keyed by real-cased URI.
                        const the_callers_before =
                            scope_resolver.get_callers_for_callee(
                                real_callee_uri,
                            );
                        expect(the_callers_before.has(caller_uri)).toBe(true);

                        // Confirm last_forward_calls carries the real-cased URI.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const the_rdeps = (scope_resolver as any).reverse_deps;
                        const pre_stored: Array<{
                            call: unknown;
                            resolved_uri: string;
                        }> = the_rdeps.last_forward_calls.get(caller_uri) ?? [];
                        expect(
                            pre_stored.some(
                                e => e.resolved_uri === real_callee_uri,
                            ),
                        ).toBe(true);

                        // Step 2: simulate the callee file being deleted from
                        // disk so that any re-resolve attempt returns the wrong-
                        // cased URI (or an unresolved path).
                        the_overrides.set(helpers_dir, []);

                        // Step 3: caller is edited to REMOVE the forward call
                        // (new_forward_calls is empty). update_reverse_dependencies
                        // must use the stored resolved_uri for the old entry, NOT
                        // re-resolve from the now-empty filesystem.
                        scope_resolver.update_reverse_dependencies(
                            caller_uri,
                            [],  // call dropped from source
                            the_empty_symbols,
                        );

                        // callee_to_callers must no longer list this caller.
                        const the_callers_after =
                            scope_resolver.get_callers_for_callee(
                                real_callee_uri,
                            );
                        expect(the_callers_after.has(caller_uri)).toBe(false);

                        // last_forward_calls must be empty (no stale entry).
                        const post_stored: Array<{
                            call: unknown;
                            resolved_uri: string;
                        }> = the_rdeps.last_forward_calls.get(caller_uri) ?? [];
                        expect(post_stored).toHaveLength(0);

                        // caller_to_callees must also have no entry for this
                        // callee (no stale edge under any casing).
                        const callee_map = the_rdeps.caller_to_callees.get(
                            caller_uri,
                        );
                        const has_real = callee_map?.has(real_callee_uri) ?? false;
                        const has_wrong = callee_map?.has(
                            to_uri(wrong_callee_path),
                        ) ?? false;
                        expect(has_real).toBe(false);
                        expect(has_wrong).toBe(false);
                    },
                );

                it(
                    'invalidating by real-cased callee URI removes dependent ' +
                        'scope-cache entries (cascade via dependent_uris)',
                    async () => {
                        // On-disk: helpers/Clean.do; source: do helpers/clean
                        write_file('helpers/Clean.do', 'global g = 1\n');
                        const helpers_dir = path.join(temp_dir, 'helpers');
                        const caller_content = 'do helpers/clean\n';
                        const caller_path = write_file(
                            'main.do',
                            caller_content,
                        );
                        const caller_uri = to_uri(caller_path);
                        const real_callee_path = path.join(
                            temp_dir, 'helpers', 'Clean.do',
                        );
                        const real_callee_uri = to_uri(real_callee_path);

                        const the_overrides = new Map<
                            string,
                            Array<{ name: string; is_file: boolean }>
                        >();
                        the_overrides.set(helpers_dir, [
                            { name: 'Clean.do', is_file: true },
                        ]);
                        const my_patched_fs = make_patched_fs(the_overrides);
                        forward_resolver.set_resolve_fs(my_patched_fs);
                        forward_resolver.set_workspace_roots([temp_dir]);
                        scope_resolver.set_resolve_fs(my_patched_fs);
                        scope_resolver.set_workspace_roots([temp_dir]);

                        // First resolve populates scope cache with
                        // dependent_uris containing the real-cased callee URI
                        // (the forward-scope-resolver uses the real path).
                        await scope_resolver.resolve(caller_uri, caller_content);
                        scope_resolver.reset_cache_metrics();

                        // Invalidating by real-cased callee URI must cascade
                        // to caller's scope cache via cascade_invalidate_scope_cache_for_uri.
                        scope_resolver.invalidate_scope_cache(real_callee_uri);

                        const the_metrics = scope_resolver.get_cache_metrics();
                        expect(
                            the_metrics.scope.invalidations,
                        ).toBeGreaterThan(0);
                    },
                );
            },
        );
    },
);
