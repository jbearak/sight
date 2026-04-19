/**
 * Find References bug: local macros crossing `include` boundaries.
 *
 * Reproduces two scenarios:
 *   1. Cursor on a local defined in a file that is `include`-d by another
 *      file (via `@lsp-included-by`). The reference in the including file
 *      (after the include) must be found.
 *   2. Cursor on a local defined in a file that `include`s another file.
 *      The reference inside the included file must be found.
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

describe('Find References - locals across include boundary', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(join(tmpdir(), 'find-refs-include-'));
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

    it('finds parent reference to a local defined in the included child (cursor on child declaration)', async () => {
        // callee.do declares `local fruit`; caller.do includes callee.do,
        // then references `` `fruit' ``. Cursor is on `fruit` at its
        // declaration in callee.do — we expect a hit in caller.do.
        const caller_path = join(test_temp_dir, 'caller.do');
        const caller_content =
            `local espresso double\n` +
            `include callee.do\n` +
            `di "\`fruit'"\n`;
        writeFileSync(caller_path, caller_content);

        const callee_path = join(test_temp_dir, 'callee.do');
        const callee_content =
            `// @lsp-included-by: caller.do\n` +
            `local fruit apple\n` +
            `di "\`espresso'"\n`;
        writeFileSync(callee_path, callee_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const callee_uri = URI.file(callee_path).toString();
        await pipeline.document_store.open(callee_uri, callee_content, 1);
        const document_state = pipeline.document_store.get(callee_uri)!;

        // Cursor on `fruit` in `local fruit apple` — line 1 (0-indexed).
        const decl_line = 1;
        const name_char = callee_content
            .split('\n')[decl_line]
            .indexOf('fruit') + 1;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: decl_line, character: name_char },
            { includeDeclaration: false },
            pipeline.indexer,
            document_state.context_tracker
        );

        const caller_uri = URI.file(caller_path).toString();
        const has_caller_ref = locations.some(
            loc => loc.uri === caller_uri && loc.range.start.line === 2
        );
        expect(has_caller_ref).toBe(true);
    });

    it('finds child reference to a local defined in the including parent (cursor on parent declaration)', async () => {
        // caller.do declares `local espresso`; includes callee.do, which
        // references `` `espresso' ``. Cursor is on `espresso` at its
        // declaration in caller.do — we expect a hit in callee.do.
        const caller_path = join(test_temp_dir, 'caller.do');
        const caller_content =
            `local espresso double\n` +
            `include callee.do\n` +
            `di "\`fruit'"\n`;
        writeFileSync(caller_path, caller_content);

        const callee_path = join(test_temp_dir, 'callee.do');
        const callee_content =
            `// @lsp-included-by: caller.do\n` +
            `local fruit apple\n` +
            `di "\`espresso'"\n`;
        writeFileSync(callee_path, callee_content);

        await pipeline.indexer.initialize([test_temp_dir]);

        const caller_uri = URI.file(caller_path).toString();
        await pipeline.document_store.open(caller_uri, caller_content, 1);
        const document_state = pipeline.document_store.get(caller_uri)!;

        // Cursor on `espresso` in `local espresso double` — line 0.
        const decl_line = 0;
        const name_char = caller_content
            .split('\n')[decl_line]
            .indexOf('espresso') + 1;

        const locations = await pipeline.references_provider.get_references(
            document_state,
            { line: decl_line, character: name_char },
            { includeDeclaration: false },
            pipeline.indexer,
            document_state.context_tracker
        );

        const callee_uri = URI.file(callee_path).toString();
        const has_callee_ref = locations.some(
            loc => loc.uri === callee_uri && loc.range.start.line === 2
        );
        expect(has_callee_ref).toBe(true);
    });
});
