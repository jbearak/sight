/**
 * Server Handlers Module
 *
 * This module contains factory functions for LSP handlers, separated from
 * connection wiring to enable unit testing.
 */

import {
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    CompletionItem,
    CompletionList,
    CompletionParams,
    Hover,
    HoverParams,
    Definition,
    DefinitionParams,
    DocumentSymbol,
    DocumentSymbolParams,
    WorkspaceSymbol,
    WorkspaceSymbolParams,
    DocumentFormattingParams,
    DocumentRangeFormattingParams,
    TextEdit,
    DidChangeWatchedFilesParams,
    Diagnostic,
    CancellationToken,
    TextDocumentContentChangeEvent,
} from 'vscode-languageserver/node';

import { DocumentStore } from './document-store';
import { DiagnosticsProvider } from './providers/diagnostics';
import { CompletionProvider } from './providers/completion';
import { HoverProvider } from './providers/hover';
import { DefinitionProvider } from './providers/definition';
import { SymbolProvider } from './providers/symbols';
import { CodeFormatter } from './providers/formatter';
import { WorkspaceIndexer } from './indexer';
import { StataLSPConfig } from './types';
import { ContextTracker } from './context-tracker';
import { ScopeResolver } from './scope-resolver';
import { ForwardScopeResolver } from './forward-scope-resolver';
import { RenameHandler } from './utils/file-rename-handler';

/**
 * Interface defining all dependencies required by LSP handlers.
 * This enables dependency injection for testing.
 */
export interface HandlerDependencies {
    document_store: DocumentStore;
    diagnostics_provider: DiagnosticsProvider | null;
    completion_provider: CompletionProvider | null;
    hover_provider: HoverProvider | null;
    definition_provider: DefinitionProvider | null;
    symbol_provider: SymbolProvider | null;
    formatter_provider: CodeFormatter | null;
    workspace_indexer: WorkspaceIndexer | null;
    scope_resolver: ScopeResolver | null;
    forward_scope_resolver: ForwardScopeResolver | null;
    rename_handler: RenameHandler | null;
    get_document_settings: (uri: string) => Promise<StataLSPConfig>;
    connection: {
        sendDiagnostics: (params: { uri: string; diagnostics: Diagnostic[] }) => void;
        console: { log: (msg: string) => void };
    };
}

/**
 * Interface for tracking client capabilities detected during initialization.
 */
export interface ServerCapabilities {
    has_snippet_support: boolean;
    has_configuration_capability: boolean;
    has_workspace_folder_capability: boolean;
    has_diagnostic_related_information_capability: boolean;
}

/**
 * Default LSP configuration settings.
 */
export const DEFAULT_SETTINGS: StataLSPConfig = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint',
        },
        undefinedVariableEnabled: false,
    },
    completion: {
        cacheSize: 200,
        prefixMaxItems: 200,
    },
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces',
        lineWidth: 80,
        preferredCommentStyle: '//',
        normalizeCommentStyle: false,
        commentLineWidth: 72,
    },
    indexing: {
        maxFileSizeBytes: 500000,
    },
    adoPaths: [],
    indexWorkspace: true,
    cross_file: {
        index_workspace: true,
        max_indexed_files: 1000,
        assume_call_site: 'end',
        max_backward_depth: 10,
        max_forward_depth: 10,
        max_chain_depth: 20,
        max_callee_revalidations: 10,
        diagnostics: {
            undefined_symbol: 'warning',
            out_of_scope: 'information',
            missing_file: 'warning',
            max_depth: 'information',
        },
    },
};


/**
 * Creates the initialize handler that processes client capabilities
 * and returns server capabilities.
 *
 * @param on_capabilities_detected - Callback to receive detected client capabilities
 * @returns Handler function for the initialize request
 */
export function create_initialize_handler(
    on_capabilities_detected?: (caps: ServerCapabilities) => void,
    on_initialization_options_detected?: (options: any) => void
): (params: InitializeParams) => InitializeResult {
    return (params: InitializeParams): InitializeResult => {
        const capabilities = params.capabilities;

        // Detect client capabilities
        const has_configuration_capability = !!(
            capabilities.workspace && !!capabilities.workspace.configuration
        );
        const has_workspace_folder_capability = !!(
            capabilities.workspace && !!capabilities.workspace.workspaceFolders
        );
        const has_diagnostic_related_information_capability = !!(
            capabilities.textDocument &&
            capabilities.textDocument.publishDiagnostics &&
            capabilities.textDocument.publishDiagnostics.relatedInformation
        );
        const has_snippet_support = !!(
            capabilities.textDocument &&
            capabilities.textDocument.completion &&
            capabilities.textDocument.completion.completionItem &&
            capabilities.textDocument.completion.completionItem.snippetSupport
        );

        // Notify caller of detected capabilities
        if (on_capabilities_detected) {
            on_capabilities_detected({
                has_snippet_support,
                has_configuration_capability,
                has_workspace_folder_capability,
                has_diagnostic_related_information_capability,
            });
        }

        // Capture initialization options for config precedence (init > file)
        if (on_initialization_options_detected) {
            on_initialization_options_detected((params as any).initializationOptions);
        }

        // Build server capabilities response
        const result: InitializeResult = {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                completionProvider: {
                    triggerCharacters: [':', '`', '"', '$', '{', ',', ' '],
                    resolveProvider: false,
                },
                hoverProvider: true,
                definitionProvider: true,
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                executeCommandProvider: {
                    commands: [
                        'sight.toggleLineComment',
                        'sight.toggleBlockComment',
                    ],
                },
            },
        };

        if (has_workspace_folder_capability) {
            result.capabilities.workspace = {
                workspaceFolders: {
                    supported: true,
                },
            };
        }

        return result;
    };
}


/**
 * Creates the initialized handler that runs after initialization is complete.
 *
 * @param on_initialized - Callback for post-initialization setup
 * @returns Handler function for the initialized notification
 */
export function create_initialized_handler(
    on_initialized?: () => void
): () => void {
    return (): void => {
        if (on_initialized) {
            on_initialized();
        }
    };
}


/**
 * Creates the completion handler that provides auto-complete suggestions.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for completion requests
 */
export function create_completion_handler(
    deps: HandlerDependencies
): (params: CompletionParams, token?: CancellationToken) => Promise<CompletionList> {
    return async (params: CompletionParams, token?: CancellationToken): Promise<CompletionList> => {
        // Wait for any pending document updates to ensure we have the latest state
        await deps.document_store.wait_for_update(params.textDocument.uri);

        const document_state = deps.document_store.get(params.textDocument.uri);
        const trigger_character = params.context?.triggerCharacter;

        if (!document_state) {
            // Document not found, return fallback completions
            if (deps.completion_provider) {
                const items = await deps.completion_provider.get_completions(
                    {
                        uri: params.textDocument.uri,
                        version: 0,
                        content: '',
                        tokens: [],
                        ast: null,
                        symbols: {
                            programs: new Map(),
                            localMacros: new Map(),
                            globalMacros: new Map(),
                            variables: new Map(),
                            scalars: new Map(),
                            matrices: new Map(),
                        },
                        diagnostics: [],
                        context_ranges: [],
                        context_tracker: new ContextTracker(),
                        line_offsets: [],
                        forward_calls: [],
                    },
                    params.position,
                    trigger_character,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    token
                );
                // Return as CompletionList with isIncomplete=true to force VS Code
                // to re-request completions as user types
                return { isIncomplete: true, items };
            }
            return { isIncomplete: true, items: [] };
        }

        if (deps.completion_provider) {
            const workspace_symbols = deps.workspace_indexer
                ? deps.workspace_indexer.get_all_symbols()
                : undefined;
            const workspace_version = deps.workspace_indexer
                ? deps.workspace_indexer.get_version()
                : 0;
            const config = await deps.get_document_settings(params.textDocument.uri);
            
            // Compute forward scope only when scope_resolver is NOT available (fallback path)
            // When scope_resolver is available, it internally calls ForwardScopeResolver.resolve()
            let forward_scope = undefined;
            if (!deps.scope_resolver && deps.forward_scope_resolver && document_state.forward_calls.length > 0) {
                // Apply per-request max_forward_depth from user config
                const max_depth = config.cross_file?.max_forward_depth ?? 10;
                forward_scope = await deps.forward_scope_resolver.resolve(
                    document_state.uri,
                    document_state.forward_calls,
                    'include',
                    {
                        visited: new Map(),
                        effective_call_type: 'include',
                        depth: 0,
                        diagnostics: [],
                        working_directory: document_state.working_directory,
                        call_chain: [],
                    },
                    undefined,
                    token,
                    { max_forward_depth: max_depth }
                );
            }
            
            const items = await deps.completion_provider.get_completions(
                document_state,
                params.position,
                trigger_character,
                deps.scope_resolver || undefined,
                workspace_symbols,
                {
                    assume_call_site: config.cross_file?.assume_call_site,
                    max_forward_depth: config.cross_file?.max_forward_depth,
                },
                forward_scope,
                workspace_version,
                token
            );
            
            // Return as CompletionList with isIncomplete=true to ensure VS Code
            // re-requests completions as user types
            // This is critical for macro completions where the replacement range changes dynamically
            return { isIncomplete: true, items };
        }

        // Fallback if completion provider not initialized
        return {
            isIncomplete: true,
            items: [
                {
                    label: 'generate',
                    kind: 1, // Text
                    data: 1,
                },
                {
                    label: 'regress',
                    kind: 1, // Text
                    data: 2,
                },
            ]
        };
    };
}


/**
 * Creates the hover handler that provides hover information.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for hover requests
 */
export function create_hover_handler(
    deps: HandlerDependencies
): (params: HoverParams, token?: CancellationToken) => Promise<Hover | null> {
    return async (params: HoverParams, token?: CancellationToken): Promise<Hover | null> => {
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.hover_provider) {
            return null;
        }
        const workspace_symbols = deps.workspace_indexer
            ? deps.workspace_indexer.get_all_symbols()
            : undefined;
        const config = await deps.get_document_settings(params.textDocument.uri);
        const workspace_root = deps.document_store.get_workspace_root();
        return await deps.hover_provider.get_hover(
            document_state,
            params.position,
            workspace_symbols,
            deps.scope_resolver || undefined,
            {
                assume_call_site: config.cross_file?.assume_call_site,
                max_forward_depth: config.cross_file?.max_forward_depth,
            },
            token,
            workspace_root
        );
    };
}

/**
 * Creates the definition handler that provides go-to-definition.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for definition requests
 */
export function create_definition_handler(
    deps: HandlerDependencies
): (params: DefinitionParams, token?: CancellationToken) => Promise<Definition | null> {
    return async (params: DefinitionParams, token?: CancellationToken): Promise<Definition | null> => {
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.definition_provider) {
            return null;
        }
        const workspace_symbols = deps.workspace_indexer
            ? deps.workspace_indexer.get_all_symbols()
            : undefined;
        const config = await deps.get_document_settings(params.textDocument.uri);

        return await deps.definition_provider.get_definition(
            document_state,
            params.position,
            workspace_symbols,
            document_state.context_tracker,
            deps.scope_resolver || undefined,
            deps.workspace_indexer || undefined,
            {
                assume_call_site: config.cross_file?.assume_call_site,
                max_forward_depth: config.cross_file?.max_forward_depth,
            },
            token
        );
    };
}

/**
 * Creates the document symbol handler that provides document outline.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for document symbol requests
 */
export function create_document_symbol_handler(
    deps: HandlerDependencies
): (params: DocumentSymbolParams) => DocumentSymbol[] {
    return (params: DocumentSymbolParams): DocumentSymbol[] => {
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.symbol_provider) {
            return [];
        }
        return deps.symbol_provider.get_document_symbols(document_state);
    };
}

/**
 * Creates the workspace symbol handler that provides workspace-wide symbol search.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for workspace symbol requests
 */
export function create_workspace_symbol_handler(
    deps: HandlerDependencies
): (params: WorkspaceSymbolParams) => WorkspaceSymbol[] {
    return (params: WorkspaceSymbolParams): WorkspaceSymbol[] => {
        if (!deps.symbol_provider) {
            return [];
        }
        const workspace_symbols = deps.workspace_indexer
            ? deps.workspace_indexer.get_all_symbols()
            : undefined;
        const all_documents = deps.document_store.getAll();
        return deps.symbol_provider.get_workspace_symbols(
            params.query,
            all_documents,
            workspace_symbols
        );
    };
}

/**
 * Creates the document formatting handler.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for document formatting requests
 */
export function create_formatting_handler(
    deps: HandlerDependencies
): (params: DocumentFormattingParams) => Promise<TextEdit[]> {
    return async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.formatter_provider) {
            return [];
        }

        // Get document settings for comment formatting configuration
        const settings = await deps.get_document_settings(params.textDocument.uri);

        // Use comment normalization if enabled
        if (settings.formatting.normalizeCommentStyle) {
            return deps.formatter_provider.format_with_comment_normalization(
                document_state,
                params.options,
                settings.formatting
            );
        }

        // Otherwise use standard formatting
        return deps.formatter_provider.format(
            document_state,
            params.options,
            settings.formatting.lineWidth
        );
    };
}

/**
 * Creates the document range formatting handler.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for document range formatting requests
 */
export function create_range_formatting_handler(
    deps: HandlerDependencies
): (params: DocumentRangeFormattingParams) => Promise<TextEdit[]> {
    return async (params: DocumentRangeFormattingParams): Promise<TextEdit[]> => {
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.formatter_provider) {
            return [];
        }

        // Get document settings for comment formatting configuration
        const settings = await deps.get_document_settings(params.textDocument.uri);

        // Use comment normalization if enabled
        if (settings.formatting.normalizeCommentStyle) {
            // Note: format_range_with_comment_normalization would be ideal,
            // but for now we apply full document normalization and return the range
            const the_full_edits = deps.formatter_provider.format_with_comment_normalization(
                document_state,
                params.options,
                settings.formatting
            );
            return the_full_edits;
        }

        // Otherwise use standard range formatting
        return deps.formatter_provider.format_range(
            document_state,
            params.range,
            params.options,
            settings.formatting.lineWidth
        );
    };
}

/**
 * Creates the shutdown handler.
 *
 * @param deps - Handler dependencies for cleanup
 * @returns Handler function for shutdown requests
 */
export function create_shutdown_handler(deps?: HandlerDependencies): () => Promise<void> {
    return (): Promise<void> => {
        // Gracefully shutdown and cleanup resources
        if (deps?.rename_handler) {
            deps.rename_handler.dispose();
        }
        return Promise.resolve();
    };
}

/**
 * Creates the exit handler.
 *
 * @param on_exit - Optional callback to run on exit (defaults to process.exit(0))
 * @returns Handler function for exit notifications
 */
export function create_exit_handler(
    on_exit?: () => void
): () => void {
    return (): void => {
        if (on_exit) {
            on_exit();
        } else {
            process.exit(0);
        }
    };
}

/**
 * Creates the did change watched files handler with atomic save detection.
 *
 * @param deps - Handler dependencies including workspace indexer and rename handler
 * @param parse_uri - Function to parse URI to file path
 * @returns Handler function for watched files change notifications
 */
export function create_did_change_watched_files_handler(
    deps: HandlerDependencies,
    parse_uri: (uri: string) => string
): (params: DidChangeWatchedFilesParams) => void {
    return (params: DidChangeWatchedFilesParams): void => {
        for (const my_event of params.changes) {
            const file_path = parse_uri(my_event.uri);
            
            // Only process Stata-related files
            if (!(
                file_path.endsWith('.do') ||
                file_path.endsWith('.ado') ||
                file_path.endsWith('.doh') ||
                file_path.endsWith('.mata')
            )) {
                continue;
            }

            // Invalidate scope cache for changed file
            if (deps.scope_resolver) {
                deps.scope_resolver.invalidate_file_cache(my_event.uri);
            }

            // Map LSP change types to our handler types
            let change_type: 'created' | 'changed' | 'deleted';
            if (my_event.type === 1) {
                change_type = 'created';
            } else if (my_event.type === 2) {
                change_type = 'changed';
            } else if (my_event.type === 3) {
                change_type = 'deleted';
            } else {
                continue;
            }

            // Use rename handler if available, otherwise fall back to direct indexer calls
            if (deps.rename_handler) {
                deps.rename_handler.handle_file_change(file_path, change_type);
            } else {
                // Fallback to direct indexer calls
                if (change_type === 'deleted') {
                    if (deps.workspace_indexer) {
                        deps.workspace_indexer.remove_file(file_path);
                    }
                    
                    // Remove all reverse dependency entries for deleted file
                    if (deps.scope_resolver) {
                        deps.scope_resolver.remove_uri_from_reverse_deps(my_event.uri);
                    }
                } else {
                    if (deps.workspace_indexer) {
                        deps.workspace_indexer.schedule_update(file_path);
                    }
                }
            }
        }
    };
}

/**
 * Creates the completion resolve handler.
 *
 * @returns Handler function for completion resolve requests
 */
export function create_completion_resolve_handler(): (item: CompletionItem) => CompletionItem {
    return (item: CompletionItem): CompletionItem => {
        if (item.data === 1) {
            item.detail = 'Generate new variable';
            item.documentation = 'Creates a new variable with the specified expression';
        } else if (item.data === 2) {
            item.detail = 'Linear regression';
            item.documentation = 'Performs linear regression analysis';
        }
        return item;
    };
}

/**
 * Creates the didChangeTextDocument handler that updates documents with workspace symbols.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for didChangeTextDocument notifications
 */
export function create_did_change_text_document_handler(
    deps: HandlerDependencies
): (uri: string, changes: TextDocumentContentChangeEvent[], version: number) => Promise<void> {
    return async (uri: string, changes: TextDocumentContentChangeEvent[], version: number): Promise<void> => {
        const workspace_symbols = deps.workspace_indexer
            ? deps.workspace_indexer.get_all_symbols()
            : undefined;
        
        await deps.document_store.update(uri, changes, version, workspace_symbols);
    };
}

/**
 * Creates the didOpenTextDocument handler that opens documents with workspace symbols.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for didOpenTextDocument notifications
 */
export function create_did_open_text_document_handler(
    deps: HandlerDependencies
): (uri: string, content: string, version: number) => Promise<void> {
    return async (uri: string, content: string, version: number): Promise<void> => {
        const workspace_symbols = deps.workspace_indexer
            ? deps.workspace_indexer.get_all_symbols()
            : undefined;
        
        await deps.document_store.open(uri, content, version, workspace_symbols);
    };
}

/**
 * Creates the execute command handler for LSP commands.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for execute command requests
 */
export function create_execute_command_handler(
    deps: HandlerDependencies
): (command: string, args: any[]) => Promise<any> {
    return async (command: string, args: any[]): Promise<any> => {
        // Handle comment toggle commands
        if (command === 'sight.toggleLineComment' || command === 'sight.toggleBlockComment') {
            // These commands are typically handled by the client
            // Return success
            return { success: true };
        }
        
        // Unknown command
        return { success: false, error: `Unknown command: ${command}` };
    };
}
