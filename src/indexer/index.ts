/**
 * Workspace Indexer for Sight
 *
 * Scans workspace and ado-path directories to build a symbol index.
 */

import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import {
    SymbolTable,
    ProgramSymbol,
    MacroSymbol,
    VariableSymbol,
    IndexerMetrics,
    StataLSPConfig,
    ScopeResolverConfig,
    Directive,
    ScalarSymbol,
    MatrixSymbol,
    Token,
    ContextRange,
    ForwardCall,
    WorkspaceSymbolMatch,
} from '../types';
import { DependencyGraph, type GraphUpdateResult } from '../dependency-graph';
import { StataLexer } from '../lexer';
import { StataParser } from '../parser';
import {
    SemanticAnalyzer,
    create_empty_symbol_table,
    merge_symbol_tables
} from '../analyzer';
import { DirectiveParser } from '../directive-parser';
import {
    ScopeResolver,
    build_scope_resolver_config,
    scope_resolver_config_for,
} from '../scope-resolver';
import { ContextTracker } from '../context-tracker';
import { logger } from '../utils/logger';
import { is_safe_include_name } from '../utils/include-expander';
import { compute_line_offsets } from '../utils/line-utils';
import {
    get_workspace_root_for_path,
    resolve_working_directory_directive,
} from '../utils/workspace-roots';
import { discover_stata_ado_paths } from '../utils/stata-install-paths';
import {
    FindaliasResolver,
    HelpAliasResolver,
} from '../utils/findalias-resolver';
import {
    hasStataExtension,
    VCS_METADATA_DIRS,
    build_cd_timeline,
    apply_cd_timeline,
} from '../utils/file-path-utils';
import { entry_is_file_async } from '../utils/symlink-aware-entry';
import {
    create_exclude_matcher,
    type ExcludeMatcher,
} from '../utils/exclude-matcher';

const MAX_PARALLEL = 4;
const YIELD_INTERVAL_MS = 100;
const INDEX_DEBOUNCE_MS = 200;

export interface IndexedFileData {
    uri: string;
    tokens: Token[];
    context_ranges?: ContextRange[];
}

/**
 * Workspace Indexer for Sight.
 */
export class WorkspaceIndexer {
    private symbol_index: Map<string, { symbols: SymbolTable; directives: Directive[] }> = new Map();
    // Overlay of backward directives parsed from unsaved buffers. When
    // present for a URI, these replace the on-disk directives in
    // `get_related_uris` so parent/child relationships reflect the live
    // editor state rather than the last saved version.
    private buffer_directives_overlay: Map<string, Directive[]> = new Map();
    private token_index: Map<string, Token[]> = new Map();
    private context_ranges_index: Map<string, ContextRange[]> = new Map();
    private enabled = true;
    private lexer = new StataLexer();
    private parser = new StataParser();
    private analyzer = new SemanticAnalyzer();
    private directive_parser = new DirectiveParser();
    private ado_paths: string[] = [];
    // Auto-discovered Stata install / user ado directories used ONLY
    // for `.sthlp` help-file lookup. Deliberately kept separate from
    // `ado_paths` so the workspace scanner doesn't recursively index
    // the thousands of built-in ado files under `ado/base`. Populated
    // once during initialize and mutated via `set_help_search_paths`
    // for tests.
    private help_search_paths: string[] = [];
    // Shared FindaliasResolver that consults the same search dirs used
    // by `resolve_sthlp_file` (ado_paths ∪ workspace roots ∪ help_search_paths).
    // Its `set_search_dirs` call is a no-op when the list is unchanged,
    // so callers can refresh it cheaply on every lookup.
    private findalias_resolver = new FindaliasResolver();
    // Parallel HelpAliasResolver consulted inside `resolve_sthlp_file`
    // to handle Stata's `<topic>` → `<other_topic>` redirects that
    // ship in `*help_alias.maint` files (e.g. `operators` → `operator`).
    private help_alias_resolver = new HelpAliasResolver();
    private dependency_graph?: DependencyGraph;
    private metrics: IndexerMetrics = {
        files_indexed: 0,
        files_skipped: 0,
        total_index_time_ms: 0,
        avg_file_time_ms: 0,
    };
    private cancelled = false;
    private size_threshold_bytes: number = 512 * 1024; // 500KB default
    private exclude_matcher: ExcludeMatcher = create_exclude_matcher([]);
    private skipped_files: Map<string, number> = new Map();
    private max_indexed_files: number = 1000;
    private max_files_reached = false;
    private version: number = 0;
    private scan_generation: number = 0;

    // Debouncing state for file updates
    private pending_updates: Map<string, NodeJS.Timeout> = new Map();
    private update_queue: Set<string> = new Set();
    private is_processing_queue = false;
    private on_graph_change_callback?: (changed_callees: Set<string>) => void;
    private workspace_roots: string[] = [];
    // Optional ScopeResolver used during indexing to resolve a file's
    // INHERITED working directory (#218). When unset, indexing stamps
    // only the file's own @lsp-cd / @lsp-wd directive.
    private scope_resolver?: ScopeResolver;
    // Cross-file resolver config (depth limits etc.) derived from the
    // workspace settings, so the indexer's inherited-WD walk uses the
    // same limits as open-document resolution (#218).
    private scope_resolver_config: Partial<ScopeResolverConfig> = {};

    /**
     * Set the dependency graph for auto backward dependency discovery.
     */
    set_dependency_graph(graph: DependencyGraph): void {
        this.dependency_graph = graph;
    }

    /**
     * Provide a ScopeResolver so indexing can resolve inherited working
     * directories (#218), making indexed and open-document dependency-graph
     * callee keys agree for WD-dependent files. Optional: when unset,
     * indexing stamps own-directive WD only (best-effort).
     */
    set_scope_resolver(resolver: ScopeResolver): void {
        this.scope_resolver = resolver;
    }

    /**
     * Record the backward directives parsed from an open buffer. These
     * override the on-disk directives for the same URI in
     * `get_related_uris`, so unsaved `@lsp-done-by` / `@lsp-included-by`
     * edits are visible to find-references immediately.
     */
    set_buffer_directives(uri: string, directives: Directive[]): void {
        this.buffer_directives_overlay.set(uri, directives);
    }

    /**
     * Drop a buffer directive overlay (e.g., on document close), so
     * `get_related_uris` falls back to the on-disk index for this URI.
     */
    clear_buffer_directives(uri: string): void {
        this.buffer_directives_overlay.delete(uri);
    }

    /**
     * Return the set of URIs reachable from `uri` through the
     * dependency graph — ancestors (files that `do`/`run`/`include`
     * this one, transitively) and descendants (files this one calls,
     * transitively). The input URI is included in the result.
     *
     * Also follows backward header directives (`@lsp-done-by` /
     * `@lsp-included-by`) in both directions: the graph only records
     * static `do`/`run`/`include` edges, so directive-only parent
     * relationships (used when the parent's call path is dynamic)
     * would otherwise be missed. The visited file's own directives
     * supply the child → parent step, and a scan of other indexed
     * entries supplies the parent ← child step.
     *
     * When no dependency graph has been configured the result is
     * just the input URI. Used by find-references to scope workspace
     * scans to files that share a runtime relationship with the
     * current one (excluding unrelated modules that happen to reuse
     * the same symbol name).
     */
    get_related_uris(
        uri: string,
        options?: { include_only?: boolean }
    ): Set<string> {
        const the_related_uris = new Set<string>([uri]);
        if (!this.dependency_graph) return the_related_uris;

        const is_include_only = options?.include_only === true;
        const is_allowed_directive = (my_type: Directive['type']): boolean => {
            if (is_include_only) return my_type === 'included-by';
            return my_type === 'done-by' || my_type === 'included-by';
        };

        const the_parent_to_children_map = new Map<string, Set<string>>();
        const record_child_directives = (
            my_child_uri: string,
            my_directives: Directive[]
        ): void => {
            for (const my_directive of my_directives) {
                if (!is_allowed_directive(my_directive.type)) continue;
                const my_parent_uri = URI.file(my_directive.path).toString();
                let my_children_set = the_parent_to_children_map.get(my_parent_uri);
                if (!my_children_set) {
                    my_children_set = new Set<string>();
                    the_parent_to_children_map.set(my_parent_uri, my_children_set);
                }
                my_children_set.add(my_child_uri);
            }
        };
        // Disk-indexed children (skip any URI with a live buffer overlay).
        for (const [my_child_uri, my_child_entry] of this.symbol_index) {
            if (this.buffer_directives_overlay.has(my_child_uri)) continue;
            record_child_directives(my_child_uri, my_child_entry.directives);
        }
        // Buffer overlay (may include URIs not yet on disk).
        for (const [my_child_uri, my_directives] of this.buffer_directives_overlay) {
            record_child_directives(my_child_uri, my_directives);
        }

        const the_work_stack: string[] = [uri];
        while (the_work_stack.length > 0) {
            const my_uri = the_work_stack.pop()!;
            for (const my_edge of this.dependency_graph.get_parents(my_uri)) {
                if (is_include_only && my_edge.call_type !== 'include') continue;
                if (!the_related_uris.has(my_edge.caller_uri)) {
                    the_related_uris.add(my_edge.caller_uri);
                    the_work_stack.push(my_edge.caller_uri);
                }
            }
            const the_callees = is_include_only
                ? this.dependency_graph.get_callees_by_type(my_uri, 'include')
                : this.dependency_graph.get_callees(my_uri);
            for (const my_callee of the_callees) {
                if (!the_related_uris.has(my_callee)) {
                    the_related_uris.add(my_callee);
                    the_work_stack.push(my_callee);
                }
            }
            const my_buffer_directives = this.buffer_directives_overlay.get(my_uri);
            const my_entry_directives = my_buffer_directives
                ?? this.symbol_index.get(my_uri)?.directives;
            if (my_entry_directives) {
                for (const my_directive of my_entry_directives) {
                    if (!is_allowed_directive(my_directive.type)) continue;
                    const my_parent_uri = URI.file(my_directive.path).toString();
                    if (!the_related_uris.has(my_parent_uri)) {
                        the_related_uris.add(my_parent_uri);
                        the_work_stack.push(my_parent_uri);
                    }
                }
            }
            const my_children_set = the_parent_to_children_map.get(my_uri);
            if (my_children_set) {
                for (const my_child_uri of my_children_set) {
                    if (the_related_uris.has(my_child_uri)) continue;
                    the_related_uris.add(my_child_uri);
                    the_work_stack.push(my_child_uri);
                }
            }
        }
        return the_related_uris;
    }

    /**
     * Set a callback invoked when the dependency graph changes during
     * re-indexing, so the caller can cascade-invalidate scope caches.
     */
    set_on_graph_change(callback: (changed_callees: Set<string>) => void): void {
        this.on_graph_change_callback = callback;
    }

    private is_active_generation(generation: number): boolean {
        return generation === this.scan_generation && !this.cancelled;
    }

    /**
     * Initialize the indexer by scanning a list of folders.
     */
    async initialize(
        workspace_folders: string[],
        ado_paths: string[] = []
    ): Promise<void> {
        const generation = ++this.scan_generation;
        this.cancelled = false;

        if (!this.enabled) {
            this.dependency_graph?.mark_scan_complete();
            return;
        }
        this.ado_paths = ado_paths;
        this.workspace_roots = workspace_folders.map(f => path.resolve(f));
        // Auto-detect Stata install / user ado directories for help
        // lookup. The discovery is cheap (a handful of `fs.statSync`
        // calls on well-known paths) and non-fatal if none exist.
        this.help_search_paths = discover_stata_ado_paths();
        const start_time = Date.now();

        for (const folder of [...workspace_folders, ...this.ado_paths]) {
            if (!this.is_active_generation(generation)) break;
            await this.scan_directory(folder, generation);
        }

        if (!this.is_active_generation(generation)) {
            return;
        }

        const elapsed_ms = Date.now() - start_time;
        this.metrics.total_index_time_ms = elapsed_ms;
        if (this.metrics.files_indexed > 0) {
            this.metrics.avg_file_time_ms =
                this.metrics.total_index_time_ms /
                this.metrics.files_indexed;
        }

        // Mark dependency graph scan as complete
        this.dependency_graph?.mark_scan_complete();

        // Log summary of skipped files
        this.log_skipped_files_summary();
    }

    /**
     * Scan a directory recursively for Stata files using async operations.
     */
    private async scan_directory(
        dir_path: string,
        generation: number
    ): Promise<void> {
        if (!this.is_active_generation(generation)) return;

        try {
            const entries = await fs.promises.readdir(dir_path, {
                withFileTypes: true,
            });
            if (!this.is_active_generation(generation)) return;

            const file_paths: string[] = [];

            for (const entry of entries) {
                if (!this.is_active_generation(generation)) break;

                const entry_path = path.join(dir_path, entry.name);

                // The persistent index follows neither symlinked dirs
                // nor symlinked files (#219): it keys entries by path
                // and the watcher invalidates by the changed path, so
                // an alias entry could not be kept fresh when its
                // target changes. In-workspace targets are covered via
                // the real path; symlink-following lives in the
                // listing/lookup consumers (path completion, the .sthlp
                // lookup), which keep no path-keyed analysis state.
                if (entry.isDirectory()) {
                    // Skip version-control metadata directories. They hold no
                    // Stata source, can be very large, and recursing them is
                    // pure scan overhead — the standard convention for code
                    // indexers and language servers.
                    if (VCS_METADATA_DIRS.has(entry.name)) {
                        continue;
                    }
                    // Prune directories whose every descendant is excluded by
                    // the workspace `exclude` patterns (issue #255). Paths
                    // outside the workspace roots (ado paths) never match.
                    if (
                        !this.exclude_matcher.is_empty &&
                        this.exclude_matcher.is_excluded_dir(
                            entry_path,
                            this.workspace_roots
                        )
                    ) {
                        continue;
                    }
                    await this.scan_directory(entry_path, generation);
                } else if (
                    entry.isFile() &&
                    hasStataExtension(entry.name)
                ) {
                    if (
                        !this.exclude_matcher.is_empty &&
                        this.exclude_matcher.is_excluded_file(
                            entry_path,
                            this.workspace_roots
                        )
                    ) {
                        continue;
                    }
                    file_paths.push(entry_path);
                }
            }

            // Process files with worker pool
            await this.process_files_with_pool(file_paths, generation);
        } catch (error) {
            logger.error(`Failed to scan directory ${dir_path}: ${error}`);
        }
    }

    /**
     * Process files using a worker pool with concurrency control.
     */
    private async process_files_with_pool(
        file_paths: string[],
        generation: number
    ): Promise<void> {
        let file_index = 0;
        const last_yield_time = { value: Date.now() };

        const process_next = async (): Promise<void> => {
            while (
                file_index < file_paths.length &&
                this.is_active_generation(generation)
            ) {
                const current_index = file_index++;
                const file_path = file_paths[current_index];

                await this.index_file(file_path, generation);

                // Yield to event loop periodically
                const now = Date.now();
                if (now - last_yield_time.value > YIELD_INTERVAL_MS) {
                    last_yield_time.value = now;
                    await new Promise((resolve) =>
                        setImmediate(resolve)
                    );
                }
            }
        };

        // Start worker pool
        const workers: Promise<void>[] = [];
        for (let i = 0; i < MAX_PARALLEL; i++) {
            workers.push(process_next());
        }

        await Promise.all(workers);
    }

    /**
     * Remove stale index entries for a file and notify graph subscribers.
     * Only bumps version if the file was previously indexed.
     */
    private clear_stale_entry(file_uri: string): void {
        let graph_result: GraphUpdateResult | undefined;
        if (this.dependency_graph) {
            graph_result = this.dependency_graph.remove_caller(file_uri);
        }
        const was_indexed = this.symbol_index.has(file_uri);
        this.symbol_index.delete(file_uri);
        this.token_index.delete(file_uri);
        this.context_ranges_index.delete(file_uri);
        if (was_indexed) {
            this.version++;
            // Evicting an already-counted file (size growth, re-index error,
            // or removal) must drop the distinct-file count; otherwise
            // files_indexed inflates over edits and trips max_indexed_files
            // early, hiding genuinely-new files and emitting spurious
            // SIGHT_FILE_NOT_INDEXED diagnostics.
            this.metrics.files_indexed = Math.max(
                0,
                this.metrics.files_indexed - 1
            );
        }
        if (graph_result && graph_result.changed_callees.size > 0 && this.on_graph_change_callback) {
            this.on_graph_change_callback(graph_result.changed_callees);
        }
    }

    private should_skip_for_max_indexed_files(file_uri: string): boolean {
        if (this.metrics.files_indexed < this.max_indexed_files) {
            return false;
        }

        if (!this.max_files_reached) {
            this.max_files_reached = true;
            logger.info(
                `Reached max_indexed_files limit (${this.max_indexed_files}). ` +
                `Skipping remaining files.`
            );
        }
        // Only evict files that are new to the index. An already-indexed file
        // re-indexed after the cap is reached should keep its existing entry
        // (it is already counted toward the cap) rather than lose coverage.
        if (!this.symbol_index.has(file_uri)) {
            this.clear_stale_entry(file_uri);
        }
        return true;
    }

    /**
     * Index a single file.
     */
    async index_file(
        file_path: string,
        generation: number = this.scan_generation
    ): Promise<void> {
        if (!this.is_active_generation(generation) || !this.enabled) return;
        const file_uri = URI.file(file_path).toString();
        // Honor workspace `exclude` patterns on the incremental update path
        // (issue #255): scan_directory already prunes excluded files on the
        // bulk scan, but schedule_update -> index_file bypasses it. Clearing a
        // previously-indexed entry drops stale symbols/edges when a file
        // becomes excluded (e.g. a new pattern, or a moved file).
        if (
            !this.exclude_matcher.is_empty &&
            this.exclude_matcher.is_excluded_file(file_path, this.workspace_roots)
        ) {
            this.clear_stale_entry(file_uri);
            return;
        }
        // Re-indexing a file already in the index does not grow the distinct-
        // file count, so the cap must not block it; otherwise an edit to an
        // already-indexed file is silently skipped once the cap is reached,
        // leaving stale symbols. The cap gates only genuinely new files.
        const already_indexed = this.symbol_index.has(file_uri);

        // Check max files limit (new files only)
        if (!already_indexed
            && this.should_skip_for_max_indexed_files(file_uri)) return;

        try {
            // Check file size
            const stats = await fs.promises.stat(file_path);
            if (!this.is_active_generation(generation)) return;

            if (stats.size > this.size_threshold_bytes) {
                this.clear_stale_entry(file_uri);
                logger.debug(
                    `Skipping large file ${file_path} ` +
                    `(${stats.size} bytes, ` +
                    `threshold: ${this.size_threshold_bytes})`
                );
                this.skipped_files.set(file_path, stats.size);
                this.metrics.files_skipped++;
                return;
            }

            const content = await fs.promises.readFile(
                file_path,
                'utf8'
            );
            if (!this.is_active_generation(generation)) return;
            if (!already_indexed
                && this.should_skip_for_max_indexed_files(file_uri)) return;

            // Handle .mata files differently
            if (path.extname(file_path).toLowerCase() === '.mata') {
                await this.index_mata_file(
                    content,
                    file_uri,
                    generation
                );
                return;
            }

            // Parse directives
            const directive_result = this.directive_parser.parse(content, file_uri);

            // Parse and analyze
            const lexResult = this.lexer.tokenize(content);
            const parseResult = this.parser.parse(lexResult.tokens);
            const workspace_root = get_workspace_root_for_path(
                this.workspace_roots,
                file_path
            );
            const analyzeResult = this.analyzer.analyze(
                parseResult.ast,
                file_uri,
                undefined,
                undefined,
                lexResult.tokens,
            );

            // Resolve effective working directory: own @lsp-cd / @lsp-wd
            // directive first (via the shared helper, so the value
            // matches what DocumentStore stamps), then — when there is no
            // own directive — the WD inherited from backward-directive
            // parents.
            //
            // The inherited lookup (#218) reuses ScopeResolver's WD walk,
            // which reads parents via the resolver's own file_cache / disk
            // and never re-enters the indexer's index_file, so it is safe
            // to call during a bulk scan. When no ScopeResolver is wired,
            // inherited WD is skipped and the edge stays own-WD-only.
            const own_working_directory: string | undefined =
                directive_result.working_directory
                    ? resolve_working_directory_directive(
                          directive_result.working_directory,
                          workspace_root,
                      )
                    : undefined;

            let effective_working_directory = own_working_directory;
            if (own_working_directory === undefined && this.scope_resolver) {
                // Pass the active cross-file resolver config (depth
                // limits) so the inherited WD matches what DocumentStore
                // computes under non-default settings. The helper filters
                // to backward directives itself.
                effective_working_directory =
                    await this.scope_resolver
                        .resolve_inherited_working_directory(
                            directive_result.directives,
                            file_uri,
                            directive_result.standalone !== undefined,
                            this.scope_resolver_config,
                        );
            }

            // Re-stamp command-detected forward calls with the line-sensitive
            // working directory implied by in-script `cd` commands (issue #252).
            // The timeline starts from the file's effective WD (own/inherited)
            // and resolves each top-level `cd` in source order, so the dep-graph
            // edges match what DocumentStore produces for the same source. The
            // analyzer sets caller_uri (= file_uri); apply_cd_timeline sets the
            // per-call working_directory. Diagnostics are discarded here (only
            // ForwardScopeResolver emits cd diagnostics, for the owner file).
            const my_caller_dir = path.dirname(file_path);
            const { timeline: cd_timeline } = build_cd_timeline({
                starting_wd: effective_working_directory,
                caller_dir: my_caller_dir,
                cd_commands: analyzeResult.cd_commands,
                workspace_roots: this.workspace_roots,
            });
            const stamped_analyzer_calls: ForwardCall[] = apply_cd_timeline(
                analyzeResult.forward_calls,
                cd_timeline,
            );

            // Compute context ranges for embedded language support
            const context_tracker = new ContextTracker();
            context_tracker.initialize_from_tokens(lexResult.tokens, content);
            const context_ranges = context_tracker.get_all_context_ranges();
            if (!this.is_active_generation(generation)) return;

            if (!already_indexed
                && this.should_skip_for_max_indexed_files(file_uri)) return;

            // Combine forward calls from analyzer (command-detected)
            // and directive parser (directive-detected).
            // Stamp caller_uri and working_directory on all calls.
            let all_forward_calls: ForwardCall[] = stamped_analyzer_calls;
            if (directive_result.forward_calls && directive_result.forward_calls.length > 0) {
                const directive_forward_calls: ForwardCall[] = directive_result.forward_calls.map(d => ({
                    type: d.type,
                    raw_path: d.raw_path,
                    call_site_line: d.call_site_line,
                    range: d.range,
                    source: 'directive' as const,
                    is_static: true,
                    caller_uri: file_uri,
                    working_directory: effective_working_directory,
                }));
                all_forward_calls = [
                    ...stamped_analyzer_calls,
                    ...directive_forward_calls,
                ].sort((a, b) => a.call_site_line - b.call_site_line);
            }

            // Update dependency graph with forward calls
            if (this.dependency_graph) {
                const graph_result = this.dependency_graph.update_caller(file_uri, all_forward_calls);
                if (graph_result.changed_callees.size > 0 && this.on_graph_change_callback) {
                    this.on_graph_change_callback(graph_result.changed_callees);
                }
            }

            // Store tokens, context ranges, and symbols
            this.token_index.set(file_uri, lexResult.tokens);
            this.context_ranges_index.set(file_uri, context_ranges);
            // Recheck membership at commit time: `already_indexed` was sampled
            // before the stat/readFile awaits, so a concurrent index/remove of
            // the same URI could otherwise mis-count metrics.files_indexed.
            const is_new_entry = !this.symbol_index.has(file_uri);
            this.symbol_index.set(file_uri, {
                symbols: analyzeResult.symbols,
                directives: directive_result.directives
            });
            this.version++;
            if (is_new_entry) this.metrics.files_indexed++;
        } catch (error) {
            if (!this.is_active_generation(generation)) return;
            this.clear_stale_entry(file_uri);
            logger.error(`Failed to index file ${file_path}: ${error}`);
            this.metrics.files_skipped++;
        }
    }

    /**
     * Index a .mata file by extracting function definitions.
     */
    private async index_mata_file(
        content: string,
        file_uri: string,
        generation: number
    ): Promise<void> {
        if (!this.is_active_generation(generation)) return;

        const symbols: SymbolTable = create_empty_symbol_table();

        // Pre-compute line offsets for efficient line number lookups
        const the_line_offsets = compute_line_offsets(content);

        // Simple regex to match Mata function definitions
        const function_regex = /^\s*function\s+(?:\w+\s+)?(\w+)\s*\(/gm;
        let match;

        while ((match = function_regex.exec(content)) !== null) {
            const function_name = match[1];
            // Binary search to find line number from offset
            const match_offset = match.index;
            let low = 0;
            let high = the_line_offsets.length - 1;
            while (low < high) {
                const mid = Math.floor((low + high + 1) / 2);
                if (the_line_offsets[mid] <= match_offset) {
                    low = mid;
                } else {
                    high = mid - 1;
                }
            }
            const line_number = low;

            symbols.programs.set(function_name, {
                name: function_name,
                location: {
                    uri: file_uri,
                    range: {
                        start: { line: line_number, character: match_offset - the_line_offsets[line_number] },
                        end: { line: line_number, character: match_offset - the_line_offsets[line_number] + match[0].length }
                    }
                },
                sourceUri: file_uri,
            });
        }

        // Recheck membership at commit time (see index_file): the sampled
        // `already_indexed` may be stale after the awaits above.
        const is_new_entry = !this.symbol_index.has(file_uri);
        this.symbol_index.set(file_uri, {
            symbols,
            directives: []
        });
        this.version++;
        if (is_new_entry) this.metrics.files_indexed++;
    }


    /**
     * Remove a file from the index.
     * Also cleans up from skipped_files if present.
     */
    remove_file(file_path: string): void {
        if (!this.enabled) {
            return;
        }
        // Cancel any pending update for this file
        const pending = this.pending_updates.get(file_path);
        if (pending) {
            clearTimeout(pending);
            this.pending_updates.delete(file_path);
        }
        this.update_queue.delete(file_path);
        
        const file_uri = URI.file(file_path).toString();
        this.clear_stale_entry(file_uri);
        this.skipped_files.delete(file_path);
    }

    /**
     * Schedule a debounced file update.
     * Batches rapid file changes to avoid excessive re-indexing.
     */
    schedule_update(file_path: string): void {
        if (!this.enabled) return;
        
        // Cancel existing timer for this file
        const existing = this.pending_updates.get(file_path);
        if (existing) {
            clearTimeout(existing);
        }
        
        // Schedule new update
        const timer = setTimeout(() => {
            this.pending_updates.delete(file_path);
            this.update_queue.add(file_path);
            this.process_update_queue();
        }, INDEX_DEBOUNCE_MS);
        
        this.pending_updates.set(file_path, timer);
    }

    /**
     * Process queued file updates with yielding.
     * Ensures UI stays responsive during bulk changes.
     */
    private async process_update_queue(): Promise<void> {
        if (this.is_processing_queue || this.update_queue.size === 0) {
            return;
        }
        
        this.is_processing_queue = true;
        const generation = this.scan_generation;
        
        try {
            while (
                this.update_queue.size > 0 &&
                this.is_active_generation(generation)
            ) {
                // Get next file from queue
                const file_path = this.update_queue.values().next().value;
                if (!file_path) break;
                this.update_queue.delete(file_path);
                
                // Index the file
                await this.index_file(file_path, generation);
                
                // Yield to event loop to keep UI responsive
                await new Promise(resolve => setImmediate(resolve));
            }
        } finally {
            this.is_processing_queue = false;
        }
    }

    /**
     * Cancel ongoing indexing operations.
     */
    cancel(): void {
        this.scan_generation++;
        this.cancelled = true;
        // Clear all pending updates
        for (const timer of this.pending_updates.values()) {
            clearTimeout(timer);
        }
        this.pending_updates.clear();
        this.update_queue.clear();
    }

    /**
     * Reset the indexer to empty state, cancelling any in-flight scan.
     * Clears all indexes, metrics, and pending updates so the indexer
     * can be re-initialized cleanly for a new workspace.
     */
    reset(): void {
        this.cancel();
        this.symbol_index.clear();
        this.token_index.clear();
        this.context_ranges_index.clear();
        this.skipped_files.clear();
        this.metrics = {
            files_indexed: 0,
            files_skipped: 0,
            total_index_time_ms: 0,
            avg_file_time_ms: 0,
        };
        this.max_files_reached = false;
        this.is_processing_queue = false;
        this.version = 0;
        this.cancelled = false;
        this.workspace_roots = [];
    }

    /**
     * Configure the indexer with LSP settings.
     */
    configure(config: Partial<StataLSPConfig>): void {
        // Capture cross-file resolver depth limits so the inherited-WD
        // walk during indexing uses the same config as open-document
        // resolution.
        this.scope_resolver_config = scope_resolver_config_for(config);

        this.exclude_matcher = create_exclude_matcher(config.exclude ?? []);

        const threshold = config?.indexing?.maxFileSizeBytes;
        if (typeof threshold === 'number' && threshold > 0) {
            this.size_threshold_bytes = threshold;
        } else if (threshold !== undefined) {
            logger.warn(
                `Invalid indexing.maxFileSizeBytes: ${threshold}, ` +
                `using default`
            );
        }

        // Respect both legacy and cross-file indexing toggles.
        // If either is explicitly false, disable indexing.
        const legacy_enabled = config.indexWorkspace;
        const cross_file_enabled = config.cross_file?.index_workspace;
        if (legacy_enabled === false || cross_file_enabled === false) {
            this.enabled = false;
        } else if (legacy_enabled === true || cross_file_enabled === true) {
            this.enabled = true;
        }
    }

    /**
     * Get list of files skipped due to size.
     */
    get_skipped_files(): Map<string, number> {
        return new Map(this.skipped_files);
    }

    /**
     * Log summary of skipped files after indexing completes.
     */
    private log_skipped_files_summary(): void {
        if (this.skipped_files.size === 0) {
            return;
        }

        const skipped_count = this.skipped_files.size;
        const the_skipped_paths: string[] = Array.from(this.skipped_files.keys());

        logger.info(
            `Indexing complete: ${skipped_count} file(s) skipped due to ` +
            `size threshold (${this.size_threshold_bytes} bytes)`
        );

        for (const my_path of the_skipped_paths) {
            const my_size = this.skipped_files.get(my_path);
            logger.info(`  - ${my_path} (${my_size} bytes)`);
        }
    }

    /**
     * Get indexing metrics.
     */
    get_metrics(): IndexerMetrics {
        return { ...this.metrics };
    }

    /**
     * Set the maximum number of files to index.
     */
    set_max_indexed_files(limit: number): void {
        this.max_indexed_files = limit;
    }

    /**
     * Get all indexed files with their tokens.
     * Used by ReferencesProvider for workspace-wide search.
     */
    get_indexed_files(): Map<string, IndexedFileData> {
        const indexed_files = new Map<string, IndexedFileData>();
        
        for (const uri of this.symbol_index.keys()) {
            const tokens = this.token_index.get(uri) || [];
            const context_ranges = this.context_ranges_index.get(uri);
            indexed_files.set(uri, {
                uri,
                tokens,
                context_ranges,
            });
        }

        return indexed_files;
    }

    /**
     * Whether a file URI has been indexed. Cheaper than get_indexed_files()
     * when only membership is needed.
     */
    has_indexed_file(uri: string): boolean {
        return this.symbol_index.has(uri);
    }

    /**
     * Get the current version of the workspace index.
     * Increments whenever the index is modified.
     */
    get_version(): number {
        return this.version;
    }

    /**
     * Get all symbols in the workspace (merged).
     */
    get_all_symbols(): SymbolTable {
        let all_symbols: SymbolTable = create_empty_symbol_table();

        for (const entry of this.symbol_index.values()) {
            all_symbols = merge_symbol_tables(all_symbols, entry.symbols);
        }
        return all_symbols;
    }

    /**
     * Find all definitions of a symbol across the workspace.
     */
    find_symbol_definitions(
        name: string,
        symbol_type?: 'program' | 'local' | 'global' | 'variable' | 'scalar' | 'matrix'
    ): Array<ProgramSymbol | MacroSymbol | VariableSymbol | ScalarSymbol | MatrixSymbol> {
        const definitions: Array<ProgramSymbol | MacroSymbol | VariableSymbol | ScalarSymbol | MatrixSymbol> = [];

        for (const entry of this.symbol_index.values()) {
            const symbols = entry.symbols;
            let symbol: ProgramSymbol | MacroSymbol | VariableSymbol | ScalarSymbol | MatrixSymbol | undefined;

            if (!symbol_type || symbol_type === 'program') {
                symbol = symbols.programs.get(name);
                if (symbol) definitions.push(symbol);
            }
            if (!symbol_type || symbol_type === 'local') {
                symbol = symbols.localMacros.get(name);
                if (symbol) definitions.push(symbol);
            }
            if (!symbol_type || symbol_type === 'global') {
                symbol = symbols.globalMacros.get(name);
                if (symbol) definitions.push(symbol);
            }
            if (!symbol_type || symbol_type === 'variable') {
                symbol = symbols.variables.get(name);
                if (symbol) definitions.push(symbol);
            }
            if (!symbol_type || symbol_type === 'scalar') {
                symbol = symbols.scalars.get(name);
                if (symbol) definitions.push(symbol);
            }
            if (!symbol_type || symbol_type === 'matrix') {
                symbol = symbols.matrices.get(name);
                if (symbol) definitions.push(symbol);
            }
        }

        return definitions;
    }

    /**
     * Find every indexed symbol whose name contains `query` (case-insensitive)
     * as a substring, returning one `WorkspaceSymbolMatch` per (file, symbol-type,
     * name) triple.
     *
     * Contrast with `find_symbol_definitions`, which performs exact-name lookup
     * and returns the raw symbol objects. This method is the backing source for
     * the `workspace/symbol` (Cmd-T / "Go to Symbol in Workspace") provider, so
     * it returns lightweight match records (name, kind, uri, range) and emits
     * one entry per file+type rather than merging across files.
     */
    find_all_symbol_definitions(query: string): WorkspaceSymbolMatch[] {
        const the_matches: WorkspaceSymbolMatch[] = [];
        const my_query_lower = query.toLowerCase();

        for (const [file_uri, entry] of this.symbol_index.entries()) {
            const my_symbols = entry.symbols;

            for (const [name, symbol] of my_symbols.programs) {
                if (name.toLowerCase().includes(my_query_lower)) {
                    the_matches.push({
                        name,
                        kind: 'program',
                        uri: file_uri,
                        range: symbol.location.range,
                    });
                }
            }
            for (const [name, symbol] of my_symbols.globalMacros) {
                if (name.toLowerCase().includes(my_query_lower)) {
                    the_matches.push({
                        name,
                        kind: 'global_macro',
                        uri: file_uri,
                        range: symbol.location.range,
                    });
                }
            }
            for (const [name, symbol] of my_symbols.localMacros) {
                if (name.toLowerCase().includes(my_query_lower)) {
                    the_matches.push({
                        name,
                        kind: 'local_macro',
                        uri: file_uri,
                        range: symbol.location.range,
                    });
                }
            }
            for (const [name, symbol] of my_symbols.variables) {
                if (name.toLowerCase().includes(my_query_lower)) {
                    the_matches.push({
                        name,
                        kind: 'variable',
                        uri: file_uri,
                        range: symbol.location.range,
                    });
                }
            }
            for (const [name, symbol] of my_symbols.scalars) {
                if (name.toLowerCase().includes(my_query_lower)) {
                    the_matches.push({
                        name,
                        kind: 'scalar',
                        uri: file_uri,
                        range: symbol.location.range,
                    });
                }
            }
            for (const [name, symbol] of my_symbols.matrices) {
                if (name.toLowerCase().includes(my_query_lower)) {
                    the_matches.push({
                        name,
                        kind: 'matrix',
                        uri: file_uri,
                        range: symbol.location.range,
                    });
                }
            }
        }

        return the_matches;
    }

    /**
     * For tests and callers that want to override or inspect the
     * auto-discovered help search paths. Accepts absolute directories.
     */
    set_help_search_paths(paths: string[]): void {
        this.help_search_paths = [...paths];
    }

    /**
     * Read-only view of the auto-discovered help search paths.
     * Exposed primarily for tests.
     */
    get_help_search_paths(): string[] {
        return [...this.help_search_paths];
    }

    /**
     * Return the shared `FindaliasResolver`, refreshed with the same
     * search-path list that `resolve_sthlp_file` uses. The resolver
     * caches `.maint` file reads internally so refreshing the search
     * dirs here is effectively free when nothing has changed.
     */
    get_findalias_resolver(): FindaliasResolver {
        this.findalias_resolver.set_search_dirs(this.maint_search_dirs());
        return this.findalias_resolver;
    }

    /**
     * Return the shared `HelpAliasResolver` used by
     * `resolve_sthlp_file` to follow `*help_alias.maint` redirects
     * (e.g. `operators` → `operator`). Refreshed on every access with
     * the same search-path list as the SMCL-alias resolver.
     */
    get_help_alias_resolver(): HelpAliasResolver {
        this.help_alias_resolver.set_search_dirs(this.maint_search_dirs());
        return this.help_alias_resolver;
    }

    /**
     * Shared search-path list fed to every `.maint` resolver. Matches
     * the lookup order used by `resolve_sthlp_file`.
     */
    private maint_search_dirs(): string[] {
        return [
            ...this.ado_paths,
            ...this.workspace_roots,
            ...this.help_search_paths,
        ];
    }

    /**
     * Resolve a `.sthlp` help file by topic name.
     *
     * Searches the user-configured `ado_paths`, then workspace roots,
     * then auto-discovered Stata install directories, following
     * Stata's letter-subdirectory convention (e.g., `r/regress.sthlp`).
     * Returns the absolute file path or null.
     *
     * When the filesystem lookup misses, consults Stata's
     * `*help_alias.maint` redirects (e.g. `operators` → `operator`)
     * and retries with the redirected topic. A per-call visited set
     * guards against malformed alias chains that cycle back on
     * themselves.
     */
    async resolve_sthlp_file(topic: string): Promise<string | null> {
        return this.resolve_sthlp_file_with_visited(topic, new Set());
    }

    private async resolve_sthlp_file_with_visited(
        topic: string,
        visited: Set<string>
    ): Promise<string | null> {
        // Stata convention: multi-word topics (e.g. `regress
        // postestimation`, `frame create`) live in files named with
        // underscores (`regress_postestimation.sthlp`,
        // `frame_create.sthlp`). Try both forms so callers can pass
        // whichever matches how the user typed the topic.
        const the_basenames: string[] = [topic];
        if (topic.includes(' ')) {
            the_basenames.push(topic.replace(/\s+/g, '_'));
        }
        for (const my_candidate of the_basenames) {
            const my_resolved = await this.resolve_sthlp_basename(my_candidate);
            if (my_resolved) return my_resolved;
        }

        // Filesystem lookup missed. Try Stata's `*help_alias.maint`
        // redirects (e.g. `operators` → `operator`) and retry the
        // resolver on the redirected topic.
        if (visited.has(topic)) return null;
        visited.add(topic);
        const my_alias_target = this.get_help_alias_resolver().lookup(topic);
        if (my_alias_target && !visited.has(my_alias_target)) {
            return this.resolve_sthlp_file_with_visited(
                my_alias_target, visited
            );
        }
        return null;
    }

    private async resolve_sthlp_basename(topic: string): Promise<string | null> {
        if (topic.length === 0) return null;
        if (!is_safe_include_name(topic)) return null;
        const my_basename = `${topic}.sthlp`;
        const my_first_letter = topic.charAt(0).toLowerCase();

        // Search user-configured ado_paths first (highest priority),
        // then workspace roots, then the auto-discovered Stata install
        // directories. Auto-discovered paths come last so an explicit
        // user override always wins, but they are still consulted so
        // built-in help like `help include` works out of the box.
        const the_search_dirs = [
            ...this.ado_paths,
            ...this.workspace_roots,
            ...this.help_search_paths,
        ];

        for (const my_dir of the_search_dirs) {
            // Check letter subdirectory: dir/r/regress.sthlp
            const my_subdir_path = path.join(
                my_dir, my_first_letter, my_basename
            );
            try {
                await fs.promises.access(my_subdir_path);
                return my_subdir_path;
            } catch {
                // not found, continue
            }

            // Check directly in directory: dir/regress.sthlp
            const my_direct_path = path.join(my_dir, my_basename);
            try {
                await fs.promises.access(my_direct_path);
                return my_direct_path;
            } catch {
                // not found, continue
            }

            if (!this.workspace_roots.includes(path.resolve(my_dir))) {
                continue;
            }

            const my_recursive_match =
                await this.find_sthlp_file_recursive(my_dir, my_basename);
            if (my_recursive_match) {
                return my_recursive_match;
            }
        }

        return null;
    }

    async resolve_ihlp_file(name: string): Promise<string | null> {
        if (name.length === 0) return null;
        if (!is_safe_include_name(name)) return null;
        // Strip .ihlp extension if already present — some SMCL files
        // write `INCLUDE help foo.ihlp` rather than `INCLUDE help foo`.
        const my_bare = name.endsWith('.ihlp')
            ? name.slice(0, -5)
            : name;
        const my_basename = `${my_bare}.ihlp`;
        const my_first_letter = my_bare.charAt(0).toLowerCase();

        const the_search_dirs = [
            ...this.ado_paths,
            ...this.workspace_roots,
            ...this.help_search_paths,
        ];

        for (const my_dir of the_search_dirs) {
            // Check letter subdirectory: dir/r/robust_short.ihlp
            const my_subdir_path = path.join(
                my_dir, my_first_letter, my_basename
            );
            try {
                await fs.promises.access(my_subdir_path);
                return my_subdir_path;
            } catch {
                // not found, continue
            }

            // Check directly in directory: dir/robust_short.ihlp
            const my_direct_path = path.join(my_dir, my_basename);
            try {
                await fs.promises.access(my_direct_path);
                return my_direct_path;
            } catch {
                // not found, continue
            }
        }

        return null;
    }

    private async list_matching_sthlp(
        dir: string,
        prefix: string
    ): Promise<string[]> {
        try {
            const the_entries = await fs.promises.readdir(dir);
            const the_matches = the_entries
                .filter(my_entry =>
                    my_entry.startsWith(prefix) &&
                    my_entry.endsWith('.sthlp')
                )
                .sort();
            return the_matches.map(my_entry => path.join(dir, my_entry));
        } catch {
            return [];
        }
    }

    async find_related_sthlp_files(topic: string): Promise<string[]> {
        if (topic.length === 0) return [];

        // Stata convention: multi-word topics (e.g. `regress
        // postestimation`) live in files joined with underscores. Probe
        // both the raw topic and the underscore-joined form so callers
        // that pass either shape get the right `topic_*.sthlp` matches.
        const the_topic_variants: string[] = [topic];
        const my_underscored = topic.replace(/[\s-]+/g, '_');
        if (my_underscored !== topic) {
            the_topic_variants.push(my_underscored);
        }

        const the_search_dirs = [
            ...this.ado_paths,
            ...this.workspace_roots,
            ...this.help_search_paths,
        ];

        const the_seen = new Set<string>();
        const the_results: string[] = [];
        for (const my_variant of the_topic_variants) {
            const my_prefix = `${my_variant}_`;
            const my_first_letter = my_variant.charAt(0).toLowerCase();

            for (const my_dir of the_search_dirs) {
                // Check letter subdirectory first
                const my_subdir = path.join(my_dir, my_first_letter);
                const the_subdir_matches =
                    await this.list_matching_sthlp(my_subdir, my_prefix);
                for (const my_match of the_subdir_matches) {
                    if (!the_seen.has(my_match)) {
                        the_seen.add(my_match);
                        the_results.push(my_match);
                    }
                }

                // Check flat directory
                const the_flat_matches =
                    await this.list_matching_sthlp(my_dir, my_prefix);
                for (const my_match of the_flat_matches) {
                    if (!the_seen.has(my_match)) {
                        the_seen.add(my_match);
                        the_results.push(my_match);
                    }
                }
            }
        }

        return the_results;
    }

    private static readonly EXCLUDED_DIRS = new Set([
        '.git',
        'node_modules',
        '.svn',
        '.hg',
        '__pycache__',
    ]);

    private static readonly MAX_STHLP_SEARCH_DEPTH = 8;

    private async find_sthlp_file_recursive(
        root_dir: string,
        basename: string
    ): Promise<string | null> {
        const the_dirs: Array<{ path: string; depth: number }> = [
            { path: root_dir, depth: 0 },
        ];

        while (the_dirs.length > 0) {
            const my_entry = the_dirs.pop()!;
            if (my_entry.depth >= WorkspaceIndexer.MAX_STHLP_SEARCH_DEPTH) {
                continue;
            }

            let the_entries: fs.Dirent[];
            try {
                the_entries = await fs.promises.readdir(my_entry.path, {
                    withFileTypes: true,
                });
            } catch {
                continue;
            }

            for (const my_dirent of the_entries) {
                const my_path = path.join(my_entry.path, my_dirent.name);
                // Recurse into real subdirectories only; symlinked
                // dirs are not descended (avoids cycles / external
                // crawl, #219).
                if (my_dirent.isDirectory()) {
                    if (!WorkspaceIndexer.EXCLUDED_DIRS.has(my_dirent.name)) {
                        the_dirs.push({
                            path: my_path,
                            depth: my_entry.depth + 1,
                        });
                    }
                    continue;
                }
                // A symlinked `.sthlp` file IS matched (target may live
                // anywhere): without this it is neither isFile() nor
                // isDirectory() and was silently skipped (#219).
                if (
                    my_dirent.name === basename &&
                    (await entry_is_file_async(
                        my_dirent,
                        my_path,
                        fs.promises
                    ))
                ) {
                    return my_path;
                }
            }
        }

        return null;
    }

    resolve_program(name: string, referring_uri: string): ProgramSymbol | undefined {
        // 1. Check same directory as referring file
        const referring_path = URI.parse(referring_uri).fsPath;
        const current_dir = path.dirname(referring_path);
        const local_ado = path.join(current_dir, `${name}.ado`);

        if (fs.existsSync(local_ado)) {
            const local_uri = URI.file(local_ado).toString();
            const entry = this.symbol_index.get(local_uri);
            return entry?.symbols.programs.get(name);
        }

        // 2. Check all indexed programs (best-effort across workspace)
        for (const entry of this.symbol_index.values()) {
            const program = entry.symbols.programs.get(name);
            if (program) return program;
        }

        // 3. Check official Stata paths (if configured and indexed)
        // This would require this.ado_paths to be populated and scanned

        return undefined;
    }

    /**
     * Get reachable symbols for a file using scope resolver.
     */
    async get_reachable_symbols(
        file_uri: string,
        scope_resolver: ScopeResolver,
        cross_file_config?: { assume_call_site?: 'start' | 'end'; max_forward_depth?: number }
    ): Promise<SymbolTable> {
        const entry = this.symbol_index.get(file_uri);
        if (!entry) {
            return create_empty_symbol_table();
        }

        // Use scope resolver to build complete scope chain
        try {
            const file_path = URI.parse(file_uri).fsPath;
            const content = await fs.promises.readFile(file_path, 'utf8');
            const resolve_config = build_scope_resolver_config(cross_file_config);
            const resolved_scope = await scope_resolver.resolve(
                file_uri,
                content,
                resolve_config
            );

            return resolved_scope.symbols;
        } catch (error) {
            logger.error(`Failed to resolve scope for ${file_uri}: ${error}`);
            return {
                ...entry.symbols,
            };
        }
    }
}
