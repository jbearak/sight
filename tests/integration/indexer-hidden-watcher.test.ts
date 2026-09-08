import {
    afterEach, beforeEach, describe, expect, it, spyOn,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileChangeType } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';
import { WorkspaceIndexer } from '../../src/indexer';
import { ScopeResolver } from '../../src/scope-resolver';
import {
    create_did_change_watched_files_handler,
    DEFAULT_SETTINGS,
    type HandlerDependencies,
} from '../../src/server-handlers';
import { RenameHandler } from '../../src/utils/file-rename-handler';

async function wait_until(predicate: () => boolean): Promise<void> {
    const deadline_ms = Date.now() + 3000;
    while (!predicate() && Date.now() < deadline_ms) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(predicate()).toBe(true);
}

function write_program(file_path: string, program_name: string): void {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, `program define ${program_name}\nend\n`);
}

for (const my_use_rename_handler of [false, true]) {
    const routing = my_use_rename_handler ? 'rename handler' : 'direct';
    describe(`hidden workspace watcher events (${routing})`, () => {
        let workspace_dir: string;
        let indexer: WorkspaceIndexer;
        let rename_handler: RenameHandler | null;
        let scope_resolver: ScopeResolver;
        let deps: HandlerDependencies;

        beforeEach(async () => {
            workspace_dir = fs.mkdtempSync(
                path.join(os.tmpdir(), 'sight-hidden-watcher-')
            );
            indexer = new WorkspaceIndexer();
            indexer.configure(DEFAULT_SETTINGS);
            await indexer.initialize([workspace_dir]);
            scope_resolver = new ScopeResolver();
            rename_handler = my_use_rename_handler
                ? new RenameHandler(
                    file_path => indexer.remove_file(file_path),
                    file_path => indexer.schedule_update(file_path),
                    () => {},
                    scope_resolver
                )
                : null;
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
                dependency_graph: null,
                rename_handler,
                get_document_settings: async () => DEFAULT_SETTINGS,
                connection: {
                    sendDiagnostics: () => {},
                    console: { log: () => {} },
                },
            };
        });

        afterEach(() => {
            rename_handler?.dispose();
            indexer.cancel();
            fs.rmSync(workspace_dir, { recursive: true, force: true });
        });

        for (const my_update_path of ['watcher', 'index_file']) {
            it(`preserves open caller edges via ${my_update_path}`, async () => {
                const hidden_path = path.join(
                    workspace_dir, '.claude', 'worktrees', 'copy', 'caller.do'
                );
                const callee_path = path.join(workspace_dir, 'callee.do');
                const hidden_uri = URI.file(hidden_path).toString();
                const callee_uri = URI.file(callee_path).toString();
                const content = `do "${callee_path}"\n`;
                write_program(callee_path, 'callee_program');
                fs.mkdirSync(path.dirname(hidden_path), { recursive: true });
                fs.writeFileSync(hidden_path, content);

                const graph = new DependencyGraph();
                graph.set_workspace_roots([workspace_dir]);
                indexer.set_dependency_graph(graph);
                deps.dependency_graph = graph;
                await deps.document_store.open(hidden_uri, content, 1);
                const document = deps.document_store.get(hidden_uri);
                if (!document?.forward_calls) {
                    throw new Error('Open caller has no parsed forward calls');
                }
                // The server publishes the open buffer's forward calls to
                // this shared graph independently of persistent indexing.
                graph.update_caller(hidden_uri, document.forward_calls);
                expect(indexer.get_indexed_files().has(hidden_uri)).toBe(false);
                expect(graph.get_callees(hidden_uri)).toEqual(
                    new Set([callee_uri])
                );

                const handler = create_did_change_watched_files_handler(
                    deps, uri => URI.parse(uri).fsPath
                );
                if (my_update_path === 'watcher') {
                    handler({ changes: [
                        { uri: hidden_uri, type: FileChangeType.Changed },
                        { uri: callee_uri, type: FileChangeType.Changed },
                    ] });
                    await wait_until(() => indexer.get_indexed_files().has(
                        callee_uri
                    ));
                } else {
                    await indexer.index_file(hidden_path);
                }
                expect(graph.get_callees(hidden_uri)).toEqual(
                    new Set([callee_uri])
                );
                expect(indexer.get_indexed_files().has(hidden_uri)).toBe(false);

                fs.unlinkSync(hidden_path);
                handler({ changes: [
                    { uri: hidden_uri, type: FileChangeType.Deleted },
                ] });
                await wait_until(() => graph.get_callees(hidden_uri).size === 0);
            });
        }

        for (const my_event_type of [
            FileChangeType.Created, FileChangeType.Changed,
        ]) {
            it(`keeps hidden sources out on event ${my_event_type}`, async () => {
                const hidden_path = path.join(
                    workspace_dir, '.claude', 'worktrees', 'copy', 'hidden.do'
                );
                const visible_path = path.join(workspace_dir, 'visible.do');
                const hidden_uri = URI.file(hidden_path).toString();
                const visible_uri = URI.file(visible_path).toString();
                const config_uri = URI.file(
                    path.join(workspace_dir, 'sight.toml')
                ).toString();
                const changed_uris: string[] = [];
                const config_uris: string[] = [];
                const invalidate = spyOn(
                    scope_resolver, 'invalidate_file_cache'
                );
                const remove_reverse_deps = spyOn(
                    scope_resolver, 'remove_uri_from_reverse_deps'
                );
                const handler = create_did_change_watched_files_handler(
                    deps,
                    uri => URI.parse(uri).fsPath,
                    uri => changed_uris.push(uri),
                    uri => config_uris.push(uri)
                );
                write_program(hidden_path, 'hidden_program');
                write_program(visible_path, 'visible_program');

                handler({ changes: [
                    { uri: hidden_uri, type: my_event_type },
                    { uri: visible_uri, type: my_event_type },
                    { uri: config_uri, type: FileChangeType.Changed },
                ] });

                // The visible event follows the hidden event through the
                // real debounce queue, so completion is not a fixed sleep.
                await wait_until(() => indexer.get_all_symbols().programs.has(
                    'visible_program'
                ));
                expect(indexer.get_indexed_files().has(hidden_uri)).toBe(false);
                expect(indexer.get_all_symbols().programs.has(
                    'hidden_program'
                )).toBe(false);
                expect(config_uris).toEqual([config_uri]);
                expect(invalidate).toHaveBeenCalledWith(hidden_uri);
                expect(changed_uris).toEqual(
                    my_event_type === FileChangeType.Changed
                        ? [hidden_uri, visible_uri] : []
                );

                // Excluding automatic indexing must not suppress cleanup
                // for explicitly referenced files or ordinary deletions.
                fs.unlinkSync(hidden_path);
                fs.unlinkSync(visible_path);
                handler({ changes: [
                    { uri: hidden_uri, type: FileChangeType.Deleted },
                    { uri: visible_uri, type: FileChangeType.Deleted },
                ] });
                await wait_until(() => !indexer.get_indexed_files().has(
                    visible_uri
                ));
                expect(remove_reverse_deps).toHaveBeenCalledWith(hidden_uri);
                expect(remove_reverse_deps).toHaveBeenCalledWith(visible_uri);
            });
        }
    });
}
