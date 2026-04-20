/**
 * Find-references — variable results sorted reachable-first (issue #135, Task 13).
 *
 * Variables scan the full workspace because dataset columns like `id`, `year`,
 * `analysis_sample` are legitimately shared across unrelated analyses (see
 * docs/find-references.md). That tier keeps unrelated hits in the result set,
 * but to surface the high-relevance matches first the sort groups
 * dep-graph-reachable URIs ahead of unrelated URIs. This guard pins that
 * ordering so a future refactor can't silently drop it.
 *
 * Covers both wiring variants:
 *  - Fallback path (tests that construct ReferencesProvider with no scope
 *    resolver — hit the fallback branch in collect_references).
 *  - Production path (scope resolver wired, matching server-factory.ts).
 *
 * Task 13 shipped as a regression guard because the reachable-first tier
 * already existed before issue #135 (landed in the older commit that scoped
 * find-references to dep-graph-related files). This test pins the behavior so
 * a future refactor of either branch can't silently drop it.
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

describe('Find-references - variables sorted reachable-first', () => {
    let test_temp_dir: string;
    let indexer: WorkspaceIndexer;
    let dep_graph: DependencyGraph;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver | undefined;
    let forward_scope_resolver: ForwardScopeResolver | undefined;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'refs-var-sort-'));
        indexer = new WorkspaceIndexer();
        dep_graph = new DependencyGraph();
        indexer.set_dependency_graph(dep_graph);
        document_store = new DocumentStore();
        scope_resolver = undefined;
        forward_scope_resolver = undefined;
    });

    afterEach(() => {
        try { scope_resolver?.dispose(); } catch (_err) { /* ignore disposal error */ }
        try { forward_scope_resolver?.dispose(); } catch (_err) { /* ignore disposal error */ }
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    // File names are chosen so the non-reachable URI sorts BEFORE the
    // reachable ones lexically (aaa_unrelated.do < main.do < sub.do). Without
    // the reachable-first tier the assertion would fail.
    const build_fixture = (): {
        main_uri: string;
        sub_uri: string;
        unrelated_uri: string;
        main_content: string;
    } => {
        const sub_path = join(test_temp_dir, 'sub.do');
        writeFileSync(sub_path, 'di cm_birth\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content = [
            'gen cm_birth = 1',    // line 0 decl
            'do "sub.do"',         // line 1
            'di cm_birth',         // line 2 ref
        ].join('\n');
        writeFileSync(main_path, main_content);

        const unrelated_path = join(test_temp_dir, 'aaa_unrelated.do');
        writeFileSync(unrelated_path, 'di cm_birth\n');

        return {
            main_uri: URI.file(main_path).toString(),
            sub_uri: URI.file(sub_path).toString(),
            unrelated_uri: URI.file(unrelated_path).toString(),
            main_content,
        };
    };

    const assert_reachable_first = (
        locations: { uri: string }[],
        main_uri: string,
        sub_uri: string,
        unrelated_uri: string,
    ): void => {
        const ordered_uris = locations.map(l => l.uri);
        expect(ordered_uris).toContain(main_uri);
        expect(ordered_uris).toContain(sub_uri);
        expect(ordered_uris).toContain(unrelated_uri);

        const first_reachable_idx = Math.min(
            ordered_uris.indexOf(main_uri),
            ordered_uris.indexOf(sub_uri),
        );
        const last_reachable_idx = Math.max(
            ordered_uris.lastIndexOf(main_uri),
            ordered_uris.lastIndexOf(sub_uri),
        );
        const unrelated_idx = ordered_uris.indexOf(unrelated_uri);

        expect(first_reachable_idx).toBeLessThan(unrelated_idx);
        expect(last_reachable_idx).toBeLessThan(unrelated_idx);
    };

    it('fallback path (no scope resolver): reachable URIs precede unrelated URIs', async () => {
        const { main_uri, sub_uri, unrelated_uri, main_content } = build_fixture();
        const provider = new ReferencesProvider();

        await indexer.initialize([test_temp_dir]);
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const cm_char = main_content.split('\n')[2].indexOf('cm_birth');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: cm_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        assert_reachable_first(locations, main_uri, sub_uri, unrelated_uri);
    });

    it('production path (scope resolver wired): reachable URIs still precede unrelated URIs', async () => {
        const { main_uri, sub_uri, unrelated_uri, main_content } = build_fixture();

        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
            max_forward_depth: 10,
        });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        scope_resolver.set_dependency_graph(dep_graph);
        const provider = new ReferencesProvider(scope_resolver);

        await indexer.initialize([test_temp_dir]);
        await document_store.open(main_uri, main_content, 1);
        const document_state = document_store.get(main_uri)!;

        const cm_char = main_content.split('\n')[2].indexOf('cm_birth');
        const locations = await provider.get_references(
            document_state,
            { line: 2, character: cm_char },
            { includeDeclaration: true },
            indexer,
            document_state.context_tracker,
        );

        assert_reachable_first(locations, main_uri, sub_uri, unrelated_uri);
    });
});
