/**
 * Integration tests for issue #252: in-script Stata `cd` statements provide
 * line-sensitive working-directory context, so `do`/`run`/`include` paths
 * resolve relative to the working directory active at each call site.
 *
 * Covers the acceptance criteria:
 *  1. Two top-level literal `cd`s resolve later calls per-call-site.
 *  3. `cd` target casing diagnosed like do/run/include path-case mismatches.
 *  4. Open-document parsing and workspace indexing agree on dep-graph edges.
 *  5. Go-to-definition uses the per-call working directory.
 *  6. Dynamic / prefixed `cd` does not cause false confident resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { WorkspaceIndexer } from '../../src/indexer';
import { DependencyGraph } from '../../src/dependency-graph';
import { DefinitionProvider } from '../../src/providers/definition';
import { get_visible_symbols_at } from '../../src/scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Issue #252: in-script cd statement tracking', () => {
    let test_dir: string;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        // Resolve symlinks (macOS /tmp → /private/tmp) for exact path matching.
        test_dir = fs.realpathSync.native(
            fs.mkdtempSync(path.join(os.tmpdir(), 'cd-tracking-')),
        );
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        scope_resolver.set_workspace_roots([test_dir]);
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        forward_resolver.set_workspace_roots([test_dir]);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        document_store = new DocumentStore();
        document_store.set_workspace_roots([test_dir]);
        document_store.set_scope_resolver(scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(test_dir, { recursive: true, force: true });
    });

    function write_file(rel_path: string, content: string): string {
        const full_path = path.join(test_dir, rel_path);
        fs.mkdirSync(path.dirname(full_path), { recursive: true });
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    function file_uri(rel_path: string): string {
        return URI.file(path.join(test_dir, rel_path)).toString();
    }

    // ── Criterion 1: per-call-site resolution ─────────────────────────────────

    it('resolves later do calls relative to the WD active at each call site', async () => {
        write_file('raw/import.do', 'global from_import = 1\n');
        write_file('analysis/clean.do', 'global from_clean = 1\n');
        const main = write_file(
            'main.do',
            'cd "raw"\ndo import\ncd "../analysis"\ndo clean\n',
        );
        const uri = URI.file(main).toString();
        await document_store.open(uri, fs.readFileSync(main, 'utf8'), 1);

        const state = document_store.get(uri)!;
        const import_call = state.forward_calls.find(c => c.raw_path === 'import')!;
        const clean_call = state.forward_calls.find(c => c.raw_path === 'clean')!;

        expect(import_call.working_directory).toBe(path.join(test_dir, 'raw'));
        expect(clean_call.working_directory).toBe(path.join(test_dir, 'analysis'));
    });

    // ── Criterion 4: open-doc vs indexer dep-graph parity ─────────────────────

    it('open-document and workspace indexing produce the same dep-graph edges', async () => {
        write_file('raw/import.do', 'global g_import = 1\n');
        write_file('analysis/clean.do', 'global g_clean = 1\n');
        write_file('main.do', 'cd "raw"\ndo import\ncd "../analysis"\ndo clean\n');

        // Indexer path.
        const indexer = new WorkspaceIndexer();
        const idx_graph = new DependencyGraph();
        idx_graph.set_workspace_roots([test_dir]);
        indexer.set_dependency_graph(idx_graph);
        const idx_scope = new ScopeResolver(create_test_scope_resolver_logger());
        idx_scope.set_workspace_roots([test_dir]);
        indexer.set_scope_resolver(idx_scope);
        await indexer.initialize([test_dir]);

        const main_uri = file_uri('main.do');
        const indexed_callees = idx_graph.get_callees(main_uri);

        // Open-document path: build a dep graph from the opened forward calls.
        const open_graph = new DependencyGraph();
        open_graph.set_workspace_roots([test_dir]);
        const main_path = path.join(test_dir, 'main.do');
        await document_store.open(main_uri, fs.readFileSync(main_path, 'utf8'), 1);
        open_graph.update_caller(main_uri, document_store.get(main_uri)!.forward_calls);
        const open_callees = open_graph.get_callees(main_uri);

        const expected_import = file_uri('raw/import.do');
        const expected_clean = file_uri('analysis/clean.do');

        for (const my_graph of [indexed_callees, open_callees]) {
            expect(my_graph.has(expected_import)).toBe(true);
            expect(my_graph.has(expected_clean)).toBe(true);
        }
        // The two paths agree on the full callee set.
        expect(new Set(open_callees.keys())).toEqual(new Set(indexed_callees.keys()));
    });

    // ── Criterion 3: cd target casing diagnostic ──────────────────────────────

    it('diagnoses a case-only cd target like do/run/include path-case', async () => {
        write_file('Raw/import.do', 'global g = 1\n');     // on disk: Raw
        const main = write_file('main.do', 'cd "raw"\ndo import\n'); // source: raw
        const uri = URI.file(main).toString();
        const content = fs.readFileSync(main, 'utf8');

        const resolved = await scope_resolver.resolve(uri, content);
        const case_diags = resolved.diagnostics.filter(
            d => d.kind === 'path_case_mismatch' && d.range.start.line === 0,
        );
        // Exactly one cd-line case-mismatch — and NO cascade onto the `do` line.
        expect(case_diags).toHaveLength(1);
        const do_line_case = resolved.diagnostics.filter(
            d => d.kind === 'path_case_mismatch' && d.range.start.line === 1,
        );
        expect(do_line_case).toHaveLength(0);
    });

    it('warns when a static cd target directory does not exist', async () => {
        const main = write_file('main.do', 'cd "nope"\n');
        const uri = URI.file(main).toString();
        const content = fs.readFileSync(main, 'utf8');

        const resolved = await scope_resolver.resolve(uri, content);
        const missing = resolved.diagnostics.filter(
            d => d.kind === 'missing_directory' && d.range.start.line === 0,
        );
        expect(missing).toHaveLength(1);
        expect(missing[0]!.severity).toBe('warning');
    });

    // ── Criterion 6: dynamic / prefixed cd does not poison ────────────────────

    it('does not change WD for a dynamic (macro) cd path', async () => {
        write_file('base/sub.do', 'global g = 1\n');
        const main = write_file(
            'main.do',
            '// @lsp-cd: "base"\ncd "`somedir\'"\ndo sub\n',
        );
        const uri = URI.file(main).toString();
        await document_store.open(uri, fs.readFileSync(main, 'utf8'), 1);
        const state = document_store.get(uri)!;
        const sub_call = state.forward_calls.find(c => c.raw_path === 'sub')!;
        // The dynamic cd is skipped, so the directive WD (base) still applies.
        expect(sub_call.working_directory).toBe(path.join(test_dir, 'base'));
    });

    // ── Nested: call-site WD propagates into the callee (codex review #1) ─────

    it('resolves a grandchild relative to the WD active at the parent call site', async () => {
        // parent (in test_dir) cd's into data/, then do's a child physically in
        // scripts/. In Stata the cwd stays `data` while child runs, so child's
        // relative `do helper` must resolve to data/helper.do — NOT
        // scripts/helper.do (child's own directory).
        write_file('scripts/child.do', 'do helper\nglobal from_child = 1\n');
        write_file('data/helper.do', 'global from_helper = 1\n');
        const parent = write_file('parent.do', 'cd "data"\ndo ../scripts/child\n');
        const uri = URI.file(parent).toString();
        const content = fs.readFileSync(parent, 'utf8');

        const resolved = await scope_resolver.resolve(uri, content);
        // Forward-call symbols are visible after the call site (line 1).
        const visible = get_visible_symbols_at(resolved, 100);
        // Direct child's global is visible.
        expect(visible.globalMacros.has('from_child')).toBe(true);
        // Grandchild found only via the call-site WD (data/), proving the
        // effective call-site WD propagated into the nested resolution.
        expect(visible.globalMacros.has('from_helper')).toBe(true);
    });

    // ── Criterion 5: go-to-definition uses per-call WD ────────────────────────

    it('go-to-definition on a path after cd jumps to the WD-relative file', async () => {
        write_file('raw/import.do', 'global g = 1\n');
        const main = write_file('main.do', 'cd "raw"\ndo import\n');
        const uri = URI.file(main).toString();
        await document_store.open(uri, fs.readFileSync(main, 'utf8'), 1);

        const definition_provider = new DefinitionProvider();
        definition_provider.set_workspace_roots([test_dir]);

        const state = document_store.get(uri)!;
        // Cursor on `import` (line 1). Column inside the path token.
        const result = await definition_provider.get_definition(
            state,
            { line: 1, character: 4 },
            undefined,
            state.context_tracker,
            scope_resolver,
        );
        const target = Array.isArray(result) ? result[0] : result;
        expect(target).not.toBeNull();
        expect(target!.uri).toBe(file_uri('raw/import.do'));
    });
});
