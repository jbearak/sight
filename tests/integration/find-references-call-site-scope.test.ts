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
});
