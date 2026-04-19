/**
 * Integration tests for issue #127: find-references classifier must respect
 * call-site order. A WORD token should not be classified as a program,
 * scalar, or matrix just because a matching definition lives in any
 * dependency-graph-related file — only files reachable at the cursor line
 * (backward chain + forward calls before the cursor) should count.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { ReferencesProvider } from '../../src/providers/references';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { join } from 'path';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';

/**
 * Wire the full find-references pipeline the same way server-factory.ts does.
 * The scope_resolver and forward_scope_resolver are attached to the indexer's
 * dependency graph so auto-backward-discovery and forward-call resolution work.
 */
function build_pipeline(): {
    indexer: WorkspaceIndexer;
    scope_resolver: ScopeResolver;
    forward_scope_resolver: ForwardScopeResolver;
    references_provider: ReferencesProvider;
    document_store: DocumentStore;
    dependency_graph: DependencyGraph;
} {
    const the_indexer = new WorkspaceIndexer();
    const the_dep_graph = new DependencyGraph();
    the_indexer.set_dependency_graph(the_dep_graph);

    const the_scope_resolver = new ScopeResolver();
    the_scope_resolver.set_dependency_graph(the_dep_graph);

    const the_forward_resolver = new ForwardScopeResolver(the_scope_resolver, {
        max_forward_depth: 10,
    });
    the_scope_resolver.set_forward_scope_resolver(the_forward_resolver);

    const the_references_provider = new ReferencesProvider(the_scope_resolver);
    const the_document_store = new DocumentStore();

    return {
        indexer: the_indexer,
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_resolver,
        references_provider: the_references_provider,
        document_store: the_document_store,
        dependency_graph: the_dep_graph,
    };
}

describe('Find References - call-site scope filtering (issue #127)', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-scope-'));
        pipeline = build_pipeline();
    });

    afterEach(() => {
        try {
            pipeline?.scope_resolver?.dispose();
        } catch {}
        try {
            pipeline?.forward_scope_resolver?.dispose();
        } catch {}
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('does not classify a WORD as a program when the defining file has not been called yet (regression)', async () => {
        // main.do references `shared_prog` on line 0, before the `do "defs.do"`
        // on line 1 that would bring defs.do's program into scope.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `shared_prog\n` +
            `do "defs.do"\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        const defs_content =
            `program define shared_prog\n` +
            `end\n`;
        writeFileSync(defs_path, defs_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `shared_prog` at line 0 in main.do.
        const cursor_line = 0;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // defs.do has not run yet at line 0 — classifier must not return
        // `program`, so defs.do's program definition must not be pooled in.
        const defs_uri = URI.file(defs_path).toString();
        const leaks_defs = locations.some(loc => loc.uri === defs_uri);
        expect(leaks_defs).toBe(false);
    });

    it('classifies a WORD as a program when the cursor is after the do call that brings it into scope', async () => {
        // Same files as the regression test, plus a second reference to
        // `shared_prog` on a line that is AFTER the do "defs.do" call.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `shared_prog\n` +
            `do "defs.do"\n` +
            `shared_prog\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        const defs_content =
            `program define shared_prog\n` +
            `end\n`;
        writeFileSync(defs_path, defs_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `shared_prog` at line 2 (AFTER the do on line 1).
        const cursor_line = 2;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // defs.do IS reachable at line 2 — classification should return
        // program and defs.do's declaration should be pooled in.
        const defs_uri = URI.file(defs_path).toString();
        const has_defs_ref = locations.some(loc => loc.uri === defs_uri);
        expect(has_defs_ref).toBe(true);
    });

    it('classifies via backward directive — parent programs are always in scope in the child', async () => {
        // main.do defines `shared_prog` then does child.do. child.do's
        // header pins the backward link with @lsp-done-by. Regardless of
        // the cursor line in child, parent's programs must be in scope
        // (backward chain = always visible).
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `program define shared_prog\n` +
            `end\n` +
            `do "child.do"\n`;
        writeFileSync(main_path, main_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `* @lsp-done-by: "main.do"\n` +
            `\n` +
            `shared_prog\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        // Cursor on `shared_prog` at line 2 in child.do.
        const cursor_line = 2;
        const cursor_char = child_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // Parent's program definition should be pooled in (classifier returned program).
        const main_uri = URI.file(main_path).toString();
        const has_parent_def = locations.some(loc => loc.uri === main_uri);
        expect(has_parent_def).toBe(true);
    });

    it('does not pool refs across unrelated branches that share a program name', async () => {
        // main.do does branch_a then branch_b. Both branches define a
        // program named `common_helper`. The cursor in main.do is placed
        // on line 0 — BEFORE either do call — so neither branch is in
        // scope yet and the classifier must not return program.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `common_helper\n` +
            `do "branch_a.do"\n` +
            `do "branch_b.do"\n`;
        writeFileSync(main_path, main_content);

        const branch_a_path = join(test_temp_dir, 'branch_a.do');
        const branch_a_content =
            `program define common_helper\n` +
            `end\n`;
        writeFileSync(branch_a_path, branch_a_content);

        const branch_b_path = join(test_temp_dir, 'branch_b.do');
        const branch_b_content =
            `program define common_helper\n` +
            `end\n`;
        writeFileSync(branch_b_path, branch_b_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `common_helper` at line 0 in main.do.
        const cursor_line = 0;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('common_helper') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // Neither branch has been called yet at cursor line 0 — nothing
        // from either branch should be pooled.
        const branch_a_uri = URI.file(branch_a_path).toString();
        const branch_b_uri = URI.file(branch_b_path).toString();
        const leaks_branch_a = locations.some(loc => loc.uri === branch_a_uri);
        const leaks_branch_b = locations.some(loc => loc.uri === branch_b_uri);
        expect(leaks_branch_a).toBe(false);
        expect(leaks_branch_b).toBe(false);
    });

    it('respects transitive forward calls for call-site filtering', async () => {
        // main.do does mid.do at line 5; mid.do does leaf.do at line 3;
        // leaf.do defines `deep_prog`. Nested call sites carry the
        // outermost parent's call line, so the filter is correct
        // transitively.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `* line 0\n` +
            `* line 1\n` +
            `deep_prog\n` +                 // line 2 — BEFORE any do
            `* line 3\n` +
            `* line 4\n` +
            `do "mid.do"\n` +               // line 5
            `* line 6\n` +
            `* line 7\n` +
            `* line 8\n` +
            `* line 9\n` +
            `deep_prog\n`;                  // line 10 — AFTER do "mid.do"
        writeFileSync(main_path, main_content);

        const mid_path = join(test_temp_dir, 'mid.do');
        const mid_content =
            `* line 0\n` +
            `* line 1\n` +
            `* line 2\n` +
            `do "leaf.do"\n`;               // line 3
        writeFileSync(mid_path, mid_content);

        const leaf_path = join(test_temp_dir, 'leaf.do');
        const leaf_content =
            `program define deep_prog\n` +
            `end\n`;
        writeFileSync(leaf_path, leaf_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const leaf_uri = URI.file(leaf_path).toString();

        // (a) Cursor on line 10 — AFTER do "mid.do" on line 5. leaf.do's
        //     transitive call site carries call_line=5, so deep_prog is
        //     visible and classification returns program.
        const after_cursor_line = 10;
        const after_cursor_char = main_content
            .split('\n')[after_cursor_line]
            .indexOf('deep_prog') + 3;
        const after_locations = await pipeline.references_provider.get_references(
            document_state,
            { line: after_cursor_line, character: after_cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );
        const after_has_leaf = after_locations.some(loc => loc.uri === leaf_uri);
        expect(after_has_leaf).toBe(true);

        // (b) Cursor on line 2 — BEFORE do "mid.do" on line 5. Nothing
        //     is in scope yet; classification must not return program.
        const before_cursor_line = 2;
        const before_cursor_char = main_content
            .split('\n')[before_cursor_line]
            .indexOf('deep_prog') + 3;
        const before_locations = await pipeline.references_provider.get_references(
            document_state,
            { line: before_cursor_line, character: before_cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );
        const before_has_leaf = before_locations.some(loc => loc.uri === leaf_uri);
        expect(before_has_leaf).toBe(false);
    });

    it('scans references visible only through a backward parent forward call', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `do "defs.do"\n` +
            `do "helper.do"\n` +
            `do "child.do"\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        writeFileSync(defs_path, `program define deep_prog\nend\n`);

        const helper_path = join(test_temp_dir, 'helper.do');
        const helper_content =
            `capture noisily deep_prog\n` +
            `deep_prog\n`;
        writeFileSync(helper_path, helper_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content = `* @lsp-done-by: "main.do"\n\ndeep_prog\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        const cursor_char = child_content
            .split('\n')[2]
            .indexOf('deep_prog') + 3;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        const defs_uri = URI.file(defs_path).toString();
        const helper_uri = URI.file(helper_path).toString();
        expect(locations.some(loc => loc.uri === defs_uri)).toBe(true);
        expect(locations.some(loc => loc.uri === helper_uri && loc.range.start.line === 1)).toBe(true);
    });

    it('keeps pre-fix behavior when ReferencesProvider is constructed without a scope_resolver', async () => {
        // The fallback path is intended only for test-only setups that
        // construct `new ReferencesProvider()`. Production always wires a
        // scope_resolver. This test pins the fallback so those setups do
        // not regress.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `shared_prog\n` +
            `do "defs.do"\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        const defs_content =
            `program define shared_prog\n` +
            `end\n`;
        writeFileSync(defs_path, defs_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        // Build a references_provider WITHOUT a scope_resolver.
        const fallback_provider = new ReferencesProvider();

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_line = 0;
        const cursor_char = main_content
            .split('\n')[cursor_line]
            .indexOf('shared_prog') + 3;

        const locations = await fallback_provider.get_references(
            document_state,
            { line: cursor_line, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        // Pre-fix behavior: without scope_resolver, the classifier uses
        // get_related_uris and pools defs.do in. Pin that behavior so
        // test-only setups don't regress.
        const defs_uri = URI.file(defs_path).toString();
        const pools_defs_in_fallback = locations.some(loc => loc.uri === defs_uri);
        expect(pools_defs_in_fallback).toBe(true);
    });
});
