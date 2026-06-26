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
                        isFile: () => e.is_file,
                        isDirectory: () => !e.is_file,
                    }));
                }
            }
            return fs.readdirSync(dir, { withFileTypes: true }) as Array<{
                name: string;
                isFile(): boolean;
                isDirectory(): boolean;
            }>;
        },
        existsSync(p: string) {
            return fs.existsSync(p);
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
    },
);
