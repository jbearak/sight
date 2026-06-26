/**
 * Regression test for the Cmd-hover (definition peek) diagnostic flicker.
 *
 * User-visible bug: open `demo_child.do` LOCALLY (parent never shown as a
 * tab) and Cmd-hover over `` `fruit' ``. An "Undefined local macro" warning
 * briefly flashed then cleared.
 *
 * Root cause: VS Code's Cmd-hover peek opens the *definition target*
 * (`demo_parent.do`) invisibly to render the preview, then closes it again —
 * firing onDidOpen + onDidClose for the parent even though no tab is shown.
 * The pre-#177 onDidClose ran `update_caller(parent, [])`, transiently
 * emptying the parent's include edge, so the open child momentarily resolved
 * against an empty parent set and warned. This is the same #177 edge-churn,
 * just triggered by the peek lifecycle rather than a user-driven close.
 *
 * This test models the full peek lifecycle against the real subsystems and
 * asserts:
 *   1. the OLD close behavior (emptying the parent edge) DOES flicker the
 *      child — proving the lifecycle reproduces the bug, and
 *   2. the FIXED close behavior (revalidate callees with the edge intact)
 *      keeps the child clean across the entire open→close sequence.
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

// Buffer-aware content provider mirroring the server's disk-for-closed /
// buffer-for-open switch (server-factory.ts content provider).
function make_provider(open_buffers: Map<string, string>) {
    return {
        read_file: async (uri: string) => {
            const buf = open_buffers.get(uri);
            if (buf !== undefined) return buf;
            return fs.promises.readFile(URI.parse(uri).fsPath, 'utf8');
        },
        exists: async (uri: string) => {
            if (open_buffers.has(uri)) return true;
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

describe('Cmd-hover peek lifecycle flicker (parent open then close)', () => {
    let child_uri: string;
    let parent_uri: string;
    let child_content: string;
    let parent_content: string;
    let graph: DependencyGraph;
    let indexer: WorkspaceIndexer;
    let scope_resolver: ScopeResolver;
    let provider: DiagnosticsProvider;
    let store: DocumentStore;
    let open_buffers: Map<string, string>;

    beforeEach(async () => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peek-flicker-'));
        const parent_path = path.join(tmp_dir, 'demo_parent.do');
        const child_path = path.join(tmp_dir, 'demo_child.do');
        parent_content =
            '* demo_parent.do\nlocal fruit apple\ninclude demo_child.do \n';
        child_content = '* demo_child.do\ndi "fruit: `fruit\'"\n';
        fs.writeFileSync(parent_path, parent_content);
        fs.writeFileSync(child_path, child_content);
        child_uri = URI.file(child_path).toString();
        parent_uri = URI.file(parent_path).toString();

        open_buffers = new Map();
        graph = new DependencyGraph();
        indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(graph);
        indexer.configure(build_config());
        scope_resolver = new ScopeResolver(undefined, make_provider(open_buffers));
        scope_resolver.set_dependency_graph(graph);
        provider = new DiagnosticsProvider({ sendDiagnostics() {} } as never);
        provider.set_dependency_graph(graph);
        store = new DocumentStore();
        store.set_scope_resolver(scope_resolver);

        // Open the CHILD (the file the user is looking at). Parent stays closed.
        open_buffers.set(child_uri, child_content);
        await store.open(child_uri, child_content, 1);

        // Workspace scan completes -> parent edge present, scan_complete=true.
        await indexer.initialize([tmp_dir], []);
    });

    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    async function child_diagnostics() {
        provider.clear_published_version(child_uri);
        return provider.get_diagnostics(
            store.get(child_uri) as never,
            build_config(),
            indexer.get_all_symbols(),
            scope_resolver,
        );
    }

    // The peek transiently OPENS the parent (definition target) to render the
    // preview: buffer now backs the parent and it is analyzed.
    async function peek_open_parent() {
        open_buffers.set(parent_uri, parent_content);
        scope_resolver.invalidate_scope_cache(parent_uri);
        await store.open(parent_uri, parent_content, 1);
    }

    it('steady state after scan resolves `fruit` (no warning)', async () => {
        expect(graph.is_scan_complete()).toBe(true);
        expect(graph.get_parents(child_uri).length).toBe(1);
        expect(has_undefined_macro(await child_diagnostics())).toBe(false);
    });

    it('OLD close behavior: peek open then edge-emptying close flickers the child', async () => {
        await peek_open_parent();
        expect(has_undefined_macro(await child_diagnostics())).toBe(false);

        // Pre-#177 onDidClose: empty the parent's edges first, then revalidate.
        open_buffers.delete(parent_uri);
        store.close(parent_uri);
        graph.update_caller(parent_uri, []);
        scope_resolver.cascade_invalidate(new Set([child_uri]));

        // Edge gone with the scan complete -> the open child warns (flicker).
        expect(has_undefined_macro(await child_diagnostics())).toBe(true);
    });

    it('FIX: peek open then close keeps the child clean throughout', async () => {
        const samples: boolean[] = [];
        samples.push(has_undefined_macro(await child_diagnostics()));

        await peek_open_parent();
        samples.push(has_undefined_macro(await child_diagnostics()));

        // Fixed onDidClose: capture the parent's current callees with the edge
        // still INTACT, drop the buffer, then revalidate (no edge emptying).
        const affected_callees = new Set(graph.get_callees(parent_uri));
        expect(affected_callees.has(child_uri)).toBe(true);
        open_buffers.delete(parent_uri);
        store.close(parent_uri);
        scope_resolver.cascade_invalidate(affected_callees);
        samples.push(has_undefined_macro(await child_diagnostics()));

        // Edge intact throughout -> `fruit` always resolves via the parent.
        expect(graph.get_parents(child_uri).length).toBe(1);
        expect(samples.some(Boolean)).toBe(false);
    });
});
