/**
 * Mock HandlerDependencies utilities for property-based testing.
 * Provides a factory function to create mock dependencies for LSP handler tests.
 */

import { DocumentStore } from '../../../src/document-store';
import { HandlerDependencies } from '../../../src/server-handlers';

/**
 * Create mock HandlerDependencies for testing LSP handlers.
 * All providers are set to null, with minimal mock implementations
 * for connection methods.
 * 
 * @param document_store - The DocumentStore instance to use
 * @returns A HandlerDependencies object suitable for testing
 */
export function create_mock_handler_deps(document_store: DocumentStore): HandlerDependencies {
    return {
        debounce_manager: null,
        document_store,
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
        get_document_settings: async () => ({} as any),
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} }
        }
    };
}
