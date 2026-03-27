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
    Directive,
    ScalarSymbol,
    MatrixSymbol,
    Token,
    ContextRange,
    ForwardCall,
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
import { ScopeResolver, build_scope_resolver_config } from '../scope-resolver';
import { ContextTracker } from '../context-tracker';
import { logger } from '../utils/logger';
import { compute_line_offsets } from '../utils/line-utils';
import { get_workspace_root_for_path } from '../utils/workspace-roots';

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
    private token_index: Map<string, Token[]> = new Map();
    private context_ranges_index: Map<string, ContextRange[]> = new Map();
    private enabled = true;
    private lexer = new StataLexer();
    private parser = new StataParser();
    private analyzer = new SemanticAnalyzer();
    private directive_parser = new DirectiveParser();
    private ado_paths: string[] = [];
    private dependency_graph?: DependencyGraph;
    private metrics: IndexerMetrics = {
        files_indexed: 0,
        files_skipped: 0,
        total_index_time_ms: 0,
        avg_file_time_ms: 0,
    };
    private cancelled = false;
    private size_threshold_bytes: number = 512 * 1024; // 500KB default
    private skipped_files: Map<string, number> = new Map();
    private max_indexed_files: number = 1000;
    private max_files_reached = false;
    private version: number = 0;
    
    // Debouncing state for file updates
    private pending_updates: Map<string, NodeJS.Timeout> = new Map();
    private update_queue: Set<string> = new Set();
    private is_processing_queue = false;
    private on_graph_change_callback?: (changed_callees: Set<string>) => void;
    private workspace_roots: string[] = [];

    /**
     * Set the dependency graph for auto backward dependency discovery.
     */
    set_dependency_graph(graph: DependencyGraph): void {
        this.dependency_graph = graph;
    }

    /**
     * Set a callback invoked when the dependency graph changes during
     * re-indexing, so the caller can cascade-invalidate scope caches.
     */
    set_on_graph_change(callback: (changed_callees: Set<string>) => void): void {
        this.on_graph_change_callback = callback;
    }

    /**
     * Initialize the indexer by scanning a list of folders.
     */
    async initialize(
        workspace_folders: string[],
        ado_paths: string[] = []
    ): Promise<void> {
        if (!this.enabled) {
            this.dependency_graph?.mark_scan_complete();
            return;
        }
        this.ado_paths = ado_paths;
        this.workspace_roots = workspace_folders.map(f => path.resolve(f));
        this.cancelled = false;
        const start_time = Date.now();

        for (const folder of [...workspace_folders, ...this.ado_paths]) {
            if (this.cancelled) break;
            await this.scan_directory(folder);
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
    private async scan_directory(dir_path: string): Promise<void> {
        if (this.cancelled) return;

        try {
            const entries = await fs.promises.readdir(dir_path, {
                withFileTypes: true,
            });

            const file_paths: string[] = [];

            for (const entry of entries) {
                if (this.cancelled) break;

                const entry_path = path.join(dir_path, entry.name);

                if (entry.isDirectory()) {
                    await this.scan_directory(entry_path);
                } else if (entry.isFile()) {
                    if (
                        entry.name.endsWith('.do') ||
                        entry.name.endsWith('.ado') ||
                        entry.name.endsWith('.doh') ||
                        entry.name.endsWith('.mata')
                    ) {
                        file_paths.push(entry_path);
                    }
                }
            }

            // Process files with worker pool
            await this.process_files_with_pool(file_paths);
        } catch (error) {
            logger.error(`Failed to scan directory ${dir_path}: ${error}`);
        }
    }

    /**
     * Process files using a worker pool with concurrency control.
     */
    private async process_files_with_pool(
        file_paths: string[]
    ): Promise<void> {
        let active_workers = 0;
        let file_index = 0;
        const last_yield_time = { value: Date.now() };

        const process_next = async (): Promise<void> => {
            while (file_index < file_paths.length && !this.cancelled) {
                const current_index = file_index++;
                const file_path = file_paths[current_index];

                await this.index_file(file_path);

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
        }
        if (graph_result && graph_result.changed_callees.size > 0 && this.on_graph_change_callback) {
            this.on_graph_change_callback(graph_result.changed_callees);
        }
    }

    /**
     * Index a single file.
     */
    async index_file(file_path: string): Promise<void> {
        if (this.cancelled || !this.enabled) return;
        const file_uri = URI.file(file_path).toString();

        // Check max files limit
        if (this.metrics.files_indexed >= this.max_indexed_files) {
            if (!this.max_files_reached) {
                this.max_files_reached = true;
                logger.info(
                    `Reached max_indexed_files limit (${this.max_indexed_files}). ` +
                    `Skipping remaining files.`
                );
            }
            this.clear_stale_entry(file_uri);
            return;
        }

        try {
            // Check file size
            const stats = await fs.promises.stat(file_path);
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

            // Handle .mata files differently
            if (file_path.endsWith('.mata')) {
                await this.index_mata_file(content, file_uri);
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
                { workspace_root }
            );

            // Compute context ranges for embedded language support
            const context_tracker = new ContextTracker();
            context_tracker.initialize_from_tokens(lexResult.tokens, content);
            const context_ranges = context_tracker.get_all_context_ranges();

            // Combine forward calls from analyzer (command-detected)
            // and directive parser (directive-detected)
            let all_forward_calls = analyzeResult.forward_calls;
            if (directive_result.forward_calls && directive_result.forward_calls.length > 0) {
                const directive_forward_calls: ForwardCall[] = directive_result.forward_calls.map(d => ({
                    type: d.type,
                    path: d.path,
                    raw_path: d.raw_path,
                    call_site_line: d.call_site_line,
                    range: d.range,
                    source: 'directive' as const,
                    is_static: true,
                }));
                all_forward_calls = [
                    ...analyzeResult.forward_calls,
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
            this.symbol_index.set(file_uri, {
                symbols: analyzeResult.symbols,
                directives: directive_result.directives
            });
            this.version++;
            this.metrics.files_indexed++;
        } catch (error) {
            this.clear_stale_entry(file_uri);
            logger.error(`Failed to index file ${file_path}: ${error}`);
            this.metrics.files_skipped++;
        }
    }

    /**
     * Index a .mata file by extracting function definitions.
     */
    private async index_mata_file(content: string, file_uri: string): Promise<void> {
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

        this.symbol_index.set(file_uri, {
            symbols,
            directives: []
        });
        this.version++;
        this.metrics.files_indexed++;
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
        
        try {
            while (this.update_queue.size > 0 && !this.cancelled) {
                // Get next file from queue
                const file_path = this.update_queue.values().next().value;
                if (!file_path) break;
                this.update_queue.delete(file_path);
                
                // Index the file
                await this.index_file(file_path);
                
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
        
        for (const [uri, entry] of this.symbol_index.entries()) {
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
     * Resolve a program name to its definition location.
     * Follows Stata resolution order:
     * 1. Current directory of the referring file
     * 2. PERSONAL
     * 3. PLUS
     * 4. SITE
     */
    /**
     * Resolve a .sthlp help file by topic name.
     *
     * Searches ado_paths and workspace roots following Stata's
     * letter-subdirectory convention (e.g., `r/regress.sthlp`).
     * Returns the absolute file path or null.
     */
    async resolve_sthlp_file(topic: string): Promise<string | null> {
        const my_basename = `${topic}.sthlp`;
        const my_first_letter = topic.charAt(0).toLowerCase();

        // Search ado_paths first (PERSONAL, PLUS, SITE, BASE order),
        // then workspace roots
        const the_search_dirs = [...this.ado_paths, ...this.workspace_roots];

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
                if (my_dirent.isDirectory()) {
                    if (!WorkspaceIndexer.EXCLUDED_DIRS.has(my_dirent.name)) {
                        the_dirs.push({
                            path: my_path,
                            depth: my_entry.depth + 1,
                        });
                    }
                    continue;
                }
                if (
                    my_dirent.isFile() &&
                    my_dirent.name === basename
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
