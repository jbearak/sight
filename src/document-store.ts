import { TextDocumentContentChangeEvent, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import {
  StataAST,
  SymbolTable,
  Token,
  DocumentStoreMetrics,
  ForwardCall,
  WorkingDirectoryDirective,
  Directive,
  LexerError,
  ParseError,
  ScopeResolverConfig,
} from './types';
import { undefined_symbol_data_fields } from './utils/undefined-symbol-diagnostic';
import { StataLexer } from './lexer';
import { StataParser } from './parser';
import { SemanticAnalyzer, SemanticDiagnostic } from './analyzer';
import { ContextTracker } from './context-tracker';
import { ContextRange } from './context-tracker/types';
import { with_parse_timeout } from './utils/parse-timeout';
import { DirectiveParser } from './directive-parser';
import { ScopeResolver } from './scope-resolver';
import {
  get_workspace_root_for_uri,
  resolve_working_directory_directive,
} from './utils/workspace-roots';

import * as fs from 'fs';

export interface DocumentState {
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

  // Forward calls detected from commands and directives
  forward_calls: ForwardCall[];

  // Resolved working directory from @lsp-cd directive (for forward scope resolution)
  working_directory?: string;

  // Line-bucketed token index for O(1) line lookup (Req 6.1, 12.1)
  token_line_index: Map<number, Token[]>;

  // Lines suppressed by @lsp-ignore / @lsp-ignore-next directives
  ignored_lines: Set<number>;
}

export class DocumentStore {
  private documents: Map<string, DocumentState> = new Map();
  private access_order: Set<string> = new Set(); // LRU tracking via insertion order
  private active_updates: Map<string, Promise<void>> = new Map();
  private in_flight_counts: Map<string, number> = new Map();
  private readonly MAX_DOCUMENTS = 50;
  private readonly MAX_TOKEN_BYTES = 100 * 1024 * 1024; // 100MB
  private workspace_roots: string[] = [];
  private scope_resolver: ScopeResolver | undefined;
  private scope_resolver_config: Partial<ScopeResolverConfig> = {};
  private on_backward_directives_parsed:
    | ((uri: string, directives: Directive[]) => void)
    | undefined;
  private disposed: boolean = false;

  // Generation counters for close-vs-update safety (Req 16.1, 16.2)
  private generations: Map<string, number> = new Map();
  private committed_generations: Map<string, number> = new Map();
  private closed_generations: Map<string, number> = new Map();

  private metrics: DocumentStoreMetrics = {
    parse_count: 0,
    parse_total_ms: 0,
    cache_hits: 0,
    cache_misses: 0,
    evictions: 0,
  };

  /**
   * Set the workspace root directories.
   * Used for resolving workspace-relative paths in @lsp-working-directory directives
   * and for fallback path resolution in forward calls.
   */
  set_workspace_roots(workspace_roots: string[]): void {
    this.workspace_roots = workspace_roots;
  }

  /**
   * Get the current workspace root directories.
   */
  get_workspace_roots(): string[] {
    return this.workspace_roots;
  }

  /**
   * Get the workspace root that contains the given URI.
   * Returns the deepest matching root, falling back to workspace_roots[0].
   */
  get_workspace_root_for_uri(uri: string): string | undefined {
    return get_workspace_root_for_uri(this.workspace_roots, uri);
  }

  /**
   * Set the scope resolver for inheriting working directory from parent files.
   * When a file has backward directives but no own working directory directive,
   * the DocumentStore will use the ScopeResolver to get the inherited working directory.
   */
  set_scope_resolver(scope_resolver: ScopeResolver | undefined): void {
    this.scope_resolver = scope_resolver;
    if (this.scope_resolver) {
      const directive_parser = new DirectiveParser();
      for (const my_state of this.documents.values()) {
        try {
          const directive_result = directive_parser.parse(my_state.content, my_state.uri);
          this.scope_resolver.sync_backward_directive_dependencies(
            my_state.uri,
            directive_result.directives
          );
        } catch {
          // Ignore directive parsing errors during warm-sync
        }
      }
    }
  }

  set_scope_resolver_config(
    config: Partial<ScopeResolverConfig>
  ): void {
    this.scope_resolver_config = config;
  }

  /**
   * Get the current scope resolver.
   */
  get_scope_resolver(): ScopeResolver | undefined {
    return this.scope_resolver;
  }

  /**
   * Register a callback that fires whenever a document's backward
   * directives are reparsed. Used to mirror buffer-state directives
   * into the workspace indexer so find-references reflects unsaved
   * `@lsp-done-by` / `@lsp-included-by` edits without waiting for
   * reindex-from-disk.
   */
  set_on_backward_directives_parsed(
    callback: ((uri: string, directives: Directive[]) => void) | undefined
  ): void {
    this.on_backward_directives_parsed = callback;
  }
  /**
   * Dispose the document store by awaiting all active update
   * promises and clearing the map. (Req 1.3)
   *
   * Only clears active_updates; other maps (documents,
   * generations, etc.) are left for GC since the store
   * instance is discarded after dispose.
   *
   * Sets disposed flag to prevent further use.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const the_promises = Array.from(this.active_updates.values());
    await Promise.allSettled(the_promises);
    this.active_updates.clear();
  }

  /**
   * Check if the store has been disposed.
   * Throws an error if called after disposal.
   */
  private check_disposed(): void {
    if (this.disposed) {
      throw new Error('DocumentStore has been disposed');
    }
  }

  /**
   * Open a document and parse it.
   * Async to support parse timeout wrapper.
   */
  async open(
    uri: string,
    content: string,
    version: number,
    workspace_symbols?: SymbolTable,
    scope_resolver_config?: Partial<ScopeResolverConfig>
  ): Promise<void> {
    this.check_disposed();
    // Capture generation at start of operation (Req 16.2)
    const generation = (this.generations.get(uri) ?? 0) + 1;
    this.generations.set(uri, generation);
    this.increment_in_flight(uri);
    const prior = this.active_updates.get(uri);

    const operation = async () => {
      // Per-URI serialization is the primary guarantee that newer state
      // and cross-file side effects cannot be overwritten by a
      // later-finishing older parse.
      if (prior) {
        try {
          await prior;
        } catch {
          // A prior operation's failure must not block this one.
        }
      }
      if (this.disposed) {
        return;
      }
      this.evict_if_needed(content.length);
      const state = await this.create_document_state(
        uri,
        content,
        version,
        workspace_symbols,
        scope_resolver_config
      );
      this.commit_state(uri, state, generation);
    };

    const promise = operation();
    this.active_updates.set(uri, promise);
    try {
      await promise;
    } finally {
      if (this.active_updates.get(uri) === promise) {
        this.active_updates.delete(uri);
      }
      this.decrement_in_flight(uri);
    }
  }

  /**
   * Update a document with text changes.
   * Async to support parse timeout wrapper.
   * Implements fast path for unchanged content.
   */
  async update(
    uri: string,
    changes: TextDocumentContentChangeEvent[],
    version: number,
    workspace_symbols?: SymbolTable,
    scope_resolver_config?: Partial<ScopeResolverConfig>
  ): Promise<void> {
    this.check_disposed();
    // Capture generation at start of operation (Req 16.2)
    const generation = (this.generations.get(uri) ?? 0) + 1;
    this.generations.set(uri, generation);
    this.increment_in_flight(uri);
    const prior = this.active_updates.get(uri);

    const operation = async () => {
      // Per-URI serialization is the primary guarantee that newer state
      // and cross-file side effects cannot be overwritten by a
      // later-finishing older parse.
      if (prior) {
        try {
          await prior;
        } catch {
          // A prior operation's failure must not block this one.
        }
      }
      if (this.disposed) {
        return;
      }
      const state = this.documents.get(uri);
      if (!state) {
        return;
      }
      const should_reparse_for_scope_config =
        scope_resolver_config !== undefined;

      // Strictly older snapshots are always stale. commit_state only
      // guards by operation generation, which increments per call rather
      // than by document version, so a later-but-older update could
      // otherwise overwrite newer state.
      if (state.version > version) {
        // With per-URI serialization, chained stale updates stop here
        // before create_document_state can apply stale cross-file
        // directive side effects.
        this.metrics.cache_hits++;
        return;
      }

      // Same-version updates are idempotent unless scope config is
      // provided, in which case config-derived state must be recomputed.
      if (state.version === version && !should_reparse_for_scope_config) {
        this.metrics.cache_hits++;
        return;
      }

      this.metrics.cache_misses++;

      // Apply text changes
      const new_content = this.apply_changes(state.content, changes, state.line_offsets);

      // Fast path: skip if content unchanged (e.g., didSave with no edits).
      // Safe to mutate in place: this path is synchronous (no await
      // between the .get() above and this mutation), so close()
      // cannot interleave.
      if (new_content === state.content && !should_reparse_for_scope_config) {
        state.version = version;
        this.metrics.cache_hits++;
        return;
      }

      // Create new state with fresh parse
      const new_state = await this.create_document_state(
        uri,
        new_content,
        version,
        workspace_symbols,
        scope_resolver_config
      );
      this.commit_state(uri, new_state, generation);
    };

    const promise = operation();
    this.active_updates.set(uri, promise);
    try {
      await promise;
    } finally {
      if (this.active_updates.get(uri) === promise) {
        this.active_updates.delete(uri);
      }
      this.decrement_in_flight(uri);
    }
  }

  /**
   * Wait for any active updates for the given URI to complete.
   */
  async wait_for_update(uri: string): Promise<void> {
    const promise = this.active_updates.get(uri);
    if (promise) {
      await promise;
    }
  }

  close(uri: string): void {
    this.check_disposed();
    // Increment generation and record as closed (Req 16.1)
    const current = (this.generations.get(uri) ?? 0) + 1;
    this.generations.set(uri, current);
    this.closed_generations.set(uri, current);
    this.committed_generations.delete(uri);
    this.documents.delete(uri);
    this.access_order.delete(uri);
  }

  get(uri: string): DocumentState | undefined {
    this.check_disposed();
    const state = this.documents.get(uri);
    if (state) {
      this.touch_access(uri);
    }
    return state;
  }

  getAll(): DocumentState[] {
    this.check_disposed();
    return Array.from(this.documents.values());
  }

  /**
   * Get current metrics.
   */
  get_metrics(): DocumentStoreMetrics {
    return { ...this.metrics };
  }

  /**
   * Commit a document state, guarded by generation counter.
   * Discards stale updates if the document was closed after
   * this update started, or if a newer update has already
   * committed. (Req 16.2)
   */
  private commit_state(
    uri: string,
    state: DocumentState,
    generation: number
  ): void {
    const closed_gen = this.closed_generations.get(uri);
    if (closed_gen !== undefined && generation <= closed_gen) {
      return; // Discard stale update (document closed)
    }
    // Operation generations increment per call, not per document
    // version. A later-started older-version update can therefore
    // have a higher generation than a newer committed state; never
    // let it overwrite that newer document version. Equal versions
    // are allowed for same-version reparses such as scope config
    // changes and error-state recovery.
    const existing = this.documents.get(uri);
    if (existing && existing.version > state.version) {
      return;
    }

    // Discard if a newer update has already committed (Req 16.2)
    const current_gen = this.committed_generations.get(uri) ?? 0;
    if (
      generation < current_gen &&
      (!existing || existing.version >= state.version)
    ) {
      return; // A newer update has already committed
    }
    this.documents.set(uri, state);
    this.committed_generations.set(
      uri,
      Math.max(current_gen, generation)
    );
    this.touch_access(uri);
  }

  /**
   * Increment in-flight operation count for a URI.
   */
  private increment_in_flight(uri: string): void {
    this.in_flight_counts.set(
      uri,
      (this.in_flight_counts.get(uri) ?? 0) + 1
    );
  }

  /**
   * Decrement in-flight operation count for a URI.
   * When the count reaches zero and the document is no longer open,
   * cleans up closed_generations and generations to prevent
   * unbounded growth.
   */
  private decrement_in_flight(uri: string): void {
    const count = (this.in_flight_counts.get(uri) ?? 0) - 1;
    if (count < 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `decrement_in_flight: negative count for ${uri} ` +
          `(no matching increment)`
        );
      }
      // Treat negative as zero to prevent invalid state
      this.in_flight_counts.delete(uri);
      if (!this.documents.has(uri)) {
        this.closed_generations.delete(uri);
        this.generations.delete(uri);
        this.committed_generations.delete(uri);
      }
      return;
    }
    if (count === 0) {
      this.in_flight_counts.delete(uri);
      if (!this.documents.has(uri)) {
        this.closed_generations.delete(uri);
        this.generations.delete(uri);
        this.committed_generations.delete(uri);
      }
    } else {
      this.in_flight_counts.set(uri, count);
    }
  }

  /**
   * Applies a series of text document changes to the content.
   * 
   * @param content - The original document content
   * @param changes - The changes to apply
   * @param initial_offsets - Optional line offsets for the initial content
   * @returns The updated content
   */
  private apply_changes(
    content: string,
    changes: TextDocumentContentChangeEvent[],
    initial_offsets?: number[]
  ): string {
    let result = content;
    let current_offsets = initial_offsets;

    for (const change of changes) {
      if ('range' in change && change.range) {
        // Incremental change
        if (!current_offsets) {
          current_offsets = this.build_line_offset_index(result);
        }

        const startLine = change.range.start.line;
        const startChar = change.range.start.character;
        const endLine = change.range.end.line;
        const endChar = change.range.end.character;

        // Ensure line indices are in bounds
        if (startLine >= current_offsets.length || endLine >= current_offsets.length) {
          // This should not happen if the client is correct, but just in case
          // Recompute offsets and retry. If still out of bounds, skip this change.
          current_offsets = this.build_line_offset_index(result);
          if (startLine >= current_offsets.length || endLine >= current_offsets.length) {
            continue; // Skip invalid change
          }
        }

        const start_offset = current_offsets[startLine] + startChar;
        const end_offset = current_offsets[endLine] + endChar;

        result = result.substring(0, start_offset) + change.text + result.substring(end_offset);

        // For multiple changes in a batch, we must invalidate offsets for subsequent changes
        // because the coordinate system shifted.
        if (changes.length > 1) {
          current_offsets = undefined;
        }
      } else {
        // Full document change
        result = change.text;
        current_offsets = undefined;
      }
    }
    return result;
  }

  /**
   * Touch access for LRU tracking.
   * Deletes and re-inserts to maintain Set insertion order (oldest first).
   */
  private touch_access(uri: string): void {
    this.access_order.delete(uri);
    this.access_order.add(uri);
  }

  /**
   * Evict documents if needed to stay within limits.
   */
  private evict_if_needed(incoming_bytes: number): void {
    // Evict by document count
    while (
      this.documents.size >= this.MAX_DOCUMENTS &&
      this.access_order.size > 0
    ) {
      const oldest = this.find_oldest_uri();
      if (oldest) {
        this.documents.delete(oldest);
        this.access_order.delete(oldest);
        this.discard_generation_metadata(oldest);
        this.metrics.evictions++;
      } else {
        break; // Safety: prevent infinite loop if access_order is inconsistent
      }
    }

    // Evict by total token bytes
    let total_bytes = this.estimate_total_bytes();
    while (
      total_bytes + incoming_bytes > this.MAX_TOKEN_BYTES &&
      this.access_order.size > 0
    ) {
      const oldest = this.find_oldest_uri();
      if (oldest) {
        this.documents.delete(oldest);
        this.access_order.delete(oldest);
        this.discard_generation_metadata(oldest);
        this.metrics.evictions++;
        total_bytes = this.estimate_total_bytes();
      } else {
        break; // Safety: prevent infinite loop if access_order is inconsistent
      }
    }
  }

  /**
   * Drop per-URI generation bookkeeping for an evicted document.
   * Eviction only targets URIs returned by find_oldest_uri (in-flight
   * count zero), so no pending operation can still reference these
   * generations. Mirrors the cleanup in decrement_in_flight/close so
   * these maps do not grow unbounded across a long session.
   */
  private discard_generation_metadata(uri: string): void {
    this.generations.delete(uri);
    this.closed_generations.delete(uri);
    this.committed_generations.delete(uri);
  }

  /**
   * Find the oldest URI that is not currently being updated.
   */
  private find_oldest_uri(): string | undefined {
    for (const my_uri of this.access_order) {
      if ((this.in_flight_counts.get(my_uri) ?? 0) === 0) {
        return my_uri;
      }
    }
    return undefined;
  }

  /**
   * Estimate total bytes used by all cached tokens.
   */
  private estimate_total_bytes(): number {
    let total = 0;
    for (const state of this.documents.values()) {
      // Rough estimate: content length + token count * avg token size
      total += state.content.length + state.tokens.length * 50;
    }
    return total;
  }

  /**
   * Create a new document state by parsing content.
   * Uses parse timeout to prevent pathological files from blocking.
   * Creates fresh lexer/parser/analyzer instances to prevent concurrent state mutation.
   */
  private async create_document_state(
    uri: string,
    content: string,
    version: number,
    workspace_symbols?: SymbolTable,
    scope_resolver_config?: Partial<ScopeResolverConfig>
  ): Promise<DocumentState> {
    const start_time = Date.now();
    this.metrics.parse_count++;

    // Create fresh instances for thread safety (async execution means concurrent calls)
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    // Lex with timeout
    const lex_result = await with_parse_timeout(() =>
      lexer.tokenize(content)
    );

    if (!lex_result.success || lex_result.timed_out) {
      // Return minimal state on timeout/error
      return this.create_error_state(
        uri,
        content,
        version,
        lex_result.error || 'Lexer timeout',
        lex_result.result?.line_offsets
      );
    }

    // Initialize context tracker using lexer tokens (no re-scan)
    const my_context_tracker = new ContextTracker();
    my_context_tracker.initialize_from_tokens(lex_result.result!.tokens, content);

    // Validate context ranges are sorted (debug assertion)
    const context_ranges = my_context_tracker.get_all_context_ranges();
    this.assert_ranges_sorted(context_ranges);

    // Parse with timeout (pass context tracker to avoid re-creation)
    const parse_result = await with_parse_timeout(() =>
      parser.parse(lex_result.result!.tokens, my_context_tracker)
    );

    if (!parse_result.success || parse_result.timed_out) {
      return this.create_error_state(
        uri,
        content,
        version,
        parse_result.error || 'Parser timeout',
        lex_result.result!.line_offsets
      );
    }

    // Parse directives to get working_directory and check for backward directives.
    //
    // KNOWN LIMITATION (tracked in https://github.com/jbearak/sight/issues/184):
    // these cross-file side effects are applied during the parse, before
    // commit_state decides whether the parse is accepted. Per-URI serialization
    // makes a stale out-of-order *update* hit the read-time version guard before
    // this runs, but a `close()` racing an in-flight parse is not serialized, so
    // a parse finishing after close can briefly leave a stale backward-directive
    // relationship until the next reparse/reindex. The full fix is to stage these
    // side effects and apply them only after commit_state's guards pass (issue
    // #184); it is deferred because the correct rollback requires a transactional
    // refactor (including a non-registering resolve() probe), not a coarse clear.
    const directive_parser = new DirectiveParser();
    let resolved_working_directory: string | undefined;
    try {
      const directive_result = directive_parser.parse(content, uri);

      if (this.scope_resolver) {
        this.scope_resolver.sync_backward_directive_dependencies(
          uri,
          directive_result.directives
        );
      }
      if (this.on_backward_directives_parsed) {
        this.on_backward_directives_parsed(uri, directive_result.directives);
      }
      if (directive_result.working_directory) {
        // File has its own working directory directive
        resolved_working_directory = this.resolve_working_directory(
          directive_result.working_directory,
          uri
        );
      } else if (this.scope_resolver) {
        // File has no own working directory. Try to inherit one from parent
        // files via ScopeResolver, including auto-discovered parents.
        try {
          const effective_scope_resolver_config =
            scope_resolver_config ?? this.scope_resolver_config;
          const scope_result = await this.scope_resolver.resolve(
            uri,
            content,
            effective_scope_resolver_config
          );
          if (scope_result.inherited_working_directory) {
            resolved_working_directory = scope_result.inherited_working_directory;
          }
        } catch {
          // ScopeResolver error - continue without inherited working directory
        }
      }
    } catch {
      // Invalid URI or other error - continue without working directory
    }

    // Analyze with timeout and explicit parameters (no hidden defaults)
    const analyze_result = await with_parse_timeout(() =>
      analyzer.analyze(
        parse_result.result!.ast,
        uri,
        workspace_symbols,
        {
          working_directory: resolved_working_directory,
        },
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
        symbols: {
          programs: new Map(),
          localMacros: new Map(),
          globalMacros: new Map(),
          variables: new Map(),
          scalars: new Map(),
          matrices: new Map(),
        },
        diagnostics: [
          {
            severity: DiagnosticSeverity.Warning,
            message: analyze_result.error || 'Analyzer timeout',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            source: 'sight',
          },
        ],
        context_ranges,
        context_tracker: my_context_tracker,
        line_offsets: lex_result.result!.line_offsets,
        forward_calls: [],
        token_line_index: this.build_token_line_index(
          lex_result.result!.tokens
        ),
        ignored_lines: new Set<number>(),
      };
    }

    // Build diagnostics
    const diagnostics = this.build_diagnostics(
      lex_result.result!.errors,
      parse_result.result!.errors,
      analyze_result.result!.diagnostics
    );

    // Parse directive-based forward calls and merge with analyzer's
    // command-detected calls.  Stamp caller_uri and working_directory on
    // directive calls; analyzer calls already carry these fields because
    // we passed resolved_working_directory into analyze() above.
    let all_forward_calls = analyze_result.result!.forward_calls;
    try {
      const directive_parser = new DirectiveParser();
      const directive_result = directive_parser.parse_forward_call_directives(content, uri);
      const directive_forward_calls: ForwardCall[] = directive_result.forward_calls.map(d => ({
        type: d.type,
        raw_path: d.raw_path,
        call_site_line: d.call_site_line,
        range: d.range,
        source: 'directive' as const,
        is_static: true,
        caller_uri: uri,
        working_directory: resolved_working_directory,
      }));
      all_forward_calls = [
        ...analyze_result.result!.forward_calls,
        ...directive_forward_calls,
      ];
    } catch {
      // Invalid URI or other error - use only analyzer's forward calls
    }

    return {
      uri,
      version,
      content,
      tokens: lex_result.result!.tokens,
      ast: parse_result.result!.ast,
      symbols: analyze_result.result!.symbols,
      diagnostics,
      context_ranges,
      context_tracker: my_context_tracker,
      line_offsets: lex_result.result!.line_offsets,
      forward_calls: all_forward_calls,
      working_directory: resolved_working_directory,
      token_line_index: this.build_token_line_index(
        lex_result.result!.tokens
      ),
      ignored_lines: analyze_result.result!.ignored_lines,
    };
  }

  /**
   * Assert context ranges are sorted by start position.
   * In debug builds, throws if invariant violated.
   */
  private assert_ranges_sorted(ranges: ContextRange[]): void {
    if (process.env.NODE_ENV === 'development') {
      for (let i = 1; i < ranges.length; i++) {
        const my_prev = ranges[i - 1];
        const my_curr = ranges[i];
        const my_prev_line = my_prev.range.start.line;
        const my_prev_char = my_prev.range.start.character;
        const my_curr_line = my_curr.range.start.line;
        const my_curr_char = my_curr.range.start.character;

        if (
          my_prev_line > my_curr_line ||
          (my_prev_line === my_curr_line && my_prev_char > my_curr_char)
        ) {
          throw new Error(
            `Context ranges not sorted: range ${i - 1} ` +
            `(${my_prev_line}:${my_prev_char}) comes after ` +
            `range ${i} (${my_curr_line}:${my_curr_char})`
          );
        }
      }
    }
  }

  /**
   * Create an error state when parsing fails.
   */
  private create_error_state(
    uri: string,
    content: string,
    version: number,
    error_message: string,
    line_offsets?: number[]
  ): DocumentState {
    // Reuse provided line_offsets or build new ones
    const offsets = line_offsets || this.build_line_offset_index(content);
    return {
      uri,
      version,
      content,
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
      diagnostics: [
        {
          severity: DiagnosticSeverity.Error,
          message: error_message,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          source: 'sight',
        },
      ],
      context_ranges: [],
      context_tracker: new ContextTracker(),
      line_offsets: offsets,
      forward_calls: [],
      token_line_index: new Map(),
      ignored_lines: new Set<number>(),
    };
  }

  /**
   * Build line offset index mapping line numbers to byte offsets.
   * line_offsets[i] = byte offset where line i starts.
   * line_offsets[0] = 0 (first line starts at offset 0).
   */
  private build_line_offset_index(source: string): number[] {
    const line_offsets: number[] = [0];

    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        line_offsets.push(i + 1);
      }
    }

    return line_offsets;
  }

  /**
   * Build a line-bucketed token index for O(1) line lookup.
   * Registers every line a token spans (Req 12.1).
   */
  private build_token_line_index(
    tokens: Token[]
  ): Map<number, Token[]> {
    const index = new Map<number, Token[]>();
    for (const my_token of tokens) {
      const start_line = my_token.range.start.line;
      const end_line = my_token.range.end.line;
      for (let my_line = start_line; my_line <= end_line; my_line++) {
        let bucket = index.get(my_line);
        if (!bucket) {
          bucket = [];
          index.set(my_line, bucket);
        }
        bucket.push(my_token);
      }
    }
    return index;
  }

  /**
   * Look up the token at a given (line, character) position using
   * the precomputed line-bucketed index.  Returns `undefined` when
   * no token covers the position.
   *
   * Boundary semantics match the LSP convention: start is inclusive,
   * end is exclusive (start <= pos < end).
   *
   * Complexity: O(B) where B is the number of tokens that span the
   * queried line — typically a small constant.
   *
   * (Req 6.1, 6.2, 12.2)
   */
  get_token_at_position(
    state: DocumentState,
    line: number,
    character: number
  ): Token | undefined {
    const bucket = state.token_line_index.get(line);
    if (!bucket) return undefined;
    for (const my_token of bucket) {
      const start = my_token.range.start;
      const end = my_token.range.end;
      // Check if (line, character) falls within [start, end)
      const after_start = line > start.line
        || (line === start.line && character >= start.character);
      const before_end = line < end.line
        || (line === end.line && character < end.character);
      if (after_start && before_end) {
        return my_token;
      }
    }
    return undefined;
  }


  /**
   * Build diagnostics from lexer, parser, and analyzer errors.
   */
  private build_diagnostics(
    lexer_errors: LexerError[],
    parser_errors: ParseError[],
    analyzer_diagnostics: SemanticDiagnostic[]
  ): Diagnostic[] {
    return [
      // Convert lexer errors to diagnostics
      ...lexer_errors.map((error) => ({
        range: error.range,
        message: error.message,
        severity: DiagnosticSeverity.Error,
        code: error.code,
        source: 'sight',
      })),
      // Convert parser errors to diagnostics
      ...parser_errors.map((error) => ({
        range: error.range,
        message: error.message,
        severity: DiagnosticSeverity.Error,
        code: error.code,
        source: 'sight',
      })),
      // Convert semantic analyzer results to diagnostics. Carry the analyzer's
      // structured symbol_name/reference_kind on the `data` field so the
      // provider can recover them without parsing message prose.
      ...analyzer_diagnostics.map((diag) => ({
        range: diag.range,
        message: diag.message,
        severity:
          diag.severity === 'error'
            ? DiagnosticSeverity.Error
            : diag.severity === 'warning'
              ? DiagnosticSeverity.Warning
              : diag.severity === 'information'
                ? DiagnosticSeverity.Information
                : DiagnosticSeverity.Hint,
        code: diag.code,
        source: 'sight',
        ...undefined_symbol_data_fields(diag),
      })),
    ];
  }

  /**
   * Resolve the working directory from a WorkingDirectoryDirective.
   * 
   * Resolution rules:
   * - If is_workspace_relative is true, resolve relative to workspace root
   * - Otherwise, resolve relative to the script's containing directory
   * - If the resolved directory doesn't exist, return undefined (fallback to script dir)
   * 
   * @param directive - The parsed working directory directive
   * @param uri - The URI of the script file
   * @returns The resolved absolute path, or undefined if resolution fails
   */
  /**
   * Resolve the working directory from a WorkingDirectoryDirective.
   *
   * Uses the shared `resolve_working_directory_directive` helper to
   * compute the canonical absolute path (same algorithm as the Indexer
   * and ScopeResolver, ensuring dependency-graph edge keys are stable
   * across producers). Then applies an existence check: if the resolved
   * directory does not exist on disk the method returns `undefined` so
   * the runtime falls back to the script's own directory.
   *
   * @param directive - The parsed working directory directive
   * @param uri - The URI of the script file
   * @returns The resolved absolute path, or undefined if resolution
   *          fails or the directory does not exist
   */
  private resolve_working_directory(
    directive: WorkingDirectoryDirective,
    uri: string
  ): string | undefined {
    const workspace_root = this.get_workspace_root_for_uri(uri);
    const resolved_path = resolve_working_directory_directive(
      directive,
      workspace_root
    );

    if (!resolved_path) {
      return undefined;
    }

    // Check if the resolved directory exists
    try {
      if (fs.existsSync(resolved_path) && fs.statSync(resolved_path).isDirectory()) {
        return resolved_path;
      }
    } catch {
      // Error checking path - return undefined
    }

    // Directory doesn't exist - return undefined to trigger fallback
    return undefined;
  }
}
