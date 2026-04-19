/**
 * Find-references regression guard - same-named programs in disjoint
 * dep-graph branches stay distinct (issue #135, Rule 2).
 *
 * Rule 1 (same identity for reachable redeclarations) only applies within
 * the reachable chain. Two programs named `helper` in unrelated analyses
 * with no `do`/`run`/`include` edge between them remain distinct identities.
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

describe('Find-references - disjoint branches (Rule 2 regression guard)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-disjoint-'));
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

    it('does not pool same-named programs across unrelated dep-graph branches', async () => {
        // Two unrelated "analyses" that each define a program named `helper`.
        // No do/run/include edges between them — disjoint branches.
        const analysis_a_path = join(test_temp_dir, 'analysis_a.do');
        writeFileSync(
            analysis_a_path,
            'program define helper\n    di "A"\nend\nhelper\n',
        );

        const analysis_b_path = join(test_temp_dir, 'analysis_b.do');
        writeFileSync(
            analysis_b_path,
            'program define helper\n    di "B"\nend\nhelper\n',
        );

        await indexer.initialize([test_temp_dir]);
        const a_uri = URI.file(analysis_a_path).toString();
        const b_uri = URI.file(analysis_b_path).toString();
        const a_content = 'program define helper\n    di "A"\nend\nhelper\n';
        await document_store.open(a_uri, a_content, 1);
        const document_state = document_store.get(a_uri)!;

        // Cursor on `helper` call at line 3 in analysis_a.do
        const helper_char = a_content.split('\n')[3].indexOf('helper');
        const locations = await provider.get_references(
            document_state,
            { line: 3, character: helper_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        // Must NOT include analysis_b.do.
        const b_hits = locations.filter(l => l.uri === b_uri);
        expect(b_hits.length).toBe(0);
    });
});
