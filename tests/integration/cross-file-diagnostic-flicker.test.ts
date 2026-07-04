/**
 * Regression test for the cross-file diagnostic flicker (PR #175).
 *
 * Bug: when the workspace scan completes between
 * `ScopeResolver.resolve()` capturing `has_auto_parents` and the
 * diagnostics provider deciding whether to defer, the deferral check
 * reads a fresh `dependency_graph.is_scan_complete()===true` while the
 * resolved scope still reflects the empty pre-scan graph
 * (`has_auto_parents===false`). The provider then publishes an
 * "Undefined local macro: `fruit'" warning that the next
 * re-validation immediately clears — the user perceives a red-squiggly
 * that briefly flickers under the macro name.
 *
 * Fix: `ScopeResolver.resolve()` snapshots
 * `dependency_graph.is_scan_complete()` at the same synchronous
 * moment as `has_auto_parents` and exposes it on the returned scope.
 * The diagnostics provider's deferral check uses that snapshot.
 *
 * This test deterministically reproduces the race by installing a
 * slow `content_provider` so the indexer's `mark_scan_complete()`
 * fires WHILE `resolve()` is awaiting parent-file I/O. Before the
 * fix, the resulting `get_diagnostics` call publishes
 * `UNDEFINED_MACRO`; after the fix, it defers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Diagnostic, Connection } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { ScopeResolver } from '../../src/scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import { make_fs_content_provider } from '../fs-content-provider';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';

let tmp_dir: string;

function build_config(): StataLSPConfig {
    return {
        diagnostics: {
            enabled: true,
            severity: {
                undefinedMacro: 'warning',
                undefinedVariable: 'off',
                styleWarnings: 'hint',
                malformedOperator: 'warning',
                invalidOperatorSequence: 'error',
                cStyleLogicalInControlFlow: 'information',
                mixedLogicalOperators: 'warning',
            },
            indentation: false,
        },
        completion: { cacheSize: 200, prefixMaxItems: 200 },
        formatting: {
            indentSize: 4,
            indentStyle: 'spaces',
            lineWidth: 80,
            preferredCommentStyle: 'line',
            normalizeCommentStyle: false,
            commentLineWidth: 72,
            mode: 'source-preserving',
            preserve_alignment: true,
        },
        lineCommentStyle: '//',
        indexing: { maxFileSizeBytes: 500000 },
        adoPaths: [],
        indexWorkspace: true,
        cross_file: {
            index_workspace: true,
            max_indexed_files: 1000,
            assume_call_site: 'end',
            backward_dependencies: 'auto',
            max_backward_depth: 10,
            max_forward_depth: 10,
            max_chain_depth: 20,
            max_callee_revalidations: 10,
            diagnostics: { missing_file: 'warning', max_depth: 'information' },
        },
        debug: false,
    };
}

describe('cross-file diagnostic flicker (regression for #175)', () => {
    let captured: Diagnostic[][];

    beforeEach(() => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flicker-test-'));
        captured = [];
    });

    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    function make_mock_connection(): Connection {
        return {
            sendDiagnostics: (params: { uri: string; diagnostics: Diagnostic[] }) => {
                captured.push(params.diagnostics);
            },
        } as unknown as Connection;
    }

    it('defers when the scan finishes during resolve() (race condition)', async () => {
        // Files: parent declares `fruit` and `include`s child.
        const parent_path = path.join(tmp_dir, 'demo_parent.do');
        const child_path = path.join(tmp_dir, 'demo_child.do');
        fs.writeFileSync(
            parent_path,
            '* demo_parent.do\nlocal fruit apple\ninclude demo_child.do \n',
        );
        const child_content = '* demo_child.do\ndi "fruit: `fruit\'"\n';
        fs.writeFileSync(child_path, child_content);
        const child_uri = URI.file(child_path).toString();

        // Pre-scan dependency graph: scan_complete=false, no edges.
        const graph = new DependencyGraph();

        // Wire scope resolver with NO parent edge in graph. The race
        // doesn't even need an await — `get_effective_backward_directives`
        // captures `has_auto_parents=false` synchronously, the snapshot
        // captures `scan_complete=false` right next to it, and from
        // that point on changes to `dependency_graph` cannot retroactively
        // turn deferral off.
        const scope_resolver = new ScopeResolver(undefined, {
            read_file: async (uri: string) =>
                fs.promises.readFile(URI.parse(uri).fsPath, 'utf8'),
            exists: async (uri: string) => {
                try {
                    await fs.promises.access(URI.parse(uri).fsPath);
                    return true;
                } catch {
                    return false;
                }
            },
            stat: async (uri: string) => {
                try {
                    const stats = await fs.promises.stat(URI.parse(uri).fsPath);
                    return { mtimeMs: stats.mtimeMs, size: stats.size };
                } catch {
                    return undefined;
                }
            },
        });
        scope_resolver.set_dependency_graph(graph);

        const diagnostics_provider = new DiagnosticsProvider(
            make_mock_connection(),
        );
        diagnostics_provider.set_dependency_graph(graph);

        const document_store = new DocumentStore();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri);
        if (!document_state) {
            throw new Error('document state missing');
        }

        // Step 1: kick off the diagnostic computation. Inside,
        // scope_resolver.resolve() will snapshot scan_complete=false.
        const get_diags_promise = diagnostics_provider.get_diagnostics(
            document_state,
            build_config(),
            undefined,
            scope_resolver,
        );

        // Step 2: the indexer finishes the workspace scan while
        // get_diagnostics is in flight. Without the snapshot, the
        // provider would now see `is_scan_complete()===true` and
        // publish UNDEFINED_MACRO. With the snapshot, deferral holds.
        graph.mark_scan_complete();
        expect(graph.is_scan_complete()).toBe(true);

        const diagnostics = await get_diags_promise;

        const has_undef_macro = diagnostics.some(d =>
            d.code === StataDiagnosticCode.UNDEFINED_MACRO,
        );
        expect(has_undef_macro).toBe(false);
    });

    it('still publishes when the scan was already complete BEFORE resolve()', async () => {
        // Sanity check: the snapshot must not retroactively suppress
        // the warning when the scan really did finish first and no
        // parent was discovered.
        const child_path = path.join(tmp_dir, 'demo_child.do');
        const child_content = '* demo_child.do\ndi "fruit: `fruit\'"\n';
        fs.writeFileSync(child_path, child_content);
        const child_uri = URI.file(child_path).toString();

        const graph = new DependencyGraph();
        graph.mark_scan_complete();  // Scan complete BEFORE resolve.

        const scope_resolver = new ScopeResolver(undefined, {
            read_file: async (uri: string) =>
                fs.promises.readFile(URI.parse(uri).fsPath, 'utf8'),
            exists: async (uri: string) => {
                try {
                    await fs.promises.access(URI.parse(uri).fsPath);
                    return true;
                } catch {
                    return false;
                }
            },
            stat: async (uri: string) => {
                try {
                    const stats = await fs.promises.stat(URI.parse(uri).fsPath);
                    return { mtimeMs: stats.mtimeMs, size: stats.size };
                } catch {
                    return undefined;
                }
            },
        });
        scope_resolver.set_dependency_graph(graph);

        const diagnostics_provider = new DiagnosticsProvider(
            make_mock_connection(),
        );
        diagnostics_provider.set_dependency_graph(graph);

        const document_store = new DocumentStore();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri);
        if (!document_state) {
            throw new Error('document state missing');
        }

        const diagnostics = await diagnostics_provider.get_diagnostics(
            document_state,
            build_config(),
            undefined,
            scope_resolver,
        );

        expect(
            diagnostics.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        ).toBe(true);
    });

    it('never defers a standalone file, even mid-scan (issue #208)', async () => {
        // A standalone file can never gain backward parents from the
        // workspace scan, so its undefined-symbol diagnostics publish
        // immediately instead of waiting for scan completion.
        const child_path = path.join(tmp_dir, 'demo_child.do');
        const child_content =
            '// sight: standalone\ndi "fruit: `fruit\'"\n';
        fs.writeFileSync(child_path, child_content);
        const child_uri = URI.file(child_path).toString();

        // Scan NOT complete — a non-standalone zero-parent file would
        // defer here (see the first test in this file).
        const graph = new DependencyGraph();
        expect(graph.is_scan_complete()).toBe(false);

        const scope_resolver = new ScopeResolver(
            undefined, make_fs_content_provider()
        );
        scope_resolver.set_dependency_graph(graph);

        const diagnostics_provider = new DiagnosticsProvider(
            make_mock_connection(),
        );
        diagnostics_provider.set_dependency_graph(graph);

        const document_store = new DocumentStore();
        await document_store.open(child_uri, child_content, 1);
        const document_state = document_store.get(child_uri);
        if (!document_state) {
            throw new Error('document state missing');
        }

        const diagnostics = await diagnostics_provider.get_diagnostics(
            document_state,
            build_config(),
            undefined,
            scope_resolver,
        );

        expect(
            diagnostics.some(d => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        ).toBe(true);
    });
});
