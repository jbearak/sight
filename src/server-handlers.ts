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
    Location,
    ReferenceParams,
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
import { command_database } from './command-database';
import { DiagnosticsProvider } from './providers/diagnostics';
import { CompletionProvider, detect_completion_context } from './providers/completion';
import { HoverProvider } from './providers/hover';
import { DefinitionProvider } from './providers/definition';
import { ReferencesProvider } from './providers/references';
import { SymbolProvider } from './providers/symbols';
import { CodeFormatter } from './providers/formatter';
import { WorkspaceIndexer } from './indexer';
import { StataLSPConfig } from './types';
import { ContextTracker } from './context-tracker';
import { ScopeResolver } from './scope-resolver';
import { ForwardScopeResolver } from './forward-scope-resolver';
import { DependencyGraph } from './dependency-graph';
import { RenameHandler } from './utils/file-rename-handler';
import { DebounceManager, DocumentDebounceManager } from './utils/debounce-manager';
import * as fs from 'fs';
import { expand_includes, IncludeResolver } from './utils/include-expander';
import { extract_marker_names } from './utils/marker-scanner';

/**
 * Interface defining all dependencies required by LSP handlers.
 * This enables dependency injection for testing.
 */
export interface HandlerDependencies {
    debounce_manager: DebounceManager | null;
    document_store: DocumentStore;
    diagnostics_provider: DiagnosticsProvider | null;
    completion_provider: CompletionProvider | null;
    hover_provider: HoverProvider | null;
    definition_provider: DefinitionProvider | null;
    references_provider: ReferencesProvider | null;
    symbol_provider: SymbolProvider | null;
    formatter_provider: CodeFormatter | null;
    workspace_indexer: WorkspaceIndexer | null;
    scope_resolver: ScopeResolver | null;
    forward_scope_resolver: ForwardScopeResolver | null;
    dependency_graph: DependencyGraph | null;
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
            undefinedVariable: 'off',
            styleWarnings: 'hint',
            malformedOperator: 'warning',
            invalidOperatorSequence: 'error',
            cStyleLogicalInControlFlow: 'information',
            mixedLogicalOperators: 'warning',
        },
        indentation: false,
    },
    completion: {
        cacheSize: 200,
        prefixMaxItems: 200,
    },
    formatting: {
        indentSize: 4,
        indentStyle: 'spaces',
        lineWidth: 80,
        preferredCommentStyle: 'line',
        normalizeCommentStyle: false,
        commentLineWidth: 72,
        mode: 'source-preserving',
        preserve_alignment: true,
    },
    lineCommentStyle: '//',
    indexing: {
        maxFileSizeBytes: 500000,
    },
    adoPaths: [],
    indexWorkspace: true,
    cross_file: {
        index_workspace: true,
        max_indexed_files: 1000,
        assume_call_site: 'end',
        backward_dependencies: 'auto',
        max_backward_depth: 10,
        max_forward_depth: 10,
        max_chain_depth: 20,
        max_callee_revalidations: 10,
        diagnostics: {
            missing_file: 'warning',
            max_depth: 'information',
        },
    },
    debug: false,
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
    on_initialization_options_detected?: (options: any) => void,
    on_root_uri_detected?: (root_uri: string | null) => void
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

        // Capture rootUri for fallback when workspaceFolders is unavailable.
        // Many CLI-based LSP clients (e.g., Claude Code, Neovim in
        // single-file mode) send rootUri but may not support the
        // workspaceFolders capability.
        if (on_root_uri_detected) {
            on_root_uri_detected(
                params.rootUri ?? params.rootPath ?? null
            );
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
                referencesProvider: true,
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
        // Wait for any pending debounce to complete (Req 10.2)
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
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
                        token_line_index: new Map(),
                        ignored_lines: new Set<number>(),
                    },
                    params.position,
                    trigger_character,
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

            const graph_version = deps.dependency_graph
                ? deps.dependency_graph.get_version()
                : undefined;
            const items = await deps.completion_provider.get_completions(
                document_state,
                params.position,
                trigger_character,
                deps.scope_resolver || undefined,
                workspace_symbols,
                {
                    assume_call_site: config.cross_file?.assume_call_site,
                    backward_dependencies: config.cross_file?.backward_dependencies,
                    max_forward_depth: config.cross_file?.max_forward_depth,
                },
                workspace_version,
                token,
                graph_version
            );

            // Detect completion context to determine isIncomplete (Req 9.1, 9.2)
            // Macro contexts need isIncomplete=true because the replacement range
            // changes dynamically as the user types macro delimiters.
            // Non-macro contexts return isIncomplete=false so the client can cache results.
            const completion_context = detect_completion_context(
                document_state,
                params.position,
                document_state.tokens
            );
            const is_macro_context = completion_context.type === 'macro';

            return { isIncomplete: is_macro_context, items };
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
        // Wait for any pending debounce to complete (Req 10.2)
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
        await deps.document_store.wait_for_update(params.textDocument.uri);
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.hover_provider) {
            return null;
        }
        const workspace_symbols = deps.workspace_indexer
            ? deps.workspace_indexer.get_all_symbols()
            : undefined;
        const config = await deps.get_document_settings(params.textDocument.uri);
        const workspace_root = deps.document_store.get_workspace_root_for_uri(
            params.textDocument.uri
        );
        return await deps.hover_provider.get_hover(
            document_state,
            params.position,
            workspace_symbols,
            deps.scope_resolver || undefined,
            {
                assume_call_site: config.cross_file?.assume_call_site,
                backward_dependencies: config.cross_file?.backward_dependencies,
                max_forward_depth: config.cross_file?.max_forward_depth,
            },
            token,
            workspace_root,
            deps.workspace_indexer || undefined,
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
        // Wait for any pending debounce to complete (Req 10.2)
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
        await deps.document_store.wait_for_update(params.textDocument.uri);
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
                backward_dependencies: config.cross_file?.backward_dependencies,
                max_forward_depth: config.cross_file?.max_forward_depth,
            },
            token
        );
    };
}

/**
 * Creates the references handler that provides find-references.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for references requests
 */
export function create_references_handler(
    deps: HandlerDependencies
): (params: ReferenceParams, token?: CancellationToken) => Promise<Location[] | null> {
    return async (params: ReferenceParams, token?: CancellationToken): Promise<Location[] | null> => {
        // Wait for any pending debounce to complete (Req 10.2)
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
        await deps.document_store.wait_for_update(params.textDocument.uri);
        const document_state = deps.document_store.get(params.textDocument.uri);
        if (!document_state || !deps.references_provider) {
            return null;
        }
        const config = await deps.get_document_settings(params.textDocument.uri);

        return await deps.references_provider.get_references(
            document_state,
            params.position,
            params.context,
            deps.workspace_indexer || undefined,
            document_state.context_tracker,
            token,
            {
                assume_call_site: config.cross_file?.assume_call_site,
                backward_dependencies: config.cross_file?.backward_dependencies,
                max_forward_depth: config.cross_file?.max_forward_depth,
            }
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
): (params: DocumentSymbolParams) => Promise<DocumentSymbol[]> {
    return async (params: DocumentSymbolParams): Promise<DocumentSymbol[]> => {
        // Wait for any pending debounce to complete before reading state
        await deps.debounce_manager?.wait_for_debounce(params.textDocument.uri);
        await deps.document_store.wait_for_update(params.textDocument.uri);

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
        const all_documents = deps.document_store.getAll();
        return deps.symbol_provider.get_workspace_symbols(
            params.query,
            all_documents,
            deps.workspace_indexer ?? undefined
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

        // Otherwise use standard formatting with mode from config
        return deps.formatter_provider.format(
            document_state,
            params.options,
            settings
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

        // Otherwise use standard range formatting with mode from config
        return deps.formatter_provider.format_range(
            document_state,
            params.range,
            params.options,
            settings
        );
    };
}

/**
 * Creates the shutdown handler.
 *
 * @param deps - Handler dependencies for cleanup
 * @param disposables - Additional disposable components
 *   (debounce_manager, pending_revalidations)
 * @returns Handler function for shutdown requests
 */
export function create_shutdown_handler(
    deps?: HandlerDependencies,
    disposables?: {
        debounce_manager?: DocumentDebounceManager;
        pending_revalidations?: Map<string, { cancelled: boolean }>;
    }
): () => Promise<void> {
    return async (): Promise<void> => {
        // Cancel background indexing first to stop new work (Req 15.1)
        deps?.workspace_indexer?.cancel();

        // Cancel all pending revalidations (Req 1.1)
        if (disposables?.pending_revalidations) {
            for (const my_token of disposables.pending_revalidations.values()) {
                my_token.cancelled = true;
            }
            disposables.pending_revalidations.clear();
        }

        // Dispose debounce manager — cancels timers,
        // clears queue (Req 1.2, 1.5)
        disposables?.debounce_manager?.dispose();

        // Await active document updates with a timeout so we don't
        // block the shutdown response to the client (Req 1.3).
        // process.exit(0) in the exit handler will clean up anything
        // still in-flight.
        if (deps?.document_store) {
            const SHUTDOWN_TIMEOUT_MS = 500;
            await Promise.race([
                deps.document_store.dispose(),
                new Promise<void>(resolve =>
                    setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)
                ),
            ]);
        }

        // Dispose scope resolvers (Req 1.4)
        deps?.scope_resolver?.dispose();
        deps?.forward_scope_resolver?.dispose();

        // Dispose rename handler — clears timers (Req 15.2)
        deps?.rename_handler?.dispose();
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
    parse_uri: (uri: string) => string,
    on_file_changed?: (uri: string) => void  // New callback for caller revalidation
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

            // Trigger caller revalidation for changed files
            if (change_type === 'changed' && on_file_changed) {
                on_file_changed(my_event.uri);
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

/**
 * Interface for sight/getWorkingDirectory request parameters.
 */
export interface GetWorkingDirectoryParams {
    uri: string;
}

/**
 * Interface for sight/getWorkingDirectory request result.
 */
export interface GetWorkingDirectoryResult {
    workingDirectory: string | null;
}

/**
 * Creates the custom request handler for sight/getWorkingDirectory.
 *
 * @param deps - Handler dependencies
 * @returns Handler function for sight/getWorkingDirectory requests
 */
export function create_get_working_directory_handler(
    deps: HandlerDependencies
): (params: GetWorkingDirectoryParams) => Promise<GetWorkingDirectoryResult> {
    return async (params: GetWorkingDirectoryParams): Promise<GetWorkingDirectoryResult> => {
        await deps.document_store.wait_for_update(params.uri);
        const document_state = deps.document_store.get(params.uri);
        return {
            workingDirectory: document_state?.working_directory ?? null
        };
    };
}

// -----------------------------------------------------------------------
// sight/resolveSthlpFile
// -----------------------------------------------------------------------

export interface ResolveSthlpFileParams {
    topic: string;
    anchor?: string;
}

export interface ResolveSthlpFileResult {
    file_path: string | null;
}

// -----------------------------------------------------------------------
// Shared ihlp cache and include-resolver used by both
// `create_resolve_sthlp_file_handler` (anchor fallback) and
// `create_expand_includes_handler` (webview rendering).
// -----------------------------------------------------------------------

const MAX_IHLP_CACHE_SIZE = 500;

/**
 * Create a shared `IncludeResolver` backed by a single LRU-ish cache
 * so the same `.ihlp` file is never read from disk twice.
 */
export function create_shared_ihlp_resolver(
    deps: HandlerDependencies
): { resolver: IncludeResolver; cache: Map<string, string> } {
    const the_cache = new Map<string, string>();

    const my_resolver: IncludeResolver = async (name: string) => {
        if (!deps.workspace_indexer) return null;

        const my_path =
            await deps.workspace_indexer.resolve_ihlp_file(name);
        if (!my_path) return null;

        const my_cached = the_cache.get(my_path);
        if (my_cached !== undefined) {
            return { path: my_path, content: my_cached };
        }

        try {
            const my_content = await fs.promises.readFile(
                my_path, 'utf-8'
            );
            if (the_cache.size >= MAX_IHLP_CACHE_SIZE) {
                const my_first = the_cache.keys().next().value;
                if (my_first !== undefined) {
                    the_cache.delete(my_first);
                }
            }
            the_cache.set(my_path, my_content);
            return { path: my_path, content: my_content };
        } catch {
            return null;
        }
    };

    return { resolver: my_resolver, cache: the_cache };
}

/**
 * Creates the custom request handler for sight/resolveSthlpFile.
 *
 * Resolves a Stata help topic name to an absolute .sthlp file path
 * by searching ado-paths and workspace roots.
 */
export function create_resolve_sthlp_file_handler(
    deps: HandlerDependencies,
    shared_ihlp?: { resolver: IncludeResolver; cache: Map<string, string> }
): (params: ResolveSthlpFileParams) => Promise<ResolveSthlpFileResult> {
    const { resolver: my_ihlp_resolver } =
        shared_ihlp ?? create_shared_ihlp_resolver(deps);

    /**
     * Read a .sthlp file, expand its INCLUDE directives, and return
     * the expanded content. Used for scanning markers during anchor
     * fallback resolution.
     */
    async function read_and_expand(
        file_path: string
    ): Promise<string | null> {
        if (!deps.workspace_indexer) return null;
        try {
            const my_content = await fs.promises.readFile(
                file_path, 'utf-8'
            );
            return expand_includes(my_content, my_ihlp_resolver);
        } catch {
            return null;
        }
    }

    // The existing topic resolution logic, extracted into a function
    async function resolve_topic(
        params: ResolveSthlpFileParams
    ): Promise<ResolveSthlpFileResult> {
        if (!deps.workspace_indexer) {
            return { file_path: null };
        }
        const my_indexer = deps.workspace_indexer;
        const my_topic = (params.topic ?? '').trim();
        if (my_topic.length === 0) {
            return { file_path: null };
        }

        // 1. Try the topic as the user typed it (and its
        //    spaces-as-underscores variant, handled inside the
        //    indexer).
        const my_direct = await my_indexer.resolve_sthlp_file(my_topic);
        if (my_direct) {
            return { file_path: my_direct };
        }

        // Split the topic into head (first word) + tail so we can work
        // with the subcommand shape (`frame create`, `macro dir`, ...)
        // the same way across all fallbacks below.
        const my_first_space = my_topic.search(/\s/);
        const my_head = my_first_space === -1
            ? my_topic
            : my_topic.substring(0, my_first_space);
        const my_tail = my_first_space === -1
            ? ''
            : my_topic.substring(my_first_space);
        if (my_head.length === 0) {
            return { file_path: null };
        }
        const my_head_lower = my_head.toLowerCase();

        // 2. Redirect via `helpFile` when the command database knows the
        //    canonical help page lives elsewhere (e.g. `local` →
        //    `macro.sthlp`, `replace` → `generate.sthlp`). We try the
        //    redirected topic both with the original tail (so
        //    `replace postestimation`-style topics still work if they
        //    ever exist) and — for multi-word topics — without the
        //    tail, which handles subcommand links like `macro dir`
        //    whose help lives inside the parent file.
        const my_head_lookup = command_database.lookup(my_head);
        if (my_head_lookup?.helpFile && my_head_lookup.helpFile.toLowerCase() !== my_head_lower) {
            const my_redirected = await my_indexer.resolve_sthlp_file(
                my_head_lookup.helpFile + my_tail
            );
            if (my_redirected) {
                return { file_path: my_redirected };
            }
            if (my_tail.length > 0) {
                const my_parent_only = await my_indexer.resolve_sthlp_file(
                    my_head_lookup.helpFile
                );
                if (my_parent_only) {
                    return { file_path: my_parent_only };
                }
            }
        } else if (my_tail.length > 0 && my_head_lookup) {
            // Subcommands (`macro dir`, `frame drop`) that aren't backed
            // by a dedicated `<head>_<sub>.sthlp` should still open the
            // parent's help page rather than surfacing "not found".
            // Use the expanded name so abbreviated heads like `mac dir`
            // or `fr drop` resolve to `macro.sthlp` / `frame.sthlp`.
            const my_parent_only = await my_indexer.resolve_sthlp_file(
                my_head_lookup.name
            );
            if (my_parent_only) {
                return { file_path: my_parent_only };
            }
        }

        // 3. Try expanding the first word of the topic via Stata's
        //    abbreviation conventions (e.g. `reg` → `regress`, `di`
        //    → `display` or `dir`, `gen` → `generate`), preserving
        //    any trailing words so `reg postestimation` resolves via
        //    `regress_postestimation.sthlp`.
        // Gather candidate expansions in preference order. Stata's
        // command-database cache marks more commonly-used commands
        // with a lower `priority` value (1 = Tier 1 / most common),
        // so we use that as the primary sort key. Ties break on
        // command name length (shorter is usually the canonical
        // command, e.g. `regress` over `regression`). The cache's
        // explicit abbreviations map (`lookup`) is tried first as a
        // published short form.
        interface Candidate { name: string; priority: number; help_file?: string; }
        const the_tried = new Set<string>();
        const the_candidates: Candidate[] = [];
        const add_candidate = (name: string, priority: number | undefined, help_file?: string): void => {
            const my_normalized = name.toLowerCase();
            if (my_normalized === my_head_lower) return;
            if (the_tried.has(my_normalized)) return;
            the_tried.add(my_normalized);
            the_candidates.push({ name, priority: priority ?? 99, help_file });
        };

        if (my_head_lookup) {
            add_candidate(my_head_lookup.name, my_head_lookup.priority, my_head_lookup.helpFile);
        }
        for (const my_match of command_database.expand_abbreviation(my_head)) {
            add_candidate(my_match.name, my_match.priority, my_match.helpFile);
        }
        for (const my_match of command_database.search(my_head)) {
            add_candidate(my_match.name, my_match.priority, my_match.helpFile);
        }

        // Sort by priority ascending (1 = Tier 1 / most common), then
        // by name length ascending so the short canonical command
        // name (`regress`, `display`) wins over verbose relatives
        // (`regression`, `dir`). This makes `di` → `display` even
        // though the cache's `abbreviations` map says otherwise.
        the_candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.name.length - b.name.length;
        });

        for (const my_candidate of the_candidates) {
            const my_resolved = await my_indexer.resolve_sthlp_file(
                my_candidate.name + my_tail
            );
            if (my_resolved) {
                return { file_path: my_resolved };
            }
            // If the expanded command itself has a help_file redirect
            // (e.g. `loc` → `local` → `macro`), follow it.
            if (
                my_candidate.help_file
                && my_candidate.help_file.toLowerCase() !== my_candidate.name.toLowerCase()
            ) {
                const my_redirected = await my_indexer.resolve_sthlp_file(
                    my_candidate.help_file + my_tail
                );
                if (my_redirected) {
                    return { file_path: my_redirected };
                }
                if (my_tail.length > 0) {
                    const my_parent_only = await my_indexer.resolve_sthlp_file(
                        my_candidate.help_file
                    );
                    if (my_parent_only) {
                        return { file_path: my_parent_only };
                    }
                }
            }
        }

        // 4. Function-name fallback: float() → f_float.sthlp,
        //    strpos → f_strpos.sthlp
        {
            const my_func_name = my_topic.endsWith('()')
                ? my_topic.slice(0, -2)
                : my_topic;
            if (my_func_name.length > 0) {
                const my_func_path = await my_indexer.resolve_sthlp_file(
                    `f_${my_func_name}`
                );
                if (my_func_path) {
                    return { file_path: my_func_path };
                }
            }
        }

        // 5. System variable fallback: _N, _n, _pi, _rc, _cons → _variables
        if (my_topic.startsWith('_')) {
            const my_sysvar_path = await my_indexer.resolve_sthlp_file(
                '_variables'
            );
            if (my_sysvar_path) {
                return { file_path: my_sysvar_path };
            }
        }

        // 6. Hash-prefix fallback: #delimit → delimit.sthlp
        if (my_topic.startsWith('#')) {
            const my_stripped = my_topic.substring(1);
            if (my_stripped.length > 0) {
                const my_hash_path =
                    await my_indexer.resolve_sthlp_file(my_stripped);
                if (my_hash_path) {
                    return { file_path: my_hash_path };
                }
            }
        }

        // 7. Hyphen-to-underscore fallback: stata-be → stata_be
        //    (alias files use underscores, not hyphens)
        if (my_topic.includes('-')) {
            const my_underscore_topic = my_topic.replace(/-/g, '_');
            const my_hyphen_path =
                await my_indexer.resolve_sthlp_file(my_underscore_topic);
            if (my_hyphen_path) {
                return { file_path: my_hyphen_path };
            }
        }

        // 8. Case-insensitive fallback: Java → java, Dynamic → dynamic
        {
            const my_lower = my_topic.toLowerCase();
            if (my_lower !== my_topic) {
                const my_lower_path =
                    await my_indexer.resolve_sthlp_file(my_lower);
                if (my_lower_path) {
                    return { file_path: my_lower_path };
                }
            }
        }

        // 9. Suffix-probing fallback: Stata's help system tries
        //    common suffixes when the bare topic has no file
        //    (e.g. dynamic → dynamic_intro, bayesian → bayesian_estimation)
        {
            const the_suffixes = [
                '_intro', '_commands', '_options', '_functions',
                '_estimation', '_styles', '_modes', '_postestimation',
            ];
            // Try the topic as given, then its lowercase form
            const the_bases = [my_topic];
            const my_lower = my_topic.toLowerCase();
            if (my_lower !== my_topic) the_bases.push(my_lower);
            for (const my_base of the_bases) {
                for (const my_suffix of the_suffixes) {
                    const my_candidate =
                        await my_indexer.resolve_sthlp_file(
                            my_base + my_suffix
                        );
                    if (my_candidate) {
                        return { file_path: my_candidate };
                    }
                }
            }
        }

        return { file_path: null };
    }

    // Main handler: resolve topic, then check anchor if provided
    return async (params: ResolveSthlpFileParams): Promise<ResolveSthlpFileResult> => {
        const my_result = await resolve_topic(params);

        // If no anchor requested, or no file resolved, return as-is
        if (!params.anchor || !my_result.file_path) {
            return my_result;
        }

        // Check if the anchor exists in the resolved file
        const my_expanded = await read_and_expand(my_result.file_path);
        if (my_expanded) {
            const the_markers = extract_marker_names(my_expanded);
            if (the_markers.has(params.anchor)) {
                return my_result;
            }
        }

        // Anchor not found — search topic_* related files
        if (deps.workspace_indexer) {
            const my_topic = (params.topic ?? '').trim();
            const the_related = await deps.workspace_indexer
                .find_related_sthlp_files(my_topic);

            for (const my_candidate_path of the_related) {
                if (my_candidate_path === my_result.file_path) continue;

                const my_candidate_content =
                    await read_and_expand(my_candidate_path);
                if (!my_candidate_content) continue;

                const the_candidate_markers =
                    extract_marker_names(my_candidate_content);
                if (the_candidate_markers.has(params.anchor)) {
                    return { file_path: my_candidate_path };
                }
            }
        }

        // No related file has the anchor — return original file
        return my_result;
    };
}

// -----------------------------------------------------------------------
// sight/resolveFindalias
// -----------------------------------------------------------------------

export interface ResolveFindaliasParams {
    alias: string;
}

export interface ResolveFindaliasResult {
    smcl: string | null;
}

/**
 * Creates the custom request handler for `sight/resolveFindalias`.
 *
 * Resolves a `{findalias X}` SMCL alias to its substitution string by
 * consulting `*smcl_alias.maint` files under the same directories
 * `resolve_sthlp_file` searches (user `ado_paths` ∪ workspace roots
 * ∪ auto-discovered Stata install paths). Returns `{ smcl: null }`
 * when the alias is unknown or no workspace indexer is available.
 */
export function create_resolve_findalias_handler(
    deps: HandlerDependencies
): (params: ResolveFindaliasParams) => Promise<ResolveFindaliasResult> {
    return async (params: ResolveFindaliasParams): Promise<ResolveFindaliasResult> => {
        if (!deps.workspace_indexer) {
            return { smcl: null };
        }
        const my_alias = (params.alias ?? '').trim();
        if (my_alias.length === 0) {
            return { smcl: null };
        }
        const my_resolver = deps.workspace_indexer.get_findalias_resolver();
        const my_smcl = my_resolver.lookup(my_alias);
        return { smcl: my_smcl };
    };
}

// -----------------------------------------------------------------------
// sight/expandIncludes
// -----------------------------------------------------------------------

export interface ExpandIncludesParams {
    content: string;
}

export interface ExpandIncludesResult {
    content: string;
}

/**
 * Creates the custom request handler for `sight/expandIncludes`.
 *
 * Expands `{include filename.ihlp}` directives in SMCL content by
 * resolving `.ihlp` files through the workspace indexer's ado-path
 * search. Uses the shared ihlp cache. Returns the original content
 * when no workspace indexer is available.
 */
export function create_expand_includes_handler(
    deps: HandlerDependencies,
    shared_ihlp?: { resolver: IncludeResolver; cache: Map<string, string> }
): (params: ExpandIncludesParams) => Promise<ExpandIncludesResult> {
    const { resolver: my_ihlp_resolver } =
        shared_ihlp ?? create_shared_ihlp_resolver(deps);

    return async (
        params: ExpandIncludesParams
    ): Promise<ExpandIncludesResult> => {
        if (!deps.workspace_indexer) {
            return { content: params.content };
        }
        const my_result = await expand_includes(
            params.content, my_ihlp_resolver
        );
        return { content: my_result };
    };
}
