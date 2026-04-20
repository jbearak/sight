/**
 * Find-references - same-name global redeclarations across do/run pool into
 * one identity (issue #135).
 *
 * A global set in a parent and the same-name global set in a do-called child
 * are the same identity from the programmer's perspective. This regression
 * guard verifies that Task 8's identity-split collapse in
 * `collect_visible_reference_uris` extends to the global-macro kind across
 * `do`/`run` edges.
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

describe('Find-references - redeclared global across do/run (issue #135)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-redecl-global-'));
        indexer = new WorkspaceIndexer();
        const dep_graph = new DependencyGraph();
        indexer.set_dependency_graph(dep_graph);
        document_store = new DocumentStore();

        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        scope_resolver.set_dependency_graph(dep_graph);

        provider = new ReferencesProvider(scope_resolver);
    });

    afterEach(() => {
        try { scope_resolver?.dispose(); } catch {}
        try { forward_scope_resolver?.dispose(); } catch {}
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('pools global declarations and references across do/run boundary', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'global data "child_value"',    // line 0 decl
            'di "$data in child"',          // line 1 ref
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'global data "parent_value"',   // line 0 decl (parent)
            'do "child.do"',                // line 1
            'di "$data in parent"',         // line 2 ref
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const child_uri = URI.file(child_path).toString();
        const parent_uri = URI.file(parent_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        const document_state = document_store.get(parent_uri)!;

        // Cursor on $data at line 2 (after do)
        const data_char = parent_content.split('\n')[2].indexOf('$data');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: data_char + 1 },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        const parent_lines = locations
            .filter(l => l.uri === parent_uri)
            .map(l => l.range.start.line)
            .sort((a, b) => a - b);
        const child_lines = locations
            .filter(l => l.uri === child_uri)
            .map(l => l.range.start.line)
            .sort((a, b) => a - b);

        expect(parent_lines).toContain(0);  // parent decl
        expect(parent_lines).toContain(2);  // parent ref
        expect(child_lines).toContain(0);   // child decl
        expect(child_lines).toContain(1);   // child ref
    });
});
