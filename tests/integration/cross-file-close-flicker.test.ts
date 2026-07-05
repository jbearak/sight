/**
 * Regression test for the cross-file diagnostic flicker on PARENT CLOSE.
 *
 * Bug: when a parent file (e.g. `demo_parent.do`, which `include`s
 * `demo_child.do` and defines `` `fruit' ``) is closed, the server's
 * onDidClose handler used to call `dependency_graph.update_caller(uri, [])`,
 * transiently emptying the parent's edges. That made the open callee
 * (`demo_child.do`) momentarily resolve against an empty parent set and
 * publish an "Undefined local macro" warning, which the subsequent
 * re-index immediately cleared — a red-squiggle flicker. This happens even
 * though the workspace scan is long complete, so the #175 scan-completion
 * deferral does not guard it.
 *
 * Fix: on close, revalidate the parent's current callees with the parent
 * edge still INTACT (then re-index from disk to correct unsaved-buffer
 * edges), instead of emptying the edges first.
 *
 * This test exercises the real ScopeResolver + DependencyGraph +
 * DiagnosticsProvider + WorkspaceIndexer and asserts:
 *   1. steady state after the scan is clean,
 *   2. emptying the parent's edges (the OLD behavior) DOES produce
 *      UNDEFINED_MACRO — proving the test reproduces the bug, and
 *   3. revalidating the callee with the edge intact (the FIX) does NOT.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { ScopeResolver } from '../../src/scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import { WorkspaceIndexer } from '../../src/indexer';
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

function file_provider() {
    return {
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
    };
}

function has_undefined_macro(diags: { code?: unknown; message?: string }[]): boolean {
    return diags.some(d =>
        d.code === StataDiagnosticCode.UNDEFINED_MACRO);
}

describe('cross-file diagnostic flicker on parent close', () => {
    let child_uri: string;
    let parent_uri: string;
    let child_content: string;
    let graph: DependencyGraph;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let provider: DiagnosticsProvider;
    let store: DocumentStore;

    beforeEach(async () => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-flicker-'));
        const parent_path = path.join(tmp_dir, 'demo_parent.do');
        const child_path = path.join(tmp_dir, 'demo_child.do');
        fs.writeFileSync(
            parent_path,
            '* demo_parent.do\nlocal fruit apple\ninclude demo_child.do \n',
        );
        child_content = '* demo_child.do\ndi "fruit: `fruit\'"\n';
        fs.writeFileSync(child_path, child_content);
        child_uri = URI.file(child_path).toString();
        parent_uri = URI.file(parent_path).toString();

        graph = new DependencyGraph();
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(graph);
        indexer.configure(build_config());
        scope_resolver = new ScopeResolver(undefined, file_provider());
        scope_resolver.set_dependency_graph(graph);
        provider = new DiagnosticsProvider(
            { sendDiagnostics() { } } as never,
        );
        provider.set_dependency_graph(graph);
        store = new DocumentStore();
        await store.open(child_uri, child_content, 1);

        // Initial workspace scan completes: parent edge present.
        await indexer.initialize([tmp_dir], []);
    });

    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    async function child_diagnostics() {
        provider.mark_force_republish(child_uri);
        return provider.get_diagnostics(
            store.get(child_uri) as never,
            build_config(),
            indexer.get_all_symbols(),
            scope_resolver,
        );
    }

    it('steady state after scan resolves `fruit` (no warning)', async () => {
        expect(graph.is_scan_complete()).toBe(true);
        expect(graph.get_parents(child_uri).length).toBe(1);
        expect(has_undefined_macro(await child_diagnostics())).toBe(false);
    });

    it('OLD behavior: emptying the parent edge produces the flicker warning', async () => {
        // Reproduce the pre-fix onDidClose step.
        graph.update_caller(parent_uri, []);
        scope_resolver.cascade_invalidate(new Set([child_uri]));
        // With the edge gone but the scan complete, the callee warns.
        expect(has_undefined_macro(await child_diagnostics())).toBe(true);
    });

    it('FIX: revalidating callees with the edge intact does not flicker', async () => {
        // The fixed onDidClose captures the parent's current callees and
        // revalidates them WITHOUT first emptying the parent's edges.
        const affected_callees = new Set(graph.get_callees(parent_uri));
        expect(affected_callees.has(child_uri)).toBe(true);

        scope_resolver.cascade_invalidate(affected_callees);
        // Edge still present -> `fruit` resolves via the include parent.
        expect(graph.get_parents(child_uri).length).toBe(1);
        expect(has_undefined_macro(await child_diagnostics())).toBe(false);
    });
});
