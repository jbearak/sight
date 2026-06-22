/**
 * Server factory for creating LSP server instances with different transports.
 * Supports stdio (for standalone/CLI usage) and Node IPC (for VS Code).
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
    Connection,
    WatchKind,
    type Disposable,
    type FileSystemWatcher,
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
import type { DeepPartial } from './config-file';
import {
    deep_merge_config,
    discover_and_load_project_config,
    map_public_config_to_partial_config,
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
    type LoadedProjectConfig,
} from './config-file';
import { WorkspaceIndexer } from './indexer';
import { ScopeResolver, scope_resolver_config_for } from './scope-resolver';
import { ForwardScopeResolver } from './forward-scope-resolver';
import { DocumentDebounceManager } from './utils/debounce-manager';
import { validate_comment_formatting_config } from './utils/config-validator';
import { RenameHandler } from './utils/file-rename-handler';
import { Logger } from './utils/logger';
import { DependencyGraph } from './dependency-graph';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import { discover_stata_ado_paths } from './utils/stata-install-paths';

// Import cache directly so it gets bundled into the binary
import embedded_cache_raw from './command-database/caches/v18.json' with { type: 'json' };
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
    create_resolve_sthlp_file_handler,
    create_resolve_findalias_handler,
    create_expand_includes_handler,
    create_shared_ihlp_resolver,
    ResolveSthlpFileHandler,
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

export interface NonCapabilitySettingsSources {
    init_options_config?: unknown;
    last_client_settings?: unknown;
    project_file_config?: DeepPartial<StataLSPConfig>;
    log_warning?: (message: string) => void;
}

function map_public_settings(
    raw: unknown,
    log_warning?: (message: string) => void
): DeepPartial<StataLSPConfig> {
    return map_public_config_to_partial_config(raw, (warning) => {
        log_warning?.(warning.message);
    });
}

export function select_pushed_client_settings(settings: unknown): unknown {
    const change_settings = settings && typeof settings === 'object'
        ? settings as Record<string, unknown>
        : undefined;
    return change_settings?.['sight'] ?? settings;
}

export function build_non_capability_settings_from_sources(
    sources: NonCapabilitySettingsSources
): StataLSPConfig {
    const init_options_config = sources.init_options_config;
    const init_record = (init_options_config
        && typeof init_options_config === 'object'
        ? (init_options_config as Record<string, unknown>)
        : undefined);
    const init_partial = map_public_settings(
        init_record?.['sight'] ?? init_options_config,
        sources.log_warning
    );
    const client_partial = deep_merge_config(
        init_partial,
        map_public_settings(
            sources.last_client_settings,
            sources.log_warning
        )
    );
    const merged_partial = deep_merge_config(
        client_partial,
        sources.project_file_config || {}
    );
    return validate_comment_formatting_config(
        merged_partial,
        sources.log_warning
    );
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
    let resolve_sthlp_handler: ResolveSthlpFileHandler | null = null;

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
        has_watched_files_dynamic_registration_capability: false,
        has_diagnostic_related_information_capability: false,
    };

    // Configuration settings
    let global_settings: StataLSPConfig = DEFAULT_SETTINGS;
    const document_settings: Map<string, Thenable<StataLSPConfig>> = new Map();

    // Shared project config loaded from sight.toml.
    let project_file_config: DeepPartial<StataLSPConfig> | undefined = undefined;
    let project_config_candidate_dirs: string[] = [];
    let active_workspace_roots: string[] = [];
    let project_config_watch_registration: Disposable | undefined = undefined;

    // Initialization options config
    let init_options_config: unknown = undefined;

    // Most recent client-pushed `sight` settings from didChangeConfiguration,
    // for clients without `workspace/configuration` capability. Retained so the
    // merged global_settings can be rebuilt when project config or folders
    // change without waiting for another didChangeConfiguration notification.
    let last_client_settings: unknown = undefined;

    // Root URI from initialize params (fallback for clients without
    // workspaceFolders support, e.g., Claude Code, Neovim single-file)
    let init_root_uri: string | null = null;

    const log_config_warning = (message: string): void => {
        connection.console.log(`Configuration warning: ${message}`);
    };

    function log_project_config_warnings(loaded: LoadedProjectConfig): void {
        for (const my_warning of loaded.warnings) {
            connection.console.log(
                `Project config warning: ${my_warning.message}`
            );
        }
        if (loaded.kind === 'load-failed') {
            connection.console.log(`Project config warning: ${loaded.error}`);
        }
    }

    function apply_loaded_project_config(loaded: LoadedProjectConfig): void {
        log_project_config_warnings(loaded);
        if (loaded.kind === 'none') {
            // Config genuinely absent: drop any prior project layer. (When no
            // config exists, candidate_dirs spans every ancestor up to
            // MAX_DISCOVERY_DEPTH (~32); watching all of them would flood the
            // client with ~64 watchers, so watch only the workspace roots,
            // added in project_config_watch_dirs — a config later created at
            // the root is still detected.)
            project_config_candidate_dirs = [];
            project_file_config = undefined;
        } else if (loaded.kind === 'load-failed') {
            // Transient parse error (e.g. a mid-edit save). Keep the last-
            // known-good config rather than reverting the whole workspace to
            // defaults; still watch the discovery walk so the fix triggers a
            // reload. project_file_config is intentionally left unchanged.
            project_config_candidate_dirs = loaded.candidate_dirs;
        } else {
            // Config found: watch the bounded discovery walk (workspace root up
            // to the config directory) so a *nearer* sight.toml created in an
            // intermediate directory fires an event and correctly wins, instead
            // of the server staying on the stale ancestor config until restart.
            project_config_candidate_dirs = loaded.candidate_dirs;
            project_file_config = loaded.partial_config;
        }
    }

    function project_config_watch_dirs(): string[] {
        const dirs = new Set<string>();
        for (const my_root of active_workspace_roots) {
            dirs.add(my_root);
        }
        for (const my_dir of project_config_candidate_dirs) {
            dirs.add(my_dir);
        }
        return [...dirs];
    }

    function project_config_watchers_for_dirs(
        dirs: string[]
    ): FileSystemWatcher[] {
        const watchers: FileSystemWatcher[] = [];
        for (const my_dir of dirs) {
            const baseUri = URI.file(my_dir).toString();
            for (const my_pattern of [PROJECT_CONFIG_FILE, STALE_JSON_CONFIG_FILE]) {
                watchers.push({
                    globPattern: { baseUri, pattern: my_pattern },
                    kind: WatchKind.Create | WatchKind.Change
                        | WatchKind.Delete,
                });
            }
        }
        return watchers;
    }

    async function refresh_project_config_watchers(): Promise<void> {
        if (!server_capabilities
            .has_watched_files_dynamic_registration_capability) {
            return;
        }
        const previous_registration = project_config_watch_registration;
        const watchers = project_config_watchers_for_dirs(
            project_config_watch_dirs()
        );
        // Register the new watcher BEFORE disposing the old one so there is no
        // window during which a config change goes unobserved. A brief overlap
        // is harmless: duplicate events are coalesced by the reload serializer.
        if (watchers.length === 0) {
            project_config_watch_registration = undefined;
        } else {
            project_config_watch_registration = await connection.client.register(
                DidChangeWatchedFilesNotification.type,
                { watchers }
            );
        }
        previous_registration?.dispose();
    }

    // Build merged settings for clients WITHOUT `workspace/configuration`
    // capability. They cannot be queried per-document, so we fold the static
    // inputs ourselves: mapped initializationOptions, then the latest pushed
    // client settings, then project (sight.toml) config (which wins). Without
    // this, init options and sight.toml are silently ignored until (and unless)
    // the client happens to send a didChangeConfiguration notification.
    function build_non_capability_settings(): StataLSPConfig {
        return build_non_capability_settings_from_sources({
            init_options_config,
            last_client_settings,
            project_file_config,
            log_warning: log_config_warning,
        });
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
                // The getConfiguration result is the live, per-scope `sight`
                // tree in the public camelCase schema. Route it through the
                // shared merge/validate pipeline as the client layer so this
                // path and the global build_non_capability_settings stay in
                // lockstep (precedence: init -> client -> project_file).
                //
                // select_pushed_client_settings is a defensive unwrap: a
                // spec-conformant client answers a `section: 'sight'` query
                // with the bare subtree (no `sight` wrapper), so it is a
                // no-op there; for a client that still wraps the response as
                // `{ sight: {...} }` it recovers the real tree. No `sight.*`
                // config key exists, so the unwrap can never strip a real
                // setting.
                return build_non_capability_settings_from_sources({
                    init_options_config,
                    last_client_settings:
                        select_pushed_client_settings(config),
                    project_file_config,
                    log_warning: log_config_warning,
                });
            }).catch((error) => {
                // A transient getConfiguration rejection (or a throw while
                // mapping the result) must not be cached as a poisoned
                // promise. Drop only OUR entry (identity guard) so a config
                // change that already replaced it via document_settings.clear()
                // is not clobbered; the next request then retries. Fall back
                // to the init + project merge (the live per-scope layer is
                // what just failed) so sight.toml / initializationOptions
                // still apply, rather than bare global_settings, which stays
                // at DEFAULT_SETTINGS for configuration-capable clients.
                log_config_warning(
                    `Failed to resolve settings for ${resource}: ${error}`
                );
                if (document_settings.get(resource) === result) {
                    document_settings.delete(resource);
                }
                return build_non_capability_settings();
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
    /**
     * Cascade-invalidate scope caches and revalidate open callee documents.
     * Used by both the indexer graph-change callback and the onDidClose handler.
     */
    function invalidate_and_revalidate_callees(
        changed_callees: Set<string>
    ): void {
        // Files added/removed from the workspace may satisfy or
        // invalidate previously-cached sthlp resolutions; drop the
        // negative cache so unresolvable topics are re-probed.
        resolve_sthlp_handler?.clear_negative_cache();
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
    }

    /**
     * Clear published diagnostics and re-trigger validation for all
     * currently open documents. Called after workspace state changes.
     */
    function revalidate_all_open_docs(): void {
        for (const my_doc of documents.all()) {
            if (diagnostics_provider) {
                diagnostics_provider.clear_published_version(my_doc.uri);
            }
            void validate_text_document(my_doc, 0);
        }
    }

    function configure_completion_provider(settings: StataLSPConfig): void {
        completion_provider?.configure_completion(settings.completion);
    }

    function reset_workspace_indexing_state(): void {
        workspace_indexer?.reset();
        dependency_graph?.reset();
        scope_resolver?.clear_cache();
        scope_resolver?.reset_reverse_deps();
    }

    function configure_workspace_indexing(
        settings: StataLSPConfig,
        folder_paths: string[],
        reset_indexes: boolean
    ): void {
        if (reset_indexes) {
            reset_workspace_indexing_state();
        }

        configure_completion_provider(settings);

        if (workspace_indexer) {
            workspace_indexer.configure(settings);
            workspace_indexer.set_max_indexed_files(
                settings.cross_file?.max_indexed_files ?? 1000
            );
        }

        const indexing_enabled =
            settings.indexWorkspace !== false &&
            settings.cross_file?.index_workspace !== false;

        if (indexing_enabled && workspace_indexer
            && folder_paths.length > 0) {
            workspace_indexer.initialize(
                folder_paths,
                settings.adoPaths || []
            ).then(() => {
                // Newly indexed files may satisfy previously-unresolvable
                // sthlp topics. Drop the per-handler negative cache so
                // those topics are re-probed.
                resolve_sthlp_handler?.clear_negative_cache();
                if (dependency_graph?.is_scan_complete()) {
                    revalidate_all_open_docs();
                }
            }).catch((err) => {
                connection.console.log(
                    `[indexer] Workspace indexing failed: ${err}`
                );
            });
        } else {
            // No workspace folders open — still discover Stata install
            // paths so the help viewer can resolve built-in topics.
            if (workspace_indexer) {
                workspace_indexer.set_help_search_paths(
                    discover_stata_ado_paths()
                );
            }
            dependency_graph?.mark_scan_complete();
            revalidate_all_open_docs();
        }
    }

    function same_string_set(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        const set_a = new Set(a);
        return b.every((value) => set_a.has(value));
    }

    // The project-config keys that change WHICH files are indexed (and thus
    // require a full index teardown + re-scan). Everything else — severities,
    // formatting, completion, resolution depths, debug — only affects how open
    // documents are validated/resolved, which a revalidation pass handles
    // without re-scanning the workspace. Client/init settings are constant
    // across a config-file reload, so comparing this subset of project_file_config
    // is sufficient to detect an effective indexing change.
    function indexing_affecting_signature(
        config: DeepPartial<StataLSPConfig> | undefined
    ): string {
        return JSON.stringify({
            adoPaths: config?.adoPaths ?? null,
            indexWorkspace: config?.indexWorkspace ?? null,
            index_workspace: config?.cross_file?.index_workspace ?? null,
            max_indexed_files: config?.cross_file?.max_indexed_files ?? null,
            maxFileSizeBytes: config?.indexing?.maxFileSizeBytes ?? null,
        });
    }

    async function reload_project_config_once(): Promise<void> {
        const active_root = active_workspace_roots[0];
        if (!active_root) {
            return;
        }

        const previous_config_json = JSON.stringify(project_file_config ?? null);
        const previous_indexing_signature =
            indexing_affecting_signature(project_file_config);
        const previous_watch_dirs = project_config_watch_dirs();

        apply_loaded_project_config(
            discover_and_load_project_config(active_root)
        );

        const config_changed =
            JSON.stringify(project_file_config ?? null) !== previous_config_json;
        if (!same_string_set(previous_watch_dirs, project_config_watch_dirs())) {
            await refresh_project_config_watchers();
        }
        if (!config_changed) {
            // A watched event fired (e.g. an edit to an unsupported .sight.json,
            // or a no-op save) but the effective project config is unchanged,
            // so skip the expensive full workspace reset and re-index.
            return;
        }

        const indexing_changed =
            indexing_affecting_signature(project_file_config) !==
            previous_indexing_signature;

        document_settings.clear();

        if (!server_capabilities.has_configuration_capability) {
            global_settings = build_non_capability_settings();
        }
        const settings = await get_document_settings('');

        if (indexing_changed) {
            configure_workspace_indexing(settings, active_workspace_roots, true);
        } else {
            // Only non-indexing config changed (severities, formatting,
            // resolution depths, ...): keep the workspace index intact and just
            // reconfigure providers and re-validate open documents so the new
            // settings take effect, instead of tearing down and re-scanning the
            // whole workspace for a cosmetic edit.
            configure_completion_provider(settings);
            workspace_indexer?.configure(settings);
            revalidate_all_open_docs();
        }
    }

    // Serialize reloads: a DidChangeWatchedFiles batch can deliver several
    // config events at once (e.g. delete+create on save), and each would
    // otherwise spawn a concurrent reload that disposes/re-registers watchers
    // and re-indexes while another is mid-flight. Run one at a time and
    // coalesce any overlapping requests into a single trailing run.
    let project_config_reload_in_progress = false;
    let project_config_reload_pending = false;

    async function reload_project_config_from_active_root(): Promise<void> {
        if (project_config_reload_in_progress) {
            project_config_reload_pending = true;
            return;
        }
        project_config_reload_in_progress = true;
        try {
            do {
                project_config_reload_pending = false;
                await reload_project_config_once();
            } while (project_config_reload_pending);
        } finally {
            project_config_reload_in_progress = false;
        }
    }

    /**
     * Refresh all workspace-wide state after folder changes.
     * Tears down stale caches, re-roots resolvers, re-reads config,
     * and re-triggers the workspace scan and document revalidation.
     *
     * Called from both onInitialized and onDidChangeWorkspaceFolders.
     */
    async function refresh_workspace_state(
        folder_paths: string[]
    ): Promise<void> {
        // --- Teardown stale state ---
        reset_workspace_indexing_state();
        document_settings.clear();

        // --- Update workspace roots ---
        if (folder_paths.length > 0) {
            active_workspace_roots = [...folder_paths];
            document_store.set_workspace_roots(folder_paths);
            if (scope_resolver) {
                scope_resolver.set_workspace_roots(folder_paths);
            }
            if (forward_scope_resolver) {
                forward_scope_resolver.set_workspace_roots(folder_paths);
            }

            // Single-root project config: sight.toml is discovered from the
            // first workspace folder and applied to every document. Multi-root
            // workspaces with a distinct sight.toml per root are not resolved
            // per-root; warn once so the behavior is not silently surprising.
            if (folder_paths.length > 1) {
                connection.console.log(
                    'Sight: multiple workspace folders detected; project ' +
                    `config is loaded only from the first folder ` +
                    `(${folder_paths[0]}). A sight.toml in another folder is ` +
                    'not applied to its own documents.'
                );
            }
            apply_loaded_project_config(
                discover_and_load_project_config(folder_paths[0])
            );
        } else {
            active_workspace_roots = [];
            document_store.set_workspace_roots([]);
            project_file_config = undefined;
            project_config_candidate_dirs = [];
            if (scope_resolver) {
                scope_resolver.set_workspace_roots([]);
            }
            if (forward_scope_resolver) {
                forward_scope_resolver.set_workspace_roots([]);
            }
        }

        await refresh_project_config_watchers();

        // --- Load settings and configure indexer ---
        // Non-capability clients can't be queried per-document, so build their
        // merged global_settings from init options + project config here rather
        // than reading back the (stale) cached value via get_document_settings.
        if (!server_capabilities.has_configuration_capability) {
            global_settings = build_non_capability_settings();
        }
        const settings = await get_document_settings('');

        // --- Scan workspace or mark complete ---
        configure_workspace_indexing(settings, folder_paths, false);
    }

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
                const my_scope_resolver_config =
                    scope_resolver_config_for(settings);

                // --- Lex/parse/analyze inside debounce callback (Req 2.1, 2.2) ---
                const workspace_symbols = workspace_indexer
                    ? workspace_indexer.get_all_symbols()
                    : undefined;

                if (document_store.get(snapshot_uri)) {
                    await document_store.update(
                        snapshot_uri,
                        [{ text: snapshot_content }],
                        snapshot_version,
                        workspace_symbols,
                        my_scope_resolver_config
                    );
                } else {
                    await document_store.open(
                        snapshot_uri,
                        snapshot_content,
                        snapshot_version,
                        workspace_symbols,
                        my_scope_resolver_config
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
                                // Only schedule revalidation for callees not already covered
                                // by affected_callees (which will be scheduled below)
                                const graph_only_callees = new Set(
                                    [...graph_result.changed_callees].filter(
                                        uri => !affected_callees.has(uri)
                                    )
                                );
                                if (graph_only_callees.size > 0) {
                                    schedule_callee_revalidation(graph_only_callees, snapshot_uri, settings, revalidation_depth);
                                }
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

                    const result = await diagnostics_provider.publish_diagnostics(
                        document_state,
                        settings,
                        diag_workspace_symbols,
                        scope_resolver || undefined,
                        undefined
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
            (options: unknown) => {
                init_options_config = options;
            },
            (root_uri: string | null) => {
                init_root_uri = root_uri;
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

            references_provider = new ReferencesProvider(scope_resolver);

            document_store.set_scope_resolver(scope_resolver);

            // Mirror backward directive edits from open buffers into the
            // indexer so `get_related_uris` reflects unsaved edits (e.g.,
            // a just-added `@lsp-done-by`) without waiting for reindex.
            const the_indexer_for_overlay = workspace_indexer;
            document_store.set_on_backward_directives_parsed((uri, directives) => {
                the_indexer_for_overlay.set_buffer_directives(uri, directives);
            });

            // Create and wire dependency graph for auto backward dependencies
            dependency_graph = new DependencyGraph();
            workspace_indexer.set_dependency_graph(dependency_graph);
            workspace_indexer.set_on_graph_change(invalidate_and_revalidate_callees);
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

            // Initialize workspace state.
            // Prefer workspaceFolders (LSP 3.6+), fall back to rootUri/
            // rootPath from the initialize params for clients that don't
            // support the workspaceFolders capability (e.g., Claude Code,
            // Neovim single-file mode, Helix).
            connection.workspace.getWorkspaceFolders().then(
                async (folders) => {
                    let folder_paths = (folders ?? [])
                        .map((my_folder) =>
                            URI.parse(my_folder.uri).fsPath
                        )
                        .filter(
                            (my_path): my_path is string =>
                                my_path !== undefined
                        );

                    // Fall back to rootUri/rootPath when workspaceFolders
                    // is empty (common with minimal CLI-based LSP clients)
                    if (folder_paths.length === 0 && init_root_uri) {
                        const root_path = init_root_uri.startsWith('file://')
                            ? URI.parse(init_root_uri).fsPath
                            : init_root_uri;
                        if (root_path) {
                            folder_paths = [root_path];
                            connection.console.log(
                                `[workspace] No workspaceFolders from`
                                + ` client; using rootUri fallback:`
                                + ` ${root_path}`
                            );
                        }
                    }

                    try {
                        await refresh_workspace_state(folder_paths);
                    } catch (err) {
                        connection.console.log(
                            `[workspace] Failed to initialize` +
                            ` workspace state: ${err}`
                        );
                    }
                }
            );

            if (server_capabilities.has_configuration_capability) {
                connection.client.register(DidChangeConfigurationNotification.type, undefined);
            }
            if (server_capabilities.has_workspace_folder_capability) {
                connection.workspace.onDidChangeWorkspaceFolders(
                    async (_event) => {
                        connection.console.log(
                            'Workspace folder change event received.'
                        );
                        const folders = await connection.workspace
                            .getWorkspaceFolders();
                        const folder_paths = (folders ?? [])
                            .map((my_folder) =>
                                URI.parse(my_folder.uri).fsPath
                            )
                            .filter(
                                (my_path): my_path is string =>
                                    my_path !== undefined
                            );
                        try {
                            await refresh_workspace_state(folder_paths);
                        } catch (err) {
                            connection.console.log(
                                `[workspace] Failed to refresh` +
                                ` workspace state: ${err}`
                            );
                        }
                    }
                );
            }
        })
    );

    // Configuration change handler
    connection.onDidChangeConfiguration((change) => {
        if (server_capabilities.has_configuration_capability) {
            document_settings.clear();
            void get_document_settings('').then((settings) => {
                configure_completion_provider(settings);
            }).catch((err) => {
                connection.console.error(
                    `Error refreshing completion config: ${err}`
                );
            });
        } else {
            last_client_settings = select_pushed_client_settings(
                change.settings
            );
            global_settings = build_non_capability_settings();
            configure_completion_provider(global_settings);
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
        workspace_indexer?.clear_buffer_directives(e.document.uri);
        if (diagnostics_provider) {
            diagnostics_provider.on_document_closed(e.document.uri);
        }
        if (scope_resolver) {
            scope_resolver.remove_caller_from_reverse_deps(e.document.uri);
        }
        // On close, the buffer's in-memory edges/symbols are discarded, so
        // callees that inherited from this file must re-resolve against its
        // on-disk content. Revalidate the current callees with this file's
        // parent edge still INTACT, then re-index from disk to correct any
        // edges that existed only in the unsaved buffer.
        //
        // We deliberately do NOT clear this file's edges to empty first.
        // Doing so makes callees momentarily resolve against an empty parent
        // set and publish a false "undefined symbol" warning that the
        // subsequent re-index immediately clears — the user perceives this
        // as a red-squiggle flicker. The captured callee set is identical to
        // what `update_caller(uri, [])` would report as changed (every
        // callee), so revalidation coverage is unchanged; only the spurious
        // empty-edge window is removed.
        if (dependency_graph) {
            const affected_callees = new Set(
                dependency_graph.get_callees(e.document.uri)
            );
            if (affected_callees.size > 0) {
                invalidate_and_revalidate_callees(affected_callees);
            }
        }
        // Restore disk-state edges via re-indexing (corrects edges that were
        // only present in the unsaved buffer; fires its own callee
        // revalidation via on_graph_change if the edge set actually changed).
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
            },
            async () => {
                await reload_project_config_from_active_root();
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

    // Custom request handlers
    connection.onRequest('sight/getWorkingDirectory', working_directory_handler);

    const shared_ihlp = create_shared_ihlp_resolver(handler_deps);

    resolve_sthlp_handler = create_resolve_sthlp_file_handler(
        handler_deps, shared_ihlp
    );
    connection.onRequest('sight/resolveSthlpFile', resolve_sthlp_handler);

    const resolve_findalias_handler = create_resolve_findalias_handler(handler_deps);
    connection.onRequest('sight/resolveFindalias', resolve_findalias_handler);

    const expand_includes_handler = create_expand_includes_handler(
        handler_deps, shared_ihlp
    );
    connection.onRequest('sight/expandIncludes', expand_includes_handler);

    // Start listening
    documents.listen(connection);
    connection.listen();
}
