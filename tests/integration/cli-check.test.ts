import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode-languageserver';
import {
    build_check_context,
    collect_check_diagnostics,
    load_check_config,
    run_check_with_cwd,
} from '../../src/cli/check';
import type { CheckContext } from '../../src/cli/check';
import { collect_report_targets } from '../../src/cli/source-files';
import {
    EXIT_CHECK_FAILED,
    EXIT_OK,
    EXIT_OPERATOR_ERROR,
} from '../../src/cli/shared';
import { create_empty_symbol_table } from '../../src/analyzer';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-integration-'));
}

async function run_capture(argv: string[], cwd: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_check_with_cwd(argv, cwd, {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('sight check integration', () => {
    it('reports same-file undefined macro diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('main.do:1:');
        expect(result.stdout).toContain('Undefined');
        expect(result.stdout).toContain('macro');
    });

    it('honors editor default undefinedVariable off', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'main.do'), 'regress y x\n');

        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('uses strict max severity gating', async () => {
        const root = temp_dir();
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[diagnostics.severity]\nundefinedMacro = "information"\n'
        );
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root, '--max-severity', 'info'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toContain('info:');
    });

    it('indexes whole workspace while report paths filter output', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.do'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(['--workspace', root, 'child.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('canonicalizes symlinked workspace and explicit target paths', async () => {
        const real_root = temp_dir();
        const link_root = `${real_root}-link`;
        fs.symlinkSync(real_root, link_root, 'dir');
        fs.writeFileSync(path.join(real_root, 'parent.do'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(real_root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(
            ['--workspace', link_root, path.join(real_root, 'child.do'), '--quiet'],
            real_root
        );

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('indexes uppercase source extensions for cross-file scope', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'parent.DO'), 'global project_root /tmp\ndo child.do\n');
        fs.writeFileSync(path.join(root, 'child.do'), 'display "$project_root"\n');

        const result = await run_capture(['--workspace', root, 'child.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).toBe('');
    });

    it('reports malformed config as operator error', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), 'bad = = toml\n');

        const result = await run_capture(['--workspace', root], root);

        expect(result.code).toBe(EXIT_OPERATOR_ERROR);
        expect(result.stderr).toContain('failed to load');
    });

    it('reports missing explicit path as operator error', async () => {
        const root = temp_dir();

        const result = await run_capture(['--workspace', root, 'missing.do'], root);

        expect(result.code).toBe(EXIT_OPERATOR_ERROR);
        expect(result.stderr).toContain('path does not exist');
    });

    it('reports unreadable report directories as operator errors', async () => {
        const root = temp_dir();
        const locked = path.join(root, 'locked');
        fs.mkdirSync(locked);
        fs.chmodSync(locked, 0);
        try {
            const result = await run_capture(['--workspace', root, 'locked'], root);

            expect(result.code).toBe(EXIT_OPERATOR_ERROR);
            expect(result.stderr).toContain('sight check:');
            expect(result.stderr).toContain('permission denied');
            expect(result.stderr).not.toContain(' at ');
        } finally {
            fs.chmodSync(locked, 0o700);
        }
    });

    it('reports explicitly oversized source files as error diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[indexing]\nmaxFileSizeBytes = 1\n');
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const result = await run_capture(['--workspace', root, 'main.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('exceeds the configured limit');
    });

    it('reports explicit source files skipped by max indexed files', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'b.do'), 'display 2\n');

        const result = await run_capture(
            ['--workspace', root, 'a.do', 'b.do', '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('was not indexed');
        expect(result.stdout).toContain('maxIndexedFiles');
    });

    it('reports explicit .mata files skipped by max indexed files', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.mata'), '// a\n');
        fs.writeFileSync(path.join(root, 'b.mata'), '// b\n');

        const result = await run_capture(
            ['--workspace', root, 'a.mata', 'b.mata', '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('was not indexed');
        expect(result.stdout).toContain('maxIndexedFiles');
    });

    it('reports walked files skipped by max indexed files on default invocation', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.do'), 'display 1\n');
        fs.writeFileSync(path.join(root, 'b.do'), 'display 2\n');

        // No explicit paths: the whole workspace is walked. The file that did
        // not fit under the cap must still be reported, not silently analyzed
        // against an incomplete index.
        const result = await run_capture(['--workspace', root, '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('was not indexed');
        expect(result.stdout).toContain('maxIndexedFiles');
    });

    it('diagnoses explicit outside-workspace files after max indexed files is reached', async () => {
        const root = temp_dir();
        const outside = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[crossFile]\nmaxIndexedFiles = 1\n');
        fs.writeFileSync(path.join(root, 'a.do'), 'display 1\n');
        fs.writeFileSync(path.join(outside, 'b.do'), '}\n');

        const result = await run_capture(
            ['--workspace', root, path.join(outside, 'b.do'), '--quiet'],
            root
        );

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('unexpected closing brace');
        expect(result.stdout).not.toContain('maxIndexedFiles');
        expect(result.stdout).not.toContain('was not indexed');
    });

    it('reports a target removed after discovery as a per-file diagnostic, not a batch abort', async () => {
        const root = fs.realpathSync.native(temp_dir());
        const vanishing = path.join(root, 'vanishing.do');
        fs.writeFileSync(vanishing, 'display 1\n');
        fs.writeFileSync(path.join(root, 'main.do'), "display \"`missing'\"\n");

        const config_result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: true,
        });
        expect(config_result.kind).toBe('loaded');
        if (config_result.kind !== 'loaded') return;

        const targets = collect_report_targets([], root, root);
        const context = await build_check_context(root, config_result.config);
        try {
            // Simulate the race: the file existed at discovery (and indexing)
            // but is gone by the time diagnostics are collected.
            fs.unlinkSync(vanishing);

            const records = await collect_check_diagnostics(
                context,
                root,
                config_result.config,
                targets.targets
            );

            // The vanished file is reported per-file; the batch still analyzes
            // main.do rather than throwing and aborting everything.
            expect(
                records.some((r) => r.diagnostic.code === 'SIGHT_UNREADABLE')
            ).toBe(true);
            expect(records.some((r) => r.relative_path === 'main.do')).toBe(true);
        } finally {
            await context.document_store.dispose();
        }
    });

    it('skips oversized directory-walked files instead of analyzing them', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'sight.toml'), '[indexing]\nmaxFileSizeBytes = 4\n');
        // Larger than the 4-byte limit; would otherwise be read+analyzed.
        fs.writeFileSync(path.join(root, 'big.do'), "display \"`missing'\"\n");

        const result = await run_capture(['--workspace', root], root);

        // Walked (non-explicit) oversized files are skipped silently: no
        // diagnostics, and no SIGHT_FILE_TOO_LARGE noise.
        expect(result.code).toBe(EXIT_OK);
        expect(result.stdout).not.toContain('big.do');
        expect(result.stdout).not.toContain('exceeds the configured limit');
    });

    it('reports invalid UTF-8 as an error diagnostic', async () => {
        const root = temp_dir();
        fs.writeFileSync(path.join(root, 'bad.do'), Buffer.from([0x64, 0x80]));

        const result = await run_capture(['--workspace', root, 'bad.do', '--quiet'], root);

        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('not valid UTF-8');
        expect(result.stdout).toContain('byte offset');
    });

    it('reuses the document-store scope resolve cache in diagnostics', async () => {
        const root = temp_dir();
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[crossFile]\nmaxForwardDepth = 4\n'
        );
        fs.writeFileSync(path.join(root, 'main.do'), 'display 1\n');

        const config_result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: false,
        });
        expect(config_result.kind).toBe('loaded');
        if (config_result.kind !== 'loaded') return;

        const targets = collect_report_targets(['main.do'], root, root);
        const context = await build_check_context(root, config_result.config);
        try {
            context.scope_resolver.reset_cache_metrics();

            await collect_check_diagnostics(
                context,
                root,
                config_result.config,
                targets.targets
            );

            const metrics = context.scope_resolver.get_cache_metrics();
            expect(metrics.scope.misses).toBe(1);
            expect(metrics.scope.hits).toBe(1);
        } finally {
            await context.document_store.dispose();
        }
    });

    it('processes report targets concurrently while preserving output order', async () => {
        const root = temp_dir();
        const targets = ['a.do', 'b.do', 'c.do', 'd.do', 'e.do'].map(
            (file_name) => {
                const file_path = path.join(root, file_name);
                fs.writeFileSync(file_path, 'display 1\n');
                return {
                    path: file_path,
                    relative_path: file_name,
                    explicit: true,
                };
            }
        );

        let active_opens = 0;
        let max_active_opens = 0;

        const context = {
            workspace_indexer: {
                get_all_symbols: () => create_empty_symbol_table(),
                get_metrics: () => ({ files_indexed: targets.length }),
                has_indexed_file: () => true,
            },
            document_store: {
                open: async () => {
                    active_opens++;
                    max_active_opens = Math.max(
                        max_active_opens,
                        active_opens
                    );
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    active_opens--;
                },
                get: (uri: string) => ({ uri }),
                close: () => undefined,
            },
            diagnostics_provider: {
                get_diagnostics: async (state: { uri: string }) => [{
                    severity: DiagnosticSeverity.Warning,
                    message: path.basename(new URL(state.uri).pathname),
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 1 },
                    },
                    source: 'sight',
                }],
            },
            scope_resolver: {},
        } as unknown as CheckContext;

        const config_result = load_check_config({
            cwd: root,
            workspace_root: root,
            no_config: true,
        });
        expect(config_result.kind).toBe('loaded');
        if (config_result.kind !== 'loaded') return;

        const records = await collect_check_diagnostics(
            context,
            root,
            config_result.config,
            targets
        );

        expect(max_active_opens).toBeGreaterThan(1);
        expect(records.map((record) => record.relative_path)).toEqual(
            targets.map((target) => target.relative_path)
        );
    });
});
