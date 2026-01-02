import { describe, it, expect } from 'bun:test';
import {
    create_initialize_handler,
    create_initialized_handler,
    create_shutdown_handler,
    create_exit_handler,
    create_completion_handler,
    create_hover_handler,
    create_definition_handler,
    create_document_symbol_handler,
    create_workspace_symbol_handler,
    create_formatting_handler,
    create_range_formatting_handler,
    create_completion_resolve_handler,
    HandlerDependencies,
    ServerCapabilities,
    DEFAULT_SETTINGS,
} from '../../src/server-handlers';
import { InitializeParams, TextDocumentSyncKind } from 'vscode-languageserver/node';
import { DocumentStore } from '../../src/document-store';

/**
 * Creates mock dependencies for testing handlers.
 */
function create_mock_dependencies(): HandlerDependencies {
    return {
        document_store: new DocumentStore(),
        diagnostics_provider: null,
        completion_provider: null,
        hover_provider: null,
        definition_provider: null,
        symbol_provider: null,
        formatter_provider: null,
        workspace_indexer: null,
        scope_resolver: null,
        get_document_settings: async () => DEFAULT_SETTINGS,
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('LSP Lifecycle - Handler Factories', () => {
    describe('Initialize Handler', () => {
        it('should return correct capabilities on initialize', () => {
            const handler = create_initialize_handler();
            const params: InitializeParams = {
                processId: null,
                rootUri: null,
                capabilities: {
                    textDocument: {
                        completion: {
                            completionItem: {
                                snippetSupport: true,
                            },
                        },
                    },
                },
                workspaceFolders: null,
            };

            const result = handler(params);

            expect(result.capabilities.textDocumentSync).toBe(TextDocumentSyncKind.Incremental);
            expect(result.capabilities.completionProvider).toBeDefined();
        expect(result.capabilities.completionProvider?.triggerCharacters).toEqual([':', '`', '"', '$', '{', ',', ' ']);
            expect(result.capabilities.hoverProvider).toBe(true);
            expect(result.capabilities.definitionProvider).toBe(true);
            expect(result.capabilities.documentSymbolProvider).toBe(true);
            expect(result.capabilities.workspaceSymbolProvider).toBe(true);
            expect(result.capabilities.documentFormattingProvider).toBe(true);
            expect(result.capabilities.documentRangeFormattingProvider).toBe(true);
        });

        it('should detect snippet support capability', () => {
            let detected_caps: ServerCapabilities | null = null;
            const handler = create_initialize_handler((caps) => {
                detected_caps = caps;
            });

            const params: InitializeParams = {
                processId: null,
                rootUri: null,
                capabilities: {
                    textDocument: {
                        completion: {
                            completionItem: {
                                snippetSupport: true,
                            },
                        },
                    },
                },
                workspaceFolders: null,
            };

            handler(params);

            expect(detected_caps).not.toBeNull();
            expect(detected_caps!.has_snippet_support).toBe(true);
        });

        it('should detect workspace folder capability', () => {
            let detected_caps: ServerCapabilities | null = null;
            const handler = create_initialize_handler((caps) => {
                detected_caps = caps;
            });

            const params: InitializeParams = {
                processId: null,
                rootUri: null,
                capabilities: {
                    workspace: {
                        workspaceFolders: true,
                    },
                },
                workspaceFolders: null,
            };

            const result = handler(params);

            expect(detected_caps).not.toBeNull();
            expect(detected_caps!.has_workspace_folder_capability).toBe(true);
            expect(result.capabilities.workspace?.workspaceFolders?.supported).toBe(true);
        });

        it('should detect configuration capability', () => {
            let detected_caps: ServerCapabilities | null = null;
            const handler = create_initialize_handler((caps) => {
                detected_caps = caps;
            });

            const params: InitializeParams = {
                processId: null,
                rootUri: null,
                capabilities: {
                    workspace: {
                        configuration: true,
                    },
                },
                workspaceFolders: null,
            };

            handler(params);

            expect(detected_caps).not.toBeNull();
            expect(detected_caps!.has_configuration_capability).toBe(true);
        });
    });

    describe('Shutdown Handler', () => {
        it('should complete without error', async () => {
            const handler = create_shutdown_handler();
            const result = await handler();
            expect(result).toBeUndefined();
        });

        it('should return a promise', () => {
            const handler = create_shutdown_handler();
            const result = handler();
            expect(result).toBeInstanceOf(Promise);
        });
    });

    describe('Initialized Handler', () => {
        it('should call on_initialized callback', () => {
            let callback_called = false;
            const handler = create_initialized_handler(() => {
                callback_called = true;
            });

            handler();

            expect(callback_called).toBe(true);
        });

        it('should work without callback', () => {
            const handler = create_initialized_handler();
            expect(() => handler()).not.toThrow();
        });
    });

    describe('Exit Handler', () => {
        it('should call custom exit callback', () => {
            let exit_called = false;
            const handler = create_exit_handler(() => {
                exit_called = true;
            });

            handler();

            expect(exit_called).toBe(true);
        });
    });

    describe('Completion Handler', () => {
        it('should return empty array when no document and no provider', async () => {
            const deps = create_mock_dependencies();
            deps.completion_provider = null;
            const handler = create_completion_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///nonexistent.do' },
                position: { line: 0, character: 0 },
            });

            // With no provider and no document, returns CompletionList with empty items
            expect(result).toHaveProperty('isIncomplete', true);
            expect(result).toHaveProperty('items');
            expect(result.items).toEqual([]);
        });

        it('should return fallback completions when document exists but no provider', async () => {
            const deps = create_mock_dependencies();
            deps.completion_provider = null;
            // Add a document to the store
            await deps.document_store.open('file:///test.do', 'display "hello"', 1);
            const handler = create_completion_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///test.do' },
                position: { line: 0, character: 0 },
            });

            // With document but no provider, returns CompletionList with fallback items
            expect(result).toHaveProperty('isIncomplete', true);
            expect(result).toHaveProperty('items');
            expect(result.items.length).toBeGreaterThan(0);
            expect(result.items.some((item) => item.label === 'generate')).toBe(true);
            expect(result.items.some((item) => item.label === 'regress')).toBe(true);
        });
    });

    describe('Hover Handler', () => {
        it('should return null when no document found', async () => {
            const deps = create_mock_dependencies();
            const handler = create_hover_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///nonexistent.do' },
                position: { line: 0, character: 0 },
            });

            expect(result).toBeNull();
        });

        it('should return null when no hover provider', async () => {
            const deps = create_mock_dependencies();
            deps.hover_provider = null;
            const handler = create_hover_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///test.do' },
                position: { line: 0, character: 0 },
            });

            expect(result).toBeNull();
        });
    });

    describe('Definition Handler', () => {
        it('should return null when no document found', async () => {
            const deps = create_mock_dependencies();
            const handler = create_definition_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///nonexistent.do' },
                position: { line: 0, character: 0 },
            });

            expect(result).toBeNull();
        });
    });

    describe('Document Symbol Handler', () => {
        it('should return empty array when no document found', () => {
            const deps = create_mock_dependencies();
            const handler = create_document_symbol_handler(deps);

            const result = handler({
                textDocument: { uri: 'file:///nonexistent.do' },
            });

            expect(result).toEqual([]);
        });
    });

    describe('Workspace Symbol Handler', () => {
        it('should return empty array when no symbol provider', () => {
            const deps = create_mock_dependencies();
            deps.symbol_provider = null;
            const handler = create_workspace_symbol_handler(deps);

            const result = handler({ query: 'test' });

            expect(result).toEqual([]);
        });
    });

    describe('Formatting Handler', () => {
        it('should return empty array when no document found', async () => {
            const deps = create_mock_dependencies();
            const handler = create_formatting_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///nonexistent.do' },
                options: { tabSize: 4, insertSpaces: true },
            });

            expect(result).toEqual([]);
        });
    });

    describe('Range Formatting Handler', () => {
        it('should return empty array when no document found', async () => {
            const deps = create_mock_dependencies();
            const handler = create_range_formatting_handler(deps);

            const result = await handler({
                textDocument: { uri: 'file:///nonexistent.do' },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 1, character: 0 },
                },
                options: { tabSize: 4, insertSpaces: true },
            });

            expect(result).toEqual([]);
        });
    });

    describe('Completion Resolve Handler', () => {
        it('should add details for known completion items', () => {
            const handler = create_completion_resolve_handler();

            const item1 = handler({ label: 'generate', data: 1 });
            expect(item1.detail).toBe('Generate new variable');

            const item2 = handler({ label: 'regress', data: 2 });
            expect(item2.detail).toBe('Linear regression');
        });

        it('should pass through unknown items unchanged', () => {
            const handler = create_completion_resolve_handler();

            const item = handler({ label: 'unknown', data: 999 });
            expect(item.detail).toBeUndefined();
        });
    });
});
