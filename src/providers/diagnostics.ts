import { Diagnostic, DiagnosticSeverity, Position, CancellationToken, Range } from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { LanguageContext, ContextDiagnostic, ContextRange } from '../context-tracker/types';
import {
    LexerError,
    LexerErrorCode,
    ParseError,
    ParseErrorCode,
    StataDiagnosticCode,
    StataLSPConfig,
    SymbolTable,
    ResolvedScope,
    DirectiveDiagnostic,
    UndefinedSymbolDiagnosticData
} from '../types';
import {
    ScopeResolver,
    get_visible_forward_call_sites,
    scope_resolver_config_for,
} from '../scope-resolver';
import { createHash } from 'crypto';
import { DocumentDebounceManager } from '../utils/debounce-manager';
import { get_line_text, get_line_count } from '../utils/line-utils';
import {
    format_out_of_scope_message,
    OutOfScopeReason as OutOfScopeMessageReason,
    OutOfScopeSymbolKind,
} from '../utils/out-of-scope-message';
import { undefined_symbol_data_fields } from '../utils/undefined-symbol-diagnostic';
import { host_is_case_sensitive } from '../utils/file-path-utils';
import {
    has_ignore_directive,
    has_ignore_next_directive,
    has_trailing_ignore_directive,
} from '../utils/directives';
import { IndentationDiagnosticAnalyzer } from './indentation-diagnostics';
import { OperatorSequenceAnalyzer } from './operator-sequence-diagnostics';
import { MixedLogicalOperatorAnalyzer } from './mixed-logical-diagnostics';
type SemanticDiagnostic = {
    message: string;
    range: Range;
    code: StataDiagnosticCode;
    severity: 'error' | 'warning' | 'information' | 'hint';
    base_code?: StataDiagnosticCode;
    // Structured carriers populated by the analyzer for UNDEFINED_MACRO /
    // UNDEFINED_VARIABLE so downstream logic reads the referenced symbol from
    // data, never by parsing the (now reworded) message prose.
    symbol_name?: string;
    reference_kind?: 'local' | 'global' | 'variable';
};
type ReferenceKind = 'local' | 'global' | 'variable' | null;
type OutOfScopeRewriteMatch = {
    symbol_kind: OutOfScopeSymbolKind;
    reason: OutOfScopeMessageReason;
};

// ─── Testability seam for host_is_case_sensitive ─────────────────────────────
// Production code calls the real implementation. Tests can override this
// via DiagnosticsProvider.set_host_probe() to inject a deterministic stub
// without mocking the module.
let host_probe: (seed_dir: string) => boolean = host_is_case_sensitive;

export interface DiagnosticsConnection {
    sendDiagnostics(params: {
        uri: string;
        diagnostics: Diagnostic[];
    }): void;
}

/**
 * DiagnosticsProvider aggregates diagnostics from cached parse results.
 * 
 * Responsibilities:
 * - Reuse cached diagnostics from DocumentStore (no re-parsing)
 * - Apply version gating to prevent stale results
 * - Publish diagnostics via textDocument/publishDiagnostics
 * - Clear previous diagnostics on document change
 * - Suppress Stata diagnostics in embedded language contexts
 * - Report context structure errors (unclosed blocks, mismatched delimiters)
 * - Cache filtered diagnostics by (uri, version, config_hash)
 * - Return pending flag when debounce is in progress
 * 
 * Diagnostic sources (from DocumentStore):
 * - Lexer: unbalanced quotes, unbalanced block comments, delimiter issues, continuation whitespace
 * - Parser: brace placement, missing `end`, unclosed blocks, `forvalues` syntax
 * - Semantic Analyzer: undefined macros, undefined variables (heuristic)
 * - Context Tracker: unclosed mata/python blocks, mismatched delimiters
 */
export class DiagnosticsProvider {
    private connection: DiagnosticsConnection;
    private debounce_manager: DocumentDebounceManager | null = null;
    private indentation_analyzer = new IndentationDiagnosticAnalyzer();
    private operator_sequence_analyzer = new OperatorSequenceAnalyzer();
    private mixed_logical_analyzer = new MixedLogicalOperatorAnalyzer();
    private dependency_graph?: import('../dependency-graph').DependencyGraph;

    // Track published versions to prevent stale diagnostics
    private published_versions: Map<string, number> = new Map();

    // Cache filtered diagnostics by (uri, version, config_hash)
    private filtered_cache: Map<string, Map<string, Diagnostic[]>> = new Map();

    constructor(
        connection: DiagnosticsConnection,
        debounce_manager?: DocumentDebounceManager
    ) {
        this.connection = connection;
        this.debounce_manager = debounce_manager || null;
    }

    /**
     * Override the host case-sensitivity probe for testing.
     * Restoring the original after the test is the caller's responsibility.
     * In production, the probe defaults to the real `host_is_case_sensitive`.
     *
     * @param probe - A function that returns true when the host FS is
     *   case-sensitive for the given seed directory.
     * @returns The previous probe (so tests can restore it).
     */
    static set_host_probe(
        probe: (seed_dir: string) => boolean,
    ): (seed_dir: string) => boolean {
        const previous = host_probe;
        host_probe = probe;
        return previous;
    }

    /**
     * Set the dependency graph for diagnostic deferral in auto mode.
     */
    set_dependency_graph(graph: import('../dependency-graph').DependencyGraph): void {
        this.dependency_graph = graph;
    }
    
    /**
     * Set the debounce manager for pending state tracking.
     */
    set_debounce_manager(debounce_manager: DocumentDebounceManager): void {
        this.debounce_manager = debounce_manager;
    }

    /**
     * Clear the published version for a document.
     * This forces the next publish_diagnostics call to actually publish,
     * even if the document version hasn't changed.
     * Used when dependencies change and diagnostics need to be recomputed.
     */
    clear_published_version(uri: string): void {
        this.published_versions.delete(uri);
        // Also clear the filtered cache for this URI
        this.filtered_cache.delete(uri);
    }

    /**
     * Compute and publish diagnostics for a document.
     * Reuses cached parse results from DocumentStore.
     * 
     * @param document - The document state to analyze (with cached parse results)
     * @param config - LSP configuration for diagnostic settings
     * @param workspace_symbols - Optional workspace-level symbols for cross-file resolution
     * @param scope_resolver - Optional scope resolver for cross-file awareness
     * @param cancellation_token - Optional cancellation token
     * @returns Object with diagnostics and pending flag
     */
    async publish_diagnostics(
        document: DocumentState,
        config: StataLSPConfig,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        cancellation_token?: CancellationToken
    ): Promise<{ diagnostics: Diagnostic[]; pending: boolean }> {
        // Version gating: only publish if this is the latest version
        const current_published = this.published_versions.get(document.uri);
        if (current_published !== undefined && current_published >= document.version) {
            // Stale request, skip
            return { diagnostics: [], pending: false };
        }

        // Check if diagnostics are enabled
        if (!config?.diagnostics?.enabled) {
            // Clear diagnostics and return
            this.clear_diagnostics(document.uri);
            this.published_versions.set(document.uri, document.version);
            return { diagnostics: [], pending: false };
        }

        // Check if debounce is pending for this document
        const is_pending = this.debounce_manager?.is_pending(document.uri) ?? false;

        // Collect all diagnostics (reuse cached results from DocumentStore)
        const the_diagnostics = await this.get_diagnostics(document, config, workspace_symbols, scope_resolver, cancellation_token);

        // Publish diagnostics
        this.connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: the_diagnostics,
        });

        // Update published version
        this.published_versions.set(document.uri, document.version);
        
        return { diagnostics: the_diagnostics, pending: is_pending };
    }

    /**
     * Get all diagnostics for a document without publishing.
     * Reuses cached parse results from DocumentStore.
     * Useful for testing or when diagnostics are needed without side effects.
     */
    async get_diagnostics(
        document: DocumentState,
        config: StataLSPConfig,
        workspace_symbols?: SymbolTable,
        scope_resolver?: ScopeResolver,
        cancellation_token?: CancellationToken
    ): Promise<Diagnostic[]> {
        // Generate config hash for cache key
        const config_hash = this.compute_config_hash(config);
        
        // Check cache first
        const uri_cache = this.filtered_cache.get(document.uri);
        const inner_key = `${document.version}:${config_hash}`;
        const cached = uri_cache?.get(inner_key);
        if (cached) {
            return cached;
        }

        const the_diagnostics: Diagnostic[] = [];

        // Get all context ranges from cached context tracker
        const the_context_ranges = document.context_tracker.get_all_context_ranges();

        // Add lexer diagnostics (structural errors are always reported)
        // These come from DocumentStore's cached parse results
        for (const my_error of this.extract_lexer_errors(document)) {
            const my_diagnostic = this.convert_lexer_error(my_error, config);
            if (my_diagnostic) {
                // Structural errors (quotes, braces) are always reported
                // These are important even in embedded contexts
                the_diagnostics.push(my_diagnostic);
            }
        }

        // Add parser diagnostics (filtered by context)
        for (const my_error of this.extract_parser_errors(document)) {
            const my_diagnostic = this.convert_parser_error(my_error, config);
            if (my_diagnostic) {
                // Check if this is a Stata-specific diagnostic in embedded context
                if (this.is_stata_specific_error(my_error.code) &&
                    this.is_in_embedded_context(my_error.range.start, the_context_ranges)) {
                    continue;
                }
                the_diagnostics.push(my_diagnostic);
            }
        }

        // Add context structure validation diagnostics
        const the_context_diagnostics = document.context_tracker.validate_context_structure();
        for (const my_context_diag of the_context_diagnostics) {
            the_diagnostics.push(this.convert_context_diagnostic(my_context_diag));
        }

        // Add semantic diagnostics from cached analyzer results
        // If scope_resolver is provided, check against cross-file scope first
        // Use the same filtered resolver config shape as other call sites so
        // cache keys stay aligned.
        const my_resolve_config = scope_resolver_config_for(config);
        const resolved_scope = scope_resolver ? await scope_resolver.resolve(
            document.uri,
            document.content,
            my_resolve_config,
            cancellation_token
        ) : undefined;
        
        // Diagnostic deferral for auto backward dependency mode:
        // If workspace scan is not yet complete and the file has no explicit
        // directives or auto-discovered parents, defer undefined symbol
        // diagnostics to avoid false positives.
        //
        // Use `resolved_scope.scan_complete_at_resolve_time` — the snapshot
        // taken at the same synchronous moment as `has_auto_parents` —
        // instead of `dependency_graph.is_scan_complete()` here. The scan
        // can transition false→true between scope resolution and this
        // check: with a live read, that transition makes us think we're
        // "done discovering parents" while `has_auto_parents` still
        // reflects the empty pre-scan graph. We then publish an
        // undefined-symbol warning that the very next re-validation
        // clears — the user sees a red-squiggly flicker. The snapshot
        // closes that race by keeping both signals consistent.
        const backward_dep_mode = config.cross_file?.backward_dependencies ?? 'auto';
        // Always use the snapshot, never a live `is_scan_complete()` read. A
        // live read is exactly what reintroduces the race (see comment above):
        // it can observe a false→true transition that happened after
        // `has_auto_parents` was captured. When the snapshot is absent (only
        // possible if the resolver had no dependency graph), default to `false`
        // (defer) rather than reading live state.
        const scan_complete_for_deferral =
            resolved_scope?.scan_complete_at_resolve_time ?? false;
        const defer_undefined_diagnostics = backward_dep_mode === 'auto' &&
            this.dependency_graph &&
            !scan_complete_for_deferral &&
            resolved_scope &&
            !resolved_scope.has_directives &&
            !resolved_scope.has_auto_parents;

        for (const my_diagnostic of this.extract_semantic_diagnostics(document)) {
            // Suppress Stata-specific semantic diagnostics in embedded contexts
            if (this.is_in_embedded_context(my_diagnostic.range.start, the_context_ranges)) {
                continue;
            }

            // Defer undefined symbol diagnostics until workspace scan completes
            if (defer_undefined_diagnostics &&
                (my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                 my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)) {
                continue;
            }

            const is_undefined_symbol =
                my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                || my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE;
            const symbol_name = is_undefined_symbol
                ? this.extract_symbol_name_from_diagnostic(my_diagnostic)
                : null;
            const reference_kind = is_undefined_symbol
                ? this.classify_reference_kind(my_diagnostic)
                : null;

            // Skip diagnostics when the symbol is truly available from
            // cross-file scope before attempting any out-of-scope rewrites.
            if (resolved_scope && symbol_name) {
                if (this.is_symbol_defined_in_scope(
                        symbol_name,
                        resolved_scope.symbols,
                        my_diagnostic.code,
                        document.uri,
                        reference_kind
                    )) {
                    continue;
                }

                if (my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                    && this.is_c_local_from_resolved_program(
                        symbol_name,
                        resolved_scope.symbols,
                        document,
                        my_diagnostic.range.start.line
                    )) {
                    continue;
                }
            }

            if (resolved_scope && symbol_name) {
                const diag_line = my_diagnostic.range.start.line;
                let found_in_forward_call = false;
                for (const call_site of get_visible_forward_call_sites(
                    resolved_scope,
                    diag_line
                )) {
                    if (this.is_symbol_in_forward_call(
                            symbol_name,
                            call_site.symbols,
                            my_diagnostic.code,
                            call_site.effective_type,
                            document.uri,
                            reference_kind
                        )) {
                        found_in_forward_call = true;
                        break;
                    }
                }
                if (found_in_forward_call) {
                    continue;
                }
            }
            if (symbol_name) {
                const same_file_match = this.find_same_file_out_of_scope_match(
                    symbol_name,
                    reference_kind,
                    document.symbols,
                    document.uri,
                    my_diagnostic.range.start.line
                );
                if (same_file_match) {
                    const converted = this.create_out_of_scope_rewrite(
                        my_diagnostic,
                        symbol_name,
                        same_file_match,
                        config,
                        document
                    );
                    if (converted) {
                        the_diagnostics.push(converted);
                    }
                    continue;
                }
            }

            if (resolved_scope && symbol_name) {
                const backward_match = this.find_backward_out_of_scope_match(
                    symbol_name,
                    reference_kind,
                    resolved_scope
                );
                if (backward_match) {
                    const converted = this.create_out_of_scope_rewrite(
                        my_diagnostic,
                        symbol_name,
                        backward_match,
                        config,
                        document
                    );
                    if (converted) {
                        the_diagnostics.push(converted);
                    }
                    continue;
                }

                const diag_line = my_diagnostic.range.start.line;
                let forward_match: OutOfScopeRewriteMatch | null = null;
                for (const call_site of get_visible_forward_call_sites(
                    resolved_scope,
                    diag_line
                )) {
                    if (this.is_symbol_excluded_by_forward_call(
                            symbol_name,
                            call_site,
                            my_diagnostic.code,
                            reference_kind,
                            document.uri
                        )) {
                        const effective = call_site.excluded_locals?.get(
                            symbol_name
                        );
                        const excluded_callee_uri = effective?.sourceUri
                            ?? call_site.callee_uri;
                        const source_file = excluded_callee_uri.split('/').pop()
                            || excluded_callee_uri;
                        forward_match = {
                            symbol_kind: 'local',
                            reason: {
                                kind: 'inheritance_excludes_locals',
                                source_file,
                            },
                        };
                    }
                }
                if (forward_match) {
                    if (this.is_symbol_defined_in_current_document(
                            symbol_name,
                            document.symbols,
                            my_diagnostic.code,
                            document.uri,
                            reference_kind
                        )) {
                        const converted = this.convert_semantic_diagnostic(
                            my_diagnostic,
                            config,
                            document
                        );
                        if (converted) {
                            the_diagnostics.push(converted);
                        }
                        continue;
                    }

                    const converted = this.create_out_of_scope_rewrite(
                        my_diagnostic,
                        symbol_name,
                        forward_match,
                        config,
                        document
                    );
                    if (converted) {
                        the_diagnostics.push(converted);
                    }
                    continue;
                }
            }
            const converted = this.convert_semantic_diagnostic(my_diagnostic, config, document);
            if (converted) {
                the_diagnostics.push(converted);
            }
        }

        // Add indentation diagnostics
        const indentation_diagnostics = this.indentation_analyzer.analyze(document, config);
        for (const my_indentation_diag of indentation_diagnostics) {
            // Skip indentation diagnostics in embedded contexts
            if (!this.is_in_embedded_context(my_indentation_diag.range.start, the_context_ranges)) {
                the_diagnostics.push(my_indentation_diag);
            }
        }

        // Add operator sequence diagnostics (malformed operators like '< =' or '| |')
        const operator_sequence_diagnostics = this.operator_sequence_analyzer.analyze(document, config);
        for (const my_operator_diag of operator_sequence_diagnostics) {
            // Skip operator sequence diagnostics in embedded contexts
            if (!this.is_in_embedded_context(my_operator_diag.range.start, the_context_ranges)) {
                the_diagnostics.push(my_operator_diag);
            }
        }

        // Add mixed logical operator diagnostics (e.g., 'x & y | z')
        const mixed_logical_diagnostics = this.mixed_logical_analyzer.analyze(document, config);
        for (const my_mixed_diag of mixed_logical_diagnostics) {
            if (!this.is_in_embedded_context(my_mixed_diag.range.start, the_context_ranges)) {
                the_diagnostics.push(my_mixed_diag);
            }
        }

        // Add directive-related diagnostics if scope resolver is provided
        if (resolved_scope) {
            for (const my_directive_diag of resolved_scope.diagnostics) {
                const converted = this.convert_directive_diagnostic(my_directive_diag, config);
                if (converted) {
                    the_diagnostics.push(converted);
                }
            }
        }

        // Cache the filtered diagnostics
        let cache_for_uri = this.filtered_cache.get(document.uri);
        if (!cache_for_uri) {
            cache_for_uri = new Map();
            this.filtered_cache.set(document.uri, cache_for_uri);
        }
        cache_for_uri.set(`${document.version}:${config_hash}`, the_diagnostics);

        return the_diagnostics;
    }
    
    /**
     * Compute a hash of the diagnostic configuration.
     * Used to invalidate cache when config changes.
     */
    private compute_config_hash(config: StataLSPConfig): string {
        const config_str = JSON.stringify({
            enabled: config.diagnostics.enabled,
            severity: config.diagnostics.severity,
            indentation: config.diagnostics.indentation,
            adoPaths: config.adoPaths,
            cross_file: config.cross_file,
        });
        return createHash('sha256').update(config_str).digest('hex').substring(0, 8);
    }
    
    /**
     * Extract lexer errors from document diagnostics.
     * These are stored in DocumentStore's cached diagnostics.
     */
    private extract_lexer_errors(document: DocumentState): LexerError[] {
        // Lexer errors are embedded in the document diagnostics
        // We identify them by their source and code range
        const lexer_errors: LexerError[] = [];
        for (const diag of document.diagnostics) {
            if (diag.code && typeof diag.code === 'number') {
                const code = diag.code as number;
                if (code >= 1001 && code <= 1004) {
                    // This is a lexer error code
                    lexer_errors.push({
                        message: diag.message,
                        range: diag.range,
                        code: code as LexerErrorCode,
                    });
                }
            }
        }
        return lexer_errors;
    }
    
    /**
     * Extract parser errors from document diagnostics.
     */
    private extract_parser_errors(document: DocumentState): ParseError[] {
        const parser_errors: ParseError[] = [];
        for (const diag of document.diagnostics) {
            if (diag.code && typeof diag.code === 'number') {
                const code = diag.code as number;
                if (code >= 3000 && code <= 3014) {
                    // This is a parser error code
                    parser_errors.push({
                        message: diag.message,
                        range: diag.range,
                        code: code as ParseErrorCode,
                    });
                }
            }
        }
        return parser_errors;
    }
    
    /**
     * Extract semantic diagnostics from document diagnostics.
     */
    private extract_semantic_diagnostics(document: DocumentState): SemanticDiagnostic[] {
        const semantic_diags: SemanticDiagnostic[] = [];
        for (const diag of document.diagnostics) {
            if (diag.code && typeof diag.code === 'number') {
                const code = diag.code as StataDiagnosticCode;
                if (code === StataDiagnosticCode.UNDEFINED_MACRO
                    || code === StataDiagnosticCode.UNDEFINED_VARIABLE
                    || code === StataDiagnosticCode.MISSING_VARIABLE_NAME) {
                    // This is a semantic error code
                    const severity_map: Record<DiagnosticSeverity, 'error' | 'warning' | 'information' | 'hint'> = {
                        [DiagnosticSeverity.Error]: 'error',
                        [DiagnosticSeverity.Warning]: 'warning',
                        [DiagnosticSeverity.Information]: 'information',
                        [DiagnosticSeverity.Hint]: 'hint',
                    };
                    const data = diag.data as
                        | UndefinedSymbolDiagnosticData
                        | undefined;
                    semantic_diags.push({
                        message: diag.message,
                        range: diag.range,
                        code,
                        severity: severity_map[diag.severity ?? DiagnosticSeverity.Error],
                        symbol_name: data?.symbol_name,
                        reference_kind: data?.reference_kind,
                    });
                }
            }
        }
        return semantic_diags;
    }

    /**
     * Clear diagnostics for a document.
     * Called when a document is closed or when diagnostics are disabled.
     */
    clear_diagnostics(uri: string): void {
        this.connection.sendDiagnostics({
            uri,
            diagnostics: [],
        });
    }
    
    /**
     * Clear the filtered diagnostics cache for a document.
     * Called when document is updated or config changes.
     */
    clear_cache_for_document(uri: string): void {
        // Remove all cached diagnostics for this URI (all versions/configs)
        this.filtered_cache.delete(uri);
    }

    /**
     * Remove tracking for a closed document.
     */
    on_document_closed(uri: string): void {
        this.published_versions.delete(uri);
        this.clear_cache_for_document(uri);
        this.clear_diagnostics(uri);
    }

    /**
     * Convert a lexer error to an LSP Diagnostic.
     */
    private convert_lexer_error(
        error: LexerError,
        config: StataLSPConfig
    ): Diagnostic | null {
        let severity: DiagnosticSeverity | null;

        // Determine severity based on error code and config
        switch (error.code) {
            case LexerErrorCode.UNBALANCED_QUOTES:
            case LexerErrorCode.UNBALANCED_BLOCK_COMMENT:
            case LexerErrorCode.UNTERMINATED_STATEMENT:
                severity = DiagnosticSeverity.Error;
                break;
            case LexerErrorCode.CONTINUATION_NO_SPACE:
                severity = this.get_severity_from_config(config.diagnostics.severity.styleWarnings);
                break;
            case LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT:
                severity = DiagnosticSeverity.Warning;
                break;
            default:
                severity = DiagnosticSeverity.Error;
        }

        if (severity === null) {
            return null; // Disabled
        }

        return {
            range: error.range,
            message: error.message,
            severity,
            code: error.code,
            source: 'sight',
        };
    }

    private get_undefined_symbol_severity_setting(
        diagnostic_code: StataDiagnosticCode | undefined,
        config: StataLSPConfig
    ): 'error' | 'warning' | 'information' | 'hint' | 'off' | null {
        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_MACRO) {
            return config.diagnostics.severity.undefinedMacro;
        }
        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
            return config.diagnostics.severity.undefinedVariable;
        }
        return null;
    }

    /**
     * Convert a parser error to an LSP Diagnostic.
     */
    private convert_parser_error(
        error: ParseError,
        _config: StataLSPConfig
    ): Diagnostic | null {
        let severity: DiagnosticSeverity = DiagnosticSeverity.Error;

        // CODE_AFTER_OPEN_BRACE is a warning since Stata runs the code but ignores the content
        // REDUNDANT_MACRO_SUFFIX is also a warning
        if (error.code === ParseErrorCode.CODE_AFTER_OPEN_BRACE ||
            error.code === ParseErrorCode.REDUNDANT_MACRO_SUFFIX) {
            severity = DiagnosticSeverity.Warning;
        }

        return {
            range: error.range,
            message: error.message,
            severity,
            code: error.code,
            source: 'sight',
        };
    }

    /**
     * Check if an undefined symbol diagnostic should be suppressed based on comment directives.
     */
    private should_suppress_undefined_symbol(
        document: DocumentState,
        diagnostic_range: Range
    ): boolean {
        const diagnostic_line = diagnostic_range.start.line;

        if (document.ignored_lines?.has(diagnostic_line)) {
            return true;
        }

        // Raw-line fallback ONLY for synthetic/error document states that never
        // ran the tokenized analyzer (no tokens). Documents that were lexed have
        // an authoritative `ignored_lines` above, computed from comment tokens
        // that correctly distinguish a real `// sight: ignore` from one that
        // merely appears inside a `/* ... */` block comment; the raw-line regexes
        // below cannot make that distinction, so applying them to real documents
        // would over-suppress.
        if (document.tokens && document.tokens.length > 0) {
            return false;
        }
        // Same-line trailing `// sight: ignore` on the diagnostic line.
        const current_line = get_line_text(document, diagnostic_line);
        if (has_trailing_ignore_directive(current_line)) {
            return true;
        }
        // Standalone `// sight: ignore` / `// sight: ignore-next` on the
        // preceding line targets this (next) statement.
        if (diagnostic_line > 0) {
            const previous_line = get_line_text(document, diagnostic_line - 1);
            if (has_ignore_directive(previous_line) || has_ignore_next_directive(previous_line)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Convert a semantic diagnostic to an LSP Diagnostic.
     */
    private convert_semantic_diagnostic(
        diagnostic: SemanticDiagnostic,
        config: StataLSPConfig,
        document?: DocumentState
    ): Diagnostic | null {
        // Check suppression first for undefined symbol diagnostics
        if (document && 
            (diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO ||
             diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE ||
             diagnostic.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL)) {
            if (this.should_suppress_undefined_symbol(document, diagnostic.range)) {
                return null; // Suppressed
            }
        }

        let severity: DiagnosticSeverity | null;

        // Determine severity based on diagnostic code and config

        switch (diagnostic.code) {
            case StataDiagnosticCode.UNDEFINED_MACRO:
            case StataDiagnosticCode.UNDEFINED_VARIABLE:
            case StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL: {
                const severity_setting = this.get_undefined_symbol_severity_setting(
                    diagnostic.code === StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL
                        ? diagnostic.base_code
                        : diagnostic.code,
                    config
                );
                if (!severity_setting) {
                    severity = this.semantic_severity_to_lsp(diagnostic.severity);
                    break;
                }
                severity = this.get_severity_from_config(severity_setting);
                break;
            }
            default:
                severity = this.semantic_severity_to_lsp(diagnostic.severity);
        }

        if (severity === null) {
            return null; // Disabled
        }

        return {
            range: diagnostic.range,
            message: diagnostic.message,
            severity,
            code: diagnostic.code,
            source: 'sight',
            // Propagate the structured payload so the diagnostic published to
            // the client carries symbol_name/reference_kind too (omitted when
            // absent, e.g. out-of-scope rewrites).
            ...undefined_symbol_data_fields(diagnostic),
        };
    }

    private create_out_of_scope_rewrite(
        base_diagnostic: SemanticDiagnostic,
        symbol_name: string,
        match: OutOfScopeRewriteMatch,
        config: StataLSPConfig,
        document: DocumentState
    ): Diagnostic | null {
        return this.convert_semantic_diagnostic(
            {
                message: format_out_of_scope_message(
                    symbol_name,
                    match.symbol_kind,
                    match.reason
                ),
                range: base_diagnostic.range,
                code: StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
                severity: base_diagnostic.severity,
                base_code: base_diagnostic.code,
            },
            config,
            document
        );
    }

    private find_same_file_out_of_scope_match(
        symbol_name: string,
        reference_kind: 'local' | 'global' | 'variable' | null,
        symbols: SymbolTable,
        current_document_uri: string,
        reference_line: number
    ): OutOfScopeRewriteMatch | null {
        if (reference_kind !== 'local' && reference_kind !== 'global') {
            return null;
        }

        const get_definition_line = (
            symbol:
                | {
                    sourceUri?: string;
                    location?: { uri?: string; range?: { start?: { line?: number } } };
                }
                | undefined
        ): number | null => {
            if (!symbol) {
                return null;
            }
            const symbol_uri = symbol.sourceUri ?? symbol.location?.uri;
            if (symbol_uri !== current_document_uri) {
                return null;
            }
            const definition_line = symbol.location?.range?.start?.line;
            return typeof definition_line === 'number' ? definition_line : null;
        };

        const matching_symbol = reference_kind === 'local'
            ? symbols.localMacros.get(symbol_name)
            : symbols.globalMacros.get(symbol_name);
        const definition_line = get_definition_line(matching_symbol);

        if (definition_line === null || definition_line <= reference_line) {
            return null;
        }

        return {
            symbol_kind: reference_kind,
            reason: {
                kind: 'same_file_forward',
                defined_line_0: definition_line,
            },
        };
    }

    private find_backward_out_of_scope_match(
        symbol_name: string,
        reference_kind: 'local' | 'global' | 'variable' | null,
        resolved_scope: ResolvedScope
    ): OutOfScopeRewriteMatch | null {
        if (reference_kind === null) {
            return null;
        }

        const out_of_scope = resolved_scope.out_of_scope_symbols.find(my_symbol =>
            my_symbol.name === symbol_name
            && this.out_of_scope_type_matches_reference(
                my_symbol.type,
                reference_kind
            )
        );
        if (!out_of_scope) {
            return null;
        }

        const source_file = out_of_scope.source_uri.split('/').pop()
            || out_of_scope.source_uri;
        if (out_of_scope.reason === 'inheritance_excludes_locals') {
            return {
                symbol_kind: 'local',
                reason: {
                    kind: 'inheritance_excludes_locals',
                    source_file,
                },
            };
        }

        return {
            symbol_kind: reference_kind,
            reason: {
                kind: 'after_call_site',
                call_site_line_0: out_of_scope.call_site_line,
                source_file,
            },
        };
    }

    /**
     * Convert config severity string to LSP DiagnosticSeverity.
     * Returns null if the severity is 'off'.
     */
    private get_severity_from_config(
        severity_config: 'error' | 'warning' | 'information' | 'hint' | 'off'
    ): DiagnosticSeverity | null {
        switch (severity_config) {
            case 'error':
                return DiagnosticSeverity.Error;
            case 'warning':
                return DiagnosticSeverity.Warning;
            case 'information':
                return DiagnosticSeverity.Information;
            case 'hint':
                return DiagnosticSeverity.Hint;
            case 'off':
                return null;
        }
    }

    /**
     * Convert semantic analyzer severity to LSP DiagnosticSeverity.
     */
    private semantic_severity_to_lsp(
        severity: 'error' | 'warning' | 'information' | 'hint'
    ): DiagnosticSeverity {
        switch (severity) {
            case 'error':
                return DiagnosticSeverity.Error;
            case 'warning':
                return DiagnosticSeverity.Warning;
            case 'information':
                return DiagnosticSeverity.Information;
            case 'hint':
                return DiagnosticSeverity.Hint;
        }
    }

    /**
     * Check if a diagnostic should be suppressed based on language context.
     * Stata-specific diagnostics are suppressed in embedded language contexts,
     * but structural errors (quotes, braces) are still reported.
     */
    private is_in_embedded_context(
        position: Position,
        context_ranges: ContextRange[]
    ): boolean {
        // Check if position is within any embedded context range
        for (const my_range of context_ranges) {
            const my_start = my_range.range.start;
            const my_end = my_range.range.end;
            
            // Check if position is within this range
            if ((position.line > my_start.line || 
                 (position.line === my_start.line && position.character >= my_start.character)) &&
                (position.line < my_end.line || 
                 (position.line === my_end.line && position.character <= my_end.character))) {
                // Position is within this range
                if (my_range.context !== LanguageContext.STATA) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if an error code represents a Stata-specific error.
     * Structural errors like unbalanced quotes/braces are not Stata-specific.
     */
    private is_stata_specific_error(error_code: string | number): boolean {
        // Structural errors that should be reported even in embedded contexts
        const structural_errors = [
            LexerErrorCode.UNBALANCED_QUOTES,
            LexerErrorCode.UNBALANCED_BLOCK_COMMENT,
        ];

        if (typeof error_code === 'number') {
            return !structural_errors.includes(error_code);
        }

        // String error codes - check if they're structural
        const error_code_str = String(error_code).toLowerCase();
        return !(error_code_str.includes('quote') || 
                 error_code_str.includes('comment') ||
                 error_code_str.includes('brace'));
    }

    /**
     * Convert a context diagnostic to an LSP Diagnostic.
     */
    private convert_context_diagnostic(
        diagnostic: ContextDiagnostic
    ): Diagnostic {
        const severity_map = {
            'error': DiagnosticSeverity.Error,
            'warning': DiagnosticSeverity.Warning,
            'information': DiagnosticSeverity.Information,
        };

        return {
            range: diagnostic.range,
            message: diagnostic.message,
            severity: severity_map[diagnostic.severity],
            code: diagnostic.code,
            source: 'sight',
        };
    }

    /**
     * Convert a directive diagnostic to an LSP Diagnostic.
     *
     * Routing is keyed on `diagnostic.kind` (structured discriminator):
     * - `'path_case_mismatch'` → severity from
     *   `config.cross_file.diagnostics.case_mismatch`; independent of
     *   `missing_file` severity.
     * - `'missing_file'` or legacy message containing 'Cannot read file' →
     *   existing `missing_file` policy, unchanged.
     */
    private convert_directive_diagnostic(
        diagnostic: DirectiveDiagnostic,
        config: StataLSPConfig
    ): Diagnostic | null {
        // ── path_case_mismatch branch ─────────────────────────────────────────
        if (diagnostic.kind === 'path_case_mismatch') {
            const case_mismatch_setting =
                config.cross_file?.diagnostics?.case_mismatch ?? 'auto';

            if (case_mismatch_setting === 'off') {
                return null;
            }

            let severity: DiagnosticSeverity;
            if (case_mismatch_setting === 'auto') {
                // Probe the host filesystem. Fall back to case-sensitive
                // (Warning) when seed dir is missing — conservative choice
                // that surfaces the problem rather than silently hiding it.
                const seed_dir = diagnostic.case_mismatch_seed_dir;
                const is_sensitive = seed_dir !== undefined
                    ? host_probe(seed_dir)
                    : true; // no seed → assume case-sensitive
                severity = is_sensitive
                    ? DiagnosticSeverity.Warning
                    : DiagnosticSeverity.Information;
            } else {
                severity =
                    this.get_severity_from_config(case_mismatch_setting)
                    ?? DiagnosticSeverity.Warning;
            }

            return {
                range: diagnostic.range,
                message: diagnostic.message,
                severity,
                code: diagnostic.code,
                source: 'sight',
            };
        }

        // ── truncation branch (#209) ─────────────────────────────────────────
        // Cap-induced cross-file truncation. Preserve the
        // CROSS_FILE_TRUNCATED code so `sight check` can surface it
        // distinctly and exclude it from the pass/fail tally by code (not
        // severity). Severity is left as emitted (respects
        // `cross_file.diagnostics.max_depth`); the code drives CI gating.
        if (diagnostic.kind === 'truncation') {
            return {
                range: diagnostic.range,
                message: diagnostic.message,
                severity: this.semantic_severity_to_lsp(diagnostic.severity),
                code: diagnostic.code,
                source: 'sight',
            };
        }

        // ── missing_file / legacy branch ─────────────────────────────────────
        // Keyed on `kind === 'missing_file'` OR the legacy prose substring.
        const is_missing_file =
            diagnostic.kind === 'missing_file' ||
            diagnostic.message.includes('Cannot read file');

        const missing_file_severity =
            config.cross_file?.diagnostics?.missing_file;
        if (is_missing_file && missing_file_severity === 'off') {
            return null;
        }

        const severity = is_missing_file
            ? (
                missing_file_severity
                    ? this.get_severity_from_config(missing_file_severity)
                        ?? DiagnosticSeverity.Information
                    : DiagnosticSeverity.Information
            )
            : this.semantic_severity_to_lsp(diagnostic.severity);

        return {
            range: diagnostic.range,
            message: diagnostic.message,
            severity,
            source: 'sight',
        };
    }

    /**
     * Return the referenced symbol name for an undefined-symbol diagnostic.
     * Reads the structured `symbol_name` the analyzer attaches; the message
     * prose is no longer consulted.
     */
    private extract_symbol_name_from_diagnostic(
        diagnostic: { symbol_name?: string }
    ): string | null {
        // The analyzer populates symbol_name structurally for UNDEFINED_MACRO /
        // UNDEFINED_VARIABLE diagnostics, so we never parse the message prose
        // (which the human-facing wording is free to change).
        return diagnostic.symbol_name ?? null;
    }

    /**
     * Check if a symbol is defined in the resolved scope AND comes from a different file.
     * Only symbols from different files should suppress undefined symbol diagnostics.
     * Symbols from the same file should preserve forward reference detection.
     */
    private is_symbol_defined_in_scope(
        symbol_name: string,
        symbols: SymbolTable,
        diagnostic_code: StataDiagnosticCode,
        current_document_uri: string,
        reference_kind: ReferenceKind
    ): boolean {
        const is_external_symbol = (
            symbol: { sourceUri?: string } | undefined
        ): boolean => {
            return !!symbol?.sourceUri && symbol.sourceUri !== current_document_uri;
        };
        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_MACRO) {
            if (reference_kind === 'local') {
                return is_external_symbol(symbols.localMacros.get(symbol_name));
            }
            if (reference_kind === 'global') {
                return is_external_symbol(symbols.globalMacros.get(symbol_name));
            }
            
            return false;
        }

        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
            if (reference_kind !== 'variable') {
                return false;
            }
            return is_external_symbol(symbols.variables.get(symbol_name));
        }
        return false;
    }

    /**
     * Check whether the current document defines the referenced symbol itself.
     * Used to preserve same-file forward-reference diagnostics when a matching
     * name also exists in an excluded forward-called file.
     *
     * NOTE: program-scoped locals in the current file are intentionally treated
     * as "same-file" here. A narrower formulation that excluded them was tried
     * and reverted on 2026-04-21 (commits b852e1c, 3ac1904, 12dc34c, 1e38388)
     * because the callee-aware "use include" rewrite then fires at top-level
     * references even when the only local with that name lives inside a
     * different program body — which is actively misleading. The remaining
     * design question of emitting a distinct, accurate message for
     * scope-isolated same-file locals is tracked in
     * https://github.com/jbearak/sight/issues/145. Do not re-narrow this
     * guard without resolving that issue.
     */
    private is_symbol_defined_in_current_document(
        symbol_name: string,
        symbols: SymbolTable,
        diagnostic_code: StataDiagnosticCode,
        current_document_uri: string,
        reference_kind?: ReferenceKind
    ): boolean {
        const is_from_current_document = (
            symbol: { sourceUri?: string; location?: { uri: string } } | undefined
        ): boolean => {
            if (!symbol) {
                return false;
            }
            return symbol.sourceUri === current_document_uri
                || symbol.location?.uri === current_document_uri;
        };

        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_MACRO) {
            if (reference_kind === 'local') {
                return is_from_current_document(symbols.localMacros.get(symbol_name));
            }
            if (reference_kind === 'global') {
                return is_from_current_document(symbols.globalMacros.get(symbol_name));
            }
            return is_from_current_document(symbols.localMacros.get(symbol_name))
                || is_from_current_document(symbols.globalMacros.get(symbol_name));
        }

        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
            return is_from_current_document(symbols.variables.get(symbol_name))
                || is_from_current_document(symbols.scalars?.get(symbol_name))
                || is_from_current_document(symbols.matrices?.get(symbol_name));
        }

        return false;
    }

    /**
     * Check if an undefined-symbol reference would have been resolved by a
     * forward-called file, except that the call's effective type excludes this
     * kind of symbol. Currently only one such case exists: a local macro
     * defined in a file reached via `do`/`run` (locals don't propagate across
     * those boundaries — only `include` inherits locals).
     *
     * Returning true signals the caller to rewrite the existing undefined
     * local-macro diagnostic into a more informative OUT_OF_SCOPE_SYMBOL
     * diagnostic. This rewrite still depends on the base undefined-symbol
     * diagnostic path being enabled.
     */
    private is_symbol_excluded_by_forward_call(
        symbol_name: string,
        call_site: import('../types').ForwardCallSite,
        diagnostic_code: StataDiagnosticCode,
        reference_kind: ReferenceKind | undefined,
        current_document_uri: string,
    ): boolean {
        if (diagnostic_code !== StataDiagnosticCode.UNDEFINED_MACRO) {
            return false;
        }
        if (reference_kind !== 'local') {
            return false;
        }
        if (call_site.effective_type !== 'do') {
            return false;
        }
        const excluded_local = call_site.excluded_locals?.get(symbol_name);
        return !!excluded_local?.sourceUri
            && excluded_local.sourceUri !== current_document_uri;
    }

    /**
     * Check if a symbol is defined in forward call symbols (from current file's forward calls).
     * Unlike is_symbol_defined_in_scope, this does NOT filter by sourceUri because
     * forward calls from the current file should suppress warnings after the call site.
     *
     * For local macros, only 'include' calls contribute locals; 'do'/'run' calls do not.
     */
    private is_symbol_in_forward_call(
        symbol_name: string,
        symbols: SymbolTable,
        diagnostic_code: StataDiagnosticCode,
        effective_type: 'do' | 'include',
        current_document_uri: string,
        reference_kind: ReferenceKind
    ): boolean {
        const is_external_symbol = (
            symbol: { sourceUri?: string } | undefined
        ): boolean => {
            return !!symbol?.sourceUri && symbol.sourceUri !== current_document_uri;
        };
        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_MACRO) {
            if (reference_kind === 'local') {
                return effective_type === 'include'
                    && is_external_symbol(symbols.localMacros.get(symbol_name));
            }
            if (reference_kind === 'global') {
                return is_external_symbol(symbols.globalMacros.get(symbol_name));
            }
            
            return false;
        }

        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
            if (reference_kind !== 'variable') {
                return false;
            }
            return is_external_symbol(symbols.variables.get(symbol_name));
        }
        return false;
    }

    /**
     * Check if a program is defined in the resolved scope.
     */
    private is_program_defined_in_scope(
        program_name: string,
        symbols: SymbolTable
    ): boolean {
        return symbols.programs.has(program_name);
    }

    /**
     * Check if a macro name is a c_local from a program in the resolved scope
     * that was called before the diagnostic line.
     * 
     * This handles the case where:
     * 1. The analyzer didn't have workspace symbols during analysis
     * 2. But the scope resolver found the program via @lsp-done-by chain
     * 3. The program has c_locals that should suppress the undefined macro warning
     * 4. The program was called BEFORE the line where the macro is referenced
     */
    private is_c_local_from_resolved_program(
        macro_name: string,
        symbols: SymbolTable,
        document: DocumentState,
        diagnostic_line: number
    ): boolean {
        // Check each program in the resolved scope
        for (const [prog_name, program] of symbols.programs) {
            // Skip if program has no c_locals
            if (!program.c_locals || program.c_locals.length === 0) {
                continue;
            }
            
            // Check if this macro is in the program's c_locals
            if (!program.c_locals.includes(macro_name)) {
                continue;
            }
            
            // Check if this program was called in the document BEFORE the diagnostic line
            // We need to verify the program was actually called, not just that it exists
            if (this.was_program_called_before_line(prog_name, document, diagnostic_line)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Check if a program was called in the document before a specific line.
     * This ensures c_locals are only suppressed after the program call.
     * 
     * Case-sensitive: program names must match exactly, and prefix commands
     * (quietly, capture, noisily) must be lowercase per Stata syntax.
     */
    private was_program_called_before_line(
        program_name: string,
        document: DocumentState,
        before_line: number
    ): boolean {
        const line_count = get_line_count(document);
        
        // Only check lines before the diagnostic
        for (let i = 0; i < before_line && i < line_count; i++) {
            const line_trimmed = get_line_text(document, i).trim();
            
            // Skip empty lines and comments
            if (line_trimmed === '' ||
                line_trimmed.startsWith('*') ||
                line_trimmed.startsWith('//')) {
                continue;
            }
            
            // Check if line starts with the program name (command position)
            if (this.line_starts_with_program(line_trimmed, program_name)) {
                return true;
            }
            
            // Check for common prefixes (must be lowercase per Stata syntax)
            const prefixes = ['quietly ', 'qui ', 'capture ', 'cap ', 'noisily ', 'noi '];
            for (const prefix of prefixes) {
                if (line_trimmed.startsWith(prefix)) {
                    const after_prefix = line_trimmed.slice(prefix.length).trim();
                    if (this.line_starts_with_program(after_prefix, program_name)) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }

    /**
     * Check if a line starts with a program name (case-sensitive).
     * Matches: "programName", "programName ", "programName\t", "programName,"
     */
    private line_starts_with_program(line: string, program_name: string): boolean {
        if (line === program_name) {
            return true;
        }
        if (line.startsWith(program_name)) {
            const next_char = line[program_name.length];
            // Program call ends at whitespace, comma, or end of line
            if (next_char === ' ' || next_char === '\t' || next_char === ',') {
                return true;
            }
        }
        return false;
    }

    /**
     * Classify the referenced symbol kind for an undefined-symbol diagnostic.
     *
     * Reads the structured `reference_kind` the analyzer attaches ('local',
     * 'global', or 'variable'); the message prose is no longer consulted.
     *
     * @returns 'local', 'global', or 'variable' when known, else null.
     */
    private classify_reference_kind(
        diagnostic: { reference_kind?: 'local' | 'global' | 'variable' }
    ): ReferenceKind {
        return diagnostic.reference_kind ?? null;
    }

    /**
     * Check if an out-of-scope symbol type matches the reference scope.
     * 
     * This ensures that when we find an out-of-scope symbol by name, we only
     * report it if the symbol type matches what the user is actually referencing.
     * For example, if the user references `$country_name` (global), we should
     * only match out-of-scope global macros, not local macros.
     * 
     * @param out_of_scope_type - The type of the out-of-scope symbol
     * @param reference_kind - The kind of the reference
     * @returns true if the types match, false otherwise
     */
    private out_of_scope_type_matches_reference(
        out_of_scope_type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix',
        reference_kind: 'local' | 'global' | 'variable' | null
    ): boolean {
        if (reference_kind === null) {
            return false;
        }

        return reference_kind === out_of_scope_type;
    }

}
