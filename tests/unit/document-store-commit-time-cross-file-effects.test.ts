// Issue #184: cross-file directive side effects (ScopeResolver
// backward-directive registration + WorkspaceIndexer overlay) must be
// staged during create_document_state and applied only after commit_state's
// guards accept the parse. A close() racing an in-flight parse is not
// serialized with the per-URI operation chain, so before the fix a
// discarded parse still mutated shared cross-file state (stale-add) or
// wiped edges a committed parse had set (valid-edge-drop).
//
// Race idiom: fire open()/update() WITHOUT awaiting, call close()
// synchronously, then await. close() is synchronous while the parse
// suspends on its first with_parse_timeout await (setImmediate), so the
// parse machinery — where the old code applied side effects — always runs
// after the close.
import { describe, expect, it } from 'bun:test';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { WorkspaceIndexer } from '../../src/indexer';
import { ScopeResolver } from '../../src/scope-resolver';
import type { ContentProvider } from '../../src/types';
import { URI } from 'vscode-uri';

function make_content_provider(
    content_by_uri: Map<string, string>
): ContentProvider {
    return {
        read_file: async (uri) => content_by_uri.get(uri) ?? '',
        exists: async (uri) => content_by_uri.has(uri),
        stat: async (uri) => {
            const content = content_by_uri.get(uri);
            return content === undefined
                ? undefined
                : { mtimeMs: 0, size: content.length };
        },
    };
}

function make_harness(content_by_uri: Map<string, string>) {
    const document_store = new DocumentStore();
    const workspace_indexer = new WorkspaceIndexer();
    const dependency_graph = new DependencyGraph();
    const scope_resolver = new ScopeResolver(
        undefined,
        make_content_provider(content_by_uri)
    );
    workspace_indexer.set_dependency_graph(dependency_graph);
    scope_resolver.set_dependency_graph(dependency_graph);
    document_store.set_scope_resolver(scope_resolver);
    document_store.set_on_backward_directives_parsed((uri, directives) => {
        workspace_indexer.set_buffer_directives(uri, directives);
    });
    return {
        document_store,
        workspace_indexer,
        dependency_graph,
        scope_resolver,
    };
}

describe('DocumentStore commit-time cross-file effects (issue #184)', () => {
    it('close racing a directive-adding reparse leaves no stale edge or overlay entry', async () => {
        const parent_path = '/tmp/sight-184-stale-parent.do';
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file('/tmp/sight-184-stale-child.do').toString();
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'display 0\n'],
        ]);
        const { document_store, workspace_indexer, scope_resolver } =
            make_harness(content_by_uri);

        await document_store.open(child_uri, 'display 1\n', 1);

        const content_with_directive =
            `// @lsp-done-by: "${parent_path}"\n` +
            'display 2\n';
        const update_promise = document_store.update(
            child_uri,
            [{ text: content_with_directive }],
            2
        );
        document_store.close(child_uri);
        await update_promise;

        expect(document_store.get(child_uri)).toBeUndefined();
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(false);
        expect(
            workspace_indexer.get_related_uris(parent_uri).has(child_uri)
        ).toBe(false);
    });

    it('close racing a directive-removing reparse preserves committed edges (A -> B -> C)', async () => {
        const c_path = '/tmp/sight-184-chain-c.do';
        const b_path = '/tmp/sight-184-chain-b.do';
        const a_path = '/tmp/sight-184-chain-a.do';
        const c_uri = URI.file(c_path).toString();
        const b_uri = URI.file(b_path).toString();
        const a_uri = URI.file(a_path).toString();
        const c_content = 'display "c"\n';
        const b_content = `// @lsp-done-by: "${c_path}"\ndisplay "b"\n`;
        const a_content = `// @lsp-done-by: "${b_path}"\ndisplay "a"\n`;
        const content_by_uri = new Map<string, string>([
            [c_uri, c_content],
            [b_uri, b_content],
            [a_uri, a_content],
        ]);
        const { document_store, workspace_indexer, scope_resolver } =
            make_harness(content_by_uri);

        await document_store.open(c_uri, c_content, 1);
        await document_store.open(b_uri, b_content, 1);
        await document_store.open(a_uri, a_content, 1);

        expect(
            scope_resolver.get_backward_directive_children(c_uri).has(b_uri)
        ).toBe(true);
        expect(
            scope_resolver.get_backward_directive_children(b_uri).has(a_uri)
        ).toBe(true);
        const transitive_before =
            scope_resolver.get_transitive_backward_directive_children(c_uri);
        expect(transitive_before.has(b_uri)).toBe(true);
        expect(transitive_before.has(a_uri)).toBe(true);

        // Discarded parse would clear-then-register B with NO directives,
        // dropping the valid C -> B edge before the fix.
        const update_promise = document_store.update(
            b_uri,
            [{ text: 'display "b edited"\n' }],
            2
        );
        document_store.close(b_uri);
        await update_promise;

        expect(
            scope_resolver.get_backward_directive_children(c_uri).has(b_uri)
        ).toBe(true);
        expect(
            scope_resolver.get_backward_directive_children(b_uri).has(a_uri)
        ).toBe(true);
        const transitive_after =
            scope_resolver.get_transitive_backward_directive_children(c_uri);
        expect(transitive_after.has(b_uri)).toBe(true);
        expect(transitive_after.has(a_uri)).toBe(true);
        // Overlay entry from B's committed open must survive the discarded
        // reparse (the real server clears it separately in onDidClose).
        expect(
            workspace_indexer.get_related_uris(c_uri).has(b_uri)
        ).toBe(true);
    });

    it('registers auto-discovered parents at commit (no explicit directives)', async () => {
        const parent_uri = URI.file('/tmp/sight-184-auto-parent.do').toString();
        const child_path = '/tmp/sight-184-auto-child.do';
        const child_uri = URI.file(child_path).toString();
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'do sight-184-auto-child.do\n'],
        ]);
        const { document_store, dependency_graph, scope_resolver } =
            make_harness(content_by_uri);

        dependency_graph.update_caller(parent_uri, [{
            type: 'do',
            raw_path: 'sight-184-auto-child.do',
            is_static: true,
            call_site_line: 0,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
            },
            source: 'command',
        }]);
        expect(dependency_graph.get_parents(child_uri)).toHaveLength(1);

        await document_store.open(child_uri, 'display 1\n', 1);

        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);
    });

    it('registers auto-discovered parents even when the file has its own working directory (probe skipped)', async () => {
        // A file with its own @lsp-cd never runs the WD probe, so before the
        // fix only the RAW parse-time sync ran and auto-discovered parents
        // were never registered from the document-store path.
        const parent_uri = URI.file('/tmp/sight-184-owncd-parent.do').toString();
        const child_path = '/tmp/sight-184-owncd-child.do';
        const child_uri = URI.file(child_path).toString();
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'do sight-184-owncd-child.do\n'],
        ]);
        const { document_store, dependency_graph, scope_resolver } =
            make_harness(content_by_uri);

        dependency_graph.update_caller(parent_uri, [{
            type: 'do',
            raw_path: 'sight-184-owncd-child.do',
            is_static: true,
            call_site_line: 0,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
            },
            source: 'command',
        }]);

        await document_store.open(
            child_uri,
            '// @lsp-cd: "/tmp"\ndisplay 1\n',
            1
        );

        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);
    });

    it('a registering resolve that cache-hits the probe-populated entry still observes registered edges', async () => {
        const parent_path = '/tmp/sight-184-probe-parent.do';
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file('/tmp/sight-184-probe-child.do').toString();
        const child_content =
            `// @lsp-done-by: "${parent_path}"\ndisplay 1\n`;
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'display 0\n'],
        ]);
        const { document_store, scope_resolver } =
            make_harness(content_by_uri);

        // open() runs the non-registering WD probe, which populates the
        // scope cache for (child_uri, child_content, {}); commit_state then
        // applies the effective registration.
        await document_store.open(child_uri, child_content, 1);

        const hits_before = scope_resolver.get_cache_metrics().scope.hits;
        await scope_resolver.resolve(child_uri, child_content, {});
        const hits_after = scope_resolver.get_cache_metrics().scope.hits;

        // The default resolve must have HIT the probe's cache entry (same
        // key, no invalidation in between) — the sharp poisoning scenario.
        expect(hits_after).toBe(hits_before + 1);
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);
    });

    it('interface-change invalidation followed by a default resolve restores edges', async () => {
        const parent_path = '/tmp/sight-184-inval-parent.do';
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file('/tmp/sight-184-inval-child.do').toString();
        const child_content =
            `// @lsp-done-by: "${parent_path}"\ndisplay 1\n`;
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'display 0\n'],
        ]);
        const { document_store, scope_resolver } =
            make_harness(content_by_uri);

        await document_store.open(child_uri, child_content, 1);
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);

        // validate_text_document's interface-change path clears the child's
        // edges (preserve_backward_directive_dependencies NOT set) but also
        // invalidates the scope cache, so the next default resolve is a
        // MISS and re-registers.
        scope_resolver.invalidate_file_cache(child_uri, {
            preserve_forward_call_relationships: true,
        });
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(false);

        await scope_resolver.resolve(child_uri, child_content, {});
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);
    });

    it('dispose blocks staged effect application from an in-flight parse', async () => {
        const parent_path = '/tmp/sight-184-dispose-parent.do';
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file('/tmp/sight-184-dispose-child.do').toString();
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'display 0\n'],
        ]);
        const { document_store, workspace_indexer, scope_resolver } =
            make_harness(content_by_uri);

        await document_store.open(child_uri, 'display 1\n', 1);

        const content_with_directive =
            `// @lsp-done-by: "${parent_path}"\ndisplay 2\n`;
        const update_promise = document_store.update(
            child_uri,
            [{ text: content_with_directive }],
            2
        );
        await document_store.dispose();
        await update_promise;

        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(false);
        expect(
            workspace_indexer.get_related_uris(parent_uri).has(child_uri)
        ).toBe(false);
    });
});

describe('ScopeResolver non-registering probe mode (issue #184)', () => {
    it('register_dependencies: false skips only the top-level registration', async () => {
        const grandparent_path = '/tmp/sight-184-flag-grandparent.do';
        const parent_path = '/tmp/sight-184-flag-parent.do';
        const grandparent_uri = URI.file(grandparent_path).toString();
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file('/tmp/sight-184-flag-child.do').toString();
        const child_content =
            `// @lsp-done-by: "${parent_path}"\ndisplay 1\n`;
        const content_by_uri = new Map<string, string>([
            [grandparent_uri, 'display 0\n'],
            [parent_uri, `// @lsp-done-by: "${grandparent_path}"\ndisplay 0\n`],
        ]);
        const scope_resolver = new ScopeResolver(
            undefined,
            make_content_provider(content_by_uri)
        );

        await scope_resolver.resolve(
            child_uri,
            child_content,
            {},
            undefined,
            { register_dependencies: false }
        );

        // The child's own edge is NOT registered...
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(false);
        // ...but the ancestor-level sync inside get_parsed_file still
        // registers the parent's own directives (disk-derived, correct
        // regardless of this parse's fate).
        expect(
            scope_resolver.get_backward_directive_children(grandparent_uri)
                .has(parent_uri)
        ).toBe(true);

        // A default resolve after invalidation registers the child's edge.
        scope_resolver.invalidate_scope_cache(child_uri);
        await scope_resolver.resolve(child_uri, child_content, {});
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);
    });
});

describe('ScopeResolver disk re-sync on close (issue #184)', () => {
    it('converges edges to disk state after a discarded save-then-close reparse', async () => {
        const old_parent_path = '/tmp/sight-184-resync-old.do';
        const new_parent_path = '/tmp/sight-184-resync-new.do';
        const old_parent_uri = URI.file(old_parent_path).toString();
        const new_parent_uri = URI.file(new_parent_path).toString();
        const child_uri = URI.file('/tmp/sight-184-resync-child.do').toString();
        const content_by_uri = new Map<string, string>([
            [old_parent_uri, 'display 0\n'],
            [new_parent_uri, 'display 0\n'],
        ]);
        const scope_resolver = new ScopeResolver(
            undefined,
            make_content_provider(content_by_uri)
        );

        // Pre-close committed state points at the OLD parent.
        await scope_resolver.resolve(
            child_uri,
            `// @lsp-done-by: "${old_parent_path}"\ndisplay 1\n`,
            {}
        );
        expect(
            scope_resolver.get_backward_directive_children(old_parent_uri)
                .has(child_uri)
        ).toBe(true);

        // Disk now has the saved header change (directive to NEW parent);
        // the reparse that would have registered it was discarded by close.
        content_by_uri.set(
            child_uri,
            `// @lsp-done-by: "${new_parent_path}"\ndisplay 1\n`
        );
        const my_applied =
            await scope_resolver.resync_backward_directive_dependencies_from_disk(
                child_uri
            );
        expect(my_applied).toBe(true);

        expect(
            scope_resolver.get_backward_directive_children(new_parent_uri)
                .has(child_uri)
        ).toBe(true);
        expect(
            scope_resolver.get_backward_directive_children(old_parent_uri)
                .has(child_uri)
        ).toBe(false);
    });

    it('clears edges when the file no longer exists on disk', async () => {
        const parent_path = '/tmp/sight-184-resync-gone-parent.do';
        const parent_uri = URI.file(parent_path).toString();
        const child_uri =
            URI.file('/tmp/sight-184-resync-gone-child.do').toString();
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'display 0\n'],
        ]);
        const scope_resolver = new ScopeResolver(
            undefined,
            make_content_provider(content_by_uri)
        );

        await scope_resolver.resolve(
            child_uri,
            `// @lsp-done-by: "${parent_path}"\ndisplay 1\n`,
            {}
        );
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(true);

        // child_uri was never in content_by_uri, so exists() is false.
        const my_applied =
            await scope_resolver.resync_backward_directive_dependencies_from_disk(
                child_uri
            );
        expect(my_applied).toBe(true);
        expect(
            scope_resolver.get_backward_directive_children(parent_uri)
                .has(child_uri)
        ).toBe(false);
    });

    it('skips applying when should_apply reports a reopen', async () => {
        const disk_parent_path = '/tmp/sight-184-resync-guard-disk.do';
        const buffer_parent_path = '/tmp/sight-184-resync-guard-buf.do';
        const disk_parent_uri = URI.file(disk_parent_path).toString();
        const buffer_parent_uri = URI.file(buffer_parent_path).toString();
        const child_uri =
            URI.file('/tmp/sight-184-resync-guard-child.do').toString();
        const content_by_uri = new Map<string, string>([
            [disk_parent_uri, 'display 0\n'],
            [buffer_parent_uri, 'display 0\n'],
            [child_uri, `// @lsp-done-by: "${disk_parent_path}"\ndisplay 1\n`],
        ]);
        const scope_resolver = new ScopeResolver(
            undefined,
            make_content_provider(content_by_uri)
        );

        // The quick reopen's buffer-based commit registered the BUFFER
        // parent; the slower disk read must not clobber it.
        await scope_resolver.resolve(
            child_uri,
            `// @lsp-done-by: "${buffer_parent_path}"\ndisplay 1\n`,
            {}
        );
        const my_applied =
            await scope_resolver.resync_backward_directive_dependencies_from_disk(
                child_uri,
                {},
                () => false
            );
        expect(my_applied).toBe(false);

        expect(
            scope_resolver.get_backward_directive_children(buffer_parent_uri)
                .has(child_uri)
        ).toBe(true);
        expect(
            scope_resolver.get_backward_directive_children(disk_parent_uri)
                .has(child_uri)
        ).toBe(false);
    });
});
