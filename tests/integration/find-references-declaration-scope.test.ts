/**
 * Integration tests for issue #129: references.ts::find_definitions must
 * respect call-site order for non-variable kinds but keep variables
 * workspace-wide (dataset-column semantics).
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

function build_pipeline() {
    const the_indexer = new WorkspaceIndexer();
    const the_dep_graph = new DependencyGraph();
    the_indexer.set_dependency_graph(the_dep_graph);
    const the_scope_resolver = new ScopeResolver();
    the_scope_resolver.set_dependency_graph(the_dep_graph);
    const the_forward_resolver = new ForwardScopeResolver(the_scope_resolver, {
        max_forward_depth: 10,
    });
    the_scope_resolver.set_forward_scope_resolver(the_forward_resolver);
    const the_refs_provider = new ReferencesProvider(the_scope_resolver);
    const the_document_store = new DocumentStore();
    return {
        indexer: the_indexer,
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_resolver,
        references_provider: the_refs_provider,
        document_store: the_document_store,
        dependency_graph: the_dep_graph,
    };
}

describe('find-references — declaration call-site scope (issue #129)', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-decl-scope-'));
        pipeline = build_pipeline();
    });

    afterEach(() => {
        try { pipeline?.scope_resolver?.dispose(); } catch {}
        try { pipeline?.forward_scope_resolver?.dispose(); } catch {}
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('pools same-name program declarations across forward-called files in the reachable chain (issue #135)', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `program define shared_prog\nend\nshared_prog\ndo "branch_b.do"\n`;
        writeFileSync(main_path, main_content);

        writeFileSync(join(test_temp_dir, 'branch_b.do'), `program define shared_prog\nend\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        // Cursor on `shared_prog` at line 2 (before `do "branch_b.do"` on line 3).
        const cursor_char = main_content.split('\n')[2].indexOf('shared_prog') + 3;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        // Issue #135: same name + same kind in the dep-graph-reachable chain
        // is one identity, regardless of call-site order. branch_b.do is
        // reachable via `do "branch_b.do"`, so its declaration pools.
        const branch_b_uri = URI.file(join(test_temp_dir, 'branch_b.do')).toString();
        expect(locations.some(loc => loc.uri === branch_b_uri)).toBe(true);
        // main's own declaration must still be included.
        expect(locations.some(loc => loc.uri === main_uri && loc.range.start.line === 0)).toBe(true);
    });

    it('includes a program declared in a visible forward-called file', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `do "defs.do"\nshared_prog\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        writeFileSync(defs_path, `program define shared_prog\nend\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[1].indexOf('shared_prog') + 3;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 1, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const defs_uri = URI.file(defs_path).toString();
        expect(locations.some(loc => loc.uri === defs_uri)).toBe(true);
    });

    it('includes a declaration inherited through a parent forward call', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `do "leaf.do"\ndo "child.do"\n`;
        writeFileSync(main_path, main_content);

        const leaf_path = join(test_temp_dir, 'leaf.do');
        writeFileSync(leaf_path, `program define deep_prog\nend\n`);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content = `* @lsp-done-by: "main.do"\n\ndeep_prog\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        const cursor_char = child_content.split('\n')[2].indexOf('deep_prog') + 3;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const leaf_uri = URI.file(leaf_path).toString();
        expect(locations.some(loc => loc.uri === leaf_uri)).toBe(true);
    });

    it('pools same-name backward parents in the reachable chain (issue #135)', async () => {
        // Under Rule 1, same name + same kind within the reachable chain
        // pool into one identity regardless of precedence tiebreaks. Two
        // @lsp-done-by parents both defining `shared_prog` therefore both
        // contribute declarations — the earlier parent is no longer masked
        // by the lattermost-wins precedence rule.
        const earlier_parent_path = join(test_temp_dir, 'earlier_parent.do');
        writeFileSync(earlier_parent_path, `program define shared_prog\nend\n`);

        const later_parent_path = join(test_temp_dir, 'later_parent.do');
        writeFileSync(later_parent_path, `program define shared_prog\nend\n`);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `* @lsp-done-by: "earlier_parent.do"\n` +
            `* @lsp-done-by: "later_parent.do"\n\n` +
            `shared_prog\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        const cursor_char = child_content.split('\n')[3].indexOf('shared_prog') + 3;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 3, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const earlier_parent_uri = URI.file(earlier_parent_path).toString();
        const later_parent_uri = URI.file(later_parent_path).toString();

        expect(locations.some(loc => loc.uri === later_parent_uri)).toBe(true);
        expect(locations.some(loc => loc.uri === earlier_parent_uri)).toBe(true);
        expect(locations.some(loc => loc.uri === child_uri && loc.range.start.line === 3)).toBe(true);
    });

    it('pools same-name program declarations from masked forward callees in the reachable chain (issue #135)', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `do "earlier.do"\n` +
            `do "later.do"\n` +
            `shared_prog\n`;
        writeFileSync(main_path, main_content);

        const earlier_path = join(test_temp_dir, 'earlier.do');
        writeFileSync(earlier_path, `program define shared_prog\nend\n`);

        const later_path = join(test_temp_dir, 'later.do');
        writeFileSync(later_path, `program define shared_prog\nend\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[2].indexOf('shared_prog') + 3;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        // Issue #135: same name + same kind in the reachable chain is one
        // identity. The earlier and later callees are both dep-graph-
        // reachable siblings, so both declarations pool with main's call.
        const earlier_uri = URI.file(earlier_path).toString();
        const later_uri = URI.file(later_path).toString();

        expect(locations.some(loc => loc.uri === later_uri)).toBe(true);
        expect(locations.some(loc => loc.uri === earlier_uri)).toBe(true);
        expect(locations.some(loc => loc.uri === main_uri && loc.range.start.line === 2)).toBe(true);
    });

    it('does not pool local macros through done-by', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `local shared 1\ndo "child.do"\n`;
        writeFileSync(main_path, main_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content = `* @lsp-done-by: "main.do"\n\ndisplay \`shared'\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        const cursor_char = child_content.split('\n')[2].indexOf('shared') + 2;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const main_uri = URI.file(main_path).toString();
        expect(locations.every(loc => loc.uri !== main_uri)).toBe(true);
    });

    it('pools local macros through included-by', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `local shared 1\ninclude "child.do"\n`;
        writeFileSync(main_path, main_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content = `* @lsp-included-by: "main.do"\n\ndisplay \`shared'\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        const cursor_char = child_content.split('\n')[2].indexOf('shared') + 2;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const main_uri = URI.file(main_path).toString();
        expect(locations.some(loc => loc.uri === main_uri && loc.range.start.line === 0)).toBe(true);
    });

    it('does not leak a local macro from an included ancestor across a downstream done-by boundary', async () => {
        const grand_path = join(test_temp_dir, 'grand.do');
        const grand_content = `local shared 1\ninclude "parent.do"\n`;
        writeFileSync(grand_path, grand_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content =
            `* @lsp-included-by: "grand.do"\n` +
            `do "child.do"\n`;
        writeFileSync(parent_path, parent_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `* @lsp-done-by: "parent.do"\n\n` +
            `display \`shared'\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const child_uri = URI.file(child_path).toString();
        await pipeline.document_store.open(child_uri, child_content, 1);
        const document_state = pipeline.document_store.get(child_uri)!;

        const cursor_char = child_content.split('\n')[2].indexOf('shared') + 2;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 2, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const grand_uri = URI.file(grand_path).toString();
        expect(locations.every(loc => loc.uri !== grand_uri)).toBe(true);
        expect(locations.some(loc => loc.uri === child_uri && loc.range.start.line === 2)).toBe(true);
    });

    it('pools variable declarations workspace-wide regardless of cursor position', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `gen my_var = 1\nlist my_var\n`;
        writeFileSync(main_path, main_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        writeFileSync(unrelated_path, `gen my_var = 99\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[1].indexOf('my_var') + 2;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 1, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const unrelated_uri = URI.file(unrelated_path).toString();
        expect(locations.some(loc => loc.uri === unrelated_uri)).toBe(true);
    });

    it('includes a variable declaration in a visible forward-called file', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `do "uses_var.do"\nlist my_var\n`;
        writeFileSync(main_path, main_content);

        const uses_var_path = join(test_temp_dir, 'uses_var.do');
        writeFileSync(uses_var_path, `gen my_var = 1\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[1].indexOf('my_var') + 2;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 1, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker,
        );

        const uses_var_uri = URI.file(uses_var_path).toString();
        expect(locations.some(loc => loc.uri === uses_var_uri)).toBe(true);
    });
});
