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

    it('excludes a program declared in a not-yet-reached forward-called file', async () => {
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

        const branch_b_uri = URI.file(join(test_temp_dir, 'branch_b.do')).toString();
        expect(locations.every(loc => loc.uri !== branch_b_uri)).toBe(true);
        // Sanity: main's own declaration must be included.
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
