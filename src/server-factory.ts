/**
 * Server factory for creating LSP server instances with different transports.
 * Supports stdio (for standalone/CLI usage) and Node IPC (for VS Code).
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    DidChangeConfigurationNotification,
    Connection,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentStore } from './document-store';
import { DiagnosticsProvider } from './providers/diagnostics';
import { CompletionProvider } from './providers/completion';
import { HoverProvider } from './providers/hover';
import { DefinitionProvider } from './providers/definition';
import { ReferencesProvider } from './providers/references';
import { SymbolProvider } from './providers/symbols';
import { CodeFormatter } from './providers/formatter';
import { command_database } from './command-database';
import { StataLSPConfig } from './types';
import type { DeepPartial } from './utils/workspace-config';
import { WorkspaceIndexer } from './indexer';
import { ScopeResolver } from './scope-resolver';
import { ForwardScopeResolver } from './forward-scope-resolver';
import { DocumentDebounceManager } from './utils/debounce-manager';
import { validate_comment_formatting_config } from './utils/config-validator';
import { read_workspace_file_config_from_root, map_stata_lsp_json_to_partial_config } from './utils/workspace-config';
import { RenameHandler } from './utils/file-rename-handler';
import { Logger } from './utils/logger';
import { DependencyGraph } from './dependency-graph';
import { URI } from 'vscode-uri';
import * as fs from 'fs';

// Import cache directly so it gets bundled into the binary
import embedded_cache_raw from './command-database/caches/v18.json';
import type { CommandCache } from './command-database/types';
const embedded_cache = embedded_cache_raw as CommandCache;

import {
    HandlerDependencies,
    ServerCapabilities,
    DEFAULT_SETTINGS,
    create_initialize_handler,
    create_initialized_handler,
    create_completion_handler,
    create_completion_resolve_handler,
    create_hover_handler,
    create_definition_handler,
    create_references_handler,
    create_document_symbol_handler,
    create_workspace_symbol_handler,
    create_formatting_handler,
    create_range_formatting_handler,
    create_shutdown_handler,
    create_exit_handler,
    create_did_change_watched_files_handler,
    create_execute_command_handler,
    create_get_working_directory_handler,
} from './server-handlers';

import type { TransportType } from './cli';

/**
 * Options for creating the server.
 */
export interface ServerOptions {
    transport: TransportType;
    quiet?: boolean;
    log_channel?: (msg: string) => void;
}

/**
 * Create an LSP connection based on transport type.
 */
function create_transport_connection(transport: TransportType): Connection {
    if (transport === 'stdio') {
        // Use stdio transport for standalone usage
        return createConnection(process.stdin, process.stdout);
    } else {
        // Use Node IPC transport for VS Code
        return createConnection(ProposedFeatures.all);
    }
}

/**
 * Create and start the LSP server with the specified options.
 */
export async function create_server(options: ServerOptions): Promise<void> {
    const { transport, quiet, log_channel } = options;

    // Create connection based on transport type
    const connection = create_transport_connection(transport);

    // Create a simple text document manager
    const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

    // Document store for managing parsed state
    const document_store = new DocumentStore();

    // Debounce manager for batching rapid document changes
    const debounce_manager = new DocumentDebounceManager();

    // Provider instances (initialized after connection is established)
    let diagnostics_provider: DiagnosticsProvider | null = null;
    let completion_provider: CompletionProvider | null = null;
    let hover_provider: HoverProvider | null = null;
    let definition_provider: DefinitionProvider | null = null;
    let references_provider: ReferencesProvider | null = null;
    let symbol_provider: SymbolProvider | null = null;
    let formatter_provider: CodeFormatter | null = null;
    let workspace_indexer: WorkspaceIndexer | null = null;
    let scope_resolver: ScopeResolver | null = null;
    let forward_scope_resolver: ForwardScopeResolver | null = null;
    let dependency_graph: DependencyGraph | null = null;
    let rename_handler: RenameHandler | null = null;

    // Maximum revalidation cascade depth to prevent A→B→C→A loops
    const MAX_REVALIDATION_DEPTH = 5;

    // Cancellation tokens for pending callee revalidations
    const pending_revalidations: Map<string, { cancelled: boolean }> = new Map();

    // Track last changed URI for active-document prioritization
    let last_changed_uri: string | undefined = undefined;

    // Track client capabilities
    let server_capabilities: ServerCapabilities = {
        has_snippet_support: false,
        has_configuration_capability: false,
        has_workspace_folder_capability: false,
        has_diagnostic_related_information_capability: false,
    };

    // Configuration settings
    let global_settings: StataLSPConfig = DEFAULT_SETTINGS;
    const document_settings: Map<string, Thenable<StataLSPConfig>> = new Map();

    // Workspace-root .sight.json config
    let workspace_file_config: DeepPartial<StataLSPConfig> | undefined = undefined;

    // Initialization options config
    let init_options_config: unknown = undefined;

    type JsonObject = Record<string, unknown>;

    function deep_merge<T>(base: T, overlay: unknown): T {
        if (overlay === null || overlay === undefined) {
            return base;
        }
        if (Array.isArray(overlay)) {
            return overlay as any;
        }
        if (typeof overlay !== 'object') {
            return overlay as any;
        }

        const overlay_obj = overlay as JsonObject;
        const result: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
        for (const key of Object.keys(overlay_obj)) {
            const base_value = (result as any)[key];
            const overlay_value = overlay_obj[key];
            if (
                typeof base_value === 'object' && base_value !== null &&
                typeof overlay_value === 'object' && overlay_value !== null &&
                !Array.isArray(base_value) && !Array.isArray(overlay_value)
            ) {
                (result as any)[key] = deep_merge(base_value, overlay_value);
            } else {
                (result as any)[key] = overlay_value;
            }
        }
        return result;
    }

    /**
     * Get document-specific settings or fall back to global settings.
     */
    function get_document_settings(resource: string): Promise<StataLSPConfig> {
        if (!server_capabilities.has_configuration_capability) {
            return Promise.resolve(global_settings);
        }

        let result = document_settings.get(resource);
        if (!result) {
            // Handle empty or invalid URIs (e.g., from Zed)
            const scope_uri = resource && resource.trim() !== '' ? resource : undefined;
            
            result = connection.workspace.getConfiguration({
                scopeUri: scope_uri,
                section: 'sight',
            }).then((config) => {
                let init_partial = (init_options_config as any)?.['sight'] ?? init_options_config;
                if (init_partial && typeof init_partial === 'object' && (init_partial as any).crossFile) {
                    init_partial = deep_merge({}, map_stata_lsp_json_to_partial_config(init_partial));
                }

                const merged_partial = deep_merge(
                    deep_merge(
                        deep_merge({}, workspace_file_config || {}),
                        init_partial || {}
                    ),
                    config || {}
                );

                return validate_comment_formatting_config(merged_partial, (msg) => {
                    connection.console.log(`Configuration warning: ${msg}`);
                });
            });
            document_settings.set(resource, result);
        }
        return result as Promise<StataLSPConfig>;
    }

    /**
     * Get priority for a document based on visibility.
     */
    function get_document_priority(uri: string): number {
        if (!documents.get(uri)) return 0;
        if (uri === last_changed_uri) return 3;
        return 1;
    }

    /**
     * Schedule re-validation for affected callee documents.
     * @param revalidation_depth - Current cascade depth, incremented
     *   when triggering further revalidation
     */
    function schedule_callee_revalidation(
        callee_uris: Set<string>,
        trigger_uri: string,
        config: StataLSPConfig,
        revalidation_depth: number = 0
    ): void {
        const max_revalidations = config.cross_file?.max_callee_revalidations ?? 10;
        const is_debug = config.debug === true;

        const sorted_callees = Array.from(callee_uris).sort((a, b) => {
            return get_document_priority(b) - get_document_priority(a);
        });

        const existing_token = pending_revalidations.get(trigger_uri);
        if (existing_token) {
            existing_token.cancelled = true;
        }

        const my_token = { cancelled: false };
        pending_revalidations.set(trigger_uri, my_token);

        let count = 0;
        for (const my_callee_uri of sorted_callees) {
            if (count >= max_revalidations) {
                if (is_debug) {
                    connection.console.log(
                        `Callee revalidation limit reached (${max_revalidations}). ` +
                        `Skipped ${sorted_callees.length - count} callees.`
                    );
                }
                break;
            }

            const callee_doc = documents.get(my_callee_uri);
            if (callee_doc) {
                // Clear the published version so diagnostics will be republished
                // even though the callee document's version hasn't changed
                if (diagnostics_provider) {
                    diagnostics_provider.clear_published_version(my_callee_uri);
                }

                // Route through debounce instead of setTimeout (Req 3.1, 3.2)
                // validate_text_document now schedules through the debounce
                // manager internally, which coalesces multiple calls for the
                // same URI. Pass incremented depth to prevent unbounded cascade.
                validate_text_document(callee_doc, revalidation_depth + 1);
                count++;
            }
        }
    }

    /**
     * Get all transitive callers of a callee URI using BFS traversal.
     * @param callee_uri - The URI of the callee file
     * @param callee_to_callers - Map from callee URI to set of caller URIs
     * @param max_depth - Maximum depth to traverse
     * @returns Set of all transitive caller URIs
     */
    function get_transitive_callers(
        callee_uri: string,
        callee_to_callers: Map<string, Set<string>>,
        max_depth: number
    ): Set<string> {
        const all_callers = new Set<string>();
        const queue: Array<{uri: string, depth: number}> = [{uri: callee_uri, depth: 0}];
        const visited = new Set<string>([callee_uri]);
        
        while (queue.length > 0) {
            const {uri: current_uri, depth} = queue.shift()!;
            if (depth >= max_depth) continue;
            
            const immediate_callers = callee_to_callers.get(current_uri);
            if (!immediate_callers) continue;
            
            for (const my_caller_uri of immediate_callers) {
                if (visited.has(my_caller_uri)) continue;
                visited.add(my_caller_uri);
                all_callers.add(my_caller_uri);
                queue.push({uri: my_caller_uri, depth: depth + 1});
            }
        }
        
        return all_callers;
    }

    /**
     * Schedule re-validation for caller documents when a callee changes.
     * This ensures that when a file defining symbols changes, all files
     * that call it (via do/run/include) get their diagnostics updated.
     * Also revalidates files that transitively depend on the callers via
     * backward directives (@lsp-done-by/@lsp-included-by).
     * @param revalidation_depth - Current cascade depth, incremented
     *   when triggering further revalidation
     */
    function schedule_caller_revalidation(
        caller_uris: Set<string>,
        trigger_uri: string,
        config: StataLSPConfig,
        revalidation_depth: number = 0
    ): void {
        const max_revalidations = config.cross_file?.max_callee_revalidations ?? 10;
        const max_depth = config.cross_file?.max_chain_depth ?? 20;
        const is_debug = config.debug === true;

        // First expand caller_uris to include transitive forward-call callers
        const expanded_caller_uris = new Set<string>(caller_uris);
        if (scope_resolver) {
            const callee_to_callers = scope_resolver.get_callee_to_callers_map();
            for (const my_caller_uri of caller_uris) {
                const transitive_callers = get_transitive_callers(my_caller_uri, callee_to_callers, max_depth);
                for (const my_transitive_caller of transitive_callers) {
                    expanded_caller_uris.add(my_transitive_caller);
                }
            }
        }

        // Then expand to include transitive backward directive dependents
        const all_uris_to_revalidate = new Set<string>(expanded_caller_uris);
        if (scope_resolver) {
            for (const my_caller_uri of expanded_caller_uris) {
                const backward_dependents = scope_resolver.get_transitive_backward_directive_children(my_caller_uri);
                for (const my_dependent_uri of backward_dependents) {
                    all_uris_to_revalidate.add(my_dependent_uri);
                }
            }
        }

        const sorted_callers = Array.from(all_uris_to_revalidate).sort((a, b) => {
            return get_document_priority(b) - get_document_priority(a);
        });

        // Use a separate token key to avoid conflicts with callee revalidation
        const token_key = `caller:${trigger_uri}`;
        const existing_token = pending_revalidations.get(token_key);
        if (existing_token) {
            existing_token.cancelled = true;
        }

        const my_token = { cancelled: false };
        pending_revalidations.set(token_key, my_token);

        if (is_debug) {
            connection.console.log(
                `[caller-revalidation] Triggered by ` +
                `${trigger_uri}, direct callers: ` +
                `${caller_uris.size}, total (with ` +
                `backward deps): ${all_uris_to_revalidate.size}`
            );
        }

        let count = 0;
        for (const my_caller_uri of sorted_callers) {
            if (count >= max_revalidations) {
                if (is_debug) {
                    connection.console.log(
                        `Caller revalidation limit reached (${max_revalidations}). ` +
                        `Skipped ${sorted_callers.length - count} callers.`
                    );
                }
                break;
            }

            const caller_doc = documents.get(my_caller_uri);
            if (is_debug) {
                connection.console.log(`[caller-revalidation] Checking ${my_caller_uri}: doc=${caller_doc ? 'found' : 'not found'}`);
            }
            if (caller_doc) {
                // Clear the published version so diagnostics will be republished
                // even though the caller document's version hasn't changed
                if (diagnostics_provider) {
                    diagnostics_provider.clear_published_version(my_caller_uri);
                }

                // Route through debounce instead of setTimeout (Req 3.1, 3.2)
                // Pass incremented depth to prevent unbounded cascade.
                validate_text_document(caller_doc, revalidation_depth + 1);
                count++;
            }
        }

        if (is_debug) {
            connection.console.log(`[caller-revalidation] Scheduled ${count} revalidations`);
        }
    }

    // Mutable handler dependencies container (Req 4.1, 4.2, 14.1, 14.2).
    // Handlers capture this object by reference, so mutating its properties
    // after provider initialization makes new providers visible to all
    // already-registered handlers (Req 4.3, 14.3).
    const handler_deps: HandlerDependencies = {
        debounce_manager,
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
        get_document_settings,
        connection: {
            sendDiagnostics: (params) => connection.sendDiagnostics(params),
            console: { log: (msg) => connection.console.log(msg) },
        },
    };

    /**
     * Validate a text document and publish diagnostics.
     *
     * Captures a content snapshot eagerly, then schedules the full
     * lex/parse/analyze cycle, cross-file revalidation, and diagnostic
     * publication inside the debounce callback so that rapid edits are
     * coalesced into a single cycle (Req 2.1, 2.2, 2.3, 3.1, 3.2).
     *
     * @param revalidation_depth - Tracks cascade depth to prevent
     *   unbounded A→B→C→A revalidation loops. Defaults to 0 for
     *   user-initiated validation.
     */
    async function validate_text_document(
        text_document: TextDocument,
        revalidation_depth: number = 0
    ): Promise<void> {
        // Guard against unbounded revalidation cascade
        if (revalidation_depth >= MAX_REVALIDATION_DEPTH) {
            const eager_settings = await get_document_settings(text_document.uri);
            if (eager_settings.debug === true) {
                connection.console.log(
                    `[validate] Skipping ${text_document.uri} - ` +
                    `max revalidation depth (${MAX_REVALIDATION_DEPTH}) reached`
                );
            }
            return;
        }

        last_changed_uri = text_document.uri;

        // Cancel existing revalidation for this URI (eager, before debounce)
        const existing_token = pending_revalidations.get(text_document.uri);
        if (existing_token) {
            existing_token.cancelled = true;
        }

        // Invalidate scope cache eagerly so stale scopes are never read
        if (scope_resolver) {
            scope_resolver.invalidate_scope_cache(text_document.uri);
        }

        // Capture content snapshot for the debounce callback (Req 2.1)
        const snapshot_uri = text_document.uri;
        const snapshot_version = text_document.version;
        const snapshot_content = text_document.getText();

        debounce_manager.schedule_validation(
            snapshot_uri,
            snapshot_version,
            async () => {
                // Fetch settings inside debounce callback to avoid
                // delaying the debounce timer start (Req 8.2, 8.3, 8.4)
                const settings = await get_document_settings(snapshot_uri);
                const is_debug = settings.debug === true;

                // --- Lex/parse/analyze inside debounce callback (Req 2.1, 2.2) ---
                const workspace_symbols = workspace_indexer
                    ? workspace_indexer.get_all_symbols()
                    : undefined;

                if (document_store.get(snapshot_uri)) {
                    await document_store.update(
                        snapshot_uri,
                        [{ text: snapshot_content }],
                        snapshot_version,
                        workspace_symbols
                    );
                } else {
                    await document_store.open(
                        snapshot_uri,
                        snapshot_content,
                        snapshot_version,
                        workspace_symbols
                    );
                }

                // --- Cross-file revalidation scheduling (Req 3.1) ---
                if (scope_resolver) {
                    const document_state = document_store.get(snapshot_uri);
                    if (document_state?.forward_calls && document_state?.symbols) {
                        // Log forward calls for debugging (Req 8.2, 8.4)
                        if (is_debug) {
                            const static_calls = document_state.forward_calls.filter(c => c.is_static && c.path);
                            connection.console.log(`[reverse-deps] Updating for ${snapshot_uri}`);
                            connection.console.log(`[reverse-deps]   forward_calls: ${document_state.forward_calls.length} total, ${static_calls.length} static`);
                            for (const my_call of static_calls) {
                                connection.console.log(`[reverse-deps]   - ${my_call.type} "${my_call.path}" (line ${my_call.call_site_line})`);
                            }
                        }

                        const { affected_callees, interface_changed } = scope_resolver.update_reverse_dependencies(
                            snapshot_uri,
                            document_state.forward_calls,
                            document_state.symbols
                        );

                        // Update dependency graph for auto backward discovery
                        if (dependency_graph) {
                            const graph_result = dependency_graph.update_caller(
                                snapshot_uri,
                                document_state.forward_calls
                            );
                            // Invalidate scope caches for callees whose parent sets changed
                            if (graph_result.changed_callees.size > 0) {
                                scope_resolver.cascade_invalidate(graph_result.changed_callees);
                            }
                        }

                        if (is_debug) {
                            connection.console.log(`[reverse-deps] Result: affected_callees=${affected_callees.size}, interface_changed=${interface_changed}`);
                        }

                        if (affected_callees.size > 0) {
                            scope_resolver.cascade_invalidate(affected_callees);
                        }

                        if (affected_callees.size > 0 || interface_changed) {
                            schedule_callee_revalidation(affected_callees, snapshot_uri, settings, revalidation_depth);
                        }

                        // When this file's interface changes, revalidate all callers
                        // (files that call this file via do/run/include)
                        if (interface_changed) {
                            // Invalidate the file cache for this file so callers read fresh content
                            // This is necessary because the file cache may have stale data from before
                            // the in-memory edit was saved to disk. The DidChangeWatchedFiles event
                            // that normally invalidates the file cache may arrive after caller revalidation.
                            // Pass preserve_forward_call_relationships=true because we just updated them via update_reverse_dependencies.
                            scope_resolver.invalidate_file_cache(snapshot_uri, { preserve_forward_call_relationships: true });

                            // Log the reverse deps state for debugging (Req 8.3)
                            if (is_debug) {
                                connection.console.log(`[reverse-deps] Reverse deps state:\n${scope_resolver.get_reverse_deps_debug_info()}`);
                            }

                            // Revalidate files that call this file via forward calls (do/run/include commands)
                            const caller_uris = scope_resolver.get_callers_for_callee(snapshot_uri);
                            if (is_debug) {
                                connection.console.log(`[reverse-deps] Interface changed, forward-call callers for ${snapshot_uri}: ${Array.from(caller_uris).join(', ') || '(none)'}`);
                            }
                            if (caller_uris.size > 0) {
                                schedule_caller_revalidation(caller_uris, snapshot_uri, settings, revalidation_depth);
                            }

                            // Revalidate files that depend on this file via backward directives (@lsp-done-by/@lsp-included-by)
                            // These are files that inherit symbols FROM this file (transitively)
                            const backward_children = scope_resolver.get_transitive_backward_directive_children(snapshot_uri);
                            if (is_debug) {
                                connection.console.log(`[reverse-deps] Interface changed, transitive backward-directive children for ${snapshot_uri}: ${backward_children.size} files`);
                            }
                            if (backward_children.size > 0) {
                                if (is_debug) {
                                    connection.console.log(`[reverse-deps] Transitive dependents: ${Array.from(backward_children).join(', ')}`);
                                }
                                schedule_caller_revalidation(backward_children, snapshot_uri, settings, revalidation_depth);
                            }
                        }
                    }
                }

                // --- Diagnostic publication (Req 2.3) ---
                const document_state = document_store.get(snapshot_uri);

                if (!document_state) {
                    connection.sendDiagnostics({ uri: snapshot_uri, diagnostics: [] });
                    return;
                }

                if (diagnostics_provider) {
                    const diag_workspace_symbols = workspace_indexer
                        ? workspace_indexer.get_all_symbols()
                        : undefined;

                    let forward_scope = undefined;
                    // Skip forward_scope computation when scope_resolver is available —
                    // ScopeResolver.resolve() already calls ForwardScopeResolver internally
                    if (!scope_resolver && forward_scope_resolver && document_state.forward_calls.length > 0) {
                        const max_depth = settings.cross_file?.max_forward_depth ?? 10;
                        forward_scope = await forward_scope_resolver.resolve(
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
                            undefined,
                            { max_forward_depth: max_depth }
                        );
                    }

                    const result = await diagnostics_provider.publish_diagnostics(
                        document_state,
                        settings,
                        diag_workspace_symbols,
                        scope_resolver || undefined,
                        undefined,
                        forward_scope
                    );

                    if (result.pending) {
                        if (is_debug) {
                            connection.console.log(`Diagnostics pending for ${snapshot_uri}`);
                        }
                    }
                } else {
                    if (!settings.diagnostics.enabled) {
                        connection.sendDiagnostics({ uri: snapshot_uri, diagnostics: [] });
                        return;
                    }
                    connection.sendDiagnostics({
                        uri: snapshot_uri,
                        diagnostics: document_state.diagnostics
                    });
                }
            }
        );
    }

    // Wire initialize handler
    connection.onInitialize(
        create_initialize_handler(
            (caps: ServerCapabilities) => {
                server_capabilities = caps;
            },
            (options: any) => {
                init_options_config = options;
            }
        )
    );

    // Wire initialized handler
    connection.onInitialized(
        create_initialized_handler(() => {
            // Initialize Logger - route to stderr for stdio transport, suppress if quiet
            const log_fn = quiet
                ? () => { } // Suppress all startup messages
                : transport === 'stdio'
                    ? (msg: string) => process.stderr.write(msg + '\n')
                    : log_channel || ((msg: string) => connection.console.log(msg));

            Logger.initialize({
                verbosity: quiet ? 'error' : 'info',
                channel: log_fn,
            });

            // Load command cache (embedded at build time)
            try {
                command_database.load_cache(embedded_cache);
                log_fn(`Loaded command cache v${embedded_cache.version} with ${Object.keys(embedded_cache.commands).length} commands`);
            } catch (error) {
                log_fn(`Error loading command cache: ${error}`);
            }

            // Load addon commands
            try {
                command_database.load_addon_commands();
                log_fn('Loaded addon commands');
            } catch (error) {
                log_fn(`Error loading addon commands: ${error}`);
            }

            // Initialize providers
            diagnostics_provider = new DiagnosticsProvider(connection, debounce_manager);
            completion_provider = new CompletionProvider(
                command_database,
                { snippet_support: server_capabilities.has_snippet_support },
                undefined,
                global_settings.completion.cacheSize,
                global_settings.completion.prefixMaxItems
            );
            hover_provider = new HoverProvider(command_database);
            definition_provider = new DefinitionProvider();
            references_provider = new ReferencesProvider();
            symbol_provider = new SymbolProvider();
            formatter_provider = new CodeFormatter();
            workspace_indexer = new WorkspaceIndexer();
            scope_resolver = new ScopeResolver({
                log: (msg) => connection.console.log(msg),
                warn: (msg) => connection.console.warn(msg),
            }, {
                read_file: async (uri: string) => {
                    // Prefer TextDocuments buffer for open files (Req 11.1)
                    const open_doc = documents.get(uri);
                    if (open_doc) {
                        return open_doc.getText();
                    }
                    // Fall back to disk for closed files (Req 11.2)
                    const fs_path = URI.parse(uri).fsPath;
                    return fs.promises.readFile(fs_path, 'utf8');
                },
                exists: async (uri: string) => {
                    // Prefer TextDocuments for open files (Req 11.1)
                    if (documents.get(uri)) return true;
                    const fs_path = URI.parse(uri).fsPath;
                    try {
                        await fs.promises.access(fs_path);
                        return true;
                    } catch {
                        return false;
                    }
                }
            });

            document_store.set_scope_resolver(scope_resolver);

            // Create and wire dependency graph for auto backward dependencies
            dependency_graph = new DependencyGraph();
            workspace_indexer.set_dependency_graph(dependency_graph);
            workspace_indexer.set_on_graph_change((changed_callees) => {
                scope_resolver?.cascade_invalidate(changed_callees);
                for (const my_callee_uri of changed_callees) {
                    const my_doc = documents.get(my_callee_uri);
                    if (!my_doc) {
                        continue;
                    }
                    diagnostics_provider?.clear_published_version(
                        my_callee_uri
                    );
                    void validate_text_document(my_doc, 0);
                }
            });
            scope_resolver.set_dependency_graph(dependency_graph);
            diagnostics_provider.set_dependency_graph(dependency_graph);

            forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
                max_forward_depth: DEFAULT_SETTINGS.cross_file.max_forward_depth,
            });

            scope_resolver.set_forward_scope_resolver(forward_scope_resolver);

            rename_handler = new RenameHandler(
                (file_path: string) => {
                    if (workspace_indexer) {
                        workspace_indexer.remove_file(file_path);
                    }
                },
                (file_path: string) => {
                    if (workspace_indexer) {
                        workspace_indexer.schedule_update(file_path);
                    }
                },
                (message: string) => {
                    connection.console.log(message);
                },
                scope_resolver || undefined
            );

            // Mutate the mutable handler_deps container so that
            // already-registered handlers see the new providers (Req 4.3, 14.3)
            handler_deps.diagnostics_provider = diagnostics_provider;
            handler_deps.completion_provider = completion_provider;
            handler_deps.hover_provider = hover_provider;
            handler_deps.definition_provider = definition_provider;
            handler_deps.references_provider = references_provider;
            handler_deps.symbol_provider = symbol_provider;
            handler_deps.formatter_provider = formatter_provider;
            handler_deps.workspace_indexer = workspace_indexer;
            handler_deps.scope_resolver = scope_resolver;
            handler_deps.forward_scope_resolver = forward_scope_resolver;
            handler_deps.dependency_graph = dependency_graph;
            handler_deps.rename_handler = rename_handler;

            // Initialize workspace indexer
            const workspace_folders_promise = connection.workspace.getWorkspaceFolders();
            workspace_folders_promise.then((folders) => {
                if (!folders || !workspace_indexer) {
                    // No workspace folders or no indexer: scan is trivially complete.
                    dependency_graph?.mark_scan_complete();
                    // Re-trigger diagnostics for open docs so deferred
                    // diagnostics are evaluated now that scan is "complete"
                    for (const my_doc of documents.all()) {
                        if (diagnostics_provider) {
                            diagnostics_provider.clear_published_version(my_doc.uri);
                        }
                        validate_text_document(my_doc, 0);
                    }
                    return;
                }
                if (folders && workspace_indexer) {
                    const folder_paths = folders
                        .map((f) => URI.parse(f.uri).fsPath)
                        .filter((p) => p !== undefined);

                    if (forward_scope_resolver) {
                        forward_scope_resolver.set_workspace_roots(folder_paths);
                    }

                    if (folder_paths.length > 0) {
                        document_store.set_workspace_root(folder_paths[0]);
                        if (scope_resolver) {
                            scope_resolver.set_workspace_root(folder_paths[0]);
                        }
                        const loaded = read_workspace_file_config_from_root(folder_paths[0]);
                        workspace_file_config = loaded.partial_config;
                        if (loaded.error) {
                            connection.console.log(`Error reading .sight.json: ${loaded.error}`);
                        }
                    }

                    get_document_settings('').then((settings) => {
                        if (workspace_indexer) {
                            workspace_indexer.configure(settings);
                            workspace_indexer.set_max_indexed_files(
                                settings.cross_file?.max_indexed_files ?? 1000
                            );
                        }

                        if (!server_capabilities.has_configuration_capability) {
                            global_settings = settings;
                        }

                        const enabled = settings.indexWorkspace !== false &&
                            settings.cross_file?.index_workspace !== false;
                        if (enabled && workspace_indexer) {
                            workspace_indexer.initialize(folder_paths, settings.adoPaths || []).then(() => {
                                // mark_scan_complete is called inside initialize()
                                // After workspace scan completes, re-trigger diagnostics
                                // for all open documents so deferred diagnostics are evaluated
                                if (dependency_graph?.is_scan_complete()) {
                                    for (const my_doc of documents.all()) {
                                        if (diagnostics_provider) {
                                            diagnostics_provider.clear_published_version(my_doc.uri);
                                        }
                                        validate_text_document(my_doc, 0);
                                    }
                                }
                            });
                        } else {
                            // Indexing disabled: scan is trivially complete.
                            // Mark immediately so diagnostic deferral doesn't
                            // suppress undefined-symbol warnings permanently.
                            dependency_graph?.mark_scan_complete();
                            for (const my_doc of documents.all()) {
                                if (diagnostics_provider) {
                                    diagnostics_provider.clear_published_version(my_doc.uri);
                                }
                                validate_text_document(my_doc, 0);
                            }
                        }
                    });
                }
            });

            if (server_capabilities.has_configuration_capability) {
                connection.client.register(DidChangeConfigurationNotification.type, undefined);
            }
            if (server_capabilities.has_workspace_folder_capability) {
                connection.workspace.onDidChangeWorkspaceFolders(async (_event) => {
                    connection.console.log('Workspace folder change event received.');
                    const folders = await connection.workspace.getWorkspaceFolders();
                    if (folders && folders.length > 0) {
                        const folder_path = URI.parse(folders[0].uri).fsPath;
                        if (folder_path) {
                            document_store.set_workspace_root(folder_path);
                            if (scope_resolver) {
                                scope_resolver.set_workspace_root(folder_path);
                            }
                        }
                    } else {
                        document_store.set_workspace_root(undefined);
                        if (scope_resolver) {
                            scope_resolver.set_workspace_root(undefined);
                        }
                    }
                });
            }
        })
    );

    // Configuration change handler
    connection.onDidChangeConfiguration((change) => {
        if (server_capabilities.has_configuration_capability) {
            document_settings.clear();
        } else {
            const init_partial = (init_options_config as any)?.['sight'] ?? init_options_config;
            const merged_partial = deep_merge(
                deep_merge({}, workspace_file_config || {}),
                deep_merge(init_partial || {}, (change.settings as any)?.['sight'] || {})
            );
            global_settings = validate_comment_formatting_config(
                merged_partial,
                (msg) => {
                    connection.console.log(`Configuration warning: ${msg}`);
                }
            );
        }

        // Clear published versions so diagnostics will be re-published
        // even though document versions haven't changed
        if (diagnostics_provider) {
            for (const my_doc of documents.all()) {
                diagnostics_provider.clear_published_version(my_doc.uri);
            }
        }

        // Fire-and-forget validation for all documents
        // Catch errors to prevent unhandled promise rejections
        documents.all().forEach((doc) => {
            validate_text_document(doc).catch((err) => {
                connection.console.error(
                    `Error validating ${doc.uri} ` +
                    `after config change: ${err}`
                );
            });
        });
    });

    // Document open handler - validate when a document is first opened
    documents.onDidOpen((e) => {
        validate_text_document(e.document);
    });

    // Document close handler
    documents.onDidClose((e) => {
        document_settings.delete(e.document.uri);
        document_store.close(e.document.uri);
        debounce_manager.on_close(e.document.uri);
        if (diagnostics_provider) {
            diagnostics_provider.on_document_closed(e.document.uri);
        }
        if (scope_resolver) {
            scope_resolver.remove_caller_from_reverse_deps(e.document.uri);
        }
        // Immediately clear stale in-memory graph edges on close.
        // In-memory edits may have changed do/run/include edges that differ
        // from the on-disk state; clearing them and cascade-invalidating
        // ensures callees don't resolve against a stale parent set.
        if (dependency_graph) {
            const graph_result = dependency_graph.update_caller(e.document.uri, []);
            if (graph_result.changed_callees.size > 0 && scope_resolver) {
                scope_resolver.cascade_invalidate(graph_result.changed_callees);
            }
        }
        // Restore disk-state edges via re-indexing.
        if (dependency_graph && workspace_indexer) {
            workspace_indexer.schedule_update(
                URI.parse(e.document.uri).fsPath
            );
        }
    });

    // Document change handler
    documents.onDidChangeContent((change) => {
        validate_text_document(change.document);
    });

    // Register all handlers once with the mutable deps container (Req 4.1).
    // Handler closures capture `handler_deps` by reference, so mutating
    // its properties later makes new providers visible without
    // re-registration (Req 4.3, 14.3).

    // Notification handlers (Req 14.1)
    connection.onDidChangeWatchedFiles(
        create_did_change_watched_files_handler(
            handler_deps,
            (uri: string) => URI.parse(uri).fsPath,
            async (uri: string) => {
                // Trigger caller revalidation when a file changes on disk
                if (scope_resolver) {
                    const callers = scope_resolver.get_callers_for_callee(uri);
                    if (callers.size > 0) {
                        const settings = await get_document_settings(uri);
                        schedule_caller_revalidation(callers, uri, settings);
                    }
                }
            }
        )
    );

    // Request handlers — created once, registered once (Req 4.1, 4.2)
    const completion_handler = create_completion_handler(handler_deps);
    const hover_handler = create_hover_handler(handler_deps);
    const definition_handler = create_definition_handler(handler_deps);
    const references_handler = create_references_handler(handler_deps);
    const document_symbol_handler = create_document_symbol_handler(handler_deps);
    const workspace_symbol_handler = create_workspace_symbol_handler(handler_deps);
    const formatting_handler = create_formatting_handler(handler_deps);
    const range_formatting_handler = create_range_formatting_handler(handler_deps);
    const execute_command_handler = create_execute_command_handler(handler_deps);
    const shutdown_handler = create_shutdown_handler(handler_deps, {
        debounce_manager,
        pending_revalidations,
    });
    const working_directory_handler = create_get_working_directory_handler(handler_deps);

    connection.onCompletion(completion_handler);
    connection.onCompletionResolve(create_completion_resolve_handler());
    connection.onHover(hover_handler);
    connection.onDefinition(definition_handler);
    connection.onReferences(references_handler);
    connection.onDocumentSymbol(document_symbol_handler);
    connection.onWorkspaceSymbol(workspace_symbol_handler);
    connection.onDocumentFormatting(formatting_handler);
    connection.onDocumentRangeFormatting(range_formatting_handler);
    connection.onExecuteCommand((params) => {
        return execute_command_handler(params.command, params.arguments || []);
    });
    connection.onShutdown(shutdown_handler);
    connection.onExit(create_exit_handler());

    // Custom request handler (Req 14.2)
    connection.onRequest('sight/getWorkingDirectory', working_directory_handler);

    // Start listening
    documents.listen(connection);
    connection.listen();
}
