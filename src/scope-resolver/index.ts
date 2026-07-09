/**
 * Scope Resolver for Cross-File Awareness
 *
 * Builds complete symbol scope by following directive chains recursively.
 */

import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { CancellationToken } from 'vscode-languageserver';
import {
    Directive,
    DirectiveDiagnostic,
    SymbolTable,
    ScopeChainEntry,
    ResolvedScope,
    ResolveOptions,
    ScopeResolverConfig,
    OutOfScopeSymbol,
    ScopeCacheEntry,
    ScopeCacheMetrics,
    ScopeCacheSizes,
    ScopeResolverLogger,
    ForwardCall,
    CdCommand,
    EffectiveCallType,
    ForwardResolvedScope,
    CallEdge,
    InterfaceHash,
    DualInterfaceHash,
    ReverseDependencyIndex,
    CallEdgeDiff,
    ContentProvider,
    WorkingDirectoryDirective,
    StataLSPConfig,
    StataDiagnosticCode,
    CrossFileCaseMismatchSeverity,
} from '../types';
import { Range } from 'vscode-languageserver-textdocument';
import { DirectiveParser } from '../directive-parser';
import { StataLexer } from '../lexer';
import { StataParser } from '../parser';
import { SemanticAnalyzer, create_empty_symbol_table, merge_symbol_tables } from '../analyzer';
import { logger } from '../utils/logger';
import { error_message } from '../utils/error-message';
import { BoundedLruMap } from '../utils/lru-cache';
import { filter_dofile_locals, is_dofile_local } from '../utils/dofile-locals';
import { get_line_text, get_line_count, compute_line_offsets } from '../utils/line-utils';
import {
    get_workspace_root_for_uri,
    get_workspace_root_for_path,
} from '../utils/workspace-roots';
import {
    resolve_path_rich,
    resolve_forward_call_rich,
    outcome_fs_path,
    is_resolvable_static_call,
    build_cd_timeline,
    apply_cd_timeline,
    type RichResolveFs,
} from '../utils/file-path-utils';
import {
    block_comment_ranges,
    position_in_block_comment,
} from '../utils/block-comment-utils';

export {
    get_visible_symbols_at,
    get_visible_forward_call_sites,
    collect_visible_reference_uris,
    filter_forward_site_symbols,
    clone_symbol_table,
} from './visible-symbols';
export type { ReferenceScanRange } from './visible-symbols';
import { clone_symbol_table } from './visible-symbols';

const DEFAULT_CONFIG: ScopeResolverConfig = {
    assume_call_site: 'end',
    max_backward_depth: 10,
    max_forward_depth: 10,
    max_chain_depth: 20,
};

// Default LRU capacities for the long-lived caches (#294). Memory-safety
// backstops far above realistic workspace sizes — NOT working-set tuners.
// Kept in sync with DEFAULT_SETTINGS.cross_file in server-handlers.ts.
export const DEFAULT_MAX_CACHED_FILES = 2000;
export const DEFAULT_MAX_CACHED_SCOPES = 1000;

/**
 * Build a Partial<ScopeResolverConfig> with undefined values filtered out.
 * This prevents undefined values from overriding defaults when spread-merged
 * in ScopeResolver.resolve().
 */
export function build_scope_resolver_config(
    config?: Partial<ScopeResolverConfig>
): Partial<ScopeResolverConfig> {
    if (!config) return {};
    const result: Partial<ScopeResolverConfig> = {};
    for (const [my_key, my_value] of Object.entries(config)) {
        if (my_key === 'diagnostics' && my_value != null
            && typeof my_value === 'object') {
            const my_filtered_diagnostics = Object.fromEntries(
                Object.entries(
                    my_value as NonNullable<ScopeResolverConfig['diagnostics']>
                ).filter(([, v]) => v !== undefined)
            );
            if (Object.keys(my_filtered_diagnostics).length > 0) {
                result.diagnostics =
                    my_filtered_diagnostics as ScopeResolverConfig['diagnostics'];
            }
        } else if (my_value !== undefined) {
            (result as Record<string, unknown>)[my_key] = my_value;
        }
    }
    return result;
}

export function scope_resolver_config_for(
    config: Partial<StataLSPConfig>
): Partial<ScopeResolverConfig> {
    return build_scope_resolver_config({
        assume_call_site: config.cross_file?.assume_call_site,
        backward_dependencies: config.cross_file?.backward_dependencies,
        max_backward_depth: config.cross_file?.max_backward_depth,
        max_forward_depth: config.cross_file?.max_forward_depth,
        max_chain_depth: config.cross_file?.max_chain_depth,
        diagnostics: {
            max_depth: config.cross_file?.diagnostics?.max_depth,
            call_site_identification:
                config.cross_file?.diagnostics?.call_site_identification,
            case_mismatch:
                config.cross_file?.diagnostics?.case_mismatch,
        },
    });
}

/**
 * Cache for file parsing results within a single resolution request.
 * Ensures we only read/parse each file once per request.
 */
type ParsedFileResult = {
    content: string;
    content_hash: string;
    symbols: SymbolTable;
    directives: Directive[];
    forward_calls: ForwardCall[];
    cd_commands: CdCommand[];
    working_directory?: string;
    working_directory_directive?: WorkingDirectoryDirective;
    is_standalone: boolean;
    diagnostics: DirectiveDiagnostic[];
} | { error: string };
type RequestCache = Map<string, Promise<ParsedFileResult>>;

/**
 * Value shape of ScopeResolver.file_cache. Kept as a named type so
 * cache_entry_to_parsed_result can single-source the entry→result copy
 * (a hand-copied literal once silently dropped a field on one cache-hit
 * path only — see the working_directory_directive note from PR #278).
 */
type FileCacheEntry = {
    /**
     * The entry's own URI (#294). Cache keys are "uri|working_directory",
     * so the eviction hook stores the URI here instead of parsing it back
     * out of the key.
     */
    uri: string;
    content: string;
    content_hash: string;
    mtimeMs?: number;
    size?: number;
    symbols: SymbolTable;
    directives: Directive[];
    forward_calls: ForwardCall[];
    cd_commands: CdCommand[];
    working_directory?: string;
    working_directory_directive?: WorkingDirectoryDirective;
    is_standalone: boolean;
    diagnostics: DirectiveDiagnostic[];
    registered_backward_mode?: 'auto' | 'explicit';
};

/**
 * Interface for ForwardScopeResolver to avoid circular imports.
 * The actual ForwardScopeResolver is injected via set_forward_scope_resolver().
 */
interface ForwardScopeResolverInterface {
    filter_calls_before_line(forward_calls: ForwardCall[], line: number): ForwardCall[];
    resolve(
        file_uri: string,
        forward_calls: ForwardCall[],
        effective_call_type: EffectiveCallType,
        context?: {
            visited: Map<string, EffectiveCallType>;
            effective_call_type: EffectiveCallType;
            depth: number;
            diagnostics: DirectiveDiagnostic[];
            working_directory?: string;
            /** Top-level cd commands of the file being resolved (issue #252). */
            cd_commands?: CdCommand[];
            call_chain?: string[];
            /** See ForwardResolveContext.diagnostic_owner_uri. */
            diagnostic_owner_uri?: string;
        },
        recursion_stack?: Set<string>,
        token?: import('vscode-languageserver').CancellationToken,
        config?: {
            max_forward_depth?: number;
            /** See ForwardScopeConfig.backward_dependencies (issue #286). */
            backward_dependencies?: 'auto' | 'explicit';
            diagnostics?: {
                max_depth?: 'error' | 'warning' | 'information' | 'off';
            };
        }
    ): Promise<ForwardResolvedScope>;
    /**
     * Evict forward-closure memo entries depending on `uri` (#234).
     * Optional so lightweight test doubles need not implement it.
     */
    invalidate_forward_closure_for_uri?(uri: string): number;
    /** Drop the whole forward-closure memo (#234). Optional as above. */
    clear_forward_closure_memo?(): void;
}

export class ScopeResolver {
    private directive_parser: DirectiveParser;
    private lexer: StataLexer;
    private parser: StataParser;
    private analyzer: SemanticAnalyzer;
    // Cache key is "uri|working_directory" (or just "uri" if no working directory)
    // registered_backward_mode: the backward_dependencies mode the entry's
    // last parse-path registration ran under (issue #286). Undefined for
    // entries written by parse_file (root-file parses, which register via
    // resolve()/commit instead). Lets cache HITS upgrade an
    // 'explicit'-registered entry to effective registration when first read
    // by an 'auto'-mode resolution. Directive-less auto-mode hits re-sync
    // idempotently because registration is global per URI, not per
    // file_cache entry — see upgrade_registration_on_cache_hit.
    private file_cache: BoundedLruMap<string, FileCacheEntry>;
    private scope_cache: BoundedLruMap<string, ScopeCacheEntry>;
    // Secondary index: uri -> Set<cache_keys> for O(1) scope cache invalidation by URI
    private uri_to_cache_keys: Map<string, Set<string>>;
    private cache_metrics: ScopeCacheMetrics;
    private logger?: ScopeResolverLogger;
    private forward_scope_resolver?: ForwardScopeResolverInterface;
    private reverse_deps: ReverseDependencyIndex;
    // Track backward directive dependencies: parent_uri → set of child_uris that depend on it via @lsp-done-by/@lsp-included-by
    private backward_directive_children: Map<string, Set<string>>;
    private content_provider: ContentProvider;
    private workspace_roots: string[] = [];
    private dependency_graph?: import('../dependency-graph').DependencyGraph;
    // Injected filesystem for resolve_path_rich (for tests only).
    // When undefined, resolve_path_rich uses the real Node fs.
    private resolve_fs?: RichResolveFs;

    constructor(
        logger?: ScopeResolverLogger,
        content_provider?: ContentProvider,
        cache_capacities?: {
            max_cached_files?: number;
            max_cached_scopes?: number;
        }
    ) {
        this.directive_parser = new DirectiveParser();
        this.lexer = new StataLexer();
        this.parser = new StataParser();
        this.analyzer = new SemanticAnalyzer();
        // Bounded caches (#294). Capacity eviction is correctness-neutral
        // (a miss recomputes from disk/buffer), with one obligation each:
        // - file_cache: the evicted URI's forward-closure memo entries must
        //   be invalidated NOW, because the stale-content purges in
        //   parse_file/_get_parsed_file_impl compare against the old cached
        //   hash — once the entry is gone, that baseline is gone with it,
        //   and a memo entry re-poisoned during a debounce window would
        //   otherwise never be purged. This uses the normal invalidation
        //   (epoch-bumping) semantics: an eviction during an in-flight
        //   standalone build's await window makes that build skip its memo
        //   store and fall back to the live walk (degraded, never wrong).
        // - scope_cache: prune the uri_to_cache_keys secondary index so it
        //   cannot leak keys for evicted entries.
        // Both hooks run synchronously inside set()/set_max_size() and do
        // not re-enter the evicting map.
        this.file_cache = new BoundedLruMap(
            cache_capacities?.max_cached_files ?? DEFAULT_MAX_CACHED_FILES,
            {
                on_evict: (_key, entry) => {
                    this.cache_metrics.file.evictions++;
                    this.forward_scope_resolver
                        ?.invalidate_forward_closure_for_uri?.(entry.uri);
                },
            }
        );
        this.scope_cache = new BoundedLruMap(
            cache_capacities?.max_cached_scopes ?? DEFAULT_MAX_CACHED_SCOPES,
            {
                on_evict: (key) => {
                    this.cache_metrics.scope.evictions++;
                    this.prune_uri_to_cache_keys_for_key(key);
                },
            }
        );
        this.uri_to_cache_keys = new Map();
        this.cache_metrics = this.create_metrics();
        this.logger = logger;
        this.reverse_deps = {
            caller_to_callees: new Map(),
            callee_to_callers: new Map(),
            interface_hashes: new Map(),
            last_forward_calls: new Map(),
        };
        this.backward_directive_children = new Map();

        // Default content provider uses fs
        this.content_provider = content_provider || {
            read_file: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                return fs.promises.readFile(fs_path, 'utf8');
            },
            exists: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                try {
                    await fs.promises.access(fs_path);
                    return true;
                } catch {
                    return false;
                }
            },
            stat: async (uri: string) => {
                const fs_path = URI.parse(uri).fsPath;
                try {
                    const stats = await fs.promises.stat(fs_path);
                    return { mtimeMs: stats.mtimeMs, size: stats.size };
                } catch {
                    return undefined;
                }
            }
        };
    }

    /**
     * Set the workspace roots for resolving workspace-relative working directory paths.
     */
    set_workspace_roots(workspace_roots: string[]): void {
        // Normalize (resolve) roots for consistent containment checks,
        // matching how DependencyGraph and ForwardScopeResolver store them.
        this.workspace_roots = workspace_roots.map(r => path.resolve(r));
    }

    /**
     * Inject a filesystem implementation for `resolve_path_rich`.
     * For testing only — production code leaves this undefined so
     * `resolve_path_rich` uses the real Node `fs`.
     */
    set_resolve_fs(injected_fs: RichResolveFs): void {
        this.resolve_fs = injected_fs;
    }

    /**
     * Set the forward scope resolver for resolving forward calls in parent files.
     * This breaks the circular dependency between ScopeResolver and ForwardScopeResolver.
     */
    set_forward_scope_resolver(resolver: ForwardScopeResolverInterface): void {
        this.forward_scope_resolver = resolver;
    }

    /**
     * Set the dependency graph for auto backward dependency discovery.
     */
    set_dependency_graph(graph: import('../dependency-graph').DependencyGraph): void {
        this.dependency_graph = graph;
    }

    /**
     * Determine the effective backward directives for a file at any recursion
     * level. A `sight: standalone` header marker (issue #208) wins over
     * everything: the file inherits nothing, regardless of mode or explicit
     * directives. Otherwise explicit directives on the file take precedence
     * over auto discovery, matching the root-level opt-out semantics.
     *
     * `is_standalone` is deliberately required (no default): every call site
     * must consciously thread the file's own standalone flag, so a future
     * call site cannot silently ignore it.
     */
    private get_effective_backward_directives(
        file_uri: string,
        parsed_directives: Directive[],
        config: ScopeResolverConfig,
        is_standalone: boolean
    ): {
        directives: Directive[];
        used_auto_parents: boolean;
    } {
        if (is_standalone) {
            return {
                directives: [],
                used_auto_parents: false,
            };
        }
        const backward_mode = config.backward_dependencies ?? 'auto';
        if (backward_mode === 'explicit' || parsed_directives.length > 0) {
            return {
                directives: parsed_directives,
                used_auto_parents: false,
            };
        }

        if (!this.dependency_graph) {
            return {
                directives: [],
                used_auto_parents: false,
            };
        }

        const the_auto_edges = this.dependency_graph.get_parents(file_uri);
        if (the_auto_edges.length === 0) {
            return {
                directives: [],
                used_auto_parents: false,
            };
        }

        const the_synthesized_directives = the_auto_edges.map(
            (my_edge) => ({
                type: (my_edge.call_type === 'include'
                    ? 'included-by'
                    : 'done-by') as 'done-by' | 'included-by',
                path: URI.parse(my_edge.caller_uri).fsPath,
                raw_path: URI.parse(my_edge.caller_uri).fsPath,
                call_site: {
                    type: 'line' as const,
                    value: my_edge.call_site_line + 1,
                },
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
            })
        );

        return {
            directives: the_synthesized_directives,
            used_auto_parents: true,
        };
    }

    /**
     * Create a metrics object with nested counters and backward-compatible getters.
     */
    private create_metrics(): ScopeCacheMetrics {
        const metrics = {
            scope: { hits: 0, misses: 0, invalidations: 0, evictions: 0 },
            file: { hits: 0, misses: 0, invalidations: 0, evictions: 0 },
        };
        return {
            ...metrics,
            get hits() { return metrics.scope.hits; },
            get misses() { return metrics.scope.misses; },
            get invalidations() { return metrics.scope.invalidations; },
        };
    }

    /**
     * Update the LRU capacities of the long-lived caches (#294). Shrinking
     * below the current size evicts LRU-first immediately (through the
     * same on_evict hooks as normal capacity pressure, so secondary
     * indexes and the forward-closure memo stay consistent).
     */
    set_cache_capacities(capacities: {
        max_cached_files?: number;
        max_cached_scopes?: number;
    }): void {
        if (capacities.max_cached_files !== undefined) {
            this.file_cache.set_max_size(capacities.max_cached_files);
        }
        if (capacities.max_cached_scopes !== undefined) {
            this.scope_cache.set_max_size(capacities.max_cached_scopes);
        }
    }

    /**
     * Remove one scope_cache key's reference from the uri_to_cache_keys
     * secondary index (dropping the URI's Set when it empties). The single
     * pruning idiom shared by explicit invalidation scans and the LRU
     * eviction hook (#294) — the scope_cache entry itself must already be
     * (or be about to be) removed by the caller.
     */
    private prune_uri_to_cache_keys_for_key(cache_key: string): void {
        const key_uri = this.extract_uri_from_cache_key(cache_key);
        const key_set = this.uri_to_cache_keys.get(key_uri);
        if (key_set) {
            key_set.delete(cache_key);
            if (key_set.size === 0) {
                this.uri_to_cache_keys.delete(key_uri);
            }
        }
    }

    /**
     * Generate a cache key for file cache that includes the working directory.
     * Format: "uri" or "uri|working_directory"
     */
    private make_file_cache_key(uri: string, working_directory?: string): string {
        return working_directory ? `${uri}|${working_directory}` : uri;
    }

    /**
     * Delete any scope_cache entries that depend on the given URI.
     * Returns the number of removed entries.
     */
    private cascade_invalidate_scope_cache_for_uri(uri: string): number {
        const keys_to_remove: string[] = [];

        for (const [cache_key, entry] of this.scope_cache) {
            if (entry.dependent_uris.has(uri)) {
                keys_to_remove.push(cache_key);
            }
        }

        for (const my_key of keys_to_remove) {
            this.scope_cache.delete(my_key);
            this.prune_uri_to_cache_keys_for_key(my_key);
        }

        return keys_to_remove.length;
    }

    /**
     * Extract URI from cache_key (format is "uri:content_hash:config_hash").
     * URIs like file:///path contain colons, so we find the last two colons.
     */
    private extract_uri_from_cache_key(cache_key: string): string {
        // Find the last colon (before config_hash)
        const last_colon = cache_key.lastIndexOf(':');
        if (last_colon < 0) return cache_key;
        
        // Find the second-to-last colon (before content_hash)
        const second_last_colon = cache_key.lastIndexOf(':', last_colon - 1);
        if (second_last_colon < 0) return cache_key;
        
        return cache_key.substring(0, second_last_colon);
    }

    /**
     * Invalidate all scope cache entries for a specific URI using O(1) lookup.
     * Uses the uri_to_cache_keys secondary index.
     * @param uri - The URI to invalidate scope caches for
     * @returns Number of cache entries removed
     */
    private invalidate_scope_cache_for_uri(uri: string): number {
        const key_set = this.uri_to_cache_keys.get(uri);
        if (!key_set) {
            return 0;
        }
        
        let count = 0;
        for (const my_cache_key of key_set) {
            if (this.scope_cache.delete(my_cache_key)) {
                count++;
            }
        }
        
        this.uri_to_cache_keys.delete(uri);
        return count;
    }

    /**
     * Log a message through the logger interface or Logger singleton.
     */
    private log(message: string): void {
        if (this.logger) {
            this.logger.log(message);
            return;
        }

        // Default: use Logger singleton for production, or console.debug for CLI/tests
        logger.debug(message);
    }

    /**
     * Log a warning through the logger interface or Logger singleton.
     */
    private warn(message: string): void {
        if (this.logger) {
            this.logger.warn(message);
        } else {
            logger.warn(message);
        }
    }

    /**
     * Validate that a line number is within bounds of the parent file.
     * @param line_number - 0-indexed line number
     * @param parent_content - Content of the parent file
     * @returns true if line exists, false otherwise
     */
    private is_line_in_bounds(line_number: number, parent_content: string): boolean {
        const doc = { content: parent_content, line_offsets: compute_line_offsets(parent_content) };
        const total_lines = get_line_count(doc);
        return line_number >= 0 && line_number < total_lines;
    }

    /**
     * Check if a given parent line is a valid call statement (do/run/include
     * command or @lsp-do/run/include forward directive).
     *
     * Delegates to DirectiveParser.classify_call_line so validation matches the
     * directive parser exactly (path required; forward directives need a
     * well-formed line=/match= tail and a non-param-like unquoted path). A line
     * whose leading text is inside a block comment is inert in Stata and is
     * never a call statement.
     *
     * @param parent_content - Full content of the parent file
     * @param line_number - 0-indexed line to check
     * @param block_ranges - Block-comment spans in the parent file
     * @returns The detected call_type, or undefined if no valid call found
     */
    private validate_call_statement(
        parent_content: string,
        line_number: number,
        block_ranges: Range[]
    ): 'do' | 'run' | 'include' | undefined {
        const doc = {
            content: parent_content,
            line_offsets: compute_line_offsets(parent_content),
        };
        const line_content = get_line_text(doc, line_number);
        // classify_call_line is anchored, so it already ignores a call inside a
        // trailing inline comment; the only case it cannot see is a line whose
        // leading text is itself inside a block comment (a continuation line of a
        // multi-line /* ... */). Skip those here.
        const leading_col = line_content.search(/\S/);
        if (leading_col >= 0 &&
            position_in_block_comment(line_number, leading_col, block_ranges)) {
            return undefined;
        }
        return this.directive_parser.classify_call_line(line_content);
    }

    /**
     * Detect if parent file has mixed call types (both do/run AND include) referencing the child.
     * @param parent_content - Content of the parent file
     * @param child_filename - Filename of the child file
     * @returns Object with has_mixed and the call types found
     */
    private detect_mixed_call_types(parent_content: string, child_filename: string): { has_mixed: boolean; types: ('do' | 'run' | 'include')[] } {
        const all_call_sites = this.directive_parser.find_all_call_sites_for_file(parent_content, child_filename);

        if (all_call_sites.length === 0) {
            return { has_mixed: false, types: [] };
        }

        const unique_types = new Set(all_call_sites.map(site => site.call_type));
        const types_array = Array.from(unique_types);

        // Check if we have both do/run AND include
        const has_do_or_run = unique_types.has('do') || unique_types.has('run');
        const has_include = unique_types.has('include');
        const has_mixed = has_do_or_run && has_include;

        return { has_mixed, types: types_array };
    }

    /**
     * Emit diagnostic for @lsp-included-by used with do/run call type.
     * Always emits as warning (not suppressible).
     */
    private maybe_emit_included_by_mismatch(
        directive_type: 'done-by' | 'included-by',
        detected_call_type: 'do' | 'run' | 'include',
        range: Range,
        parent_filename: string,
        source_line: number | undefined,
        diagnostics: DirectiveDiagnostic[]
    ): void {
        if (directive_type === 'included-by' && detected_call_type !== 'include') {
            diagnostics.push({
                message: `Directive sight: included-by used but caller uses ${detected_call_type} (not include). Local macros will not be inherited.`,
                range,
                severity: 'warning',
                source: {
                    source_file: parent_filename,
                    source_line,
                    original_range: range,
                },
            });
        }
    }

    /**
     * Emit diagnostic for @lsp-done-by used with include call type.
     * Uses config.diagnostics.call_site_identification severity (default 'information'), can be 'off'.
     */
    private maybe_emit_done_by_include_info(
        directive_type: 'done-by' | 'included-by',
        detected_call_type: 'do' | 'run' | 'include',
        range: Range,
        parent_filename: string,
        source_line: number | undefined,
        diagnostics: DirectiveDiagnostic[],
        config: ScopeResolverConfig
    ): void {
        if (directive_type === 'done-by' && detected_call_type === 'include') {
            const call_site_severity = config.diagnostics?.call_site_identification ?? 'information';
            if (call_site_severity !== 'off') {
                diagnostics.push({
                    message: `Directive sight: done-by used but caller uses include. Full inheritance (including local macros) will occur.`,
                    range,
                    severity: call_site_severity,
                    source: {
                        source_file: parent_filename,
                        source_line,
                        original_range: range,
                    },
                });
            }
        }
    }

    /**
     * Emit diagnostic for mixed call types (both do/run AND include) in parent file.
     * Always emits as warning.
     */
    private maybe_emit_mixed_call_types_warning(
        mixed_check: { has_mixed: boolean; types: ('do' | 'run' | 'include')[] },
        range: Range,
        parent_filename: string,
        source_line: number,
        diagnostics: DirectiveDiagnostic[]
    ): void {
        if (mixed_check.has_mixed) {
            diagnostics.push({
                message: `Parent file "${parent_filename}" has multiple call types (${mixed_check.types.join(', ')}) referencing this file. The first call site will be used. Consider using line= or match= to specify which call site to use.`,
                range,
                severity: 'warning',
                source: {
                    source_file: parent_filename,
                    source_line,
                    original_range: range,
                },
            });
        }
    }

    /**
     * Normalize directives before resolution.
     * If both done-by and included-by reference the same parent file, included-by
     * semantics win, and a warning is emitted.
     */
    private normalize_directives(
        directives: Directive[],
        diagnostics: DirectiveDiagnostic[]
    ): Directive[] {
        const by_parent_uri: Map<string, Directive[]> = new Map();

        for (const my_directive of directives) {
            const my_parent_uri = URI.file(my_directive.path).toString();
            const existing = by_parent_uri.get(my_parent_uri) ?? [];
            existing.push(my_directive);
            by_parent_uri.set(my_parent_uri, existing);
        }

        const normalized: Directive[] = [];
        for (const the_group of by_parent_uri.values()) {
            const group_types = new Set(the_group.map(d => d.type));
            const has_done_by = group_types.has('done-by');
            const has_included_by = group_types.has('included-by');

            if (has_done_by && has_included_by) {
                // Warn once, and prefer included-by.
                const my_range =
                    the_group.find((d) => d.type === 'included-by')?.range ?? the_group[0].range;
                diagnostics.push({
                    message:
                        'Both sight: done-by and sight: included-by reference the same parent; ' +
                        'treating as included-by (full inheritance).',
                    range: my_range,
                    severity: 'warning',
                });

                for (const my_directive of the_group) {
                    if (my_directive.type === 'included-by') {
                        normalized.push(my_directive);
                    }
                }
            } else {
                normalized.push(...the_group);
            }
        }

        return normalized;
    }

    /**
     * Resolve a backward directive's raw_path to the real-cased absolute
     * filesystem path using `resolve_path_rich`.
     *
     * The join is done via `DirectiveParser.resolve_path` (separator
     * normalization, Windows/UNC handling) on `directive.raw_path` joined
     * to the containing directory of `child_uri` — WITHOUT the `.do`
     * fallback applied at that stage. `resolve_path_rich` owns the `.do`
     * fallback (`try_do_fallback: true`).
     *
     * Returns the real-cased path and the outcome kind. The caller decides
     * what to do with `case_only` vs `ambiguous`/`missing`.
     */
    private compute_directive_real_path(
        directive: Directive,
        child_uri: string,
    ): {
        real_path: string;
        outcome_kind: 'exact' | 'case_only' | 'ambiguous' | 'missing';
        requested_path?: string;
        seed_dir?: string;
    } {
        const child_fs_path = URI.parse(child_uri).fsPath;
        const containing_dir = path.dirname(child_fs_path);
        // Join raw_path without .do fallback; rich resolver owns that.
        const joined = this.directive_parser.resolve_path(
            directive.raw_path,
            containing_dir,
        );
        const my_outcome = resolve_path_rich(joined, {
            try_do_fallback: true,
            workspace_roots: this.workspace_roots.length > 0
                ? this.workspace_roots
                : undefined,
            fs: this.resolve_fs,
        });

        if (my_outcome.kind === 'exact') {
            return {
                real_path: my_outcome.path,
                outcome_kind: 'exact',
            };
        }
        if (my_outcome.kind === 'case_only') {
            // Use the shared helper to find the deepest workspace root
            // that contains the real path (consistent with forward-scope-
            // resolver's seed-dir logic; uses path.sep, no '/' assumption).
            const my_seed = get_workspace_root_for_path(
                this.workspace_roots,
                my_outcome.path,
            ) ?? path.dirname(my_outcome.path);
            return {
                real_path: my_outcome.path,
                outcome_kind: 'case_only',
                requested_path: my_outcome.requested,
                seed_dir: my_seed,
            };
        }
        // ambiguous or missing: fall back to the as-typed directive.path
        // so the existing error path can report it.
        return {
            real_path: directive.path,
            outcome_kind: my_outcome.kind,
        };
    }

    /**
     * Emit a backward-directive path_case_mismatch diagnostic.
     *
     * Message deliberately makes no Stata-execution claim — backward
     * directives are LSP hints only; Stata never reads them.
     */
    private emit_backward_case_mismatch(
        raw_path: string,
        real_path: string,
        directive: Directive,
        child_uri: string,
        seed_dir: string | undefined,
        config: ScopeResolverConfig,
        diagnostics: DirectiveDiagnostic[],
    ): void {
        const my_severity: CrossFileCaseMismatchSeverity =
            config.diagnostics?.case_mismatch ?? 'auto';
        if (my_severity === 'off') {
            return;
        }
        // Compute display paths relative to the child's directory.
        const child_dir = path.dirname(URI.parse(child_uri).fsPath);
        const my_req_disp = path.relative(child_dir, raw_path)
            .replace(/\\/g, '/') || raw_path;
        const my_real_disp = path.relative(child_dir, real_path)
            .replace(/\\/g, '/') || real_path;
        // Use 'warning' as a neutral placeholder. For path_case_mismatch
        // diagnostics, convert_directive_diagnostic in the diagnostics
        // provider is the SINGLE point that resolves 'auto' via
        // host_is_case_sensitive() — it derives the final LSP severity
        // entirely from the config setting and host probe, so this field
        // is not consulted. We do not pre-resolve 'auto' here.
        diagnostics.push({
            // Backward directives are LSP hints — no execution claim.
            message:
                `Directive path "${my_req_disp}" does not match the ` +
                `file on disk "${my_real_disp}"; update the directive ` +
                `to match the file's casing.`,
            range: directive.range,
            severity: 'warning',
            kind: 'path_case_mismatch',
            code: StataDiagnosticCode.PATH_CASE_MISMATCH,
            case_mismatch_seed_dir: seed_dir,
            source: {
                source_file: path.basename(URI.parse(child_uri).fsPath),
                original_range: directive.range,
            },
        });
    }

    /**
     * Generate cache key for scope resolution.
     */
    private generate_cache_key(file_uri: string, content: string, config: ScopeResolverConfig): string {
        const content_hash = this.hash_content(content);
        const config_hash = this.hash_content(JSON.stringify(config));
        // Include graph version in config hash for auto mode so that
        // scope cache entries are invalidated when the graph changes.
        // Folded into the config hash (not appended as extra segment) to
        // preserve the uri:hash:hash cache key format expected by
        // extract_uri_from_cache_key.
        const graph_suffix = (config.backward_dependencies !== 'explicit' && this.dependency_graph)
            ? `|g${this.dependency_graph.get_version()}`
            : '';
        return `${file_uri}:${content_hash}:${config_hash}${graph_suffix}`;
    }

    /**
     * Simple hash function for content.
     */
    private hash_content(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Compute a stable hash of the symbols that would be inherited by a child.
     * The hash targets the 'public interface' (globals, programs, scalars, matrices, variables).
     * Local macros are excluded since they don't pass through do/run boundaries.
     */
    compute_interface_hash(symbols: SymbolTable): InterfaceHash {
        return this.compute_do_interface_hash(symbols);
    }

    /**
     * Compute interface hash for do/run callees (excludes local macros).
     */
    private compute_do_interface_hash(symbols: SymbolTable): InterfaceHash {
        const the_parts: string[] = [];

        // Programs
        const program_names = Array.from(symbols.programs.keys()).sort();
        for (const my_name of program_names) {
            the_parts.push(`p:${my_name}`);
        }

        // Global macros
        const global_names = Array.from(symbols.globalMacros.keys()).sort();
        for (const my_name of global_names) {
            the_parts.push(`g:${my_name}`);
        }

        // Scalars
        const scalar_names = Array.from(symbols.scalars.keys()).sort();
        for (const my_name of scalar_names) {
            the_parts.push(`s:${my_name}`);
        }

        // Matrices
        const matrix_names = Array.from(symbols.matrices.keys()).sort();
        for (const my_name of matrix_names) {
            the_parts.push(`m:${my_name}`);
        }

        // Variables
        const var_names = Array.from(symbols.variables.keys()).sort();
        for (const my_name of var_names) {
            the_parts.push(`v:${my_name}`);
        }

        return this.hash_content(the_parts.join('|'));
    }

    /**
     * Compute interface hash for include callees (includes local macros).
     */
    private compute_include_interface_hash(symbols: SymbolTable): InterfaceHash {
        const the_parts: string[] = [];

        // Programs
        const program_names = Array.from(symbols.programs.keys()).sort();
        for (const my_name of program_names) {
            the_parts.push(`p:${my_name}`);
        }

        // Global macros
        const global_names = Array.from(symbols.globalMacros.keys()).sort();
        for (const my_name of global_names) {
            the_parts.push(`g:${my_name}`);
        }

        // Local macros (included for include callees). Only do-file-level
        // locals are include-visible (issue #271); hashing the raw flat map
        // would miss scope moves (program <-> dofile keeps the name set
        // unchanged) and skip caller revalidation.
        const local_names: string[] = [];
        for (const [my_name, my_symbol] of symbols.localMacros) {
            if (is_dofile_local(my_symbol)) {
                local_names.push(my_name);
            }
        }
        local_names.sort();
        for (const my_name of local_names) {
            the_parts.push(`l:${my_name}`);
        }

        // Scalars
        const scalar_names = Array.from(symbols.scalars.keys()).sort();
        for (const my_name of scalar_names) {
            the_parts.push(`s:${my_name}`);
        }

        // Matrices
        const matrix_names = Array.from(symbols.matrices.keys()).sort();
        for (const my_name of matrix_names) {
            the_parts.push(`m:${my_name}`);
        }

        // Variables
        const var_names = Array.from(symbols.variables.keys()).sort();
        for (const my_name of var_names) {
            the_parts.push(`v:${my_name}`);
        }

        return this.hash_content(the_parts.join('|'));
    }

    /**
     * Compute dual interface hashes for a symbol table.
     */
    compute_dual_interface_hash(symbols: SymbolTable): DualInterfaceHash {
        return {
            do_hash: this.compute_do_interface_hash(symbols),
            include_hash: this.compute_include_interface_hash(symbols),
        };
    }

    /**
     * Extract the filename from a file URI.
     */
    private extract_filename(uri: string): string {
        const fs_path = URI.parse(uri).fsPath;
        // Handle both forward slashes and backslashes
        const last_slash_index = Math.max(
            fs_path.lastIndexOf('/'),
            fs_path.lastIndexOf('\\')
        );
        if (last_slash_index === -1) {
            return fs_path;
        }
        return fs_path.substring(last_slash_index + 1);
    }

    /**
     * Resolve the complete scope for a file.
     */
    async resolve(
        file_uri: string,
        file_content: string,
        config: Partial<ScopeResolverConfig> = {},
        token?: CancellationToken,
        options?: ResolveOptions
    ): Promise<ResolvedScope> {
        const my_config = { ...DEFAULT_CONFIG, ...config };
        const cache_key = this.generate_cache_key(file_uri, file_content, my_config);

        // Check scope cache
        const cached_entry = this.scope_cache.get(cache_key);
        if (cached_entry) {
            this.cache_metrics.scope.hits++;
            this.log(`[resolve] Cache HIT for ${file_uri} (key prefix: ${cache_key.substring(0, 50)}...)`);
            return cached_entry.resolved_scope;
        }

        this.cache_metrics.scope.misses++;
        this.log(`[resolve] Cache MISS for ${file_uri} (key prefix: ${cache_key.substring(0, 50)}...)`);

        const visited = new Set<string>();
        const the_chain: ScopeChainEntry[] = [];
        const the_diagnostics: DirectiveDiagnostic[] = [];
        const the_out_of_scope: OutOfScopeSymbol[] = [];

        // Parse current file
        const my_parse_result = this.parse_file(file_uri, file_content);
        const my_directives = my_parse_result.directives;
        the_diagnostics.push(...my_parse_result.diagnostics);

        // Track whether the current file has directives declared (regardless of resolution)
        const has_directives = my_directives.length > 0;
        const is_standalone = my_parse_result.is_standalone;

        // Standalone wins over explicit backward directives, with a warning
        // per ignored line (issue #208). Emitted here (root path) rather than
        // by the DirectiveParser so it never rides ancestor parse results
        // into a descendant's diagnostics — it appears only when the
        // standalone file itself is diagnosed.
        if (is_standalone) {
            // Do not name my_ignored.type here: the parser folds `run-by`
            // into `done-by`, so the stored type can differ from the text
            // on the flagged line (#208 review round 1).
            for (const my_ignored of my_directives) {
                the_diagnostics.push({
                    message: `Ignored backward directive: this file is ` +
                        `marked 'sight: standalone', which disables ` +
                        `backward-directive inheritance.`,
                    range: my_ignored.range,
                    severity: 'warning',
                });
            }
        }

        // Add current file to chain
        the_chain.push({
            uri: file_uri,
            directive_type: 'included-by', // Current file has full access
            call_site_line: Number.MAX_SAFE_INTEGER,
            symbols: my_parse_result.symbols,
            depth: 0,
            directive_order: Number.MAX_SAFE_INTEGER,
            sort_key: `included-by:${file_uri}:${Number.MAX_SAFE_INTEGER}`,
        });

        visited.add(file_uri);

        // Create request cache for this resolution chain
        const request_cache: RequestCache = new Map();

        const {
            directives: effective_directives,
            used_auto_parents: has_auto_parents,
        } = this.get_effective_backward_directives(
            file_uri,
            my_directives,
            my_config,
            is_standalone
        );

        // Snapshot scan_complete at the SAME synchronous moment as
        // has_auto_parents. Diagnostic deferral must use this snapshot,
        // not a fresh `is_scan_complete()` read at publication time —
        // otherwise the workspace scan completing between this point and
        // the deferral check can make the LSP publish an undefined-symbol
        // warning that the very next re-validation clears, which the user
        // perceives as a red-squiggly flicker.
        const scan_complete_at_resolve_time =
            this.dependency_graph?.is_scan_complete();

        // Follow directive chain
        const normalized_directives = this.normalize_directives(
            effective_directives,
            the_diagnostics
        );

        // Register backward directive dependencies for this file, unless the
        // caller owns registration (DocumentStore's working-directory probe
        // passes register_dependencies: false and applies the effective
        // registration itself at commit time, issue #184).
        if (options?.register_dependencies ?? true) {
            this.apply_normalized_backward_directives(
                file_uri, normalized_directives
            );
        }

        // Follow directive chain and get inherited working directory
        const directive_result = await this.follow_directives(
            normalized_directives,
            file_uri,
            visited,
            the_chain,
            the_diagnostics,
            the_out_of_scope,
            1,
            my_config,
            request_cache,
            token
        );

        // Check cancellation after directive chain traversal
        if (token?.isCancellationRequested) {
            return {
                chain: the_chain,
                symbols: create_empty_symbol_table(),
                out_of_scope_symbols: the_out_of_scope,
                diagnostics: [],
                has_directives,
                has_auto_parents,
                is_standalone,
                scan_complete_at_resolve_time,
            };
        }

        // Merge symbols with shadowing
        const merged_symbols = this.merge_chain(the_chain);

        // Check if current file has its own working directory
        // (parse_file forwards the header's working-directory directive).
        let own_working_directory: string | undefined;
        if (my_parse_result.working_directory_directive) {
            if (my_parse_result.working_directory_directive.is_workspace_relative) {
                const my_ws_root = get_workspace_root_for_uri(
                    this.workspace_roots, file_uri
                );
                if (my_ws_root) {
                    own_working_directory = path.normalize(path.join(
                        my_ws_root,
                        my_parse_result.working_directory_directive.resolved_path
                    ));
                }
            } else {
                own_working_directory = my_parse_result.working_directory_directive.resolved_path;
            }
        }

        // Only use inherited working directory if current file doesn't have its own
        const inherited_working_directory = own_working_directory
            ? undefined
            : directive_result.working_directory;

        // Resolve forward calls from current file
        // This makes symbols from scripts executed by the current file visible after the call site line
        let forward_call_symbols: import('../types').ForwardCallSite[] | undefined;
        const effective_working_directory = own_working_directory ?? inherited_working_directory;

        // Enter forward resolution when there are forward calls OR in-script
        // `cd` commands: the latter must run even with no do/run/include so a
        // lone `cd` with a casing/missing issue is still diagnosed (issue #252).
        if (this.forward_scope_resolver &&
            (my_parse_result.forward_calls.length > 0 ||
             my_parse_result.cd_commands.length > 0)) {
            const forward_result = await this.forward_scope_resolver.resolve(
                file_uri,
                my_parse_result.forward_calls,
                'include', // Current file has full access to forward call symbols
                {
                    visited: new Map(),
                    effective_call_type: 'include',
                    depth: 0,
                    diagnostics: the_diagnostics,
                    working_directory: effective_working_directory,
                    // The owner file's own cd commands drive its frame timeline.
                    cd_commands: my_parse_result.cd_commands,
                    call_chain: [],
                    // Thread the owner so path_case_mismatch fires for
                    // case-only do/run/include written in THIS file at
                    // depth 0, and is suppressed in all nested callees.
                    diagnostic_owner_uri: file_uri,
                },
                new Set([file_uri]), // Include current file in recursion stack for cycle detection
                token,
                {
                    max_forward_depth: my_config.max_forward_depth,
                    // Thread the resolution's backward mode so callee reads
                    // register ancestor edges under the same semantics
                    // (issue #286); ?? 'auto' mirrors
                    // get_effective_backward_directives.
                    backward_dependencies:
                        my_config.backward_dependencies ?? 'auto',
                    diagnostics: {
                        max_depth: my_config.diagnostics?.max_depth,
                    },
                }
            );

            if (forward_result.call_sites.length > 0) {
                forward_call_symbols = forward_result.call_sites;
            }

            // Note: forward_result.diagnostics is the same array as the_diagnostics
            // (passed via context), so no need to push - they're already there
        }

        // Remap diagnostics with source attribution to point to the active file's call site line
        // This ensures the IDE shows errors at the directive location in the current file
        // Forward-call diagnostics keep their original range (they're already in the active file)
        const remapped_diagnostics = this.remap_diagnostics_to_active_file(
            the_diagnostics,
            normalized_directives,
            file_uri
        );

        const resolved_scope: ResolvedScope = {
            chain: the_chain,
            symbols: merged_symbols,
            out_of_scope_symbols: the_out_of_scope,
            diagnostics: remapped_diagnostics,
            has_directives,
            has_auto_parents,
            is_standalone,
            scan_complete_at_resolve_time,
            inherited_working_directory,
            forward_call_symbols,
        };

        // Build dependency list for invalidation cascading
        // Include both backward directive URIs (from chain) and forward-call callee URIs
        const dependent_uris = new Set(resolved_scope.chain.map((e) => e.uri));

        // Add forward-call callee URIs to dependent_uris for cascade invalidation
        if (forward_call_symbols) {
            for (const my_call_site of forward_call_symbols) {
                dependent_uris.add(my_call_site.callee_uri);
            }
        }

        // Evict stale entries for this URI that differ only by graph version.
        // Graph version bumps create new cache keys; old ones become dead weight.
        const my_old_keys = this.uri_to_cache_keys.get(file_uri);
        if (my_old_keys) {
            // Strip graph suffix (|gN) from the new key to get base key
            const my_base_key = cache_key.replace(/\|g\d+$/, '');
            for (const my_old_key of my_old_keys) {
                if (my_old_key !== cache_key &&
                    my_old_key.replace(/\|g\d+$/, '') === my_base_key) {
                    this.scope_cache.delete(my_old_key);
                    my_old_keys.delete(my_old_key);
                }
            }
        }

        // Cache the result
        this.scope_cache.set(cache_key, {
            resolved_scope,
            content_hash: this.hash_content(file_content),
            timestamp: Date.now(),
            dependent_uris,
        });

        // Update secondary index
        let key_set = this.uri_to_cache_keys.get(file_uri);
        if (!key_set) {
            key_set = new Set();
            this.uri_to_cache_keys.set(file_uri, key_set);
        }
        key_set.add(cache_key);

        return resolved_scope;
    }

    /**
     * Preserve directive order as written in the referencing file header.
     *
     * Tie-breaking rule (same depth): lattermost directive wins.
     * That requires we do NOT reorder directives here.
     */


    /**
     * Resolve every forward call in a parent file (both pre- and
     * post-child-call). Scope resolution consumes only the pre-site subset
     * via the returned `symbols` and `call_sites` fields; find-references
     * consumes the full list via `all_call_sites`. Running the forward
     * resolver once on the full input and splitting the output preserves
     * today's pre-site scope-merge semantics while exposing post-site
     * siblings for the sibling-forward-calls walk.
     *
     * @param parent_uri - URI of the parent file
     * @param parent_forward_calls - Forward calls extracted from the parent
     *   file
     * @param call_site_line - The line where the child is called (0-indexed)
     * @param backward_directive_type - The type of backward directive
     *   ('done-by' or 'included-by')
     * @param working_directory - Working directory context for path resolution
     * @param depth - Current resolution depth
     * @param config - Scope resolver configuration
     * @param visited - Set of visited URIs for cycle detection
     * @param token - Cancellation token
     * @returns `symbols` and `call_sites` (pre-site only, feeds chain-entry
     *   merging), `all_call_sites` (full list, feeds find-references), and
     *   any diagnostics.
     */
    private async resolve_parent_forward_calls(
        parent_uri: string,
        parent_forward_calls: ForwardCall[],
        parent_cd_commands: CdCommand[],
        call_site_line: number,
        backward_directive_type: 'done-by' | 'included-by',
        working_directory: string | undefined,
        depth: number,
        config: ScopeResolverConfig,
        visited: Set<string>,
        token?: CancellationToken
    ): Promise<{
        symbols: SymbolTable;
        diagnostics: DirectiveDiagnostic[];
        call_sites: import('../types').ForwardCallSite[];
        all_call_sites: import('../types').ForwardCallSite[];
    }> {
        if (!this.forward_scope_resolver) {
            return {
                symbols: create_empty_symbol_table(),
                diagnostics: [],
                call_sites: [],
                all_call_sites: [],
            };
        }

        if (parent_forward_calls.length === 0) {
            return {
                symbols: create_empty_symbol_table(),
                diagnostics: [],
                call_sites: [],
                all_call_sites: [],
            };
        }

        // Compute effective call type based on backward directive type.
        // If backward directive is done-by or run-by, all forward calls are
        // treated as 'do' (locals don't pass through do/run boundaries).
        // If backward directive is included-by, preserve original call types.
        const effective_call_type: EffectiveCallType =
            backward_directive_type === 'included-by' ? 'include' : 'do';

        // Calculate remaining depth for forward resolution.
        // Use overall chain depth limit minus current backward depth.
        const remaining_depth = config.max_chain_depth - depth;
        if (remaining_depth <= 0) {
            // Cap-induced truncation, not a genuine error (#209). Respect the
            // configured `max_depth` severity and suppress when 'off' —
            // consistent with the backward and forward depth caps.
            const max_depth_setting =
                config.diagnostics?.max_depth ?? 'warning';
            if (max_depth_setting === 'off') {
                return {
                    symbols: create_empty_symbol_table(),
                    diagnostics: [],
                    call_sites: [],
                    all_call_sites: [],
                };
            }
            // Attribute to the parent file's call site so the diagnostic
            // points somewhere actionable (was 0:0). Guard the sentinel:
            // with assume_call_site === 'end' the inferred call_site_line
            // is Number.MAX_SAFE_INTEGER. When the call site is unknown,
            // anchor the range at line 0 but OMIT source_line — downstream
            // formatting treats a defined source_line as authoritative and
            // would mislabel an unknown site as "line 1".
            const has_known_call_site =
                Number.isInteger(call_site_line) &&
                call_site_line >= 0 &&
                call_site_line < Number.MAX_SAFE_INTEGER;
            const chain_line = has_known_call_site ? call_site_line : 0;
            const chain_range = {
                start: { line: chain_line, character: 0 },
                end: { line: chain_line, character: 0 },
            };
            const parent_basename =
                path.basename(URI.parse(parent_uri).fsPath);
            return {
                symbols: create_empty_symbol_table(),
                diagnostics: [{
                    message:
                        `Maximum combined resolution depth ` +
                        `(${config.max_chain_depth}) exceeded when ` +
                        `resolving parent forward calls`,
                    range: chain_range,
                    severity: max_depth_setting,
                    kind: 'truncation',
                    code: StataDiagnosticCode.CROSS_FILE_TRUNCATED,
                    source: {
                        source_file: parent_basename,
                        // Omit source_line when the call site is unknown.
                        ...(has_known_call_site
                            ? { source_line: call_site_line }
                            : {}),
                        original_range: chain_range,
                    },
                }],
                call_sites: [],
                all_call_sites: [],
            };
        }

        // ISSUE #209 INVARIANT (sibling visibility): isolate the parent's
        // forward-call walk from the backward walk. We pass a *copy* of the
        // backward `visited` set (not the live set) as the forward cycle
        // stack, and a *fresh* forward `visited` Map (line below). Combined
        // with the caller deleting `my_parent_uri` from `visited` BEFORE
        // invoking us (see follow_directives), every URI in `recursion_stack`
        // is the current file or a file already on the active backward chain
        // — never an independent earlier sibling. So a legitimately earlier-
        // sourced sibling can never be skipped as a false cycle. Raven
        // (jbearak/raven#471, #477) shared ONE map across both walks and
        // dropped such siblings; do not merge these structures. Regression:
        // tests/integration/hub-heavy-sibling-visibility.test.ts.
        const recursion_stack = new Set<string>(visited);

        // Resolve the FULL forward-call list so find-references sees sibling
        // post-site calls. Scope resolution still wants only the pre-site
        // subset, which we derive from the output below.
        const the_diagnostics: DirectiveDiagnostic[] = [];
        const forward_result = await this.forward_scope_resolver.resolve(
            parent_uri,
            parent_forward_calls,
            effective_call_type,
            {
                visited: new Map(),
                effective_call_type,
                depth: 0,
                diagnostics: the_diagnostics,
                working_directory,
                // Parent's own cd commands make its forward calls line-sensitive
                // (issue #252).
                cd_commands: parent_cd_commands,
                call_chain: [],
            },
            recursion_stack,
            token,
            {
                max_forward_depth: remaining_depth,
                // Thread the resolution's backward mode for ancestor-edge
                // registration during callee reads (issue #286).
                backward_dependencies:
                    config.backward_dependencies ?? 'auto',
                // Thread the depth-diagnostic severity/off setting so a
                // parent's forward truncations honor `max_depth` too (#209).
                diagnostics: { max_depth: config.diagnostics?.max_depth },
            }
        );

        // Derive pre-site subset + its merged symbol table for scope resolution.
        const the_pre_site_sites = forward_result.call_sites
            .filter(my_site => my_site.call_line < call_site_line);
        let my_pre_site_symbols = create_empty_symbol_table();
        for (const my_site of the_pre_site_sites) {
            my_pre_site_symbols = merge_symbol_tables(
                my_pre_site_symbols,
                my_site.symbols
            );
        }

        return {
            symbols: my_pre_site_symbols,
            diagnostics: the_diagnostics,
            call_sites: the_pre_site_sites,
            all_call_sites: forward_result.call_sites,
        };
    }

    /**
     * Resolve the working directory a file INHERITS from its explicit
     * backward-directive parents (`@lsp-done-by` / `@lsp-included-by`;
     * `@lsp-run-by` is parsed as `done-by`). Pass the file's full
     * directive list — this filters to the backward types itself, so the
     * "which directives are backward" rule lives in one place.
     * Own-directive WD is the caller's responsibility; this returns only
     * the inherited value.
     *
     * Safe to call from the workspace indexer: it reads parent files via
     * this resolver's own `file_cache` / disk through `get_parsed_file`
     * and never touches the indexer's `symbol_index` nor re-enters
     * `index_file`. Used to make indexed and open-document
     * dependency-graph callee keys agree for WD-dependent files (#218).
     *
     * Covers EXPLICIT backward directives only. WD inherited via
     * auto-discovered (dependency-graph) parents is not resolved here —
     * that depends on scan ordering — and stays best-effort during
     * indexing, corrected when the file is opened.
     */
    async resolve_inherited_working_directory(
        directives: Directive[],
        current_uri: string,
        is_standalone: boolean,
        config?: Partial<ScopeResolverConfig>,
    ): Promise<string | undefined> {
        // A standalone file (issue #208) inherits no working directory,
        // regardless of any (ignored) backward directives in its header.
        if (is_standalone) {
            return undefined;
        }
        const the_backward_directives = directives.filter(
            d => d.type === 'done-by' || d.type === 'included-by',
        );
        if (the_backward_directives.length === 0) {
            return undefined;
        }
        // Force EXPLICIT backward resolution for the walk. The recursion into
        // deeper ancestors goes through get_effective_backward_directives,
        // which in 'auto' mode reads the dependency graph — and during a bulk
        // indexer scan that graph is only partially built, so an auto-
        // discovered grandparent's WD would resolve order-dependently (a
        // race). Forcing 'explicit' makes the walk deterministic and
        // scan-order-independent; auto-discovered-parent WD stays best-effort
        // and is resolved authoritatively when the file is opened.
        const my_config: ScopeResolverConfig = {
            ...DEFAULT_CONFIG,
            ...config,
            backward_dependencies: 'explicit',
        };
        // Probe-only reads (#294): the forced-'explicit' mode above exists
        // for deterministic WD discovery, not to express registration
        // intent — letting this walk register would let a post-capacity-
        // eviction reparse wipe a directive-less file's auto-discovered
        // parent edges (clear-then-register under 'explicit' with zero raw
        // directives). Registration stays owned by genuine resolutions.
        return this.discover_working_directory(
            the_backward_directives,
            new Set<string>(),
            0,
            my_config,
            new Map(),
            current_uri,
            undefined,
            /* skip_backward_registration */ true,
        );
    }

    /**
     * Discover the working directory from the directive chain using lightweight parsing.
     * This method only parses directives (no full AST) to efficiently find the working
     * directory before doing full parsing.
     *
     * @param directives - Directives to follow
     * @param visited - Set of visited URIs for cycle detection
     * @param depth - Current recursion depth
     * @param config - Scope resolver configuration
     * @param request_cache - Per-request parse cache
     * @param current_uri - URI of the file whose directives these are
     *   (the join base for case-aware parent resolution)
     * @returns The effective working directory for the chain, or undefined if not found
     */
    private async discover_working_directory(
        directives: Directive[],
        visited: Set<string>,
        depth: number,
        config: ScopeResolverConfig,
        request_cache: RequestCache,
        current_uri: string,
        token?: CancellationToken,
        skip_backward_registration?: boolean
    ): Promise<string | undefined> {
        // Check depth limit
        if (depth > config.max_backward_depth) {
            return undefined;
        }

        for (const my_directive of directives) {
            // Check cancellation before processing each directive
            if (token?.isCancellationRequested) {
                return undefined;
            }

            // Resolve the parent through the case-aware chokepoint so
            // the inherited-WD lookup matches the main follow_directives
            // path: case-only matches resolve, the .do fallback is
            // applied, and an ambiguous parent is skipped instead of
            // arbitrarily picked.
            const my_rich = this.compute_directive_real_path(
                my_directive, current_uri,
            );
            if (my_rich.outcome_kind === 'ambiguous') {
                continue;
            }
            const my_real_path = my_rich.real_path;
            const my_parent_uri = URI.file(my_real_path).toString();

            // Cycle detection - skip if already visited
            if (visited.has(my_parent_uri)) {
                continue;
            }

            // Read file content using get_parsed_file to leverage cache.
            // compute_directive_real_path already applied the .do fallback,
            // so no second manual retry is needed here.
            let my_parent_result: ParsedFileResult;
            try {
                my_parent_result = await this.get_parsed_file(
                    my_parent_uri,
                    my_real_path,
                    {
                        request_cache,
                        // Thread the walk's mode so the ancestor-level
                        // registration inside get_parsed_file matches the
                        // resolution semantics (issue #286). ?? 'auto'
                        // mirrors get_effective_backward_directives.
                        backward_dependencies:
                            config.backward_dependencies ?? 'auto',
                        // Probe-only when driven by the indexer's WD walk
                        // (#294): its forced-'explicit' mode is a
                        // determinism hack, not registration intent.
                        skip_backward_registration,
                    }
                );
            } catch (error) {
                my_parent_result = { error: String(error) };
            }

            // Check cancellation after file read
            if (token?.isCancellationRequested) {
                return undefined;
            }

            if ('error' in my_parent_result) {
                this.warn(`discover_working_directory: Cannot read file ${my_real_path}`);
                continue;
            }

            // Backward working-directory inheritance is DIRECTIVE-BASED only.
            //
            // Issue #252 (in-script `cd`) is intentionally scoped to make a
            // file's OWN later calls line-sensitive, starting from "the existing
            // directive or inherited working directory". A parent's in-script
            // `cd` is deliberately NOT propagated as the inherited starting WD
            // of a child opened standalone: doing so would require call-site
            // matching inside this cache-keyed backward walk and is a separate
            // enhancement. The FORWARD direction is fully handled — resolving
            // the parent as the owner recurses into the child using the call-
            // site WD (see ForwardScopeResolver effective_call_wd). Keeping
            // backward inheritance directive-only also keeps the owner file's
            // producer and resolver timelines identical, preserving dep-graph
            // edge parity (acceptance criterion 4).
            //
            // If the parent has a working_directory directive, resolve it for inheritance.
            if (my_parent_result.working_directory_directive) {
                let resolved_path = my_parent_result.working_directory_directive.resolved_path;
                
                // Handle workspace-relative paths
                if (my_parent_result.working_directory_directive.is_workspace_relative) {
                    const workspace_root = get_workspace_root_for_uri(
                        this.workspace_roots, my_parent_uri
                    );
                    if (workspace_root) {
                        resolved_path = path.normalize(path.join(workspace_root, resolved_path));
                    } else {
                        this.warn(`discover_working_directory: Cannot resolve workspace-relative path "${my_parent_result.working_directory_directive.path}" - no workspace root set`);
                        continue;
                    }
                }

                return resolved_path;
            }

            // A standalone parent's OWN working-directory directive (handled
            // above) still flows to the child, but its ancestors' WD does
            // not: the chokepoint returns [] for it (issue #208).
            const {
                directives: effective_parent_directives,
            } = this.get_effective_backward_directives(
                my_parent_uri,
                my_parent_result.directives,
                config,
                my_parent_result.is_standalone
            );

            // Otherwise, recursively search deeper ancestors
            if (effective_parent_directives.length > 0) {
                // Mark as visited before recursing
                visited.add(my_parent_uri);

                const my_deeper_wd = await this.discover_working_directory(
                    effective_parent_directives,
                    visited,
                    depth + 1,
                    config,
                    request_cache,
                    my_parent_uri,
                    token,
                    skip_backward_registration
                );

                // Allow same file via different paths
                visited.delete(my_parent_uri);

                // Return the first working_directory found from deeper ancestors
                if (my_deeper_wd) {
                    return my_deeper_wd;
                }
            }
        }

        // No working directory found in the chain
        return undefined;
    }

    /**
     * Follow directives recursively.
     * Returns the working directory found in the directive chain (if any).
     */
    private async follow_directives(
        directives: Directive[],
        current_uri: string,
        visited: Set<string>,
        chain: ScopeChainEntry[],
        diagnostics: DirectiveDiagnostic[],
        out_of_scope: OutOfScopeSymbol[],
        depth: number,
        config: ScopeResolverConfig,
        request_cache: RequestCache,
        token?: CancellationToken
    ): Promise<{ working_directory?: string }> {
        if (depth > config.max_backward_depth) {
            const source_filename = path.basename(URI.parse(current_uri).fsPath);
            const default_range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
            this.warn(`ScopeResolver: Maximum backward depth (${config.max_backward_depth}) exceeded at ${current_uri}`);

            // Emit diagnostic if configured
            const max_depth_severity = config.diagnostics?.max_depth ?? 'warning';
            if (max_depth_severity !== 'off') {
                diagnostics.push({
                    message: `Maximum backward directive depth (${config.max_backward_depth}) exceeded`,
                    range: default_range,
                    severity: max_depth_severity,
                    // Cap-induced truncation, not a genuine error (#209).
                    kind: 'truncation',
                    code: StataDiagnosticCode.CROSS_FILE_TRUNCATED,
                    source: {
                        source_file: source_filename,
                        source_line: 0,
                        original_range: default_range,
                    },
                });
            }
            return {};
        }

        // Track the working directory found at this level (nearest parent wins)
        let found_working_directory: string | undefined;

        for (const my_directive of directives) {
            // Check cancellation before processing each directive
            if (token?.isCancellationRequested) {
                return { working_directory: found_working_directory };
            }

            // Resolve the directive path via the rich resolver so that a
            // unique case-only match on disk still resolves (no cascade)
            // and registers under the REAL-cased URI (M3 invariant).
            // Auto-synthesised directives already carry real-cased paths
            // from the dependency graph, so resolve_path_rich returns
            // 'exact' for them and no diagnostic is emitted.
            const my_rich = this.compute_directive_real_path(
                my_directive, current_uri,
            );

            // Ambiguous outcome → two or more case-insensitive matches on
            // disk; no concrete parent can be chosen.  Skip this directive
            // entirely (no registration, no parsing) so an arbitrary-cased
            // parent is never picked on a case-insensitive host.
            if (my_rich.outcome_kind === 'ambiguous') {
                continue;
            }

            const my_real_fs_path = my_rich.real_path;
            const my_parent_uri = URI.file(my_real_fs_path).toString();

            // Emit backward path_case_mismatch for explicit case-only
            // mismatches.  No execution claim — backward directives are
            // LSP hints only.
            if (my_rich.outcome_kind === 'case_only') {
                const my_raw_joined = this.directive_parser.resolve_path(
                    my_directive.raw_path,
                    path.dirname(URI.parse(current_uri).fsPath),
                );
                this.emit_backward_case_mismatch(
                    my_raw_joined,
                    my_real_fs_path,
                    my_directive,
                    current_uri,
                    my_rich.seed_dir,
                    config,
                    diagnostics,
                );
            }

            // Cycle detection
            if (visited.has(my_parent_uri)) {
                // Cycle detected - skip to prevent infinite recursion
                // This is normal behavior, not an error condition
                continue;
            }

            // Phase 1: Discover working directory from deeper ancestors BEFORE full parsing
            // This ensures forward calls in the parent file are resolved with the correct working directory
            const discovered_wd = await this.discover_working_directory(
                [my_directive],  // Just this directive to follow its chain
                new Set(visited),  // Copy visited set for discovery phase
                depth,
                config,
                request_cache,
                current_uri,
                token
            );

            // Phase 2: Parse with discovered working directory
            const my_parent_result = await this.get_parsed_file(
                my_parent_uri,
                my_real_fs_path,
                {
                    working_directory: discovered_wd,  // Pass discovered working directory
                    request_cache,
                    // Thread the chain's mode for the ancestor-level
                    // registration (issue #286); ?? 'auto' mirrors
                    // get_effective_backward_directives.
                    backward_dependencies:
                        config.backward_dependencies ?? 'auto',
                }
            );

            // Check for cancellation after file read
            if (token?.isCancellationRequested) {
                return { working_directory: found_working_directory };
            }

            // Handle error results
            if ('error' in my_parent_result) {
                const error_message = my_parent_result.error;
                const source_filename = path.basename(my_real_fs_path);

                // Handle encoding errors specifically
                if (error_message.includes('invalid byte sequence') ||
                    error_message.includes('malformed') ||
                    error_message.includes('encoding')) {
                    this.warn(`ScopeResolver: Encoding error in ${my_real_fs_path}, skipping file`);
                } else {
                    this.warn(`ScopeResolver: File read error for ${my_real_fs_path}: ${error_message}`);
                }

                diagnostics.push({
                    message: `Cannot read file: ${my_real_fs_path} (${error_message})`,
                    range: my_directive.range,
                    severity: 'warning',
                    kind: 'missing_file',
                    code: StataDiagnosticCode.CROSS_FILE_MISSING_FILE,
                    source: {
                        source_file: source_filename,
                        // Omit source_line - call site unknown (file unreadable)
                        original_range: my_directive.range,
                    },
                });
                continue;
            }

            // Check if parent has a working directory (nearest parent wins)
            // Use the discovered working directory, not the resolved one from get_parsed_file
            if (!found_working_directory && discovered_wd) {
                found_working_directory = discovered_wd;
            }

            // Use content from get_parsed_file() for call site resolution (no second disk read)
            const my_parent_content = my_parent_result.content;
            const current_filename = this.extract_filename(current_uri);
            const parent_filename = path.basename(my_real_fs_path);

            // Resolve call site line (0-indexed internally)
            // Priority: explicit call_site > reverse deps edges > text inference > config default
            let my_call_site_line: number;
            let effective_call_type: 'do' | 'run' | 'include' = my_directive.type === 'included-by' ? 'include' : 'do';

            if (my_directive.call_site) {
                // Block-comment spans are inert, so a call site must never
                // resolve into one. Computed once and shared by the line= and
                // match= validation below.
                const my_block_ranges = block_comment_ranges(my_parent_content);
                if (my_directive.call_site.type === 'line') {
                    // User-provided line=N is 1-indexed; convert to 0-indexed
                    my_call_site_line = (my_directive.call_site.value as number) - 1;

                    // Validate line is in bounds (Req 1.3)
                    if (!this.is_line_in_bounds(my_call_site_line, my_parent_content)) {
                        const doc = { content: my_parent_content, line_offsets: compute_line_offsets(my_parent_content) };
                        const total_lines = get_line_count(doc);
                        diagnostics.push({
                            message: `Specified line=${my_directive.call_site.value} is out of bounds (file has ${total_lines} lines). Using default call site assumption.`,
                            range: my_directive.range,
                            severity: 'warning',
                            source: {
                                source_file: parent_filename,
                                // Omit source_line - line= out of bounds
                                original_range: my_directive.range,
                            },
                        });
                        my_call_site_line = config.assume_call_site === 'end'
                            ? Number.MAX_SAFE_INTEGER
                            : 0;
                    } else {
                        // Validate line contains a call statement (Req 1.4).
                        // A malformed/block-commented line returns undefined, so
                        // it no longer flips effective_call_type/inheritance.
                        const call_validation = this.validate_call_statement(
                            my_parent_content, my_call_site_line, my_block_ranges);

                        if (!call_validation) {
                            diagnostics.push({
                                message: `Specified line=${my_directive.call_site.value} does not contain a do/run/include command or forward directive.`,
                                range: my_directive.range,
                                severity: 'warning',
                                source: {
                                    source_file: parent_filename,
                                    source_line: my_call_site_line,  // Use the specified line (user provided it)
                                    original_range: my_directive.range,
                                },
                            });
                            // Still use the specified line (user may know better)
                        } else {
                            // Update effective call type from validated line
                            effective_call_type = call_validation;

                            // Emit directive/call-type mismatch diagnostics based on the explicitly selected line
                            this.maybe_emit_included_by_mismatch(my_directive.type, call_validation, my_directive.range, parent_filename, my_call_site_line, diagnostics);
                            this.maybe_emit_done_by_include_info(my_directive.type, call_validation, my_directive.range, parent_filename, my_call_site_line, diagnostics, config);
                        }
                    }
                } else {
                    // find_match_line returns 0-indexed line number. Pass the
                    // already-computed block lines to avoid re-lexing the parent.
                    const my_match_line = this.directive_parser.find_match_line(
                        my_parent_content,
                        my_directive.call_site.value as string,
                        my_block_ranges
                    );
                    if (my_match_line === undefined) {
                        // Req 1.6: match= not found emits warning
                        diagnostics.push({
                            message: `Match string "${my_directive.call_site.value}" not found in parent file "${parent_filename}". Using default call site assumption.`,
                            range: my_directive.range,
                            severity: 'warning',
                            source: {
                                source_file: parent_filename,
                                // Omit source_line - match= not found
                                original_range: my_directive.range,
                            },
                        });
                        my_call_site_line = config.assume_call_site === 'end'
                            ? Number.MAX_SAFE_INTEGER
                            : 0;
                    } else {
                        // Use 0-indexed result directly
                        my_call_site_line = my_match_line;

                        // Try to infer call type from the matched line so we can emit mismatch diagnostics
                        const matched_call_type = this.validate_call_statement(
                            my_parent_content, my_call_site_line, my_block_ranges);
                        if (matched_call_type) {
                            effective_call_type = matched_call_type;

                            this.maybe_emit_included_by_mismatch(my_directive.type, matched_call_type, my_directive.range, parent_filename, my_call_site_line, diagnostics);
                            this.maybe_emit_done_by_include_info(my_directive.type, matched_call_type, my_directive.range, parent_filename, my_call_site_line, diagnostics, config);
                        }
                    }
                }
            } else {
                // No explicit call site - first check reverse deps for call edges (Req 7.2)
                const call_edges = this.get_call_edges(my_parent_uri, current_uri);
                if (call_edges && call_edges.length > 0) {
                    // Use earliest call_site_line from reverse deps (Req 4: first one found will be used)
                    const earliest_edge = call_edges.reduce((min, edge) =>
                        edge.call_site_line < min.call_site_line ? edge : min
                    );
                    my_call_site_line = earliest_edge.call_site_line;

                    // Effective call type is from the selected (earliest) edge, not any edge
                    const selected_call_type = earliest_edge.call_type;
                    effective_call_type = selected_call_type === 'include' ? 'include' : 'do';

                    // Check for mixed call types (Req 4.1, 4.2, 4.3) - warn but still use earliest
                    const mixed_check = this.detect_mixed_call_types(my_parent_content, current_filename);
                    this.maybe_emit_mixed_call_types_warning(mixed_check, my_directive.range, parent_filename, earliest_edge.call_site_line, diagnostics);

                    // Check for directive/call-type mismatch (Req 2.1, 2.2, 2.3)
                    // Use selected_call_type (from earliest edge), not whether any edge is include
                    this.maybe_emit_included_by_mismatch(my_directive.type, selected_call_type, my_directive.range, parent_filename, earliest_edge.call_site_line, diagnostics);

                    // Check for done-by/run-by with include mismatch (Req 3.1, 3.2, 3.3)
                    // This is an information diagnostic that respects configuration (Req 6.1)
                    // Use selected_call_type (from earliest edge), not whether any edge is include
                    this.maybe_emit_done_by_include_info(my_directive.type, selected_call_type, my_directive.range, parent_filename, earliest_edge.call_site_line, diagnostics, config);
                } else {
                    // Fall back to text inference
                    const inferred_call = this.directive_parser.infer_call_type_for_file(
                        my_parent_content,
                        current_filename
                    );

                    if (inferred_call !== undefined) {
                        my_call_site_line = inferred_call.line;
                        effective_call_type = inferred_call.call_type === 'include' ? 'include' : 'do';

                        // Check for mixed call types (Req 4.1, 4.2, 4.3)
                        const mixed_check = this.detect_mixed_call_types(my_parent_content, current_filename);
                        this.maybe_emit_mixed_call_types_warning(mixed_check, my_directive.range, parent_filename, inferred_call.line, diagnostics);

                        // Check for directive/call-type mismatch in text inference (Req 2.1, 2.2, 2.3)
                        this.maybe_emit_included_by_mismatch(my_directive.type, inferred_call.call_type, my_directive.range, parent_filename, inferred_call.line, diagnostics);

                        // Check for done-by/run-by with include mismatch (Req 3.1, 3.2, 3.3)
                        // This is an information diagnostic that respects configuration (Req 6.1)
                        this.maybe_emit_done_by_include_info(my_directive.type, inferred_call.call_type, my_directive.range, parent_filename, inferred_call.line, diagnostics, config);
                    } else {
                        // Fall back to config default - call site not identified (Req 1.1, 1.7)
                        my_call_site_line = config.assume_call_site === 'end'
                            ? Number.MAX_SAFE_INTEGER
                            : 0;

                        // Emit information diagnostic when call site cannot be identified (Req 6.1)
                        const call_site_severity = config.diagnostics?.call_site_identification ?? 'information';
                        if (call_site_severity !== 'off') {
                            diagnostics.push({
                                message: `Could not identify call site in parent file "${parent_filename}". Using default assumption (${config.assume_call_site}). Consider using line= or match= parameters for explicit call site specification.`,
                                range: my_directive.range,
                                severity: call_site_severity,
                                source: {
                                    source_file: parent_filename,
                                    // Omit source_line - call site not identified
                                    original_range: my_directive.range,
                                },
                            });
                        }
                    }
                }
            }

            // Apply inheritance rules based on effective call type (not just directive type)
            const inheritance_type: 'done-by' | 'included-by' = effective_call_type === 'include' ? 'included-by' : 'done-by';

            // A parent's parser-level diagnostics (malformed directive,
            // multiple-WD warning) carry ranges in the PARENT's coordinate
            // space. Stamp source attribution so
            // remap_diagnostics_to_active_file relocates them onto this
            // file's directive line with a "…: parent.do line N" note,
            // instead of publishing them on this file at the parent's raw
            // coordinates (#208 review round 1).
            for (const my_parse_diag of my_parent_result.diagnostics) {
                diagnostics.push(my_parse_diag.source ? my_parse_diag : {
                    ...my_parse_diag,
                    source: {
                        source_file: parent_filename,
                        // Full URI so remapping routes by identity, not
                        // basename (#208 review round 2: two parents can
                        // share a basename, or a parent's basename can
                        // equal the active file's).
                        source_uri: my_parent_uri,
                        source_line: my_parse_diag.range.start.line,
                        original_range: my_parse_diag.range,
                    },
                });
            }

            // Apply inheritance rules and call site filtering
            const { filtered: my_filtered_symbols, excluded_locals } = this.apply_inheritance_rules(
                my_parent_result.symbols,
                inheritance_type,
                my_parent_uri
            );
            this.add_out_of_scope_symbols(out_of_scope, excluded_locals);
            const { filtered: my_call_site_filtered, out_of_scope: my_out_of_scope } = this.filter_by_call_site(
                my_filtered_symbols,
                my_call_site_line,
                my_parent_uri
            );
            this.add_out_of_scope_symbols(out_of_scope, my_out_of_scope);

            // Mark as visited and recurse FIRST to get working directory from deeper ancestors
            // This ensures we have the correct working directory before resolving forward calls
            visited.add(my_parent_uri);
            // A standalone parent (issue #208) contributes its own symbols
            // (already parsed above) but never conducts its ancestors'
            // scope: the chokepoint returns [] for it, so the recursion
            // below iterates zero times and execution falls through to the
            // unconditional chain push. Do NOT early-continue here — the
            // parent must still land in the chain (and thus in the
            // descendant's dependent_uris for cascade invalidation).
            const {
                directives: effective_parent_directives,
            } = this.get_effective_backward_directives(
                my_parent_uri,
                my_parent_result.directives,
                config,
                my_parent_result.is_standalone
            );
            const normalized_parent_directives = this.normalize_directives(
                effective_parent_directives,
                diagnostics
            );
            // Record chain length before recursion to strip locals from ancestor entries if needed
            const chain_length_before = chain.length;
            const recursive_result = await this.follow_directives(
                normalized_parent_directives,
                my_parent_uri,
                visited,
                chain,
                diagnostics,
                out_of_scope,
                depth + 1,
                config,
                request_cache,
                token
            );
            visited.delete(my_parent_uri); // Allow same file via different paths

            // If this is a done-by/run-by boundary, strip locals from all ancestor chain entries
            // that were added during the recursion (they may have come via included-by in ancestors)
            if (inheritance_type === 'done-by') {
                for (let i = chain_length_before; i < chain.length; i++) {
                    // Track excluded locals from ancestor entries too - they're out of scope
                    // because of the done-by boundary at this level
                    const { filtered, excluded_locals } = this.apply_inheritance_rules(chain[i].symbols, 'done-by', chain[i].uri);
                    chain[i].symbols = filtered;
                    this.add_out_of_scope_symbols(out_of_scope, excluded_locals);
                }
            }

            // Determine the effective working directory for this parent:
            // 1. Parent's own working directory (if it has one)
            // 2. Working directory from deeper ancestors (recursive_result)
            // 3. Working directory found at this level so far
            //
            // A standalone parent (issue #208) inherits no working
            // directory: its forward calls resolve with its OWN WD or none.
            // Without this guard, an EARLIER sibling parent's WD (held in
            // found_working_directory) would leak into the standalone
            // parent's forward-call resolution. found_working_directory
            // itself is deliberately untouched — an earlier non-standalone
            // sibling's WD must still reach the root file's inherited WD.
            const effective_working_directory =
                my_parent_result.is_standalone
                    ? my_parent_result.working_directory
                    : (my_parent_result.working_directory ??
                       recursive_result.working_directory ??
                       found_working_directory);

            // Update found_working_directory if we got one from deeper in chain
            if (!found_working_directory && recursive_result.working_directory) {
                found_working_directory = recursive_result.working_directory;
            }

            // Resolve forward calls in parent that occur before the call site
            // This makes symbols from scripts executed by the parent visible to the child
            // Now using the effective working directory that includes deeper ancestors
            const forward_result = await this.resolve_parent_forward_calls(
                my_parent_uri,
                my_parent_result.forward_calls,
                my_parent_result.cd_commands,
                my_call_site_line,
                inheritance_type,
                effective_working_directory,
                depth,
                config,
                visited,
                token
            );
            diagnostics.push(...forward_result.diagnostics);

            // Merge parent's direct symbols with symbols from forward calls
            // Forward call symbols are applied first, then parent's direct symbols shadow them
            const my_merged_symbols = merge_symbol_tables(forward_result.symbols, my_call_site_filtered);

            // Generate deterministic sort key
            const my_sort_key = `${my_directive.type}:${my_directive.path}:${my_call_site_line}`;

            // Preserve directive order within the referencing file header.
            // Later call site lines should win at the same depth.
            const my_directive_order = my_directive.range.start.line * 1000 + my_directive.range.start.character;

            // Add to chain
            chain.push({
                uri: my_parent_uri,
                directive_type: my_directive.type,
                call_site_line: my_call_site_line,
                symbols: my_merged_symbols,
                forward_call_sites: forward_result.call_sites.length > 0
                    ? forward_result.call_sites
                    : undefined,
                all_forward_call_sites: forward_result.all_call_sites.length > 0
                    ? forward_result.all_call_sites
                    : undefined,
                depth,
                directive_order: my_directive_order,
                sort_key: my_sort_key,
            });
        }

        return { working_directory: found_working_directory };
    }

    /**
     * Parse a file and extract symbols and directives.
     * Used for the current file (content provided directly).
     */
    private parse_file(
        uri: string,
        content: string
    ): {
        symbols: SymbolTable;
        directives: Directive[];
        forward_calls: ForwardCall[];
        cd_commands: CdCommand[];
        working_directory_directive?: WorkingDirectoryDirective;
        is_standalone: boolean;
        diagnostics: DirectiveDiagnostic[];
    } {
        const content_hash = this.hash_content(content);
        // peek: this is a validation probe until the hash matches; only a
        // served hit promotes (#294 recency contract).
        const cached = this.file_cache.peek(uri);
        if (cached && cached.content_hash === content_hash) {
            this.file_cache.touch(uri);
            return {
                symbols: cached.symbols,
                directives: cached.directives,
                forward_calls: cached.forward_calls,
                cd_commands: cached.cd_commands,
                working_directory_directive:
                    cached.working_directory_directive,
                is_standalone: cached.is_standalone,
                diagnostics: cached.diagnostics,
            };
        }

        // New content observed for this URI: any forward-closure memo entry
        // built from the PREVIOUS content is stale. The eager didChange
        // invalidation cannot cover entries built DURING the debounce window
        // (after the invalidation, before this parse) from the then-stale
        // file_cache — they are keyed by ancestor hashes that this edit does
        // not rotate, so purge them now that the new content lands (#278
        // review). No-op when nothing was cached before.
        if (cached) {
            this.forward_scope_resolver
                ?.invalidate_forward_closure_for_uri?.(uri);
        }

        try {
            const my_parse_result = this.parse_content(uri, content);

            this.file_cache.set(uri, {
                uri,
                content,
                content_hash,
                size: Buffer.byteLength(content, 'utf8'),
                symbols: my_parse_result.symbols,
                directives: my_parse_result.directives,
                forward_calls: my_parse_result.forward_calls,
                cd_commands: my_parse_result.cd_commands,
                working_directory: my_parse_result.working_directory,
                working_directory_directive: my_parse_result.working_directory_directive,
                is_standalone: my_parse_result.is_standalone,
                diagnostics: my_parse_result.diagnostics,
            });

            return {
                symbols: my_parse_result.symbols,
                directives: my_parse_result.directives,
                forward_calls: my_parse_result.forward_calls,
                cd_commands: my_parse_result.cd_commands,
                working_directory_directive: my_parse_result.working_directory_directive,
                is_standalone: my_parse_result.is_standalone,
                diagnostics: my_parse_result.diagnostics,
            };
        } catch (error) {
            this.warn(`ScopeResolver: Parse error for ${uri}: ${error_message(error)}`);

            // Return empty results on parse failure — but recover the
            // header facts (directives, standalone marker, WD directive)
            // via the directive parser, which is independent of the
            // lexer/parser/analyzer failure. Without this, a parse error in
            // a `sight: standalone` file silently re-enables auto-discovered
            // parents (and a file with explicit directives falls back to
            // auto-discovery) — #208 review round 1.
            const my_recovered = this.recover_header_facts(uri, content);
            const empty_symbols = create_empty_symbol_table();
            return {
                symbols: empty_symbols,
                directives: my_recovered.directives,
                forward_calls: [],
                cd_commands: [],
                working_directory_directive:
                    my_recovered.working_directory_directive,
                is_standalone: my_recovered.is_standalone,
                diagnostics: [{
                    message: `Parse error in file: ${uri}`,
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    severity: 'warning',
                }],
            };
        }
    }

    /**
     * Best-effort recovery of header-only facts when the full
     * lex/parse/analyze pipeline throws: the DirectiveParser scans only
     * comment lines and is independent of the failure, so a broken file
     * keeps its explicit directives, standalone marker, and own
     * working-directory directive instead of silently falling back to
     * auto-discovery (#208 review round 1).
     */
    private recover_header_facts(uri: string, content: string): {
        directives: Directive[];
        working_directory_directive?: WorkingDirectoryDirective;
        is_standalone: boolean;
        /**
         * False when the directive parse ITSELF threw: the empty facts
         * are then a fallback, not a statement about the file's header,
         * and must not drive registration (clearing edges on a failed
         * recovery would be a silent wipe — bot-review follow-up).
         */
        recovered: boolean;
    } {
        try {
            const my_result = this.directive_parser.parse(content, uri);
            return {
                directives: my_result.directives,
                working_directory_directive: my_result.working_directory,
                is_standalone: my_result.standalone !== undefined,
                recovered: true,
            };
        } catch {
            return {
                directives: [],
                is_standalone: false,
                recovered: false,
            };
        }
    }

    /**
     * Parse content and return symbols, directives, forward_calls, and working_directory.
     * Helper method for get_parsed_file().
     *
     * @param uri - The file URI
     * @param content - The file content
     * @param inherited_working_directory - Optional working directory inherited from parent file
     */
    private parse_content(
        uri: string,
        content: string,
        inherited_working_directory?: string
    ): {
        symbols: SymbolTable;
        directives: Directive[];
        forward_calls: ForwardCall[];
        cd_commands: CdCommand[];
        working_directory?: string;
        working_directory_directive?: WorkingDirectoryDirective;
        is_standalone: boolean;
        diagnostics: DirectiveDiagnostic[];
    } {
        const my_directive_result = this.directive_parser.parse(content, uri);
        const my_lex_result = this.lexer.tokenize(content);
        const my_parse_result = this.parser.parse(my_lex_result.tokens);

        // Resolve file's own working_directory (handling workspace-relative paths)
        const my_workspace_root = get_workspace_root_for_uri(this.workspace_roots, uri);
        let own_working_directory: string | undefined;
        if (my_directive_result.working_directory) {
            if (my_directive_result.working_directory.is_workspace_relative) {
                if (my_workspace_root) {
                    own_working_directory = path.normalize(path.join(
                        my_workspace_root,
                        my_directive_result.working_directory.resolved_path
                    ));
                }
            } else {
                own_working_directory = my_directive_result.working_directory.resolved_path;
            }
        }
        const effective_working_directory = own_working_directory ?? inherited_working_directory;

        // Stamp the effective working directory onto the analyzer's forward
        // calls as resolution context; the analyzer no longer resolves paths.
        const my_analysis = this.analyzer.analyze(my_parse_result.ast, uri, undefined, {
            working_directory: effective_working_directory,
        }, my_lex_result.tokens);

        // Re-stamp command-detected forward calls with the line-sensitive
        // working directory implied by in-script `cd` commands (issue #252),
        // so the reverse-dependency keys this file feeds (resolve_callee_uri)
        // agree with the dep-graph edges DocumentStore/Indexer build. The
        // timeline starts from the file's effective WD. Diagnostics from the
        // helper are discarded here — ForwardScopeResolver emits cd diagnostics
        // for the owner file (single emission); see resolve().
        const my_caller_dir = path.dirname(URI.parse(uri).fsPath);
        const { timeline: cd_timeline } = build_cd_timeline({
            starting_wd: effective_working_directory,
            caller_dir: my_caller_dir,
            cd_commands: my_analysis.cd_commands,
            workspace_roots: this.workspace_roots,
            fs: this.resolve_fs,
        });
        const restamped_command_calls = apply_cd_timeline(
            my_analysis.forward_calls,
            cd_timeline,
        );

        // Combine forward calls from commands and directives.
        // Directive calls keep the file-wide working directory (directive
        // behavior is intentionally unchanged by cd tracking).
        const directive_forward_calls: ForwardCall[] = (my_directive_result.forward_calls ?? []).map(d => ({
            type: d.type,
            raw_path: d.raw_path,
            call_site_line: d.call_site_line,
            range: d.range,
            source: 'directive' as const,
            is_static: true,
            caller_uri: uri,
            working_directory: effective_working_directory,
        }));

        const all_forward_calls: ForwardCall[] = [
            ...restamped_command_calls,
            ...directive_forward_calls,
        ];

        // Return effective working_directory (file's own or inherited)
        return {
            symbols: my_analysis.symbols,
            directives: my_directive_result.directives,
            forward_calls: all_forward_calls,
            cd_commands: my_analysis.cd_commands,
            working_directory: effective_working_directory,
            working_directory_directive: my_directive_result.working_directory,
            is_standalone: my_directive_result.standalone !== undefined,
            diagnostics: my_directive_result.diagnostics,
        };
    }

    /**
     * Get parsed file from disk with caching.
     * Used for parent files referenced via directives.
     * Returns content along with parsed results so callers can use it for call-site inference
     * without a second disk read. Note: FileCacheEntry does NOT store raw content (per R2.1),
     * but this method returns it transiently for immediate use.
     *
     * @param uri - The file URI
     * @param fs_path - The filesystem path
     * @param options - Optional settings
     * @param options.skip_disk_if_cached - If true, return cached entry without disk read (cache-first mode)
     * @param options.working_directory - Inherited working directory for path resolution in nested files
     * @param options.backward_dependencies - The resolution's effective
     *   backward-dependencies mode (issue #286). Governs ONLY the
     *   registration side effect on the parse path: 'auto' uses the
     *   effective variant (auto-synthesizes DependencyGraph parents when
     *   the file has no explicit directives), 'explicit' registers raw
     *   directives only. Defaults to 'explicit' (the raw pre-#286
     *   behavior) so untracked callers can never synthesize edges from a
     *   mode they did not opt into. Callers inside a resolution must
     *   thread the chain's mode (normalized with ?? 'auto', matching
     *   get_effective_backward_directives). Deliberately NOT part of any
     *   cache key: parsed content is mode-independent.
     * @param options.skip_backward_registration - Probe-only read (#294):
     *   perform NO backward-directive registration and write NO
     *   registered_backward_mode stamp (hit paths also skip the
     *   registration upgrade). Used by resolve_inherited_working_directory,
     *   whose forced-'explicit' walk exists purely for deterministic WD
     *   discovery — letting it register would let a post-eviction reparse
     *   wipe auto-discovered parent edges, and letting it stamp would let
     *   an entry claim a registration that never ran. An unstamped entry
     *   is registered by the next real registering read's hit path (see
     *   upgrade_registration_on_cache_hit).
     */
    async get_parsed_file(
        uri: string,
        fs_path: string,
        options?: { skip_disk_if_cached?: boolean; working_directory?: string; request_cache?: RequestCache; backward_dependencies?: 'auto' | 'explicit'; skip_backward_registration?: boolean }
    ): Promise<ParsedFileResult> {
        // Use request cache if available to avoid duplicate reads/parses in same request
        if (options?.request_cache) {
            // Include working_directory in request cache key because it affects parsing
            const req_key = this.make_file_cache_key(uri, options.working_directory);
            let promise = options.request_cache.get(req_key);
            if (promise) {
                return promise;
            }

            // Create new promise for this file
            promise = this._get_parsed_file_impl(uri, fs_path, options);
            options.request_cache.set(req_key, promise);
            return promise;
        }

        return this._get_parsed_file_impl(uri, fs_path, options);
    }

    /**
     * Build the ParsedFileResult view of a file_cache entry. The single
     * point of copy for every cache-hit return path, so a future
     * ParsedFileResult field cannot be silently dropped on one hit path
     * only (that exact bug shipped once — working_directory_directive was
     * missing from the .do-fallback hit alone; caught on PR #278).
     * `content`/`content_hash` are parameters because the hash-match path
     * returns the freshly read disk content rather than the entry's.
     */
    private cache_entry_to_parsed_result(
        entry: FileCacheEntry,
        content: string,
        content_hash: string
    ): ParsedFileResult {
        return {
            content,
            content_hash,
            symbols: entry.symbols,
            directives: entry.directives,
            forward_calls: entry.forward_calls,
            cd_commands: entry.cd_commands,
            working_directory: entry.working_directory,
            working_directory_directive: entry.working_directory_directive,
            is_standalone: entry.is_standalone,
            diagnostics: entry.diagnostics,
        };
    }

    /**
     * Internal implementation of get_parsed_file
     */
    private async _get_parsed_file_impl(
        uri: string,
        fs_path: string,
        options?: { skip_disk_if_cached?: boolean; working_directory?: string; request_cache?: RequestCache; backward_dependencies?: 'auto' | 'explicit'; skip_backward_registration?: boolean }
    ): Promise<ParsedFileResult> {
        const inherited_wd = options?.working_directory;
        const cache_key = this.make_file_cache_key(uri, inherited_wd);

        // 1. Initial Cache/Stat Check (Avoid Disk Read if possible)
        // peek: a validation probe until one of the hit branches below
        // decides to serve it; served hits touch() to promote (#294).
        const cached = this.file_cache.peek(cache_key);

        // Cache-first mode: return cached entry without disk access if available
        if (options?.skip_disk_if_cached && cached) {
            this.log(`[get_parsed_file] file_cache HIT for ${cache_key} (skip_disk_if_cached)`);
            this.cache_metrics.file.hits++;
            this.file_cache.touch(cache_key);
            if (!options?.skip_backward_registration) {
                this.upgrade_registration_on_cache_hit(
                    uri, cached, options?.backward_dependencies
                );
            }
            return this.cache_entry_to_parsed_result(
                cached, cached.content, cached.content_hash
            );
        }

        // Optimization: check mtime and size if available BEFORE reading content
        let mtimeMs: number | undefined;
        let size: number | undefined;
        if (this.content_provider.stat) {
            const stats = await this.content_provider.stat(uri);
            mtimeMs = stats?.mtimeMs;
            size = stats?.size;

            // Fast Path: mtime and size match bypasses disk read entirely
            if (cached && mtimeMs !== undefined && size !== undefined &&
                cached.mtimeMs !== undefined && cached.mtimeMs === mtimeMs &&
                cached.size !== undefined && cached.size === size) {
                this.cache_metrics.file.hits++;
                this.log(`[get_parsed_file] File cache HIT for ${uri} (mtime match, skipped read)`);
                this.file_cache.touch(cache_key);
                if (!options?.skip_backward_registration) {
                    this.upgrade_registration_on_cache_hit(
                        uri, cached, options?.backward_dependencies
                    );
                }
                return this.cache_entry_to_parsed_result(
                    cached, cached.content, cached.content_hash
                );
            }
        }

        // 2. Read file from content provider (Mtime failed or missing)
        let content: string;
        let actual_uri = uri;

        try {
            content = await this.content_provider.read_file(uri);
        } catch (error) {
            // Try .do fallback if original path doesn't end in .do
            if (!fs_path.endsWith('.do')) {
                const fallback_path = fs_path + '.do';
                const fallback_uri = URI.file(fallback_path).toString();
                try {
                    // Re-check stat/cache for fallback URI before reading
                    if (this.content_provider.stat) {
                        const fallback_stats = await this.content_provider.stat(fallback_uri);
                        const fallback_mtimeMs = fallback_stats?.mtimeMs;
                        const fallback_size = fallback_stats?.size;
                        const fallback_cache_key = this.make_file_cache_key(fallback_uri, inherited_wd);
                        const fallback_cached = this.file_cache.peek(fallback_cache_key);

                        if (fallback_cached && fallback_mtimeMs !== undefined && fallback_size !== undefined &&
                            fallback_cached.mtimeMs !== undefined && fallback_cached.mtimeMs === fallback_mtimeMs &&
                            fallback_cached.size !== undefined && fallback_cached.size === fallback_size) {
                            this.cache_metrics.file.hits++;
                            this.log(`[get_parsed_file] File cache HIT for ${fallback_uri} (mtime match, skipped read)`);
                            this.file_cache.touch(fallback_cache_key);
                            if (!options?.skip_backward_registration) {
                                this.upgrade_registration_on_cache_hit(
                                    fallback_uri,
                                    fallback_cached,
                                    options?.backward_dependencies
                                );
                            }
                            return this.cache_entry_to_parsed_result(
                                fallback_cached,
                                fallback_cached.content,
                                fallback_cached.content_hash
                            );
                        }
                    }

                    content = await this.content_provider.read_file(fallback_uri);
                    actual_uri = fallback_uri;
                } catch {
                    // Both paths failed
                    this.file_cache.delete(cache_key);
                    this.cache_metrics.file.misses++;
                    const original_error = error_message(error);
                    return { error: `${original_error} (also tried ${fallback_path})` };
                }
            } else {
                // Original path ends in .do, no fallback to try
                this.file_cache.delete(cache_key);
                this.cache_metrics.file.misses++;
                return { error: error_message(error) };
            }
        }

        // 3. Final Cache/Hash check (Defensive)
        const actual_cache_key = this.make_file_cache_key(actual_uri, inherited_wd);
        const actual_cached = this.file_cache.peek(actual_cache_key);
        const disk_hash = this.hash_content(content);

        if (actual_cached && actual_cached.content_hash === disk_hash) {
            this.cache_metrics.file.hits++;
            this.log(`[get_parsed_file] File cache HIT for ${actual_uri} (hash match)`);
            this.file_cache.touch(actual_cache_key);
            if (!options?.skip_backward_registration) {
                this.upgrade_registration_on_cache_hit(
                    actual_uri, actual_cached, options?.backward_dependencies
                );
            }
            // Return cached results with current content - don't mutate the
            // entry's cached content/symbols (the registration stamp above
            // is the one intentional entry mutation on this hit path)
            return this.cache_entry_to_parsed_result(
                actual_cached, content, disk_hash
            );
        } else if (actual_cached) {
            this.log(`[get_parsed_file] File cache STALE for ${actual_uri} (cached hash=${actual_cached.content_hash}, disk hash=${disk_hash})`);
            // New content observed without an invalidation event having
            // reached us: purge memo entries that embedded the previous
            // content (same rationale as the parse_file hash-change purge).
            this.forward_scope_resolver
                ?.invalidate_forward_closure_for_uri?.(actual_uri);
        } else {
            this.log(`[get_parsed_file] File cache MISS for ${actual_uri} (no entry)`);
        }

        // 4. Parse and cache
        this.cache_metrics.file.misses++;
        try {
            const parse_result = this.parse_content(actual_uri, content, inherited_wd);

            // Fetch mtime if we don't have it yet for this file
            if (mtimeMs === undefined && this.content_provider.stat) {
                const stats = await this.content_provider.stat(actual_uri);
                mtimeMs = stats?.mtimeMs;
            }

            this.file_cache.set(actual_cache_key, {
                uri: actual_uri,
                content,
                content_hash: disk_hash,
                mtimeMs,
                size: Buffer.byteLength(content, 'utf8'),
                symbols: parse_result.symbols,
                directives: parse_result.directives,
                forward_calls: parse_result.forward_calls,
                cd_commands: parse_result.cd_commands,
                working_directory: parse_result.working_directory,
                working_directory_directive: parse_result.working_directory_directive,
                is_standalone: parse_result.is_standalone,
                diagnostics: parse_result.diagnostics,
                // Stamp the mode the registration below runs under (and
                // upgrade an 'explicit'-registered entry on later
                // auto-mode cache hits (issue #286). A probe-only read
                // (#294) performs no registration and therefore stamps
                // nothing — an entry must never claim a registration that
                // never ran; the next real registering read's hit path
                // registers it (upgrade_registration_on_cache_hit).
                registered_backward_mode: options?.skip_backward_registration
                    ? undefined
                    : (options?.backward_dependencies ?? 'explicit'),
            });

            // Register backward directive dependencies from cached file
            // This ensures transitive dependents are discoverable even when
            // intermediate files are only read from disk (not opened in editor).
            // Uses the EFFECTIVE variant under the resolution's threaded
            // backward_dependencies mode (issue #286): in 'auto' mode a file
            // with no explicit directives keeps (or gains) its DependencyGraph
            // parents instead of having them wiped by this clear-then-register,
            // matching the commit-time effective registration in DocumentStore
            // (issue #184). An unthreaded call defaults to 'explicit', which
            // registers raw directives only — identical to the pre-#286 raw
            // sync, so this can only ADD edges relative to that behavior,
            // with one exception: a `sight: standalone` file's effective
            // directives are EMPTY (issue #208), so its raw done-by edges
            // are deliberately not registered.
            if (!options?.skip_backward_registration) {
                this.apply_backward_directive_registration(
                    actual_uri,
                    parse_result.directives,
                    { backward_dependencies: options?.backward_dependencies ?? 'explicit' },
                    parse_result.is_standalone
                );
            }

            // Register forward call relationships from cached file
            // This ensures callee_to_callers map includes relationships from cached files,
            // not just open documents, enabling proper revalidation when callees change
            this.register_forward_call_relationships_from_cache(actual_uri, parse_result.forward_calls, parse_result.symbols);

            return { content, content_hash: disk_hash, ...parse_result };
        } catch (error) {
            this.warn(`ScopeResolver: Parse error for ${actual_uri}: ${error_message(error)}`);

            // Return empty results on parse failure
            const empty_symbols = create_empty_symbol_table();
            // Recover header facts (directives, standalone, WD directive)
            // via the directive parser — see recover_header_facts.
            const my_recovered = this.recover_header_facts(
                actual_uri, content
            );
            // Register only when the header facts were actually
            // recovered: a failed recovery must leave the previous
            // registrations unchanged (mirroring DocumentStore's
            // undefined-staged-effects semantics), never clear them.
            if (my_recovered.recovered &&
                !options?.skip_backward_registration) {
                this.apply_backward_directive_registration(
                    actual_uri,
                    my_recovered.directives,
                    {
                        backward_dependencies:
                            options?.backward_dependencies ?? 'explicit',
                    },
                    my_recovered.is_standalone
                );
            }
            return {
                content,
                content_hash: disk_hash,
                symbols: empty_symbols,
                directives: my_recovered.directives,
                forward_calls: [],
                cd_commands: [],
                working_directory: undefined,
                working_directory_directive:
                    my_recovered.working_directory_directive,
                is_standalone: my_recovered.is_standalone,
                diagnostics: [{
                    message: `Parse error in file: ${actual_uri}`,
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    severity: 'warning',
                }],
            };
        }
    }

    /**
     * Apply inheritance rules based on directive type.
     * done-by: excludes locals
     * included-by: includes all symbols except program-body locals
     * Returns both filtered symbols and locals excluded due to inheritance rules.
     *
     * Program-body locals never exist at the do-file level of the boundary
     * (issue #271): `included-by` drops them silently (references get the
     * plain undefined warning), and `done-by` omits them from
     * excluded_locals because the "use include instead" remedy would be
     * false advice for them.
     */
    apply_inheritance_rules(
        symbols: SymbolTable,
        directive_type: 'done-by' | 'included-by',
        source_uri: string
    ): { filtered: SymbolTable; excluded_locals: OutOfScopeSymbol[] } {
        // Clone in both branches: `symbols` is the shared file-cache
        // entry and must not be aliased or mutated.
        const filtered = clone_symbol_table(symbols);

        if (directive_type === 'included-by') {
            filtered.localMacros = filter_dofile_locals(symbols.localMacros);
            return { filtered, excluded_locals: [] };
        }

        // done-by: exclude locals and track them
        const excluded_locals: OutOfScopeSymbol[] = [];
        for (const [name, symbol] of symbols.localMacros) {
            if (!is_dofile_local(symbol)) continue;
            excluded_locals.push({
                name,
                type: 'local',
                source_uri,
                defined_line: symbol.location.range.start.line,
                call_site_line: -1, // Not applicable for inheritance exclusion
                reason: 'inheritance_excludes_locals',
            });
        }

        filtered.localMacros = new Map(); // Exclude locals
        return { filtered, excluded_locals };
    }

    /**
     * Filter symbols by call site line.
     * Only includes symbols defined on or before the call site.
     * Returns both filtered symbols and out-of-scope symbols.
     * Note: call_site_line is 0-indexed, matching symbol locations.
     */
    filter_by_call_site(
        symbols: SymbolTable,
        call_site_line: number,
        source_uri: string
    ): { filtered: SymbolTable; out_of_scope: OutOfScopeSymbol[] } {
        const the_out_of_scope: OutOfScopeSymbol[] = [];

        const filter_map = <T extends { location: { range: { start: { line: number } } }; definition_line?: number; name?: string }>(
            map: Map<string, T>,
            symbol_type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix'
        ): Map<string, T> => {
            const filtered = new Map<string, T>();
            for (const [name, symbol] of map) {
                // Filter by the symbol's source (navigation) line, not a
                // diagnostic-only line. Some analyzer symbols (e.g. `args`
                // locals) carry definition_line=0 to mean "visible throughout
                // the program" for in-file diagnostics; that sentinel must not
                // make them look defined at the top of the file for cross-file
                // call-site filtering. Loop-expanded macros set definition_line
                // equal to this line, so they are unaffected.
                const defined_line = symbol.location.range.start.line;
                if (defined_line <= call_site_line) {
                    filtered.set(name, symbol);
                } else {
                    the_out_of_scope.push({
                        name,
                        type: symbol_type,
                        source_uri,
                        defined_line,
                        call_site_line,
                        reason: 'after_call_site',
                    });
                }
            }
            return filtered;
        };

        return {
            filtered: {
                programs: filter_map(symbols.programs, 'program'),
                localMacros: filter_map(symbols.localMacros, 'local'),
                globalMacros: filter_map(symbols.globalMacros, 'global'),
                variables: filter_map(symbols.variables, 'variable'),
                scalars: filter_map(symbols.scalars, 'scalar'),
                matrices: filter_map(symbols.matrices, 'matrix'),
            },
            out_of_scope: the_out_of_scope,
        };
    }

    /**
     * Add out-of-scope symbols with deduplication.
     * If a symbol already exists with reason 'after_call_site' and we're adding
     * with reason 'inheritance_excludes_locals', replace the existing entry.
     *
     * Priority: inheritance_excludes_locals > after_call_site
     */
    private add_out_of_scope_symbols(
        out_of_scope: OutOfScopeSymbol[],
        new_symbols: OutOfScopeSymbol[]
    ): void {
        // Build index once for O(n) lookups instead of O(n²)
        // ASSUMPTION: Within this function, out_of_scope is only modified via push()
        //   and element replacement. No removals or reordering occur.
        const name_to_index = new Map<string, number>();
        for (let i = 0; i < out_of_scope.length; i++) {
            name_to_index.set(out_of_scope[i].name, i);
        }

        for (const new_symbol of new_symbols) {
            const existing_index = name_to_index.get(new_symbol.name);
            if (existing_index === undefined) {
                name_to_index.set(new_symbol.name, out_of_scope.length);
                out_of_scope.push(new_symbol);
            } else if (new_symbol.reason === 'inheritance_excludes_locals' &&
                out_of_scope[existing_index].reason === 'after_call_site') {
                // Replace in-place; name_to_index remains valid since name and index are unchanged
                out_of_scope[existing_index] = new_symbol;
            }
        }
    }

    /**
     * Merge symbol tables with shadowing.
     * Nearer symbols shadow more distant ones.
     */
    merge_with_shadowing(base: SymbolTable, overlay: SymbolTable): SymbolTable {
        const merge_map = <T>(base_map: Map<string, T>, overlay_map: Map<string, T>): Map<string, T> => {
            const merged = new Map(base_map);
            for (const [name, symbol] of overlay_map) {
                merged.set(name, symbol); // Overlay shadows base
            }
            return merged;
        };

        return {
            programs: merge_map(base.programs, overlay.programs),
            localMacros: merge_map(base.localMacros, overlay.localMacros),
            globalMacros: merge_map(base.globalMacros, overlay.globalMacros),
            variables: merge_map(base.variables, overlay.variables),
            scalars: merge_map(base.scalars, overlay.scalars),
            matrices: merge_map(base.matrices, overlay.matrices),
        };
    }

    /**
     * Merge the entire chain with proper shadowing.
     *
     * Precedence rules:
     * - Primary: depth (nearer ancestors override more distant ancestors)
     * - Secondary (same depth): lattermost directive in the referencing file header wins
     * - Current file always overrides inherited symbols
     */
    private merge_chain(chain: ScopeChainEntry[]): SymbolTable {
        if (chain.length === 0) {
            return create_empty_symbol_table();
        }

        const current_entry = chain[0];
        const ancestor_entries = chain.slice(1);

        // Apply distant first, then nearer; within same depth apply earlier directive first
        // so later directives overwrite.
        const sorted_ancestors = [...ancestor_entries].sort((a, b) => {
            // Depth: larger depth (more distant) first
            if (a.depth !== b.depth) {
                return b.depth - a.depth;
            }
            // Same depth: earlier directive first (so lattermost overwrites)
            if (a.directive_order !== b.directive_order) {
                return a.directive_order - b.directive_order;
            }
            // Final deterministic tie-break (should be rare)
            return a.sort_key.localeCompare(b.sort_key);
        });

        let merged = create_empty_symbol_table();
        for (const my_entry of sorted_ancestors) {
            merged = this.merge_with_shadowing(merged, my_entry.symbols);
        }

        // Current file shadows all inherited symbols.
        merged = this.merge_with_shadowing(merged, current_entry.symbols);

        return merged;
    }

    /**
     * Remap diagnostics with source attribution to point to the active file's call site line.
     * This ensures the IDE shows errors at the directive location in the current file,
     * while the message includes the original source file and line information.
     *
     * Rules:
     * a) Diagnostics that already have a range in the active file (matching a directive range) are NOT remapped.
     * b) For diagnostics from parent files, remap to the specific directive that references that parent.
     * c) Keep source attribution message suffixing.
     *
     * @param diagnostics - Array of diagnostics to remap
     * @param directives - Directives from the active file (used to find the call site line)
     * @param active_file_uri - URI of the active file
     * @returns Remapped diagnostics array
     */
    private remap_diagnostics_to_active_file(
        diagnostics: DirectiveDiagnostic[],
        directives: Directive[],
        active_file_uri: string
    ): DirectiveDiagnostic[] {
        if (directives.length === 0) {
            return diagnostics;
        }

        const active_file_basename = path.basename(URI.parse(active_file_uri).fsPath);

        // Build a set of directive ranges for quick lookup (to detect if diagnostic is already at a directive)
        const directive_ranges = new Set(
            directives.map(d => `${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}`)
        );

        // Build a map from parent basename to directive range for targeted remapping
        const parent_to_directive = new Map<string, Range>();
        // URI-keyed variant for diagnostics that carry source_uri: exact
        // identity routing, immune to basename collisions (#208 round 2).
        const parent_uri_to_directive = new Map<string, Range>();
        for (const my_directive of directives) {
            const parent_basename = path.basename(my_directive.path);
            // If multiple directives reference the same parent, use the first one
            if (!parent_to_directive.has(parent_basename)) {
                parent_to_directive.set(parent_basename, my_directive.range);
            }
            const parent_uri = URI.file(my_directive.path).toString();
            if (!parent_uri_to_directive.has(parent_uri)) {
                parent_uri_to_directive.set(parent_uri, my_directive.range);
            }
            // The traversal stamps source_uri with the REAL-CASED URI from
            // compute_directive_real_path (case-only match, .do fallback),
            // which can differ from the parser-resolved directive.path.
            // Key the map through the same chokepoint so the exact lookup
            // cannot miss and silently fall back to basename routing
            // (#208 review round 3).
            const my_real = this.compute_directive_real_path(
                my_directive, active_file_uri
            );
            if (my_real.outcome_kind !== 'ambiguous') {
                const my_real_uri = URI.file(my_real.real_path).toString();
                if (!parent_uri_to_directive.has(my_real_uri)) {
                    parent_uri_to_directive.set(
                        my_real_uri, my_directive.range
                    );
                }
            }
        }

        // Fallback to first directive range if no specific match found
        const first_directive_range = directives[0].range;

        return diagnostics.map(diagnostic => {
            // Only remap diagnostics that have source attribution
            if (!diagnostic.source) {
                return diagnostic;
            }

            // Forward-call diagnostics (from current file) keep their
            // original range. Prefer the URI identity check when the
            // source carries one — a PARENT whose basename happens to
            // equal the active file's must still be remapped (#208 r2).
            if (diagnostic.source.source_uri !== undefined
                ? diagnostic.source.source_uri === active_file_uri
                : diagnostic.source.source_file === active_file_basename) {
                return diagnostic;
            }

            // Build source info: include line number only when source_line is known
            const source_info = diagnostic.source.source_line !== undefined
                ? `: ${diagnostic.source.source_file} line ${diagnostic.source.source_line + 1}`
                : `: ${diagnostic.source.source_file}`;

            // Check if diagnostic range already matches a directive range (rule a)
            const range_key = `${diagnostic.range.start.line}:${diagnostic.range.start.character}:${diagnostic.range.end.line}:${diagnostic.range.end.character}`;
            if (directive_ranges.has(range_key)) {
                // Already at a directive range, just add source info to message if needed
                const updated_message = diagnostic.message.includes(source_info)
                    ? diagnostic.message
                    : `${diagnostic.message}${source_info}`;
                return {
                    ...diagnostic,
                    message: updated_message,
                };
            }

            // Find the specific directive that references the source file
            // (rule b): exact URI match first when available, then the
            // basename map, then the first directive as a last resort.
            const target_range =
                (diagnostic.source.source_uri !== undefined
                    ? parent_uri_to_directive.get(diagnostic.source.source_uri)
                    : undefined) ??
                parent_to_directive.get(diagnostic.source.source_file) ??
                first_directive_range;

            // Update message to include source file and line info (rule c)
            const updated_message = diagnostic.message.includes(source_info)
                ? diagnostic.message
                : `${diagnostic.message}${source_info}`;

            return {
                ...diagnostic,
                message: updated_message,
                range: target_range,
            };
        });
    }

    /**
     * Invalidate scope cache entries that depend on a specific file.
     * Does NOT touch file_cache - use this for in-memory edits (didChange).
     * Also invalidates scope caches for all callers (files that call this file via do/run/include).
     */
    invalidate_scope_cache(uri: string): void {
        // Keep the forward-closure memo in lockstep with scope_cache (#234):
        // any memoized closure that reached this URI is stale with it.
        this.forward_scope_resolver?.invalidate_forward_closure_for_uri?.(uri);

        // Fast path: directly invalidate scope cache for the target URI using secondary index (spec 6.2)
        let num_removed = this.invalidate_scope_cache_for_uri(uri);

        // Cascade: invalidate scope caches that depend on this URI via backward directives
        num_removed += this.cascade_invalidate_scope_cache_for_uri(uri);

        // Also invalidate scope caches for all callers (forward call dependencies)
        // When a callee file changes, all files that call it need their scope cache invalidated
        const caller_set = this.reverse_deps.callee_to_callers.get(uri);
        if (caller_set) {
            for (const my_caller_uri of caller_set) {
                // Use O(1) lookup via secondary index instead of O(N) scan
                num_removed += this.invalidate_scope_cache_for_uri(my_caller_uri);
            }
        }

        this.cache_metrics.scope.invalidations += num_removed;
        // Note: Do NOT touch file_cache here
    }

    /**
     * Invalidate file cache entries for a URI and cascade to scope cache.
     * Use this for on-disk changes (watcher/rename/delete).
     * Removes all cache entries for the URI regardless of working directory.
     * Also invalidates scope caches for all callers (files that call this file via do/run/include).
     *
     * @param uri - The URI to invalidate
     * @param options - Invalidation options
     * @param options.preserve_forward_call_relationships - If true, do not clear forward call relationships.
     *   Use this when the file cache is being invalidated during an update where relationships were just refreshed.
     * @param options.preserve_backward_directive_dependencies - If true, do
     *   not clear the parent→child backward-directive map for this URI. Use
     *   this on document CLOSE (#278): the file still exists on disk and
     *   nothing re-syncs the map until its next parse, so clearing it would
     *   break get_transitive_backward_directive_children for parent edits
     *   until then. The next parse re-syncs (and corrects buffer-era
     *   registrations) via sync_backward_directive_dependencies.
     */
    invalidate_file_cache(uri: string, options?: { preserve_forward_call_relationships?: boolean; preserve_backward_directive_dependencies?: boolean }): void {
        this.log(`[invalidate_file_cache] Invalidating file cache for ${uri}`);
        // Keep the forward-closure memo in lockstep with scope_cache (#234).
        this.forward_scope_resolver?.invalidate_forward_closure_for_uri?.(uri);
        // Delete all file cache entries that start with this URI
        // (handles composite keys like "uri|working_directory")
        let num_deleted = 0;
        for (const key of this.file_cache.keys()) {
            if (key === uri || key.startsWith(uri + '|')) {
                this.log(`[invalidate_file_cache] Deleted cache key: ${key}`);
                this.file_cache.delete(key);
                num_deleted++;
            }
        }
        this.cache_metrics.file.invalidations += num_deleted;

        // Clear backward directive dependencies for this file
        // This maintains consistency between file cache and backward directive map
        if (!options?.preserve_backward_directive_dependencies) {
            this.clear_backward_directive_dependencies(uri);
        }

        // Clear forward call relationships for this file
        // This maintains consistency between file cache and callee_to_callers map
        if (!options?.preserve_forward_call_relationships) {
            this.clear_forward_call_relationships(uri);
        }

        // Fast path: directly invalidate scope cache for the target URI using secondary index (spec 6.2)
        let num_removed = this.invalidate_scope_cache_for_uri(uri);

        // Cascade: invalidate scope caches that depend on this URI via backward directives
        num_removed += this.cascade_invalidate_scope_cache_for_uri(uri);

        // Also invalidate scope caches for all callers (forward call dependencies)
        // When a callee file changes, all files that call it need their scope cache invalidated
        const caller_set = this.reverse_deps.callee_to_callers.get(uri);
        this.log(`[invalidate_file_cache] Invalidate callers for ${uri}. Caller set size: ${caller_set ? caller_set.size : 0}`);
        if (caller_set) {
            for (const my_caller_uri of caller_set) {
                // Use O(1) lookup via secondary index instead of O(N) scan
                num_removed += this.invalidate_scope_cache_for_uri(my_caller_uri);
            }
        }

        this.cache_metrics.scope.invalidations += num_removed;
    }

    /**
     * Get cache metrics for debugging.
     */
    get_cache_metrics(): ScopeCacheMetrics {
        // Return a fully detached snapshot so callers can't mutate internal metrics.
        const snapshot = {
            scope: { ...this.cache_metrics.scope },
            file: { ...this.cache_metrics.file },
        };

        return {
            ...snapshot,
            get hits() { return snapshot.scope.hits; },
            get misses() { return snapshot.scope.misses; },
            get invalidations() { return snapshot.scope.invalidations; },
        };
    }

    /**
     * Live entry-count gauges (#294). Read fresh from the caches at call
     * time — a gauge, not a counter, so it is never reset.
     */
    get_cache_sizes(): ScopeCacheSizes {
        return {
            scope: this.scope_cache.size,
            file: this.file_cache.size,
        };
    }

    /**
     * Reset cache metrics.
     */
    reset_cache_metrics(): void {
        this.cache_metrics = this.create_metrics();
    }

    /**
     * Resolve the real-cased callee URI for a forward call.
     *
     * Mirrors `DependencyGraph.update_caller` exactly so the scope-resolver's
     * own reverse-dependency maps key callees by the same URI the dep-graph
     * uses — required for invalidation to fire on the correct map entry.
     *
     * Algorithm:
     * 1. Derive caller_dir from my_call.caller_uri (an empty string when
     *    no caller URI is available — degrades to relative resolution).
     * 2. Call resolve_forward_call_rich(raw_path, caller_dir, wd, ...)
     *    which computes the WD-joined and script-relative candidates from
     *    raw_path.
     *    - exact or case_only  → use the real-cased path
     *    - ambiguous or missing → key by my_outcome.requested (WD path)
     * Empty workspace_roots → plain-existence semantics (no case handling),
     * matching the old early-startup behavior.
     */
    private resolve_callee_uri(
        my_call: ForwardCall,
        caller_uri_override?: string,
    ): string {
        // Resolve the callee URI through the single shared helper so
        // scope-resolver reverse-dep keys agree with dep-graph and
        // forward-scope-resolver. Pass caller_dir (derived from the
        // caller URI, never a pre-joined path) so the WD-join and
        // script-relative candidates are computed from raw_path,
        // regardless of which producer wrote the call. Empty
        // workspace_roots → plain-existence semantics (no case handling),
        // matching the old early-startup behavior.
        // Prefer the explicit override (passed by methods that know the
        // caller), then the call's own caller_uri.
        const my_effective_caller_uri =
            caller_uri_override ?? my_call.caller_uri;
        const my_caller_dir = my_effective_caller_uri
            ? path.dirname(URI.parse(my_effective_caller_uri).fsPath)
            : '';
        const my_outcome = resolve_forward_call_rich(
            my_call.raw_path,
            my_caller_dir,
            my_call.working_directory,
            {
                workspace_roots: this.workspace_roots,
                fs: this.resolve_fs,
            },
        );
        // exact/case_only → real-cased path; ambiguous/missing → the
        // WD-joined `requested` path (shared with dep-graph keying).
        return URI.file(outcome_fs_path(my_outcome)).toString();
    }

    /**
     * Compute the diff between old and new forward calls, operating on
     * pre-resolved `{call, resolved_uri}` pairs so that each callee URI is
     * computed ONCE and shared between the diff logic and the map mutations.
     *
     * Accepting pre-resolved pairs satisfies the single-resolved-URI
     * invariant: the same URI used to key `caller_to_callees` /
     * `callee_to_callers` is stored in `last_forward_calls`, with no
     * secondary filesystem resolution for either old or new entries.
     */
    private compute_call_edge_diff(
        old_stored: Array<{ call: ForwardCall; resolved_uri: string }>,
        new_stored: Array<{ call: ForwardCall; resolved_uri: string }>,
    ): CallEdgeDiff {
        const old_by_callee = new Map<string, CallEdge[]>();
        const new_by_callee = new Map<string, CallEdge[]>();

        // Group old entries by their pre-resolved callee URI.
        for (const my_entry of old_stored) {
            const edges = old_by_callee.get(my_entry.resolved_uri) ?? [];
            edges.push({
                call_type: my_entry.call.type,
                call_site_line: my_entry.call.call_site_line,
            });
            old_by_callee.set(my_entry.resolved_uri, edges);
        }

        // Group new entries by their pre-resolved callee URI.
        for (const my_entry of new_stored) {
            const edges = new_by_callee.get(my_entry.resolved_uri) ?? [];
            edges.push({
                call_type: my_entry.call.type,
                call_site_line: my_entry.call.call_site_line,
            });
            new_by_callee.set(my_entry.resolved_uri, edges);
        }

        const diff: CallEdgeDiff = {
            added: new Map(),
            removed: new Map(),
            modified: new Map(),
        };

        // Find added and modified
        for (const [my_uri, new_edges] of new_by_callee) {
            const old_edges = old_by_callee.get(my_uri);
            if (!old_edges) {
                diff.added.set(my_uri, new_edges);
            } else if (!this.edges_equal(old_edges, new_edges)) {
                diff.modified.set(my_uri, { old_edges, new_edges });
            }
        }

        // Find removed
        for (const [my_uri, old_edges] of old_by_callee) {
            if (!new_by_callee.has(my_uri)) {
                diff.removed.set(my_uri, old_edges);
            }
        }

        return diff;
    }

    /**
     * Check if two arrays of call edges are equal.
     */
    private edges_equal(a: CallEdge[], b: CallEdge[]): boolean {
        if (a.length !== b.length) return false;
        const sorted_a = [...a].sort((x, y) => x.call_site_line - y.call_site_line || x.call_type.localeCompare(y.call_type));
        const sorted_b = [...b].sort((x, y) => x.call_site_line - y.call_site_line || x.call_type.localeCompare(y.call_type));
        for (let i = 0; i < sorted_a.length; i++) {
            if (sorted_a[i].call_type !== sorted_b[i].call_type || sorted_a[i].call_site_line !== sorted_b[i].call_site_line) {
                return false;
            }
        }
        return true;
    }

    /**
     * Update reverse dependencies when a document's forward calls or interface changes.
     * Returns the set of affected callee URIs and whether the interface changed.
     * Uses dual interface hashing: do_hash for do/run callees, include_hash for include callees.
     */
    update_reverse_dependencies(
        caller_uri: string,
        new_forward_calls: ForwardCall[],
        new_symbols: SymbolTable
    ): { affected_callees: Set<string>; interface_changed: boolean } {
        // old_stored carries the pre-resolved callee URIs from the previous
        // registration — use them as-is so we NEVER re-resolve old calls from
        // the filesystem (the callee may already be deleted or renamed).
        const old_stored =
            this.reverse_deps.last_forward_calls.get(caller_uri) ?? [];

        // Precompute new_stored ONCE (resolve each new call exactly once),
        // before diffing, so the same URI is used in both the diff and
        // the map mutations and last_forward_calls write.
        const new_stored: Array<{ call: ForwardCall; resolved_uri: string }> =
            new_forward_calls
                .filter(is_resolvable_static_call)
                .map(c => ({
                    call: c,
                    resolved_uri: this.resolve_callee_uri(c, caller_uri),
                }));

        // Compute diff using pre-resolved pairs — no secondary filesystem
        // resolution for either old or new entries.
        const diff = this.compute_call_edge_diff(old_stored, new_stored);

        // Commit the new stored list.
        this.reverse_deps.last_forward_calls.set(caller_uri, new_stored);

        // Compute dual interface hashes
        const old_hashes = this.reverse_deps.interface_hashes.get(caller_uri);
        const new_hashes = this.compute_dual_interface_hash(new_symbols);
        const do_hash_changed = old_hashes?.do_hash !== new_hashes.do_hash;
        const include_hash_changed = old_hashes?.include_hash !== new_hashes.include_hash;
        const interface_changed = do_hash_changed || include_hash_changed;
        this.reverse_deps.interface_hashes.set(caller_uri, new_hashes);

        // Collect affected callees
        const affected_callees = new Set<string>();

        // Process removed callees
        for (const [my_callee_uri] of diff.removed) {
            affected_callees.add(my_callee_uri);
            // Remove from caller_to_callees
            const callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
            if (callee_map) {
                callee_map.delete(my_callee_uri);
                if (callee_map.size === 0) {
                    this.reverse_deps.caller_to_callees.delete(caller_uri);
                }
            }
            // Remove from callee_to_callers
            const caller_set = this.reverse_deps.callee_to_callers.get(my_callee_uri);
            if (caller_set) {
                caller_set.delete(caller_uri);
                if (caller_set.size === 0) {
                    this.reverse_deps.callee_to_callers.delete(my_callee_uri);
                }
            }
        }

        // Process added callees
        for (const [my_callee_uri, edges] of diff.added) {
            this.log(`[update_reverse_dependencies] Added callee ${my_callee_uri} for caller ${caller_uri}`);
            affected_callees.add(my_callee_uri);
            // Add to caller_to_callees
            let callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
            if (!callee_map) {
                callee_map = new Map();
                this.reverse_deps.caller_to_callees.set(caller_uri, callee_map);
            }
            callee_map.set(my_callee_uri, edges);
            // Add to callee_to_callers
            let caller_set = this.reverse_deps.callee_to_callers.get(my_callee_uri);
            if (!caller_set) {
                caller_set = new Set();
                this.reverse_deps.callee_to_callers.set(my_callee_uri, caller_set);
            }
            caller_set.add(caller_uri);
        }

        // Process modified callees
        for (const [my_callee_uri, { new_edges }] of diff.modified) {
            affected_callees.add(my_callee_uri);
            // Update caller_to_callees
            let callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
            if (!callee_map) {
                callee_map = new Map();
                this.reverse_deps.caller_to_callees.set(caller_uri, callee_map);
            }
            callee_map.set(my_callee_uri, new_edges);
        }

        // If interface changed, add callees based on their effective call type
        if (interface_changed) {
            const callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
            if (callee_map) {
                for (const [my_callee_uri, edges] of callee_map) {
                    // Determine effective call type: include if any edge is include, else do
                    const has_include = edges.some(e => e.call_type === 'include');
                    const effective_type = has_include ? 'include' : 'do';

                    // Only invalidate if the relevant hash changed
                    if (effective_type === 'include' && include_hash_changed) {
                        affected_callees.add(my_callee_uri);
                    } else if (effective_type === 'do' && do_hash_changed) {
                        affected_callees.add(my_callee_uri);
                    }
                }
            }
        }

        return { affected_callees, interface_changed };
    }

    /**
     * Clear all caches.
     */
    clear_cache(): void {
        const scope_cache_size = this.scope_cache.size;
        const file_cache_size = this.file_cache.size;

        this.scope_cache.clear();
        this.uri_to_cache_keys.clear();
        this.file_cache.clear();
        // Keep the forward-closure memo in lockstep (#234).
        this.forward_scope_resolver?.clear_forward_closure_memo?.();

        this.cache_metrics.scope.invalidations += scope_cache_size;
        this.cache_metrics.file.invalidations += file_cache_size;
    }

    /**
     * Clear all reverse dependency maps and backward directive children.
     * Called from refresh_workspace_state() when workspace folders change,
     * so stale caller/callee edges from the old workspace are discarded.
     */
    reset_reverse_deps(): void {
        this.reverse_deps.caller_to_callees.clear();
        this.reverse_deps.callee_to_callers.clear();
        this.reverse_deps.interface_hashes.clear();
        this.reverse_deps.last_forward_calls.clear();
        this.backward_directive_children.clear();
    }

    /**
     * Remove all reverse dependency entries where the given URI is a caller.
     * Called when a document is closed.
     */
    remove_caller_from_reverse_deps(caller_uri: string): void {
        // Get all callees for this caller
        const callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
        if (callee_map) {
            // Remove this caller from each callee's caller set
            for (const my_callee_uri of callee_map.keys()) {
                const caller_set = this.reverse_deps.callee_to_callers.get(my_callee_uri);
                if (caller_set) {
                    caller_set.delete(caller_uri);
                    if (caller_set.size === 0) {
                        this.reverse_deps.callee_to_callers.delete(my_callee_uri);
                    }
                }
            }
            // Remove the caller entry
            this.reverse_deps.caller_to_callees.delete(caller_uri);
        }

        // Remove interface hash
        this.reverse_deps.interface_hashes.delete(caller_uri);

        // Remove last forward calls
        this.reverse_deps.last_forward_calls.delete(caller_uri);
    }

    /**
     * Remove all reverse dependency entries where the given URI appears as caller or callee.
     * Called when a file is deleted.
     */
    remove_uri_from_reverse_deps(uri: string): void {
        // Remove as caller
        this.remove_caller_from_reverse_deps(uri);

        // Remove as callee from all callers
        const caller_set = this.reverse_deps.callee_to_callers.get(uri);
        if (caller_set) {
            for (const my_caller_uri of caller_set) {
                const callee_map = this.reverse_deps.caller_to_callees.get(my_caller_uri);
                if (callee_map) {
                    callee_map.delete(uri);
                    if (callee_map.size === 0) {
                        this.reverse_deps.caller_to_callees.delete(my_caller_uri);
                    }
                }
                // Also update last_forward_calls to remove calls to the
                // deleted file. Use the stored resolved_uri (recorded at
                // registration time, while the callee still existed on disk)
                // rather than re-resolving via the filesystem — the file is
                // now gone so re-resolution would return the wrong-cased URI
                // and leave a stale entry.
                const last_stored = this.reverse_deps.last_forward_calls.get(my_caller_uri);
                if (last_stored) {
                    const filtered_stored = last_stored.filter(
                        e => e.resolved_uri !== uri,
                    );
                    if (filtered_stored.length !== last_stored.length) {
                        this.reverse_deps.last_forward_calls.set(
                            my_caller_uri,
                            filtered_stored,
                        );
                    }
                }
            }
            this.reverse_deps.callee_to_callers.delete(uri);
        }
    }

    /**
     * Invalidate scope caches for a set of callee URIs.
     * Does NOT invalidate file parse caches since callee content hasn't changed.
     */
    private invalidate_callee_scope_caches(uris: Set<string>): void {
        for (const my_uri of uris) {
            // Keep the forward-closure memo in lockstep (#234).
            this.forward_scope_resolver
                ?.invalidate_forward_closure_for_uri?.(my_uri);
            // Find and remove all scope cache entries that depend on this URI
            const keys_to_remove: string[] = [];
            for (const [cache_key, entry] of this.scope_cache) {
                if (entry.dependent_uris.has(my_uri)) {
                    keys_to_remove.push(cache_key);
                }
            }
            for (const my_key of keys_to_remove) {
                this.scope_cache.delete(my_key);
                this.prune_uri_to_cache_keys_for_key(my_key);
                this.cache_metrics.scope.invalidations++;
            }
        }
    }

    /**
     * Get call edges from a caller to a callee from the reverse dependency index.
     * Returns undefined if no edges exist.
     */
    get_call_edges(caller_uri: string, callee_uri: string): CallEdge[] | undefined {
        const callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
        if (!callee_map) return undefined;
        return callee_map.get(callee_uri);
    }

    /**
     * Cascade invalidation to dependents when a file's scope changes.
     * If a callee's resolved scope changes, propagate to its own dependents.
     * Uses visited set to prevent infinite loops in cyclic dependencies.
     */
    cascade_invalidate(
        uris: Set<string>,
        visited: Set<string> = new Set(),
        max_depth: number = 10
    ): void {
        if (max_depth <= 0) {
            this.warn('cascade_invalidate: max depth reached, stopping propagation');
            return;
        }

        // Invalidate scope caches for the given URIs
        this.invalidate_callee_scope_caches(uris);

        // Find URIs that depend on the invalidated URIs (transitive propagation)
        const next_level = new Set<string>();
        for (const my_uri of uris) {
            if (visited.has(my_uri)) continue;
            visited.add(my_uri);

            // Check if this URI is also a caller (has dependents)
            const callee_map = this.reverse_deps.caller_to_callees.get(my_uri);
            if (callee_map) {
                for (const my_callee_uri of callee_map.keys()) {
                    if (!visited.has(my_callee_uri)) {
                        next_level.add(my_callee_uri);
                    }
                }
            }
        }

        // Recursively propagate if there are more dependents
        if (next_level.size > 0) {
            this.cascade_invalidate(next_level, visited, max_depth - 1);
        }
    }

    /**
     * Get all caller URIs for a given callee URI.
     * Returns an empty set if no callers exist.
     */
    get_callers_for_callee(callee_uri: string): Set<string> {
        const caller_set = this.reverse_deps.callee_to_callers.get(callee_uri);
        return caller_set ? new Set(caller_set) : new Set();
    }

    /**
     * Get the callee-to-callers map for transitive caller discovery.
     * @returns Map from callee URI to set of caller URIs
     */
    get_callee_to_callers_map(): Map<string, Set<string>> {
        return this.reverse_deps.callee_to_callers;
    }

    /**
     * Sync backward directive dependencies for a child file using a set of directives.
     * This is a helper for callers (e.g., DocumentStore) that already parsed directives
     * and want to register dependencies without doing a full scope resolve.
     */
    sync_backward_directive_dependencies(child_uri: string, directives: Directive[]): void {
        // Raw-sync helper: deliberately bypasses BOTH auto-discovery and the
        // standalone gate (issue #208) — it registers exactly the directives
        // given, unlike the effective-directive chokepoint. A future caller
        // must not assume it is standalone-aware.
        // Normalize directives to match resolve() behavior (handles done-by + included-by collisions)
        const normalized = this.normalize_directives(directives, []);
        this.apply_normalized_backward_directives(child_uri, normalized);
    }

    /**
     * Effective-directive variant of sync_backward_directive_dependencies:
     * consults get_effective_backward_directives (auto-synthesizes parents
     * from the DependencyGraph when the file has no explicit directives and
     * backward_dependencies is 'auto'). Canonical entry point for
     * DocumentStore's commit-time cross-file side-effect application
     * (issue #184) — registers without requiring a full resolve() call, and
     * reads live DependencyGraph state at call time.
     */
    apply_backward_directive_registration(
        child_uri: string,
        raw_directives: Directive[],
        config: Partial<ScopeResolverConfig>,
        is_standalone: boolean
    ): void {
        const my_config = { ...DEFAULT_CONFIG, ...config };
        const { directives: effective_directives } =
            this.get_effective_backward_directives(
                child_uri, raw_directives, my_config, is_standalone
            );
        const normalized = this.normalize_directives(effective_directives, []);
        this.apply_normalized_backward_directives(child_uri, normalized);
    }

    /**
     * Registration upgrade on file-cache hit (issue #286). Hit paths do
     * not re-parse, so an entry whose last parse-path registration ran
     * under 'explicit' would leave a directive-less file's
     * dependency-graph parents unregistered for as long as 'auto'-mode
     * resolutions keep hitting the cache (until the content changes).
     * (The indexer's forced-'explicit' working-directory walk used to
     * prime such entries; since #294 it is probe-only — it neither
     * registers nor stamps, so entries it writes arrive here UNSTAMPED
     * and are healed by the first real registering read of either mode.)
     * When an 'auto'-mode read hits such an entry, apply effective
     * registration and stamp the entry so repeat hits are free.
     * Effective ⊇ raw (except for `sight: standalone` files, whose
     * effective directives are empty, issue #208), so upgrading can only
     * add edges. Explicit-mode hits never downgrade: for them hit paths
     * stay side-effect-free, as before.
     *
     * Directive-less auto-mode hits always re-sync idempotently. The
     * file_cache may hold multiple entries for the same URI (different
     * inherited working directories), while backward registration is one
     * global map per URI; another cache-key variant can replace that map
     * without changing this entry's stamp or the DependencyGraph version.
     *
     * Entries whose cached content has explicit directives can still use
     * the stamp: effective registration is graph-independent for them
     * (explicit directives win), and another same-content cache variant
     * registers the same raw directives.
     */
    private upgrade_registration_on_cache_hit(
        uri: string,
        cached: {
            directives: Directive[];
            is_standalone: boolean;
            registered_backward_mode?: 'auto' | 'explicit';
        },
        requested_mode: 'auto' | 'explicit' | undefined
    ): void {
        if (requested_mode !== 'auto') {
            // Explicit-mode hits stay side-effect-free for STAMPED entries
            // (never downgrade), as before. An UNSTAMPED entry, however,
            // carries no proof any registration ever ran — it may have
            // been written by a probe-only read (#294,
            // skip_backward_registration) — so a genuine explicit-mode hit
            // must self-heal it: register raw directives and stamp, the
            // same effect an explicit-mode parse would have had.
            if (requested_mode === 'explicit' &&
                cached.registered_backward_mode === undefined) {
                this.apply_backward_directive_registration(
                    uri, cached.directives,
                    { backward_dependencies: 'explicit' },
                    cached.is_standalone
                );
                cached.registered_backward_mode = 'explicit';
            }
            return;
        }
        if (cached.directives.length > 0 &&
            cached.registered_backward_mode === 'auto') {
            return;
        }
        this.apply_backward_directive_registration(uri, cached.directives, {
            backward_dependencies: 'auto',
        }, cached.is_standalone);
        cached.registered_backward_mode = 'auto';
    }

    /**
     * Re-sync a file's backward-directive edges from its ON-DISK content
     * (issue #184). Used by the server's close handler: a reparse racing a
     * close is discarded by commit_state, so when a user saves a header
     * change and closes immediately, nothing else re-syncs this file's
     * child→parent edges until its next parse. Best-effort: read/parse
     * failures keep the existing edges (can't know disk state, and wiping
     * would reintroduce the #278 flicker); a missing file clears them.
     *
     * @param should_apply - checked after the disk read, immediately before
     *   the synchronous registration; return false to skip (e.g. the
     *   document was reopened while the read was in flight, so the
     *   buffer-based commit-time registration must win).
     * @returns true when registration was applied, false when skipped
     *   (read error or should_apply veto) — callers use this to decide
     *   whether dependents need revalidation.
     */
    async resync_backward_directive_dependencies_from_disk(
        child_uri: string,
        config: Partial<ScopeResolverConfig> = {},
        should_apply?: () => boolean
    ): Promise<boolean> {
        let raw_directives: Directive[] = [];
        let disk_is_standalone = false;
        try {
            const file_exists = await this.content_provider.exists(child_uri);
            if (file_exists) {
                const disk_content =
                    await this.content_provider.read_file(child_uri);
                const disk_parse = this.directive_parser.parse(
                    disk_content, child_uri
                );
                raw_directives = disk_parse.directives;
                disk_is_standalone = disk_parse.standalone !== undefined;
            }
        } catch {
            return false;
        }
        if (should_apply && !should_apply()) {
            return false;
        }
        this.apply_backward_directive_registration(
            child_uri, raw_directives, config, disk_is_standalone
        );
        return true;
    }

    /**
     * The single mutation point for per-child entries of
     * backward_directive_children: clear the child's existing edges, then
     * register one edge per normalized directive. Uses real-cased URIs (M3)
     * so edits to the real file invalidate the right scope-cache entries
     * even when the directive uses a different casing.
     */
    private apply_normalized_backward_directives(
        child_uri: string,
        normalized_directives: Directive[]
    ): void {
        this.clear_backward_directive_dependencies(child_uri);
        for (const my_directive of normalized_directives) {
            const my_real = this.compute_directive_real_path(
                my_directive, child_uri,
            );
            // Ambiguous outcome → two or more case-insensitive matches on
            // disk; no concrete parent can be chosen, so skip registration.
            if (my_real.outcome_kind === 'ambiguous') {
                continue;
            }
            const my_parent_uri = URI.file(my_real.real_path).toString();
            this.register_backward_directive_dependency(child_uri, my_parent_uri);
        }
    }

    /**
     * Register a backward directive dependency.
     * Called when a child file uses @lsp-done-by or @lsp-included-by to depend on a parent.
     * @param child_uri - The URI of the child file (the one with the directive)
     * @param parent_uri - The URI of the parent file (the one being referenced)
     */
    register_backward_directive_dependency(child_uri: string, parent_uri: string): void {
        let children = this.backward_directive_children.get(parent_uri);
        if (!children) {
            children = new Set();
            this.backward_directive_children.set(parent_uri, children);
        }
        children.add(child_uri);
        this.log(`[backward-deps] Registered: ${child_uri} depends on ${parent_uri}`);
    }

    /**
     * Clear all backward directive dependencies for a child file.
     * Called before re-registering dependencies when a file is re-parsed.
     * @param child_uri - The URI of the child file
     */
    clear_backward_directive_dependencies(child_uri: string): void {
        // Remove this child from all parent entries
        for (const [parent_uri, children] of this.backward_directive_children) {
            if (children.has(child_uri)) {
                children.delete(child_uri);
                if (children.size === 0) {
                    this.backward_directive_children.delete(parent_uri);
                }
            }
        }
    }

    /**
     * Get all child URIs that depend on a parent via backward directives.
     * @param parent_uri - The URI of the parent file
     * @returns Set of child URIs that depend on this parent
     */
    get_backward_directive_children(parent_uri: string): Set<string> {
        const children = this.backward_directive_children.get(parent_uri);
        return children ? new Set(children) : new Set();
    }

    /**
     * Get all files that transitively depend on a parent file via backward directives.
     * Uses BFS to traverse the dependency graph with cycle detection.
     * @param parent_uri - The URI of the parent file
     * @param max_depth - Maximum chain depth (default: config.max_chain_depth)
     * @returns Set of all transitive dependent URIs
     */
    get_transitive_backward_directive_children(
        parent_uri: string,
        max_depth: number = DEFAULT_CONFIG.max_chain_depth
    ): Set<string> {
        const result = new Set<string>();
        const visited = new Set<string>([parent_uri]);
        const queue: string[] = [parent_uri];
        let depth = 0;

        while (queue.length > 0 && depth < max_depth) {
            const level_size = queue.length;

            for (let i = 0; i < level_size; i++) {
                const current = queue.shift()!;
                const direct_children = this.backward_directive_children.get(current);

                if (direct_children) {
                    for (const my_child of direct_children) {
                        if (!visited.has(my_child)) {
                            visited.add(my_child);
                            result.add(my_child);
                            queue.push(my_child);
                        }
                    }
                }
            }

            depth++;
        }

        return result;
    }

    /**
     * Register forward call relationships from a cached file's forward calls.
     * Called when a file is added to the file cache to ensure the callee_to_callers
     * map includes relationships from cached files, not just open documents.
     *
     * @param caller_uri - The URI of the file whose forward calls are being registered
     * @param forward_calls - The parsed forward calls from the file
     */
    private register_forward_call_relationships_from_cache(
        caller_uri: string,
        forward_calls: ForwardCall[],
        symbols: SymbolTable
    ): void {
        // Clear existing relationships for this caller first
        this.clear_forward_call_relationships(caller_uri);

        // Build caller_to_callees map: callee_uri -> CallEdge[]
        const callee_edges_map = new Map<string, CallEdge[]>();

        // Register each callee relationship. Compute the callee URI ONCE per
        // call and reuse it for all maps and last_forward_calls — no redundant
        // resolve_callee_uri calls.
        const the_stored: Array<{ call: ForwardCall; resolved_uri: string }> = [];
        for (const my_call of forward_calls) {
            // Skip dynamic (macro) calls and degenerate empty-path calls.
            if (!is_resolvable_static_call(my_call)) {
                continue;
            }

            // Use real-cased URI (via resolve_callee_uri) so this map keys
            // callees the same way dependency-graph does — required for
            // invalidation to fire when the real-cased callee changes.
            const my_callee_uri = this.resolve_callee_uri(my_call, caller_uri);
            const edge: CallEdge = {
                call_type: my_call.type,
                call_site_line: my_call.call_site_line,
            };

            // Add to callee_to_callers
            let caller_set = this.reverse_deps.callee_to_callers.get(my_callee_uri);
            if (!caller_set) {
                caller_set = new Set();
                this.reverse_deps.callee_to_callers.set(my_callee_uri, caller_set);
            }
            caller_set.add(caller_uri);

            // Accumulate edges for caller_to_callees
            let edges = callee_edges_map.get(my_callee_uri);
            if (!edges) {
                edges = [];
                callee_edges_map.set(my_callee_uri, edges);
            }
            edges.push(edge);

            // Collect for last_forward_calls (avoids second resolve_callee_uri call)
            the_stored.push({ call: my_call, resolved_uri: my_callee_uri });

            this.log(`[forward-call-cache] Registered: ${caller_uri} calls ${my_callee_uri}`);
        }

        // Store in caller_to_callees map (spec 5.1)
        if (callee_edges_map.size > 0) {
            this.reverse_deps.caller_to_callees.set(caller_uri, callee_edges_map);
        }

        // Store forward_calls for diff computation (spec 5.4), paired with
        // the resolved callee URI (captured inside the loop above so we do
        // not call resolve_callee_uri a second time).
        this.reverse_deps.last_forward_calls.set(caller_uri, the_stored);

        // Compute and store interface hash
        const interface_hash = this.compute_dual_interface_hash(symbols);
        this.reverse_deps.interface_hashes.set(caller_uri, interface_hash);
    }

    /**
     * Clear forward call relationships where the given URI is the caller.
     * Called before re-registering relationships when a file is re-parsed,
     * and when a file's cache is invalidated.
     *
     * Uses caller_to_callees for O(M) clearing where M = number of callees.
     *
     * @param caller_uri - The URI of the caller file
     */
    private clear_forward_call_relationships(caller_uri: string): void {
        // Get callees from caller_to_callees for O(M) lookup (spec 6.1)
        const callee_map = this.reverse_deps.caller_to_callees.get(caller_uri);
        if (callee_map) {
            // For each callee, remove caller from callee_to_callers
            for (const my_callee_uri of callee_map.keys()) {
                const caller_set = this.reverse_deps.callee_to_callers.get(my_callee_uri);
                if (caller_set) {
                    caller_set.delete(caller_uri);
                    if (caller_set.size === 0) {
                        this.reverse_deps.callee_to_callers.delete(my_callee_uri);
                    }
                }
            }
            // Delete the caller_to_callees entry
            this.reverse_deps.caller_to_callees.delete(caller_uri);
        }

        // Delete the interface_hashes entry (prevents ghosting on file delete/recreate)
        this.reverse_deps.interface_hashes.delete(caller_uri);

        // Delete the last_forward_calls entry
        this.reverse_deps.last_forward_calls.delete(caller_uri);
    }

    /**
     * Get debug info about the reverse dependencies state.
     * Used for debugging caller revalidation issues.
     */
    get_reverse_deps_debug_info(): string {
        const lines: string[] = [];
        lines.push(`callee_to_callers (${this.reverse_deps.callee_to_callers.size} entries):`);
        for (const [callee_uri, caller_set] of this.reverse_deps.callee_to_callers) {
            lines.push(`  ${callee_uri}: [${Array.from(caller_set).join(', ')}]`);
        }
        lines.push(`caller_to_callees (${this.reverse_deps.caller_to_callees.size} entries):`);
        for (const [caller_uri, callee_map] of this.reverse_deps.caller_to_callees) {
            const callees = Array.from(callee_map.keys());
            lines.push(`  ${caller_uri}: [${callees.join(', ')}]`);
        }
        lines.push(`backward_directive_children (${this.backward_directive_children.size} entries):`);
        for (const [parent_uri, children] of this.backward_directive_children) {
            lines.push(`  ${parent_uri}: [${Array.from(children).join(', ')}]`);
        }
        return lines.join('\n');
    }

    /**
     * Dispose the scope resolver by clearing all caches and reverse
     * dependency maps. Called during server shutdown to release memory.
     */
    dispose(): void {
        this.clear_cache();
        this.reset_reverse_deps();
    }

}
