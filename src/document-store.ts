import { TextDocumentContentChangeEvent, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { StataAST, SymbolTable, Token, DocumentStoreMetrics, ForwardCall, WorkingDirectoryDirective } from './types';
import { StataLexer } from './lexer';
import { StataParser } from './parser';
import { SemanticAnalyzer } from './analyzer';
import { ContextTracker } from './context-tracker';
import { ContextRange } from './context-tracker/types';
import { with_parse_timeout, ParseResult } from './utils/parse-timeout';
import { DirectiveParser } from './directive-parser';
import { ScopeResolver } from './scope-resolver';

import { URI } from 'vscode-uri';
import * as path from 'path';
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
}

export class DocumentStore {
  private documents: Map<string, DocumentState> = new Map();
  private access_order: Map<string, number> = new Map(); // LRU tracking
  private active_updates: Map<string, Promise<void>> = new Map();
  private readonly MAX_DOCUMENTS = 50;
  private readonly MAX_TOKEN_BYTES = 100 * 1024 * 1024; // 100MB
  private workspace_root: string | undefined;
  private scope_resolver: ScopeResolver | undefined;

  private metrics: DocumentStoreMetrics = {
    parse_count: 0,
    parse_total_ms: 0,
    cache_hits: 0,
    cache_misses: 0,
    evictions: 0,
  };

  /**
   * Set the workspace root directory.
   * Used for resolving workspace-relative paths in @lsp-working-directory directives
   * and for fallback path resolution in forward calls.
   */
  set_workspace_root(workspace_root: string | undefined): void {
    this.workspace_root = workspace_root;
  }

  /**
   * Get the current workspace root directory.
   */
  get_workspace_root(): string | undefined {
    return this.workspace_root;
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

  /**
   * Get the current scope resolver.
   */
  get_scope_resolver(): ScopeResolver | undefined {
    return this.scope_resolver;
  }
  /**
   * Open a document and parse it.
   * Async to support parse timeout wrapper.
   */
  async open(uri: string, content: string, version: number, workspace_symbols?: SymbolTable): Promise<void> {
    const operation = async () => {
      this.evict_if_needed(content.length);
      const state = await this.create_document_state(uri, content, version, workspace_symbols);
      this.documents.set(uri, state);
      this.touch_access(uri);
    };

    const promise = operation();
    this.active_updates.set(uri, promise);
    try {
      await promise;
    } finally {
      if (this.active_updates.get(uri) === promise) {
        this.active_updates.delete(uri);
      }
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
    workspace_symbols?: SymbolTable
  ): Promise<void> {
    const operation = async () => {
      const state = this.documents.get(uri);
      if (!state) {
        return;
      }

      // Skip if version hasn't changed (idempotent)
      if (state.version >= version) {
        this.metrics.cache_hits++;
        return;
      }

      this.metrics.cache_misses++;

      // Apply text changes
      const new_content = this.apply_changes(state.content, changes, state.line_offsets);

      // Fast path: skip if content unchanged (e.g., didSave with no edits)
      if (new_content === state.content) {
        // Just update version, reuse everything else
        state.version = version;
        this.metrics.cache_hits++;
        return;
      }

      // Create new state with fresh parse
      const new_state = await this.create_document_state(
        uri,
        new_content,
        version,
        workspace_symbols
      );
      this.documents.set(uri, new_state);
      this.touch_access(uri);
    };

    const promise = operation();
    this.active_updates.set(uri, promise);
    try {
      await promise;
    } finally {
      if (this.active_updates.get(uri) === promise) {
        this.active_updates.delete(uri);
      }
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
    this.documents.delete(uri);
    this.access_order.delete(uri);
  }

  get(uri: string): DocumentState | undefined {
    const state = this.documents.get(uri);
    if (state) {
      this.touch_access(uri);
    }
    return state;
  }

  getAll(): DocumentState[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get current metrics.
   */
  get_metrics(): DocumentStoreMetrics {
    return { ...this.metrics };
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
   * Touch access time for LRU tracking.
   */
  private touch_access(uri: string): void {
    this.access_order.set(uri, Date.now());
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
        this.metrics.evictions++;
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
        this.metrics.evictions++;
        total_bytes = this.estimate_total_bytes();
      }
    }
  }

  /**
   * Find the URI with the oldest access timestamp.
   */
  private find_oldest_uri(): string | undefined {
    let oldest_uri: string | undefined;
    let oldest_timestamp = Infinity;

    for (const [uri, timestamp] of this.access_order) {
      if (timestamp < oldest_timestamp) {
        oldest_timestamp = timestamp;
        oldest_uri = uri;
      }
    }

    return oldest_uri;
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
    workspace_symbols?: SymbolTable
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

    // Parse directives to get working_directory and check for backward directives
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
      if (directive_result.working_directory) {
        // File has its own working directory directive
        resolved_working_directory = this.resolve_working_directory(
          directive_result.working_directory,
          uri
        );
      } else if (directive_result.directives.length > 0 && this.scope_resolver) {
        // File has backward directives but no own working directory
        // Try to inherit from parent files via ScopeResolver
        try {
          const scope_result = await this.scope_resolver.resolve(uri, content);
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
          workspace_root: this.workspace_root,
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
      };
    }

    // Build diagnostics
    const diagnostics = this.build_diagnostics(
      lex_result.result!.errors,
      parse_result.result!.errors,
      analyze_result.result!.diagnostics
    );

    // Parse directive-based forward calls and merge with analyzer's command-detected calls
    let all_forward_calls = analyze_result.result!.forward_calls;
    try {
      const directive_parser = new DirectiveParser();
      const directive_result = directive_parser.parse_forward_call_directives(content, uri);
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
   * Build diagnostics from lexer, parser, and analyzer errors.
   */
  private build_diagnostics(
    lexer_errors: any[],
    parser_errors: any[],
    analyzer_diagnostics: any[]
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
      // Convert semantic analyzer results to diagnostics
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
  private resolve_working_directory(
    directive: WorkingDirectoryDirective,
    uri: string
  ): string | undefined {
    let resolved_path: string;

    if (directive.is_workspace_relative) {
      // Resolve relative to workspace root
      if (!this.workspace_root) {
        // No workspace root available - cannot resolve workspace-relative path
        return undefined;
      }
      // resolved_path in directive already has leading slash stripped
      resolved_path = path.normalize(path.join(this.workspace_root, directive.resolved_path));
    } else {
      // Resolve relative to script's containing directory
      // The directive parser already resolved this for us
      resolved_path = directive.resolved_path;
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
