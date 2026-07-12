import { describe, expect, it } from 'bun:test';
import { DocumentState, DocumentStore, ParseOutcome } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { WorkspaceIndexer } from '../../src/indexer';
import { ScopeResolver } from '../../src/scope-resolver';
import type {
    ContentProvider,
    ScopeResolverConfig,
    SymbolTable,
} from '../../src/types';
import type { CancellationToken } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

type InspectableDocumentStore = DocumentStore & {
    documents: Map<string, DocumentState>;
    generations: Map<string, number>;
    commit_state(
        uri: string,
        outcome: ParseOutcome,
        generation: number,
        is_operation_current?: () => boolean
    ): boolean;
    create_document_state(
        uri: string,
        content: string,
        version: number,
        workspace_symbols?: SymbolTable,
        scope_resolver_config?: Partial<ScopeResolverConfig>,
        is_operation_current?: () => boolean
    ): Promise<ParseOutcome | undefined>;
};

describe('DocumentStore version guard', () => {
    it('rejects older commit state while allowing equal-version reparses', async () => {
        const document_store = new DocumentStore();
        const store = document_store as unknown as InspectableDocumentStore;
        const uri = 'file:///version-guard-commit.do';

        await document_store.open(uri, 'content v3', 3);
        const state_v3 = document_store.get(uri);
        expect(state_v3).toBeDefined();

        const stale_state_v2 = {
            ...state_v3!,
            version: 2,
            content: 'content v2',
        };
        store.commit_state(
            uri,
            { state: stale_state_v2, staged_effects: undefined },
            2
        );

        expect(store.documents.get(uri)).toBe(state_v3);
        expect(store.documents.get(uri)!.version).toBe(3);
        expect(store.documents.get(uri)!.content).toBe('content v3');

        const reparse_state_v3 = {
            ...state_v3!,
            content: 'content v3 reparse',
        };
        store.commit_state(
            uri,
            { state: reparse_state_v3, staged_effects: undefined },
            3
        );

        expect(store.documents.get(uri)).toBe(reparse_state_v3);
        expect(store.documents.get(uri)!.version).toBe(3);
        expect(store.documents.get(uri)!.content).toBe('content v3 reparse');
    });

    it('rejects a queued stale update and keeps the newer committed content', async () => {
        const document_store = new DocumentStore();
        const uri = 'file:///version-guard-concurrent.do';

        await document_store.open(uri, 'content v1', 1);

        // A newer update (v3) and an older update (v2) are issued before the
        // first settles. Per-URI serialization runs them in issue order, so
        // the queued v2 sees the already-committed v3 and is rejected by the
        // strict stale-version guard before it can reparse. (Genuine
        // out-of-order parse completion is impossible by design: each update
        // awaits the prior one, so parse order always matches issue order.)
        const update_v3 = document_store.update(uri, [{ text: 'content v3' }], 3);
        const update_v2 = document_store.update(uri, [{ text: 'content v2' }], 2);

        await Promise.all([update_v3, update_v2]);

        const state = document_store.get(uri);
        expect(state).toBeDefined();
        expect(state!.version).toBe(3);
        expect(state!.content).toBe('content v3');
    });

    it('keeps newer backward directive side effects after stale update', async () => {
        const document_store = new DocumentStore();
        const workspace_indexer = new WorkspaceIndexer();
        const dependency_graph = new DependencyGraph();
        const parent_path = '/tmp/sight-f8-parent.do';
        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file('/tmp/sight-f8-child.do').toString();
        const content_by_uri = new Map<string, string>([
            [parent_uri, 'display 0\n'],
            [child_uri, 'display 1\n'],
        ]);
        const content_provider: ContentProvider = {
            read_file: async (uri) => content_by_uri.get(uri) ?? '',
            exists: async (uri) => content_by_uri.has(uri),
            stat: async (uri) => {
                const content = content_by_uri.get(uri);
                return content === undefined
                    ? undefined
                    : { mtimeMs: 0, size: content.length };
            },
        };
        const scope_resolver = new ScopeResolver(undefined, content_provider);

        workspace_indexer.set_dependency_graph(dependency_graph);
        scope_resolver.set_dependency_graph(dependency_graph);
        document_store.set_scope_resolver(scope_resolver);
        document_store.set_on_backward_directives_parsed((uri, directives) => {
            workspace_indexer.set_buffer_directives(uri, directives);
        });

        await document_store.open(child_uri, 'display 1', 1);

        const content_with_directive =
            `// @lsp-done-by: "${parent_path}"\n` +
            'display 3\n';
        const content_without_directive = 'display 2\n';
        content_by_uri.set(child_uri, content_with_directive);

        const update_v3 = document_store.update(
            child_uri,
            [{ text: content_with_directive }],
            3
        );
        const update_v2 = document_store.update(
            child_uri,
            [{ text: content_without_directive }],
            2
        );

        await Promise.all([update_v3, update_v2]);

        const state = document_store.get(child_uri);
        expect(state).toBeDefined();
        expect(state!.version).toBe(3);
        expect(state!.content).toBe(content_with_directive);

        const related_uris = workspace_indexer.get_related_uris(parent_uri);
        expect(related_uris.has(child_uri)).toBe(true);
        const directive_children =
            scope_resolver.get_backward_directive_children(parent_uri);
        expect(
            directive_children.has(child_uri)
        ).toBe(true);
    });

    it('rejects older-version updates even when scope config is present', async () => {
        const document_store = new DocumentStore();
        const uri = 'file:///version-guard.do';

        await document_store.open(uri, 'content v1', 1);
        await document_store.update(uri, [{ text: 'content v3' }], 3);

        await document_store.update(
            uri,
            [{ text: 'content v2' }],
            2,
            undefined,
            { backward_dependencies: 'auto' }
        );

        const state = document_store.get(uri);
        expect(state).toBeDefined();
        expect(state!.version).toBe(3);
        expect(state!.content).toBe('content v3');
    });

    it('stops parsing after awaited scope work when its guard retires', async () => {
        const document_store = new DocumentStore();
        const store = document_store as unknown as InspectableDocumentStore;
        const scope_resolver = new ScopeResolver();
        const uri = 'file:///lifecycle-parse-cancellation.do';
        let lifecycle_is_current = true;
        let captured_token: CancellationToken | undefined;
        let release_scope: (() => void) | undefined;
        let scope_started: (() => void) | undefined;
        const scope_start = new Promise<void>(resolve => {
            scope_started = resolve;
        });
        const scope_gate = new Promise<void>(resolve => {
            release_scope = resolve;
        });
        const original_resolve = scope_resolver.resolve.bind(scope_resolver);

        scope_resolver.resolve = async (...args) => {
            captured_token = args[3];
            scope_started?.();
            await scope_gate;
            return original_resolve(...args);
        };
        document_store.set_scope_resolver(scope_resolver);

        const parse = store.create_document_state(
            uri,
            'display 1\n',
            1,
            undefined,
            { backward_dependencies: 'auto' },
            () => lifecycle_is_current
        );
        await scope_start;

        lifecycle_is_current = false;
        expect(captured_token?.isCancellationRequested).toBe(true);
        release_scope?.();

        expect(await parse).toBeUndefined();
    });

    it('rejects a completed parse when its lifecycle guard retires before commit', async () => {
        const document_store = new DocumentStore();
        const store = document_store as unknown as InspectableDocumentStore;
        const uri = 'file:///lifecycle-commit-guard.do';
        let lifecycle_is_current = true;
        let release_parse: (() => void) | undefined;
        let parse_started: (() => void) | undefined;
        const parse_start = new Promise<void>(resolve => {
            parse_started = resolve;
        });
        const parse_gate = new Promise<void>(resolve => {
            release_parse = resolve;
        });

        await document_store.open(uri, 'content v1', 1);
        const original_create_document_state =
            store.create_document_state.bind(store);
        store.create_document_state = async (
            the_uri,
            content,
            version,
            workspace_symbols,
            scope_resolver_config,
            is_operation_current
        ) => {
            const outcome = await original_create_document_state(
                the_uri,
                content,
                version,
                workspace_symbols,
                scope_resolver_config,
                is_operation_current
            );
            parse_started?.();
            await parse_gate;
            return outcome;
        };

        const retired_update = document_store.update(
            uri,
            [{ text: 'retired content v2' }],
            2,
            undefined,
            { backward_dependencies: 'auto' },
            () => lifecycle_is_current
        );
        await parse_start;

        lifecycle_is_current = false;
        release_parse?.();
        await retired_update;

        const state = document_store.get(uri);
        expect(state).toBeDefined();
        expect(state!.version).toBe(1);
        expect(state!.content).toBe('content v1');
    });
});
