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
    create_document_symbol_handler,
    create_workspace_symbol_handler,
    create_formatting_handler,
    create_range_formatting_handler,
    create_shutdown_handler,
    create_exit_handler,
    create_did_change_watched_files_handler,
    create_execute_command_handler,
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
    let symbol_provider: SymbolProvider | null = null;
    let formatter_provider: CodeFormatter | null = null;
    let workspace_indexer: WorkspaceIndexer | null = null;
    let scope_resolver: ScopeResolver | null = null;
    let forward_scope_resolver: ForwardScopeResolver | null = null;
    let rename_handler: RenameHandler | null = null;

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
            result = connection.workspace.getConfiguration({
                scopeUri: resource,
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
     */
    function schedule_callee_revalidation(
        callee_uris: Set<string>,
        trigger_uri: string,
        config: StataLSPConfig
    ): void {
        const max_revalidations = config.cross_file?.max_callee_revalidations ?? 10;

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
                connection.console.log(
                    `Callee revalidation limit reached (${max_revalidations}). ` +
                    `Skipped ${sorted_callees.length - count} callees.`
                );
                break;
            }

            const callee_doc = documents.get(my_callee_uri);
            if (callee_doc) {
                // Clear the published version so diagnostics will be republished
                // even though the callee document's version hasn't changed
                if (diagnostics_provider) {
                    diagnostics_provider.clear_published_version(my_callee_uri);
                }

                setTimeout(() => {
                    if (my_token.cancelled) return;
                    validate_text_document(callee_doc);
                }, 0);
                count++;
            }
        }
    }

    /**
     * Schedule re-validation for caller documents when a callee changes.
     * This ensures that when a file defining symbols changes, all files
     * that call it (via do/run/include) get their diagnostics updated.
     */
    function schedule_caller_revalidation(
        caller_uris: Set<string>,
        trigger_uri: string,
        config: StataLSPConfig
    ): void {
        const max_revalidations = config.cross_file?.max_callee_revalidations ?? 10;

        const sorted_callers = Array.from(caller_uris).sort((a, b) => {
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

        connection.console.log(`[caller-revalidation] Triggered by ${trigger_uri}, callers: ${sorted_callers.length}`);

        let count = 0;
        for (const my_caller_uri of sorted_callers) {
            if (count >= max_revalidations) {
                connection.console.log(
                    `Caller revalidation limit reached (${max_revalidations}). ` +
                    `Skipped ${sorted_callers.length - count} callers.`
                );
                break;
            }

            const caller_doc = documents.get(my_caller_uri);
            connection.console.log(`[caller-revalidation] Checking ${my_caller_uri}: doc=${caller_doc ? 'found' : 'not found'}`);
            if (caller_doc) {
                // Clear the published version so diagnostics will be republished
                // even though the caller document's version hasn't changed
                if (diagnostics_provider) {
                    diagnostics_provider.clear_published_version(my_caller_uri);
                }

                setTimeout(() => {
                    if (my_token.cancelled) return;
                    connection.console.log(`[caller-revalidation] Revalidating ${my_caller_uri}`);
                    validate_text_document(caller_doc);
                }, 0);
                count++;
            }
        }

        connection.console.log(`[caller-revalidation] Scheduled ${count} revalidations`);
    }

    /**
     * Create the HandlerDependencies object with real providers.
     */
    function get_handler_dependencies(): HandlerDependencies {
        return {
            document_store,
            diagnostics_provider,
            completion_provider,
            hover_provider,
            definition_provider,
            symbol_provider,
            formatter_provider,
            workspace_indexer,
            scope_resolver,
            forward_scope_resolver,
            rename_handler,
            get_document_settings,
            connection: {
                sendDiagnostics: (params) => connection.sendDiagnostics(params),
                console: { log: (msg) => connection.console.log(msg) },
            },
        };
    }

    /**
     * Validate a text document and publish diagnostics.
     */
    async function validate_text_document(text_document: TextDocument): Promise<void> {
        last_changed_uri = text_document.uri;
        connection.console.log(`[validate] Starting validation for ${text_document.uri} v${text_document.version}`);

        const existing_token = pending_revalidations.get(text_document.uri);
        if (existing_token) {
            existing_token.cancelled = true;
        }

        if (scope_resolver) {
            connection.console.log(`[validate] Invalidating scope cache for ${text_document.uri}`);
            scope_resolver.invalidate_scope_cache(text_document.uri);
        }

        const update_promise = (async () => {
            const workspace_symbols = workspace_indexer ? workspace_indexer.get_all_symbols() : undefined;

            if (document_store.get(text_document.uri)) {
                await document_store.update(text_document.uri, [{
                    text: text_document.getText(),
                }], text_document.version, workspace_symbols);
            } else {
                await document_store.open(text_document.uri, text_document.getText(), text_document.version, workspace_symbols);
            }

            if (scope_resolver) {
                const document_state = document_store.get(text_document.uri);
                if (document_state?.forward_calls && document_state?.symbols) {
                    // Log forward calls for debugging
                    const static_calls = document_state.forward_calls.filter(c => c.is_static && c.path);
                    connection.console.log(`[reverse-deps] Updating for ${text_document.uri}`);
                    connection.console.log(`[reverse-deps]   forward_calls: ${document_state.forward_calls.length} total, ${static_calls.length} static`);
                    for (const fc of static_calls) {
                        connection.console.log(`[reverse-deps]   - ${fc.type} "${fc.path}" (line ${fc.call_site_line})`);
                    }

                    const { affected_callees, interface_changed } = scope_resolver.update_reverse_dependencies(
                        text_document.uri,
                        document_state.forward_calls,
                        document_state.symbols
                    );

                    connection.console.log(`[reverse-deps] Result: affected_callees=${affected_callees.size}, interface_changed=${interface_changed}`);

                    if (affected_callees.size > 0) {
                        scope_resolver.cascade_invalidate(affected_callees);
                    }

                    if (affected_callees.size > 0 || interface_changed) {
                        const settings = await get_document_settings(text_document.uri);
                        schedule_callee_revalidation(affected_callees, text_document.uri, settings);
                    }

                    // When this file's interface changes, revalidate all callers
                    // (files that call this file via do/run/include)
                    if (interface_changed) {
                        // Invalidate the file cache for this file so callers read fresh content
                        // This is necessary because the file cache may have stale data from before
                        // the in-memory edit was saved to disk. The DidChangeWatchedFiles event
                        // that normally invalidates the file cache may arrive after caller revalidation.
                        scope_resolver.invalidate_file_cache(text_document.uri);

                        // Log the reverse deps state for debugging
                        connection.console.log(`[reverse-deps] Reverse deps state:\n${scope_resolver.get_reverse_deps_debug_info()}`);

                        // Revalidate files that call this file via forward calls (do/run/include commands)
                        const caller_uris = scope_resolver.get_callers_for_callee(text_document.uri);
                        connection.console.log(`[reverse-deps] Interface changed, forward-call callers for ${text_document.uri}: ${Array.from(caller_uris).join(', ') || '(none)'}`);
                        if (caller_uris.size > 0) {
                            const settings = await get_document_settings(text_document.uri);
                            schedule_caller_revalidation(caller_uris, text_document.uri, settings);
                        }

                        // Revalidate files that depend on this file via backward directives (@lsp-done-by/@lsp-included-by)
                        // These are files that inherit symbols FROM this file
                        const backward_children = scope_resolver.get_backward_directive_children(text_document.uri);
                        connection.console.log(`[reverse-deps] Interface changed, backward-directive children for ${text_document.uri}: ${Array.from(backward_children).join(', ') || '(none)'}`);
                        if (backward_children.size > 0) {
                            const settings = await get_document_settings(text_document.uri);
                            schedule_caller_revalidation(backward_children, text_document.uri, settings);
                        }
                    }
                }
            }
        })();

        debounce_manager.schedule_validation(
            text_document.uri,
            text_document.version,
            async () => {
                await update_promise;

                const settings = await get_document_settings(text_document.uri);
                const document_state = document_store.get(text_document.uri);

                if (!document_state) {
                    connection.sendDiagnostics({ uri: text_document.uri, diagnostics: [] });
                    return;
                }

                if (diagnostics_provider) {
                    const workspace_symbols = workspace_indexer ? workspace_indexer.get_all_symbols() : undefined;

                    let forward_scope = undefined;
                    // Skip forward_scope computation when scope_resolver is available - ScopeResolver.resolve() already calls ForwardScopeResolver internally
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
                        workspace_symbols,
                        scope_resolver || undefined,
                        undefined,
                        forward_scope
                    );

                    if (result.pending) {
                        connection.console.log(`Diagnostics pending for ${text_document.uri}`);
                    }
                } else {
                    if (!settings.diagnostics.enabled) {
                        connection.sendDiagnostics({ uri: text_document.uri, diagnostics: [] });
                        return;
                    }
                    connection.sendDiagnostics({
                        uri: text_document.uri,
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
            symbol_provider = new SymbolProvider();
            formatter_provider = new CodeFormatter();
            workspace_indexer = new WorkspaceIndexer();
            scope_resolver = new ScopeResolver({
                log: (msg) => connection.console.log(msg),
                warn: (msg) => connection.console.warn(msg),
            }, {
                read_file: async (uri: string) => {
                    const doc = document_store.get(uri);
                    if (doc) {
                        return doc.content;
                    }
                    const fs_path = URI.parse(uri).fsPath;
                    return fs.promises.readFile(fs_path, 'utf8');
                },
                exists: async (uri: string) => {
                    const doc = document_store.get(uri);
                    if (doc) return true;
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

            // Initialize workspace indexer
            const workspace_folders_promise = connection.workspace.getWorkspaceFolders();
            workspace_folders_promise.then((folders) => {
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
                            workspace_indexer.initialize(folder_paths, settings.adoPaths || []);
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

        documents.all().forEach(validate_text_document);
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
    });

    // Document change handler
    documents.onDidChangeContent((change) => {
        validate_text_document(change.document);
    });

    // Wire all handlers
    connection.onDidChangeWatchedFiles(
        create_did_change_watched_files_handler(
            get_handler_dependencies(),
            (uri: string) => URI.parse(uri).fsPath
        )
    );

    connection.onCompletion((params, token) => {
        const deps = get_handler_dependencies();
        return create_completion_handler(deps)(params, token);
    });

    connection.onCompletionResolve(create_completion_resolve_handler());

    connection.onHover((params, token) => {
        const deps = get_handler_dependencies();
        return create_hover_handler(deps)(params, token);
    });

    connection.onDefinition((params, token) => {
        const deps = get_handler_dependencies();
        return create_definition_handler(deps)(params, token);
    });

    connection.onDocumentSymbol((params) => {
        const deps = get_handler_dependencies();
        return create_document_symbol_handler(deps)(params);
    });

    connection.onWorkspaceSymbol((params) => {
        const deps = get_handler_dependencies();
        return create_workspace_symbol_handler(deps)(params);
    });

    connection.onDocumentFormatting((params) => {
        const deps = get_handler_dependencies();
        return create_formatting_handler(deps)(params);
    });

    connection.onDocumentRangeFormatting((params) => {
        const deps = get_handler_dependencies();
        return create_range_formatting_handler(deps)(params);
    });

    connection.onExecuteCommand((params) => {
        const deps = get_handler_dependencies();
        return create_execute_command_handler(deps)(params.command, params.arguments || []);
    });

    connection.onShutdown(() => {
        const deps = get_handler_dependencies();
        return create_shutdown_handler(deps)();
    });

    connection.onExit(create_exit_handler());

    // Start listening
    documents.listen(connection);
    connection.listen();
}
