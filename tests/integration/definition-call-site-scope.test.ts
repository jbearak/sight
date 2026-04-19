/**
 * Integration tests for issue #129: definition.ts::resolve_non_macro_symbols
 * must consult forward-call symbols visible at the cursor line, and it
 * must prefer in-scope variable definitions over workspace-wide fallbacks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WorkspaceIndexer } from '../../src/indexer';
import { DefinitionProvider } from '../../src/providers/definition';
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
    const the_definition_provider = new DefinitionProvider();
    const the_document_store = new DocumentStore();
    return {
        indexer: the_indexer,
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_resolver,
        definition_provider: the_definition_provider,
        document_store: the_document_store,
        dependency_graph: the_dep_graph,
    };
}

describe('Go-to-Definition - call-site scope filtering (issue #129)', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'def-scope-'));
        pipeline = build_pipeline();
    });

    afterEach(() => {
        try { pipeline?.scope_resolver?.dispose(); } catch {}
        try { pipeline?.forward_scope_resolver?.dispose(); } catch {}
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('falls through to workspace fallback when forward-called file is not yet visible', async () => {
        // Sanity regression test: cursor is on line 0, before the do "defs.do"
        // on line 1. The in-scope check misses (defs.do is not yet visible),
        // so control falls through to the workspace-indexer fallback, which
        // correctly returns defs.do's program definition as a workspace-wide
        // match. This is the specified behavior — the fix only tightens the
        // *in-scope* lookup; the workspace fallback is intentionally unchanged
        // (see spec "Concrete changes / src/providers/definition.ts").
        // The meaningful call-site filtering gain is exercised by the
        // 'isolates unrelated branches' scenario below.
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `shared_prog\ndo "defs.do"\n`;
        writeFileSync(main_path, main_content);

        const defs_path = join(test_temp_dir, 'defs.do');
        writeFileSync(defs_path, `program define shared_prog\nend\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[0].indexOf('shared_prog') + 3;
        const result = await pipeline.definition_provider.get_definition(
            document_state,
            { line: 0, character: cursor_char },
            undefined,
            document_state.context_tracker,
            pipeline.scope_resolver,
            pipeline.indexer,
        );

        const defs_uri = URI.file(defs_path).toString();
        expect(result).not.toBeNull();
        const locations = Array.isArray(result) ? result : [result!];
        expect(locations.some(loc => loc.uri === defs_uri)).toBe(true);
    });

    it('resolves a program to a visible forward-called file', async () => {
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
        const result = await pipeline.definition_provider.get_definition(
            document_state,
            { line: 1, character: cursor_char },
            undefined,
            document_state.context_tracker,
            pipeline.scope_resolver,
            pipeline.indexer,
        );

        const defs_uri = URI.file(defs_path).toString();
        expect(result).not.toBeNull();
        const locations = Array.isArray(result) ? result : [result!];
        expect(locations.some(loc => loc.uri === defs_uri)).toBe(true);
    });

    it('prefers an in-scope variable definition over a workspace-wide fallback', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `do "uses_var.do"\n`;
        writeFileSync(main_path, main_content);

        const uses_var_path = join(test_temp_dir, 'uses_var.do');
        const uses_var_content = `gen my_var = 1\nlist my_var\n`;
        writeFileSync(uses_var_path, uses_var_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        writeFileSync(unrelated_path, `gen my_var = 99\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const uses_var_uri = URI.file(uses_var_path).toString();
        await pipeline.document_store.open(uses_var_uri, uses_var_content, 1);
        const document_state = pipeline.document_store.get(uses_var_uri)!;

        const cursor_char = uses_var_content.split('\n')[1].indexOf('my_var') + 2;
        const result = await pipeline.definition_provider.get_definition(
            document_state,
            { line: 1, character: cursor_char },
            undefined,
            document_state.context_tracker,
            pipeline.scope_resolver,
            pipeline.indexer,
        );

        expect(result).not.toBeNull();
        const locations = Array.isArray(result) ? result : [result!];
        expect(locations.some(loc => loc.uri === uses_var_uri && loc.range.start.line === 0)).toBe(true);
        const unrelated_uri = URI.file(unrelated_path).toString();
        expect(locations.every(loc => loc.uri !== unrelated_uri)).toBe(true);
    });

    it('falls back to the workspace-wide Location[] when no in-scope variable def exists', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content = `list my_var\n`;
        writeFileSync(main_path, main_content);

        const unrelated_path = join(test_temp_dir, 'unrelated.do');
        writeFileSync(unrelated_path, `gen my_var = 1\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[0].indexOf('my_var') + 2;
        const result = await pipeline.definition_provider.get_definition(
            document_state,
            { line: 0, character: cursor_char },
            undefined,
            document_state.context_tracker,
            pipeline.scope_resolver,
            pipeline.indexer,
        );

        const unrelated_uri = URI.file(unrelated_path).toString();
        expect(result).not.toBeNull();
        const locations = Array.isArray(result) ? result : [result!];
        expect(locations.some(loc => loc.uri === unrelated_uri)).toBe(true);
    });

    it('isolates unrelated branches with same-named programs', async () => {
        writeFileSync(join(test_temp_dir, 'branch_a.do'), `program define shared_prog\nend\n`);
        writeFileSync(join(test_temp_dir, 'branch_b.do'), `program define shared_prog\nend\n`);

        const caller_path = join(test_temp_dir, 'caller.do');
        const caller_content = `do "branch_a.do"\nshared_prog\n`;
        writeFileSync(caller_path, caller_content);
        await pipeline.indexer.initialize([test_temp_dir]);

        const caller_uri = URI.file(caller_path).toString();
        await pipeline.document_store.open(caller_uri, caller_content, 1);
        const document_state = pipeline.document_store.get(caller_uri)!;

        const cursor_char = caller_content.split('\n')[1].indexOf('shared_prog') + 3;
        const result = await pipeline.definition_provider.get_definition(
            document_state,
            { line: 1, character: cursor_char },
            undefined,
            document_state.context_tracker,
            pipeline.scope_resolver,
            pipeline.indexer,
        );

        const branch_a_uri = URI.file(join(test_temp_dir, 'branch_a.do')).toString();
        const branch_b_uri = URI.file(join(test_temp_dir, 'branch_b.do')).toString();
        expect(result).not.toBeNull();
        const locations = Array.isArray(result) ? result : [result!];
        expect(locations.some(loc => loc.uri === branch_a_uri)).toBe(true);
        expect(locations.every(loc => loc.uri !== branch_b_uri)).toBe(true);
    });

    it('resolves transitively through nested forward calls', async () => {
        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            `* line 0\n* line 1\n* line 2\n* line 3\n* line 4\n` +
            `do "mid.do"\n* line 6\n* line 7\n* line 8\n* line 9\ndeep_prog\n`;
        writeFileSync(main_path, main_content);

        const mid_path = join(test_temp_dir, 'mid.do');
        const mid_content = `* line 0\n* line 1\n* line 2\ndo "leaf.do"\n`;
        writeFileSync(mid_path, mid_content);

        const leaf_path = join(test_temp_dir, 'leaf.do');
        writeFileSync(leaf_path, `program define deep_prog\nend\n`);

        await pipeline.indexer.initialize([test_temp_dir]);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const cursor_char = main_content.split('\n')[10].indexOf('deep_prog') + 3;
        const result = await pipeline.definition_provider.get_definition(
            document_state,
            { line: 10, character: cursor_char },
            undefined,
            document_state.context_tracker,
            pipeline.scope_resolver,
            pipeline.indexer,
        );

        const leaf_uri = URI.file(leaf_path).toString();
        expect(result).not.toBeNull();
        const locations = Array.isArray(result) ? result : [result!];
        expect(locations.some(loc => loc.uri === leaf_uri)).toBe(true);
    });
});
