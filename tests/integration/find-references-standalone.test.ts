/**
 * Find-references vs the standalone directive (issue #208, locked
 * "consistent" decision): the dep-graph/raw-directive connectivity floor
 * (get_related_uris) is deliberately UNCHANGED by standalone. References
 * for a global still traverse raw do/run/include connectivity involving a
 * standalone file — while that same file's own DIAGNOSTICS treat the
 * parent-defined global as undefined (strict resolution). This test pins
 * that the two behaviors coexist by design; see docs/find-references.md.
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

    const the_forward_resolver = new ForwardScopeResolver(
        the_scope_resolver, { max_forward_depth: 10 }
    );
    the_scope_resolver.set_forward_scope_resolver(the_forward_resolver);

    const the_references_provider =
        new ReferencesProvider(the_scope_resolver);
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

describe('Find References - standalone files (issue #208)', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-standalone-'));
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

    it('still reports occurrences inside a standalone callee via raw connectivity', async () => {
        // parent.do defines $cfg and does child.do; child.do is standalone
        // and uses $cfg. From the definition in parent.do, references must
        // still surface the occurrence in child.do — the connectivity
        // floor reads raw do/run/include facts, not effective scope.
        const parent_path = join(test_temp_dir, 'parent.do');
        const parent_content =
            `global cfg "x"\n` +
            `do "child.do"\n`;
        writeFileSync(parent_path, parent_content);

        const child_path = join(test_temp_dir, 'child.do');
        const child_content =
            `// sight: standalone\n` +
            `display "$cfg"\n`;
        writeFileSync(child_path, child_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const parent_uri = URI.file(parent_path).toString();
        await pipeline.document_store.open(parent_uri, parent_content, 1);
        const document_state = pipeline.document_store.get(parent_uri)!;

        // Cursor on `cfg` in the definition on line 0.
        const cursor_char = parent_content.split('\n')[0].indexOf('cfg') + 1;
        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: 0, character: cursor_char },
            { includeDeclaration: true },
            pipeline.indexer,
            document_state.context_tracker
        );

        const child_uri = URI.file(child_path).toString();
        expect(locations.some(loc => loc.uri === child_uri)).toBe(true);
    });
});
