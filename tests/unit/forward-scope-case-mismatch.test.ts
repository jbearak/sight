/**
 * Unit tests for case-only path mismatch detection in
 * ForwardScopeResolver.
 *
 * Acceptance criteria:
 * (a) A case-only `do helpers/clean` (on-disk `helpers/Clean.do`) resolves
 *     the callee's symbols into scope (NO undefined-symbol cascade) and
 *     emits EXACTLY ONE `path_case_mismatch` at the call-site range.
 * (b) Grandparent→parent→child chain where the GRANDPARENT's `do` is
 *     case-only: the diagnostic is emitted ONCE when the grandparent is
 *     the diagnosed file, and is NOT emitted when the parent or child is
 *     diagnosed.
 * (c) `ambiguous` (two ci matches) → no scope resolution, and the existing
 *     cannot-read-file diagnostic still appears (no path_case_mismatch).
 *
 * Strategy: inject a `RichResolveFs` that simulates case-only / ambiguous
 * outcomes so tests are not gated on the host filesystem regime.
 * Real files are written to a temp dir so `get_parsed_file` can read them.
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
 * Create a minimal `RichResolveFs` backed by the real Node fs, but with
 * the ability to intercept `readdirSync` for specific directories to
 * simulate different on-disk casing.
 *
 * `overrides` maps a directory path to the fake entries it should return.
 * Directories not in `overrides` fall through to real `fs.readdirSync`.
 */
function make_patched_fs(
    overrides: Map<
        string,
        Array<{ name: string; is_file: boolean }>
    >,
): RichResolveFs {
    return {
        readdirSync(dir: string, _opts: { withFileTypes: true }) {
            // Normalize the key for lookup (path sep)
            const my_key = dir.replace(/\\/g, '/');
            // Also try with real path.normalize form
            for (const [my_dir, my_entries] of overrides) {
                if (
                    my_dir.replace(/\\/g, '/') === my_key ||
                    path.normalize(my_dir) === path.normalize(dir)
                ) {
                    return my_entries.map(e => ({
                        name: e.name,
                        isFile:         () => e.is_file,
                        isDirectory:    () => !e.is_file,
                        isSymbolicLink: () => false,
                    }));
                }
            }
            // Fall through to real fs
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

describe('ForwardScopeResolver — case-only path mismatch', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        temp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'forward-scope-case-mismatch-'),
        );
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Helper — write a file and return its fs path.
     */
    function write_file(
        rel_path: string,
        content: string,
    ): string {
        const full_path = path.join(temp_dir, rel_path);
        fs.mkdirSync(path.dirname(full_path), { recursive: true });
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    // ─── (a) single case-only call ───────────────────────────────────────────

    describe('(a) single case-only forward call', () => {
        it(
            'resolves callee symbols and emits exactly one path_case_mismatch',
            async () => {
                // On-disk file is helpers/Clean.do
                write_file(
                    'helpers/Clean.do',
                    'global from_clean = 1\n',
                );
                const helpers_dir = path.join(temp_dir, 'helpers');

                // The caller's ForwardCall references "helpers/clean"
                // (lowercase — case mismatch). The analyzer joins this to
                // temp_dir/helpers/clean (no extension).
                const wrong_cased = path.join(temp_dir, 'helpers', 'clean');

                // Inject an fs that, when asked to list `helpers_dir`,
                // reports "Clean.do" (the real file) — simulating what a
                // real case-sensitive FS would show.
                const the_overrides = new Map<
                    string,
                    Array<{ name: string; is_file: boolean }>
                >();
                the_overrides.set(helpers_dir, [
                    { name: 'Clean.do', is_file: true },
                ]);
                const patched = make_patched_fs(the_overrides);
                forward_resolver.set_resolve_fs(patched);
                forward_resolver.set_workspace_roots([temp_dir]);

                // Caller file (in-memory; its path doesn't matter for
                // symbols, only the ForwardCall drives resolution)
                const caller_path = write_file(
                    'main.do',
                    'do helpers/clean\n',
                );
                const caller_uri = to_uri(caller_path);

                const the_forward_calls = [
                    {
                        type: 'do' as const,
                        raw_path: 'helpers/clean',
                        call_site_line: 0,
                        range: {
                            start: { line: 0, character: 3 },
                            end: { line: 0, character: 16 },
                        },
                        source: 'command' as const,
                        is_static: true,
                        caller_uri,
                        working_directory: undefined,
                    },
                ];

                const result = await forward_resolver.resolve(
                    caller_uri,
                    the_forward_calls,
                    'include',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    caller_uri, // diagnostic_owner_uri
                );

                // Symbol from Clean.do must be resolved (no undefined cascade)
                expect(
                    result.symbols.globalMacros.has('from_clean'),
                ).toBe(true);

                // Exactly one path_case_mismatch diagnostic
                const the_case_diags = result.diagnostics.filter(
                    d => d.kind === 'path_case_mismatch',
                );
                expect(the_case_diags).toHaveLength(1);

                const my_diag = the_case_diags[0]!;
                expect(my_diag.code).toBe(
                    StataDiagnosticCode.PATH_CASE_MISMATCH,
                );
                expect(my_diag.severity).toBe('warning');
                // Range should be at the call site
                expect(my_diag.range.start.line).toBe(0);
                // Message should reference the wrong casing and the real path
                expect(my_diag.message).toMatch(/helpers\/clean/);
                expect(my_diag.message).toMatch(/Clean\.do/);
                // case_mismatch_seed_dir must be set (needed by converter)
                expect(my_diag.case_mismatch_seed_dir).toBeTruthy();
                // No missing-file diagnostic
                const the_missing_diags = result.diagnostics.filter(
                    d => d.message.includes('Cannot read file'),
                );
                expect(the_missing_diags).toHaveLength(0);
            },
        );
    });

    // ─── (b) grandparent→parent→child chain ─────────────────────────────────

    describe(
        '(b) chain — case-only grandparent do; diagnostic emitted once on gp',
        () => {
            /**
             * Setup:
             *   grandparent.do  →  do helpers/clean   (case-only mismatch)
             *   parent.do       →  do grandparent.do  (exact)
             *   child.do        →  do parent.do       (exact)
             *
             * When grandparent is diagnosed → 1 path_case_mismatch.
             * When parent or child is diagnosed → 0 path_case_mismatch
             * (because depth > 0 for grandparent's call when seen from
             * parent/child scope build).
             */
            let gp_path: string;
            let parent_path: string;
            let helpers_dir: string;
            let the_patched_fs: RichResolveFs;

            beforeEach(() => {
                write_file(
                    'helpers/Clean.do',
                    'global clean_sym = 42\n',
                );
                helpers_dir = path.join(temp_dir, 'helpers');
                gp_path = write_file(
                    'grandparent.do',
                    'do helpers/clean\n',
                );
                parent_path = write_file(
                    'parent.do',
                    `do "${gp_path}"\n`,
                );
                write_file(
                    'child.do',
                    `do "${parent_path}"\n`,
                );

                // Inject fs that reports case-only for helpers/clean
                const the_overrides = new Map<
                    string,
                    Array<{ name: string; is_file: boolean }>
                >();
                the_overrides.set(helpers_dir, [
                    { name: 'Clean.do', is_file: true },
                ]);
                the_patched_fs = make_patched_fs(the_overrides);
            });

            it('emits path_case_mismatch when grandparent is diagnosed', async () => {
                const gp_uri = to_uri(gp_path);
                const resolved_gp = new ForwardScopeResolver(
                    new ScopeResolver(),
                );
                resolved_gp.set_resolve_fs(the_patched_fs);
                resolved_gp.set_workspace_roots([temp_dir]);

                const wrong_cased = path.join(
                    temp_dir,
                    'helpers',
                    'clean',
                );
                const the_gp_calls = [
                    {
                        type: 'do' as const,
                        raw_path: 'helpers/clean',
                        call_site_line: 0,
                        range: {
                            start: { line: 0, character: 3 },
                            end: { line: 0, character: 16 },
                        },
                        source: 'command' as const,
                        is_static: true,
                        caller_uri: gp_uri,
                        working_directory: undefined,
                    },
                ];

                const result = await resolved_gp.resolve(
                    gp_uri,
                    the_gp_calls,
                    'include',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    gp_uri, // diagnosed file is grandparent itself
                );

                const the_case_diags = result.diagnostics.filter(
                    d => d.kind === 'path_case_mismatch',
                );
                expect(the_case_diags).toHaveLength(1);
                expect(result.symbols.globalMacros.has('clean_sym')).toBe(
                    true,
                );
            });

            it(
                'suppresses path_case_mismatch when resolving from parent' +
                    " scope (grandparent's call at depth > 0)",
                async () => {
                    // Build parent's forward resolution. Parent calls gp
                    // (exact), which in turn calls helpers/clean (case-only).
                    // When building parent's scope we set diagnostic_owner_uri
                    // = parent_uri; the grandparent's case-only call is at
                    // depth 1 and must NOT emit.
                    const parent_uri = to_uri(parent_path);

                    // Create a fresh resolver for this sub-test
                    const parent_sr = new ScopeResolver();
                    const parent_fsr = new ForwardScopeResolver(parent_sr);
                    parent_sr.set_forward_scope_resolver(parent_fsr);
                    parent_fsr.set_resolve_fs(the_patched_fs);
                    parent_fsr.set_workspace_roots([temp_dir]);

                    const the_parent_calls = [
                        {
                            type: 'do' as const,
                            raw_path: gp_path,
                            call_site_line: 0,
                            range: {
                                start: { line: 0, character: 3 },
                                end: { line: 0, character: 20 },
                            },
                            source: 'command' as const,
                            is_static: true,
                            caller_uri: parent_uri,
                            working_directory: undefined,
                        },
                    ];

                    // diagnostic_owner_uri = parent (not grandparent)
                    const result = await parent_fsr.resolve(
                        parent_uri,
                        the_parent_calls,
                        'include',
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        parent_uri,
                    );

                    // Grandparent's case-only call resolves scope (gp does
                    // have a forward call that works) → clean_sym may or
                    // may not be present depending on recursion through the
                    // real gp file, but what matters for this test is:
                    const the_case_diags = result.diagnostics.filter(
                        d => d.kind === 'path_case_mismatch',
                    );
                    // ZERO path_case_mismatch: grandparent's call is at
                    // depth 1 relative to this resolve() invocation
                    expect(the_case_diags).toHaveLength(0);
                },
            );
        },
    );

    // ─── (c) ambiguous — keep existing cannot-read-file diagnostic ───────────

    describe('(c) ambiguous — two ci matches → no scope, existing error', () => {
        it(
            'emits cannot-read-file diagnostic (not path_case_mismatch) ' +
                'when two case-insensitive matches exist',
            async () => {
                // Create two files that are case-insensitively equal
                write_file('helpers/Clean.do', 'global clean1 = 1\n');
                write_file('helpers/CLEAN.do', 'global clean2 = 2\n');
                const helpers_dir = path.join(temp_dir, 'helpers');

                // Inject fs that reports both Clean.do and CLEAN.do for
                // helpers_dir → ambiguous
                const the_overrides = new Map<
                    string,
                    Array<{ name: string; is_file: boolean }>
                >();
                the_overrides.set(helpers_dir, [
                    { name: 'Clean.do', is_file: true },
                    { name: 'CLEAN.do', is_file: true },
                ]);
                const patched = make_patched_fs(the_overrides);
                forward_resolver.set_resolve_fs(patched);
                forward_resolver.set_workspace_roots([temp_dir]);

                const wrong_cased = path.join(
                    temp_dir,
                    'helpers',
                    'clean',
                );
                const caller_path = write_file('main.do', 'do helpers/clean\n');
                const caller_uri = to_uri(caller_path);

                const the_forward_calls = [
                    {
                        type: 'do' as const,
                        raw_path: 'helpers/clean',
                        call_site_line: 0,
                        range: {
                            start: { line: 0, character: 3 },
                            end: { line: 0, character: 16 },
                        },
                        source: 'command' as const,
                        is_static: true,
                        caller_uri,
                        working_directory: undefined,
                    },
                ];

                const result = await forward_resolver.resolve(
                    caller_uri,
                    the_forward_calls,
                    'include',
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    caller_uri,
                );

                // No symbols from ambiguous callee
                expect(
                    result.symbols.globalMacros.has('clean1'),
                ).toBe(false);
                expect(
                    result.symbols.globalMacros.has('clean2'),
                ).toBe(false);

                // No path_case_mismatch for ambiguous
                const the_case_diags = result.diagnostics.filter(
                    d => d.kind === 'path_case_mismatch',
                );
                expect(the_case_diags).toHaveLength(0);

                // Existing cannot-read-file diagnostic must be present
                const the_missing_diags = result.diagnostics.filter(d =>
                    d.message.includes('Cannot read file'),
                );
                expect(the_missing_diags).toHaveLength(1);
            },
        );
    });
});
