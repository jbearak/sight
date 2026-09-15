import {
    afterEach, beforeEach, describe, expect, it, spyOn,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileChangeType } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { DependencyGraph } from '../../src/dependency-graph';
import { DocumentStore } from '../../src/document-store';
import { WorkspaceIndexer } from '../../src/indexer';
import { ScopeResolver } from '../../src/scope-resolver';
import {
    create_did_change_watched_files_handler,
    DEFAULT_SETTINGS,
    type HandlerDependencies,
} from '../../src/server-handlers';
import { RenameHandler } from '../../src/utils/file-rename-handler';

/** Wait for the observable result of a real debounced watcher update. */
async function wait_until(predicate: () => boolean): Promise<void> {
    const deadline_ms = Date.now() + 3000;
    while (!predicate() && Date.now() < deadline_ms) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(predicate()).toBe(true);
}

for (const my_use_rename_handler of [false, true]) {
    const routing = my_use_rename_handler ? 'rename handler' : 'direct';
    describe(`Git-ignored watcher events (${routing})`, () => {
        let root: string;
        let indexer: WorkspaceIndexer;
        let graph: DependencyGraph;
        let deps: HandlerDependencies;
        let rename_handler: RenameHandler | null;

        beforeEach(async () => {
            root = fs.realpathSync.native(fs.mkdtempSync(
                path.join(os.tmpdir(), 'sight-gitignore-watcher-')
            ));
            fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
            graph = new DependencyGraph();
            graph.set_workspace_roots([root]);
            indexer = new WorkspaceIndexer();
            indexer.configure(DEFAULT_SETTINGS);
            indexer.set_dependency_graph(graph);
            await indexer.initialize([root]);
            const scope_resolver = new ScopeResolver();
            rename_handler = my_use_rename_handler ? new RenameHandler(
                file_path => indexer.remove_file(file_path),
                file_path => indexer.schedule_update(file_path),
                () => {}, scope_resolver
            ) : null;
            deps = {
                debounce_manager: null,
                document_store: new DocumentStore(),
                diagnostics_provider: null,
                completion_provider: null,
                hover_provider: null,
                definition_provider: null,
                references_provider: null,
                symbol_provider: null,
                formatter_provider: null,
                workspace_indexer: indexer,
                scope_resolver,
                forward_scope_resolver: null,
                dependency_graph: graph,
                rename_handler,
                get_document_settings: async () => DEFAULT_SETTINGS,
                connection: {
                    sendDiagnostics: () => {}, console: { log: () => {} },
                },
            };
        });

        afterEach(async () => {
            rename_handler?.dispose();
            indexer.cancel();
            await deps.document_store.dispose();
            fs.rmSync(root, { recursive: true, force: true });
        });

        for (const my_event_type of [
            FileChangeType.Created, FileChangeType.Changed,
        ]) {
            it(`preserves open caller edges on event ${my_event_type}`, async () => {
                const caller_path = path.join(root, 'ignored', 'caller.do');
                const callee_path = path.join(root, 'callee.do');
                const caller_uri = URI.file(caller_path).toString();
                const callee_uri = URI.file(callee_path).toString();
                const content = `do "${callee_path}"\n`;
                fs.mkdirSync(path.dirname(caller_path));
                fs.writeFileSync(caller_path, content);
                fs.writeFileSync(callee_path, 'display 1\n');
                await deps.document_store.open(caller_uri, content, 1);
                const document = deps.document_store.get(caller_uri);
                if (!document?.forward_calls) {
                    throw new Error('Expected parsed open-document calls');
                }
                graph.update_caller(caller_uri, document.forward_calls);
                const changed_uris: string[] = [];
                const handler = create_did_change_watched_files_handler(
                    deps, uri => URI.parse(uri).fsPath,
                    uri => changed_uris.push(uri)
                );
                const read_source = spyOn(fs.promises, 'readFile');
                const index_file = spyOn(indexer, 'index_file');
                try {
                    handler({ changes: [
                        { uri: caller_uri, type: my_event_type },
                        { uri: callee_uri, type: my_event_type },
                    ] });
                    await wait_until(() => indexer.get_indexed_files().has(
                        callee_uri
                    ));
                    // The ignored event must not even reach the indexer's
                    // queued update. Direct indexing must also avoid IO.
                    expect(index_file.mock.calls.some(
                        my_call => my_call[0] === caller_path
                    )).toBe(false);
                    await indexer.index_file(caller_path);
                    expect(read_source.mock.calls.some(
                        my_call => String(my_call[0]) === caller_path
                    )).toBe(false);
                    expect(indexer.get_indexed_files().has(caller_uri)).toBe(false);
                    expect(graph.get_callees(caller_uri)).toEqual(
                        new Set([callee_uri])
                    );
                    expect(changed_uris).toEqual(
                        my_event_type === FileChangeType.Changed
                            ? [caller_uri, callee_uri] : []
                    );

                    // Real deletions still remove explicitly opened callers.
                    fs.unlinkSync(caller_path);
                    handler({ changes: [
                        { uri: caller_uri, type: FileChangeType.Deleted },
                    ] });
                    await wait_until(() => graph.get_callees(caller_uri).size === 0);
                } finally {
                    read_source.mockRestore();
                    index_file.mockRestore();
                }
            });
        }
    });
}
