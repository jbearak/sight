/**
 * Find-references regression guard - local macros do NOT pool across do/run
 * boundaries (issue #135, Rule 2 companion).
 *
 * Stata's sequential execution rules scope local macros to the enclosing
 * do-file. A local declared in a `do`-called child is a distinct identity
 * from a same-name local in the parent. The references provider preserves
 * this via Tier 1 (include-chain only) and via
 * `can_reference_forward_site`'s include-only rule for local_macros.
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

describe('Find-references - local macro do/run boundary (regression guard)', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let provider: ReferencesProvider;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-local-boundary-'));
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

    async function expect_no_local_pooling_across_boundary(
        call_type: 'do' | 'run'
    ): Promise<void> {
        const child_path = join(test_temp_dir, 'child.do');
        const child_content = [
            'local fruit cherry',           // line 0 (child's local)
            'di "`fruit\'"',                // line 1 (child's ref)
        ].join('\n');
        writeFileSync(child_path, child_content);

        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content = [
            'local fruit apple',            // line 0 (parent's local)
            `${call_type} "child.do"`,      // line 1
            'di "`fruit\'"',                // line 2 (parent's ref)
        ].join('\n');
        writeFileSync(parent_path, parent_content);

        await indexer.initialize([test_temp_dir]);
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();
        await document_store.open(parent_uri, parent_content, 1);
        const document_state = document_store.get(parent_uri)!;

        // Cursor on `fruit' at line 2 (parent's)
        const fruit_char = parent_content.split('\n')[2].indexOf('fruit');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: fruit_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        // Must NOT include the child's decl or ref.
        const child_hits = locations.filter(l => l.uri === child_uri);
        expect(child_hits.length).toBe(0);
    }

    for (const my_call_type of ['do', 'run'] as const) {
        it(
            `does not pool local macros across ${my_call_type} boundary`,
            async () => {
                await expect_no_local_pooling_across_boundary(my_call_type);
            }
        );
    }
});
