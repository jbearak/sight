import { describe, expect, it } from 'bun:test';
import { FileChangeType } from 'vscode-languageserver/node';
import {
    create_did_change_watched_files_handler,
    DEFAULT_SETTINGS,
    type HandlerDependencies,
} from '../../src/server-handlers';
import { DocumentStore } from '../../src/document-store';

function create_null_deps(): HandlerDependencies {
    return {
        debounce_manager: null,
        document_store: new DocumentStore(),
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        references_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        forward_scope_resolver: null,
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => DEFAULT_SETTINGS,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('watched-files project config routing', () => {
    it('routes sight.toml and .sight.json to project config reload only', () => {
        const deps = create_null_deps();
        const stata_changes: string[] = [];
        const config_changes: string[] = [];
        const handler = create_did_change_watched_files_handler(
            deps,
            (uri) => uri.replace('file://', ''),
            (uri) => stata_changes.push(uri),
            (uri) => config_changes.push(uri)
        );

        handler({
            changes: [
                { uri: 'file:///tmp/sight.toml', type: FileChangeType.Changed },
                { uri: 'file:///tmp/.sight.json', type: FileChangeType.Deleted },
                { uri: 'file:///tmp/main.do', type: FileChangeType.Changed },
            ],
        });

        expect(config_changes).toEqual([
            'file:///tmp/sight.toml',
            'file:///tmp/.sight.json',
        ]);
        expect(stata_changes).toEqual(['file:///tmp/main.do']);
    });
});
