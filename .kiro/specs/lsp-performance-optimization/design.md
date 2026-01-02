# Design Document: LSP Performance Optimization

## Overview

This design addresses critical performance bottlenecks in the Stata LSP server by eliminating redundant work, introducing caching layers, and optimizing hot-path algorithms. The changes maintain backward compatibility while significantly improving responsiveness.

## Future Considerations

The following optimizations are out of scope for this iteration but should be considered for future work:

- **Incremental parsing**: Range-based re-tokenization or tree-diff to avoid full re-parse on small edits
- **Disk-based symbol cache**: Persist parsed symbols with mtime+hash to skip re-parse on unchanged files at startup
- **Cooperative async parsing**: Refactor lex/parse/analyze to yield periodically with setImmediate/AbortSignal for true interruptibility
- **Large file handling**: Skip or sample files over size threshold during workspace indexing

### Cooperative Async Parsing Roadmap

Current lex/parse/analyze are synchronous. Timeouts report completion time but cannot preempt mid-operation. To achieve true CPU protection:

**Phase 1 (This iteration)**: Timeouts + metrics to identify pathological files
**Phase 2 (Future)**: Chunked lexer with yield points every N tokens
**Phase 3 (Future)**: AbortSignal integration for debounce cancellation
**Phase 4 (Future)**: Workspace indexer with per-file cancellation on workspace change

Implementation approach:
```typescript
// Future: Chunked lexer with cooperative yielding
async function tokenize_chunked(
    source: string, 
    signal?: AbortSignal
): Promise<LexerResult> {
    const CHUNK_SIZE = 1000; // tokens per chunk
    let tokens: Token[] = [];
    
    while (has_more_tokens()) {
        if (signal?.aborted) throw new AbortError();
        
        // Process chunk
        const chunk = tokenize_next_chunk(CHUNK_SIZE);
        tokens.push(...chunk);
        
        // Yield to event loop
        await new Promise(resolve => setImmediate(resolve));
    }
    
    return { tokens, ... };
}
```

## Design Constraints

- **Sync operations**: Current lex/parse/analyze are synchronous. Timeouts report after completion, not interrupt mid-operation. True interruptibility requires future refactoring (see Cooperative Async Parsing Roadmap).
- **Memory ceiling**: Target max 50 open documents cached, ~100MB total token bytes. Exceeding triggers LRU eviction.
- **Diagnostics config**: Filtering considers severity, enabled, suppressions, lint_rules, and ado_paths. All are included in config hash for cache invalidation.
- **Concurrent parses**: max_concurrent_parses auto-scales based on CPU cores (default: min(2, cores/2)), configurable via constructor.

## Architecture

The optimizations follow a layered approach:

```
┌─────────────────────────────────────────────────────────────┐
│                      LSP Server                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Debounce Layer (NEW)                    │    │
│  │  - Batches rapid document changes                    │    │
│  │  - Configurable window (default 150ms)               │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Document Store (MODIFIED)                  │    │
│  │  - Single parse per version                          │    │
│  │  - Caches tokens, AST, symbols, context_tracker      │    │
│  │  - Owns Line_Offset_Index                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Providers (MODIFIED)                    │    │
│  │  - Reuse cached parse results                        │    │
│  │  - Completion prefix cache (LRU)                     │    │
│  │  - Binary search for context ranges                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Enhanced DocumentState Interface

```typescript
interface DocumentState {
    uri: string;
    version: number;
    content: string;
    
    // Cached parse results (NEW: tokens added)
    tokens: Token[];
    ast: StataAST | null;
    symbols: SymbolTable;
    diagnostics: Diagnostic[];
    
    // Context tracking (existing, but now single source of truth)
    context_ranges: ContextRange[];
    context_tracker: ContextTracker;
    
    // NEW: Line offset index for O(1) position lookups
    line_offsets: number[];
}
```

### 2. Enhanced LexerResult Interface

The lexer builds line offsets during tokenization (single pass), avoiding double traversal.

```typescript
interface LexerResult {
    tokens: Token[];
    errors: LexerError[];
    finalState: LexerState;
    
    // NEW: Pre-computed line offsets (built during tokenization)
    line_offsets: number[];
}
```

### 3. Debounce Manager

```typescript
interface DebounceManager {
    /**
     * Schedule a document validation after debounce window.
     * Cancels any pending validation for the same URI.
     */
    schedule_validation(
        uri: string, 
        version: number,
        callback: () => Promise<void>
    ): void;
    
    /**
     * Cancel pending validation for a document.
     */
    cancel(uri: string): void;
    
    /**
     * Clean up when document is closed.
     */
    on_close(uri: string): void;
    
    /**
     * Get debounce window in milliseconds.
     */
    get_debounce_ms(): number;
    
    /**
     * Set debounce window in milliseconds.
     */
    set_debounce_ms(ms: number): void;
}

class DocumentDebounceManager implements DebounceManager {
    private pending_timers: Map<string, NodeJS.Timeout> = new Map();
    private debounce_ms: number = 150;
    private active_parses: number = 0;
    private max_concurrent_parses: number;
    private readonly MAX_QUEUE_LENGTH = 20;
    private parse_queue: Array<{ 
        uri: string; 
        version: number;
        callback: () => Promise<void> 
    }> = [];
    private current_versions: Map<string, number> = new Map();
    
    // Metrics
    private metrics = {
        merged_parses: 0,      // Parses avoided due to debounce
        dropped_parses: 0,     // Parses dropped due to queue full
        stale_parses: 0,       // Parses skipped due to version staleness
    };
    
    constructor(config?: { max_concurrent_parses?: number }) {
        // Default to min(2, cores/2), prefer os.cpus() for Node.js LSP process
        let cpu_count = 2;
        try {
            // Node.js environment
            cpu_count = require('os').cpus().length;
        } catch {
            // Browser environment (unlikely for LSP, but safe fallback)
            if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
                cpu_count = navigator.hardwareConcurrency;
            }
        }
        this.max_concurrent_parses = config?.max_concurrent_parses 
            ?? Math.max(1, Math.min(2, Math.floor(cpu_count / 2)));
    }
    
    schedule_validation(
        uri: string, 
        version: number,
        callback: () => Promise<void>
    ): void {
        // Track current version for staleness check
        const prev_version = this.current_versions.get(uri);
        this.current_versions.set(uri, version);
        
        // If we're replacing a pending timer, count as merged
        if (this.pending_timers.has(uri)) {
            this.metrics.merged_parses++;
        }
        
        // Cancel existing timer for this URI
        this.cancel(uri);
        
        // Schedule new timer
        const timer = setTimeout(() => {
            this.pending_timers.delete(uri);
            this.enqueue_parse(uri, version, callback);
        }, this.debounce_ms);
        
        this.pending_timers.set(uri, timer);
    }
    
    private enqueue_parse(
        uri: string, 
        version: number,
        callback: () => Promise<void>
    ): void {
        // Drop if queue is full (backpressure)
        if (this.parse_queue.length >= this.MAX_QUEUE_LENGTH) {
            console.warn(`Parse queue full, dropping ${uri} v${version}`);
            this.metrics.dropped_parses++;
            return;
        }
        
        if (this.active_parses < this.max_concurrent_parses) {
            // Fire and forget, but handle errors
            this.execute_parse(uri, version, callback).catch(err => {
                console.error(`Parse failed for ${uri}:`, err);
            });
        } else {
            // Queue for later execution (backpressure)
            this.parse_queue.push({ uri, version, callback });
        }
    }
    
    private async execute_parse(
        uri: string, 
        version: number,
        callback: () => Promise<void>
    ): Promise<void> {
        // Version guard: skip if stale
        const current = this.current_versions.get(uri);
        if (current !== undefined && version < current) {
            console.debug(`Skipping stale parse for ${uri} v${version} (current: v${current})`);
            this.metrics.stale_parses++;
            return;
        }
        
        this.active_parses++;
        try {
            // Yield to event loop before starting parse
            await new Promise(resolve => setImmediate(resolve));
            await callback();
        } catch (error) {
            // Log but don't rethrow - parse failures shouldn't crash the server
            console.error(`Parse error for ${uri}:`, error);
        } finally {
            this.active_parses--;
            this.process_queue();
        }
    }
    
    private process_queue(): void {
        // Remove stale items from queue
        const before_length = this.parse_queue.length;
        this.parse_queue = this.parse_queue.filter(item => {
            const current = this.current_versions.get(item.uri);
            return current === undefined || item.version >= current;
        });
        this.metrics.stale_parses += before_length - this.parse_queue.length;
        
        if (this.parse_queue.length > 0 && 
            this.active_parses < this.max_concurrent_parses) {
            const next = this.parse_queue.shift()!;
            // Fire and forget with error handling
            this.execute_parse(next.uri, next.version, next.callback).catch(err => {
                console.error(`Queued parse failed for ${next.uri}:`, err);
            });
        }
    }
    
    /**
     * Check if a document has a pending parse (in debounce or queue).
     * Used to determine if diagnostics request should wait or use cached.
     */
    is_pending(uri: string): boolean {
        return this.pending_timers.has(uri) || 
               this.parse_queue.some(item => item.uri === uri);
    }
    
    cancel(uri: string): void {
        const existing = this.pending_timers.get(uri);
        if (existing) {
            clearTimeout(existing);
            this.pending_timers.delete(uri);
        }
        // Also remove from queue if pending
        this.parse_queue = this.parse_queue.filter(item => item.uri !== uri);
    }
    
    /**
     * Call when document is closed to clean up tracking.
     */
    on_close(uri: string): void {
        this.cancel(uri);
        this.current_versions.delete(uri);
    }
    
    get_debounce_ms(): number {
        return this.debounce_ms;
    }
    
    set_debounce_ms(ms: number): void {
        this.debounce_ms = ms;
    }
    
    get_metrics(): typeof this.metrics {
        return { ...this.metrics };
    }
}
```

### 4. LRU Cache for Completion Prefixes

Cache is keyed by (prefix, context) to avoid collisions across Mata/Stata/Python scopes.

**Cache Invalidation Triggers:**
- Command database changes (built-in commands updated)
- Ado path changes (user config update)
- Workspace command set version change (new .ado files indexed)

```typescript
interface CompletionCacheKey {
    prefix: string;
    context: 'stata' | 'mata' | 'python';
}

interface LRUCache<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    clear(): void;
    size(): number;
    get_stats(): { hits: number; misses: number; evictions: number };
}

class CompletionPrefixCache implements LRUCache<string, CompletionItem[]> {
    private cache: Map<string, CompletionItem[]> = new Map();
    private max_size: number;
    private hits: number = 0;
    private misses: number = 0;
    private evictions: number = 0;
    private command_db_version: number = 0;
    
    constructor(max_size: number = 100) {
        this.max_size = max_size;
    }
    
    private make_key(prefix: string, context: string): string {
        return `${context}:${prefix}`;
    }
    
    get_with_context(
        prefix: string, 
        context: string
    ): CompletionItem[] | undefined {
        return this.get(this.make_key(prefix, context));
    }
    
    set_with_context(
        prefix: string, 
        context: string, 
        value: CompletionItem[]
    ): void {
        this.set(this.make_key(prefix, context), value);
    }
    
    get(key: string): CompletionItem[] | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.hits++;
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        } else {
            this.misses++;
        }
        return value;
    }
    
    set(key: string, value: CompletionItem[]): void {
        // Remove if exists to update position
        this.cache.delete(key);
        
        // Evict oldest if at capacity
        if (this.cache.size >= this.max_size) {
            const oldest_key = this.cache.keys().next().value;
            this.cache.delete(oldest_key);
            this.evictions++;
        }
        
        this.cache.set(key, value);
    }
    
    has(key: string): boolean {
        return this.cache.has(key);
    }
    
    clear(): void {
        this.cache.clear();
        // Keep stats for monitoring
    }
    
    /**
     * Call when command database or ado paths change.
     */
    invalidate_on_db_change(new_version: number): void {
        if (new_version !== this.command_db_version) {
            this.command_db_version = new_version;
            this.clear();
        }
    }
    
    size(): number {
        return this.cache.size;
    }
    
    get_stats(): { hits: number; misses: number; evictions: number } {
        return { hits: this.hits, misses: this.misses, evictions: this.evictions };
    }
}
```

### 5. Line Offset Index Builder

Line offsets are built inside the lexer during tokenization (single pass). These helper functions are for reference and testing.

```typescript
/**
 * Build an index mapping line numbers to byte offsets.
 * line_offsets[i] = byte offset where line i starts.
 * line_offsets[0] = 0 (first line starts at offset 0).
 * 
 * NOTE: In production, this is built inside the lexer during tokenization
 * to avoid double traversal.
 */
function build_line_offset_index(source: string): number[] {
    const line_offsets: number[] = [0];
    
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') {
            line_offsets.push(i + 1);
        }
    }
    
    return line_offsets;
}

/**
 * Convert line/column to byte offset using pre-computed index.
 * O(1) time complexity.
 * Returns -1 for out-of-bounds line or column.
 */
function position_to_offset(
    line: number,
    column: number,
    line_offsets: number[],
    source_length: number
): number {
    if (line < 0 || line >= line_offsets.length) {
        return -1;
    }
    
    const line_start = line_offsets[line];
    const line_end = line + 1 < line_offsets.length 
        ? line_offsets[line + 1] - 1  // Exclude newline
        : source_length;
    const line_length = line_end - line_start;
    
    if (column < 0 || column > line_length) {
        return -1;
    }
    
    return line_start + column;
}
```

### 6. Binary Search for Context Ranges

Context ranges are sorted by (start.line, start.character, end.line, end.character) to handle nesting correctly. Ranges may nest but not partially overlap.

```typescript
/**
 * Find context range containing position using binary search.
 * Assumes context_ranges is sorted by start position, then by end position
 * (descending) to handle nesting—outer ranges come before inner ranges.
 * O(log n) time complexity.
 */
function find_context_range_binary(
    position: Position,
    context_ranges: ContextRange[]
): ContextRange | undefined {
    if (context_ranges.length === 0) {
        return undefined;
    }
    
    let low = 0;
    let high = context_ranges.length - 1;
    let result: ContextRange | undefined = undefined;
    
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const range = context_ranges[mid];
        
        const cmp = compare_position_to_range(position, range.range);
        
        if (cmp < 0) {
            // Position is before this range
            high = mid - 1;
        } else if (cmp > 0) {
            // Position is after this range
            low = mid + 1;
        } else {
            // Position is within this range
            result = range;
            // Continue searching right for more specific (nested) ranges
            low = mid + 1;
        }
    }
    
    return result;
}

/**
 * Compare position to range.
 * Returns: -1 if position before range, 0 if inside, 1 if after.
 */
function compare_position_to_range(
    position: Position, 
    range: Range
): number {
    if (position.line < range.start.line ||
        (position.line === range.start.line && 
         position.character < range.start.character)) {
        return -1;
    }
    if (position.line > range.end.line ||
        (position.line === range.end.line && 
         position.character > range.end.character)) {
        return 1;
    }
    return 0;
}
```

### 7. Parse Timeout Wrapper

Wraps parse operations with a timeout to prevent pathological files from blocking the queue.

```typescript
const PARSE_TIMEOUT_MS = 5000; // 5 second timeout

interface ParseResult<T> {
    success: boolean;
    result?: T;
    error?: string;
    timed_out: boolean;
}

/**
 * Execute a parse operation with timeout.
 * Returns early if operation exceeds timeout.
 * 
 * NOTE: This assumes the operation is synchronous. If parse stages become
 * async in the future, wrap operation() in Promise.resolve() to handle both.
 */
async function with_parse_timeout<T>(
    operation: () => T,
    timeout_ms: number = PARSE_TIMEOUT_MS
): Promise<ParseResult<T>> {
    return new Promise((resolve) => {
        let completed = false;
        
        const timer = setTimeout(() => {
            if (!completed) {
                completed = true;
                resolve({ 
                    success: false, 
                    timed_out: true,
                    error: `Parse operation timed out after ${timeout_ms}ms`
                });
            }
        }, timeout_ms);
        
        // Run operation in next tick to allow timeout to be set up
        setImmediate(() => {
            if (completed) return;
            
            try {
                const result = operation();
                if (!completed) {
                    completed = true;
                    clearTimeout(timer);
                    resolve({ success: true, result, timed_out: false });
                }
            } catch (error) {
                if (!completed) {
                    completed = true;
                    clearTimeout(timer);
                    resolve({ 
                        success: false, 
                        error: String(error),
                        timed_out: false 
                    });
                }
            }
        });
    });
}
```

## Data Models

### Modified DocumentStore

The DocumentStore is modified to:
1. Store tokens in DocumentState
2. Parse exactly once per version
3. Own the single ContextTracker instance
4. Use lexer-provided line offsets (single pass)
5. Skip work on didSave if no edits since last parse
6. LRU eviction when exceeding MAX_DOCUMENTS or MAX_TOKEN_BYTES
7. Lightweight metrics for monitoring

```typescript
interface DocumentStoreMetrics {
    parse_count: number;
    parse_total_ms: number;
    cache_hits: number;
    cache_misses: number;
    evictions: number;
}

class DocumentStore {
    private documents: Map<string, DocumentState> = new Map();
    private access_order: string[] = []; // LRU tracking
    private lexer = new StataLexer();
    private parser = new StataParser();
    private analyzer = new SemanticAnalyzer();
    
    private readonly MAX_DOCUMENTS = 50;
    private readonly MAX_TOKEN_BYTES = 100 * 1024 * 1024; // 100MB
    
    private metrics: DocumentStoreMetrics = {
        parse_count: 0,
        parse_total_ms: 0,
        cache_hits: 0,
        cache_misses: 0,
        evictions: 0,
    };

    async open(uri: string, content: string, version: number): Promise<void> {
        this.evict_if_needed(content.length);
        const state = await this.create_document_state(uri, content, version);
        this.documents.set(uri, state);
        this.touch_access(uri);
    }

    async update(uri: string, changes: TextDocumentContentChangeEvent[], 
           version: number): Promise<void> {
        const state = this.documents.get(uri);
        if (!state) return;
        
        // Skip if version hasn't changed (idempotent)
        if (state.version >= version) {
            this.metrics.cache_hits++;
            return;
        }
        
        this.metrics.cache_misses++;
        
        // Apply text changes
        const new_content = this.apply_changes(state.content, changes);
        
        // Fast path: skip if content unchanged (e.g., didSave with no edits)
        if (new_content === state.content) {
            // Just update version, reuse everything else
            state.version = version;
            this.metrics.cache_hits++;
            return;
        }
        
        // Create new state with fresh parse
        const new_state = await this.create_document_state(
            uri, new_content, version
        );
        this.documents.set(uri, new_state);
        this.touch_access(uri);
    }
    
    close(uri: string): void {
        this.documents.delete(uri);
        this.access_order = this.access_order.filter(u => u !== uri);
    }
    
    get(uri: string): DocumentState | undefined {
        const state = this.documents.get(uri);
        if (state) {
            this.touch_access(uri);
        }
        return state;
    }
    
    get_metrics(): DocumentStoreMetrics {
        return { ...this.metrics };
    }
    
    private touch_access(uri: string): void {
        this.access_order = this.access_order.filter(u => u !== uri);
        this.access_order.push(uri);
    }
    
    private evict_if_needed(incoming_bytes: number): void {
        // Evict by document count
        while (this.documents.size >= this.MAX_DOCUMENTS && 
               this.access_order.length > 0) {
            const oldest = this.access_order.shift()!;
            this.documents.delete(oldest);
            this.metrics.evictions++;
        }
        
        // Evict by total token bytes
        let total_bytes = this.estimate_total_bytes();
        while (total_bytes + incoming_bytes > this.MAX_TOKEN_BYTES && 
               this.access_order.length > 0) {
            const oldest = this.access_order.shift()!;
            this.documents.delete(oldest);
            this.metrics.evictions++;
            total_bytes = this.estimate_total_bytes();
        }
    }
    
    private estimate_total_bytes(): number {
        let total = 0;
        for (const state of this.documents.values()) {
            // Rough estimate: content length + token count * avg token size
            total += state.content.length + state.tokens.length * 50;
        }
        return total;
    }

    private async create_document_state(
        uri: string, 
        content: string, 
        version: number
    ): Promise<DocumentState> {
        const start_time = Date.now();
        this.metrics.parse_count++;
        
        // Tokenize with timeout - lexer builds line_offsets during single pass
        const lex_result = await with_parse_timeout(
            () => this.lexer.tokenize(content)
        );
        
        if (!lex_result.success || lex_result.timed_out) {
            // Return minimal state on timeout/error
            // Reuse any partial line_offsets from lexer if available
            return this.create_error_state(uri, content, version, 
                lex_result.error || 'Lexer timeout',
                lex_result.result?.line_offsets);
        }
        
        // Initialize context tracker using lexer tokens (no re-scan)
        const context_tracker = new ContextTracker();
        context_tracker.initialize_from_tokens(lex_result.result!.tokens);
        
        // Validate context ranges are sorted (debug assertion)
        const context_ranges = context_tracker.get_all_context_ranges();
        this.assert_ranges_sorted(context_ranges);
        
        // Parse with timeout (no context tracker creation inside)
        const parse_result = await with_parse_timeout(
            () => this.parser.parse(lex_result.result!.tokens)
        );
        
        if (!parse_result.success || parse_result.timed_out) {
            return this.create_error_state(uri, content, version,
                parse_result.error || 'Parser timeout',
                lex_result.result!.line_offsets);
        }
        
        // Analyze with timeout and explicit parameters (no hidden defaults)
        const analyze_result = await with_parse_timeout(
            () => this.analyzer.analyze(
                parse_result.result!.ast, 
                uri, 
                lex_result.result!.tokens
            )
        );
        
        const elapsed_ms = Date.now() - start_time;
        this.metrics.parse_total_ms += elapsed_ms;
        
        if (!analyze_result.success || analyze_result.timed_out) {
            // Return partial state with AST but no analysis
            return {
                uri,
                version,
                content,
                tokens: lex_result.result!.tokens,
                ast: parse_result.result!.ast,
                symbols: { macros: new Map(), programs: new Map() },
                diagnostics: [{
                    severity: DiagnosticSeverity.Warning,
                    message: analyze_result.error || 'Analyzer timeout',
                    range: { start: { line: 0, character: 0 }, 
                             end: { line: 0, character: 0 } }
                }],
                context_ranges,
                context_tracker,
                line_offsets: lex_result.result!.line_offsets,
            };
        }
        
        // Build diagnostics
        const diagnostics = this.build_diagnostics(
            lex_result.result!.errors,
            parse_result.result!.errors,
            analyze_result.result!.diagnostics
        );
        
        return {
            uri,
            version,
            content,
            tokens: lex_result.result!.tokens,
            ast: parse_result.result!.ast,
            symbols: analyze_result.result!.symbols,
            diagnostics,
            context_ranges,
            context_tracker,
            line_offsets: lex_result.result!.line_offsets,
        };
    }
    
    /**
     * Assert context ranges are sorted by start position.
     * In debug builds, throws if invariant violated.
     */
    private assert_ranges_sorted(ranges: ContextRange[]): void {
        if (process.env.NODE_ENV === 'development') {
            for (let i = 1; i < ranges.length; i++) {
                const prev = ranges[i - 1];
                const curr = ranges[i];
                if (prev.range.start.line > curr.range.start.line ||
                    (prev.range.start.line === curr.range.start.line &&
                     prev.range.start.character > curr.range.start.character)) {
                    throw new Error('Context ranges not sorted');
                }
            }
        }
    }
    
    private create_error_state(
        uri: string,
        content: string,
        version: number,
        error_message: string,
        line_offsets?: number[]
    ): DocumentState {
        // Reuse provided line_offsets or build new ones
        const offsets = line_offsets || build_line_offset_index(content);
        return {
            uri,
            version,
            content,
            tokens: [],
            ast: null,
            symbols: { macros: new Map(), programs: new Map() },
            diagnostics: [{
                severity: DiagnosticSeverity.Error,
                message: error_message,
                range: { start: { line: 0, character: 0 }, 
                         end: { line: 0, character: 0 } }
            }],
            context_ranges: [],
            context_tracker: new ContextTracker(),
            line_offsets: offsets,
        };
    }
}
```

### Modified DiagnosticsProvider

The DiagnosticsProvider is modified to reuse cached results. Cache is keyed by (document version, config hash) to handle config changes.

```typescript
class DiagnosticsProvider {
    // Remove: private lexer, parser, analyzer, context_tracker
    // These are no longer needed - we use DocumentState's cached results
    
    private filtered_cache: Map<string, { 
        version: number; 
        config_hash: string; 
        diagnostics: Diagnostic[] 
    }> = new Map();
    
    get_diagnostics(
        document: DocumentState,
        config: StataLSPConfig,
        workspace_symbols?: SymbolTable,
        debounce_manager?: DebounceManager
    ): { diagnostics: Diagnostic[]; pending: boolean } {
        if (!config?.diagnostics?.enabled) {
            return { diagnostics: [], pending: false };
        }
        
        // Check if parse is pending (debounce in progress)
        const is_pending = debounce_manager?.is_pending(document.uri) ?? false;
        
        const config_hash = this.compute_config_hash(config);
        const cached = this.filtered_cache.get(document.uri);
        
        // Return cached filtered diagnostics if version and config match
        if (cached && 
            cached.version === document.version && 
            cached.config_hash === config_hash) {
            return { diagnostics: cached.diagnostics, pending: is_pending };
        }
        
        // Recompute filtered diagnostics
        const filtered = document.diagnostics.filter(diag => 
            this.should_include_diagnostic(diag, config)
        );
        
        // Cache the filtered result
        this.filtered_cache.set(document.uri, {
            version: document.version,
            config_hash,
            diagnostics: filtered,
        });
        
        return { diagnostics: filtered, pending: is_pending };
    }
    
    /**
     * Compute hash of all diagnostics config that affects filtering.
     * Includes severity, enabled, suppressions, and lint toggles.
     */
    private compute_config_hash(config: StataLSPConfig): string {
        const relevant = {
            enabled: config?.diagnostics?.enabled,
            severity: config?.diagnostics?.severity,
            suppressions: config?.diagnostics?.suppressions,
            lint_rules: config?.diagnostics?.lint_rules,
            ado_paths: config?.ado_paths,
        };
        return JSON.stringify(relevant);
    }
    
    /**
     * Clear cache for a document (call on document close).
     */
    clear_cache(uri: string): void {
        this.filtered_cache.delete(uri);
    }
}
```

### Modified WorkspaceIndexer

```typescript
interface IndexerMetrics {
    files_indexed: number;
    files_skipped: number;  // Due to size or error
    total_index_time_ms: number;
    avg_file_time_ms: number;
}

class WorkspaceIndexer {
    private symbol_index: Map<string, SymbolTable> = new Map();
    private lexer = new StataLexer();
    private parser = new StataParser();
    private analyzer = new SemanticAnalyzer();
    
    private readonly BATCH_SIZE = 10;
    private readonly MAX_PARALLEL = 4; // Limit parallelism to avoid CPU saturation
    private readonly MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB - skip larger files
    private readonly YIELD_INTERVAL_MS = 50; // Yield every 50ms of CPU time
    
    private cancelled: boolean = false;
    private metrics: IndexerMetrics = {
        files_indexed: 0,
        files_skipped: 0,
        total_index_time_ms: 0,
        avg_file_time_ms: 0,
    };

    async initialize(
        workspace_folders: string[], 
        ado_paths: string[] = []
    ): Promise<void> {
        this.cancelled = false;
        const start_time = Date.now();
        const the_files: string[] = [];
        
        // Collect all files first (async)
        for (const my_folder of workspace_folders) {
            if (this.cancelled) return;
            await this.collect_files(my_folder, the_files);
        }
        
        // Process with limited concurrency using promise-based worker pool
        await this.process_with_pool(the_files, this.MAX_PARALLEL);
        
        this.metrics.total_index_time_ms = Date.now() - start_time;
        if (this.metrics.files_indexed > 0) {
            this.metrics.avg_file_time_ms = 
                this.metrics.total_index_time_ms / this.metrics.files_indexed;
        }
    }
    
    /**
     * Cancel ongoing indexing (e.g., on workspace change).
     */
    cancel(): void {
        this.cancelled = true;
    }
    
    /**
     * Process files with limited concurrency (no busy-wait).
     * Uses a promise-based pool pattern with cancellation support.
     */
    private async process_with_pool(
        files: string[], 
        concurrency: number
    ): Promise<void> {
        let index = 0;
        let last_yield_time = Date.now();
        
        const worker = async (): Promise<void> => {
            while (index < files.length && !this.cancelled) {
                const file_path = files[index++];
                await this.index_file(file_path);
                
                // Yield to event loop periodically based on elapsed time
                const now = Date.now();
                if (now - last_yield_time > this.YIELD_INTERVAL_MS) {
                    await new Promise(resolve => setImmediate(resolve));
                    last_yield_time = Date.now();
                }
            }
        };
        
        // Start `concurrency` workers
        const the_workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, files.length); i++) {
            the_workers.push(worker());
        }
        
        await Promise.all(the_workers);
    }

    private async collect_files(
        dir_path: string, 
        result: string[]
    ): Promise<void> {
        if (this.cancelled) return;
        
        try {
            const entries = await fs.promises.readdir(dir_path, { 
                withFileTypes: true 
            });
            
            for (const my_entry of entries) {
                if (this.cancelled) return;
                
                const entry_path = path.join(dir_path, my_entry.name);
                
                if (my_entry.isDirectory()) {
                    await this.collect_files(entry_path, result);
                } else if (my_entry.isFile()) {
                    if (my_entry.name.endsWith('.do') || 
                        my_entry.name.endsWith('.ado')) {
                        result.push(entry_path);
                    }
                }
            }
        } catch (error) {
            // Directory doesn't exist or not readable
        }
    }

    async index_file(file_path: string): Promise<void> {
        if (this.cancelled) return;
        
        try {
            // Check file size before reading
            const stats = await fs.promises.stat(file_path);
            if (stats.size > this.MAX_FILE_SIZE_BYTES) {
                console.debug(`Skipping large file: ${file_path} (${stats.size} bytes)`);
                this.metrics.files_skipped++;
                return;
            }
            
            const content = await fs.promises.readFile(file_path, 'utf8');
            const file_uri = URI.file(file_path).toString();

            const lex_result = this.lexer.tokenize(content);
            const parse_result = this.parser.parse(lex_result.tokens);
            const analyze_result = this.analyzer.analyze(
                parse_result.ast, 
                file_uri
            );

            this.symbol_index.set(file_uri, analyze_result.symbols);
            this.metrics.files_indexed++;
        } catch (error) {
            // File read failed, skip
            this.metrics.files_skipped++;
        }
    }
    
    get_metrics(): IndexerMetrics {
        return { ...this.metrics };
    }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Parse Caching Consistency

*For any* document and sequence of updates with the same version number, the Document_Store SHALL parse exactly once and return identical cached results for subsequent accesses.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Single Context Tracker Instance

*For any* document open or update operation, exactly one Context_Tracker instance SHALL be created and stored in DocumentState.

**Validates: Requirements 2.1**

### Property 3: Line Offset Index Correctness

*For any* document content and valid line/column position, the Line_Offset_Index SHALL return the correct byte offset such that `content.substring(offset, offset + 1)` equals the character at that position.

**Validates: Requirements 3.2**

### Property 4: Linear Tokenization Scaling

*For any* document, tokenization time SHALL scale linearly with document size. Specifically, for documents of size n and 2n, the ratio of tokenization times SHALL be approximately 2 (within a tolerance factor).

**Validates: Requirements 3.5**

### Property 5: Debounce Batching

*For any* sequence of rapid document changes within the debounce window, the Server SHALL execute exactly one parse operation after the window expires.

**Validates: Requirements 5.1, 5.3**

### Property 6: Completion Cache Hit Rate

*For any* prefix requested multiple times without command database changes, the Completion_Provider SHALL return cached results without re-querying the database.

**Validates: Requirements 6.1, 6.2**

### Property 7: LRU Cache Bounded Size

*For any* sequence of cache insertions, the cache size SHALL never exceed the configured maximum, and the least recently used entries SHALL be evicted first.

**Validates: Requirements 6.4**

### Property 8: Context Ranges Sorted Invariant

*For any* document after Context_Tracker initialization, the context_ranges array SHALL be sorted by start position (line, then character).

**Validates: Requirements 7.1**

### Property 9: Binary Search Logarithmic Scaling

*For any* document with n context ranges, position lookup time SHALL scale logarithmically. Specifically, doubling the number of ranges SHALL increase lookup time by at most a constant factor.

**Validates: Requirements 7.3**

## Error Handling

### Debounce Edge Cases

- If a document is closed during debounce, cancel the pending timer and remove from queue
- If validation fails, still clear the pending timer to avoid retry loops
- Handle race conditions where document version changes during debounce
- Global concurrent parse limit (MAX_CONCURRENT_PARSES=2) prevents CPU spikes from watcher-triggered changes

### Cache Invalidation

- Clear completion cache when command database is modified
- Clear completion cache when ado paths change
- Clear document cache when document is closed
- Handle concurrent access to caches (Map operations are atomic in JS)

### Line Offset Index Bounds

- Return -1 for out-of-bounds line numbers
- Handle empty documents (single entry: [0])
- Handle documents without trailing newline

### Context Range Invariants

- Ranges may nest but must not partially overlap
- Ranges are sorted by (start.line, start.character) ascending
- For nested ranges at same start, outer ranges come before inner (sorted by end descending)

### Parse Timeouts

- Parse operations (lex, parse, analyze) are wrapped with 5-second timeout
- On timeout, return partial/error state with diagnostic message
- Prevents pathological files from blocking the debounce queue
- Timeout is configurable via PARSE_TIMEOUT_MS constant

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Line offset index building**
   - Empty document
   - Single line document
   - Multi-line document with various line endings

2. **Binary search edge cases**
   - Empty context ranges
   - Single context range
   - Position before all ranges
   - Position after all ranges
   - Position exactly at range boundary
   - Nested ranges (inner should be found)

3. **LRU cache eviction**
   - Cache at capacity
   - Access pattern affecting eviction order
   - Context-aware key generation

4. **Debounce timer management**
   - Timer cancellation
   - Multiple rapid changes
   - Queue backpressure when at concurrent limit

### Property-Based Tests

Property tests verify universal properties across generated inputs using fast-check:

1. **Parse caching**: Generate random documents and update sequences
2. **Line offset correctness**: Generate random documents and positions
3. **Tokenization scaling**: Generate documents of varying sizes
4. **Cache bounded size**: Generate random insertion sequences
5. **Context range sorting**: Generate documents with embedded blocks
6. **Binary search correctness**: Generate context ranges and positions

Each property test runs minimum 100 iterations with shrinking on failure.

**Test Configuration:**
- Framework: fast-check (already in project)
- Minimum iterations: 100
- Tag format: **Feature: lsp-performance-optimization, Property N: {property_text}**

### Performance Regression Tests

Budget-based tests that fail if performance exceeds thresholds:

1. **Tokenization time budget**
   - 1KB file: < 10ms
   - 10KB file: < 50ms
   - 100KB file: < 500ms
   - Verify linear scaling (2x file size ≈ 2x time, ±20% tolerance)

2. **Parse time budget**
   - Similar thresholds scaled for parse complexity

3. **Context lookup budget**
   - 100 ranges: < 1ms for 1000 lookups
   - 1000 ranges: < 2ms for 1000 lookups (verify log scaling)

### Metrics Validation Tests

Tests that verify metrics are collected and within expected ranges:

1. **DocumentStore metrics**
   - parse_count increments on each parse
   - cache_hits increments on version match
   - evictions occur when exceeding MAX_DOCUMENTS

2. **Debounce metrics**
   - merged_parses increments when timer replaced
   - dropped_parses increments when queue full
   - stale_parses increments when version outdated

3. **Completion cache metrics**
   - hits/misses ratio improves with repeated prefixes
   - evictions occur at max_size boundary

4. **Indexer metrics**
   - files_skipped increments for large files
   - avg_file_time_ms within budget (< 100ms per file)

**Alert thresholds for production monitoring:**
- parse_total_ms / parse_count > 500ms → slow parse warning
- dropped_parses > 10 in 1 minute → backpressure alert
- evictions > 20 in 1 minute → memory pressure alert
- cache hit rate < 50% → cache inefficiency warning
