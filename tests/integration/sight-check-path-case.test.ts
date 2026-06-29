/**
 * End-to-end integration tests: `sight check` with a case-only path mismatch.
 *
 * Fixture: a project where `main.do` does `do helpers/clean` but the file
 * on disk is `helpers/Clean.do`. The callee defines a global macro that the
 * caller references.
 *
 * Assertions (per spec section "`sight check`"):
 *   (a) EXACTLY ONE path_case_mismatch diagnostic at the call site, at the
 *       regime-expected severity.
 *   (b) NO undefined-symbol cascade: symbols from the callee do NOT produce
 *       UNDEFINED_MACRO / UNDEFINED_VARIABLE diagnostics in the caller.
 *   (c) With `crossFile.diagnostics.missingFile = "off"` in config, the
 *       path_case_mismatch is STILL emitted (independent policy) — no cascade.
 *
 * Host-gating: case-sensitive-regime severity assertions (Warning) are gated
 * by `host_is_case_sensitive` so they run for real on Linux CI and are
 * relaxed on case-insensitive macOS (Information severity expected there).
 * (b) no-cascade and (c) missingFile independence are asserted on both hosts.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
    build_check_context,
    collect_check_diagnostics,
    load_check_config,
} from '../../src/cli/check';
import { collect_report_targets } from '../../src/cli/source-files';
import { StataDiagnosticCode } from '../../src/types';
import { host_is_case_sensitive } from '../../src/utils/file-path-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function temp_dir(): string {
    return fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-path-case-'))
    );
}

/**
 * Build a fixture project with a case-only path mismatch:
 *   main.do      → `do helpers/clean`  (lowercase 'c', wrong)
 *   helpers/Clean.do → `global from_clean = 1`  (uppercase 'C', correct)
 *
 * `main.do` also references `$from_clean` so any undefined-macro cascade is
 * detectable.
 *
 * Returns the project root (already realpath-ed).
 */
function build_fixture(): string {
    const root = temp_dir();
    fs.mkdirSync(path.join(root, 'helpers'));
    // Callee: defines a global macro
    fs.writeFileSync(
        path.join(root, 'helpers', 'Clean.do'),
        'global from_clean = 1\n'
    );
    // Caller: case-only path typo + reference to callee's global
    fs.writeFileSync(
        path.join(root, 'main.do'),
        'do helpers/clean\ndisplay "$from_clean"\n'
    );
    return root;
}

/**
 * Run `collect_check_diagnostics` over all files in `root` with a given
 * sight.toml string (empty string → no config file written).
 *
 * Returns the flat array of DiagnosticRecord objects.
 */
async function run_check(
    root: string,
    toml_content?: string
): Promise<Array<{ relative_path: string; diagnostic: { code: unknown; severity: number; message: string } }>> {
    if (toml_content !== undefined) {
        fs.writeFileSync(path.join(root, 'sight.toml'), toml_content);
    }

    const config_result = load_check_config({
        cwd: root,
        workspace_root: root,
        no_config: toml_content === undefined,
    });
    expect(config_result.kind).toBe('loaded');
    if (config_result.kind !== 'loaded') return [];

    const targets = collect_report_targets([], root, root);
    const context = await build_check_context(root, config_result.config);
    try {
        const records = await collect_check_diagnostics(
            context,
            root,
            config_result.config,
            targets.targets
        );
        return records as Array<{
            relative_path: string;
            diagnostic: { code: unknown; severity: number; message: string };
        }>;
    } finally {
        await context.document_store.dispose();
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sight check — case-only path mismatch', () => {
    it(
        '(a)+(b) emits exactly one PATH_CASE_MISMATCH at the call site, ' +
            'no undefined-symbol cascade',
        async () => {
            const root = build_fixture();
            try {
                const records = await run_check(root);

                // ── (b) no undefined-symbol cascade ─────────────────────────
                // Code 2001 = UNDEFINED_MACRO. A cascade would fire because
                // `$from_clean` is unknown when the callee is not resolved.
                const the_undef = records.filter(
                    r => r.diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                );
                expect(the_undef).toHaveLength(0);

                // ── (a) exactly one PATH_CASE_MISMATCH ───────────────────────
                const the_case_diags = records.filter(
                    r => r.diagnostic.code === StataDiagnosticCode.PATH_CASE_MISMATCH
                );
                expect(the_case_diags).toHaveLength(1);

                // The diagnostic must be on main.do (the caller), not the callee
                expect(the_case_diags[0]!.relative_path).toBe('main.do');

                // ── (a) regime-expected severity ─────────────────────────────
                const the_is_sensitive = host_is_case_sensitive(root);
                if (the_is_sensitive) {
                    // Linux CI: warning (auto → warning on case-sensitive FS)
                    expect(the_case_diags[0]!.diagnostic.severity).toBe(
                        DiagnosticSeverity.Warning
                    );
                } else {
                    // macOS: information (auto → information on case-insensitive FS)
                    expect(the_case_diags[0]!.diagnostic.severity).toBe(
                        DiagnosticSeverity.Information
                    );
                }
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it(
        '(c) missingFile = "off" does NOT silence path_case_mismatch, ' +
            'and still no undefined-symbol cascade',
        async () => {
            const root = build_fixture();
            try {
                const records = await run_check(
                    root,
                    '[crossFile.diagnostics]\nmissingFile = "off"\n'
                );

                // ── (b) no undefined-symbol cascade ─────────────────────────
                const the_undef = records.filter(
                    r => r.diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                );
                expect(the_undef).toHaveLength(0);

                // ── (c) path_case_mismatch still present ─────────────────────
                // missingFile = "off" must NOT silence the case-mismatch
                // diagnostic (governed by caseMismatch, not missingFile).
                const the_case_diags = records.filter(
                    r => r.diagnostic.code === StataDiagnosticCode.PATH_CASE_MISMATCH
                );
                expect(the_case_diags).toHaveLength(1);

                // Severity: auto (default caseMismatch). Same regime logic.
                const the_is_sensitive = host_is_case_sensitive(root);
                if (the_is_sensitive) {
                    expect(the_case_diags[0]!.diagnostic.severity).toBe(
                        DiagnosticSeverity.Warning
                    );
                } else {
                    expect(the_case_diags[0]!.diagnostic.severity).toBe(
                        DiagnosticSeverity.Information
                    );
                }
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it(
        'caseMismatch = "off" suppresses the diagnostic (sanity check on ' +
            'the off-switch)',
        async () => {
            const root = build_fixture();
            try {
                const records = await run_check(
                    root,
                    '[crossFile.diagnostics]\ncaseMismatch = "off"\n'
                );

                // With caseMismatch = "off", no path_case_mismatch should appear
                const the_case_diags = records.filter(
                    r => r.diagnostic.code === StataDiagnosticCode.PATH_CASE_MISMATCH
                );
                expect(the_case_diags).toHaveLength(0);

                // The callee still resolves (no cascade), even when the
                // diagnostic is suppressed
                const the_undef = records.filter(
                    r => r.diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                );
                expect(the_undef).toHaveLength(0);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it(
        'text output renders [path_case_mismatch] for path_case_mismatch in run_check_with_cwd',
        async () => {
            // Verify the code suffix appears in text output via the
            // run_check_with_cwd wrapper (consistent with how other diagnostic
            // codes appear, e.g. [undefined_macro]).
            const root = build_fixture();
            try {
                const { run_check_with_cwd } = await import('../../src/cli/check');
                const stdout_lines: string[] = [];
                await run_check_with_cwd(
                    ['--workspace', root, '--quiet', '--no-color'],
                    root,
                    {
                        stdout: (text) => stdout_lines.push(text),
                        stderr: () => undefined,
                    }
                );
                const the_output = stdout_lines.join('');
                expect(the_output).toContain(
                    `[${StataDiagnosticCode.PATH_CASE_MISMATCH.toLowerCase()}]`
                );
                // Must point at main.do (the caller)
                expect(the_output).toContain('main.do:');
                // Must NOT contain undefined macro diagnostics: no cascade.
                expect(the_output).not.toContain(
                    `[${StataDiagnosticCode.UNDEFINED_MACRO.toLowerCase()}]`
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    );
});
