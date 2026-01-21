import { Diagnostic, DiagnosticSeverity, Connection, Position, CancellationToken } from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { LanguageContext, ContextDiagnostic, ContextErrorCode } from '../context-tracker/types';
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
    ForwardResolvedScope
} from '../types';
import { ScopeResolver } from '../scope-resolver';
import { createHash } from 'crypto';
import { DocumentDebounceManager } from '../utils/debounce-manager';
import { get_line_text, get_line_count } from '../utils/line-utils';
import { IndentationDiagnosticAnalyzer } from './indentation-diagnostics';

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
    private connection: Connection;
    private debounce_manager: DocumentDebounceManager | null = null;
    private indentation_analyzer = new IndentationDiagnosticAnalyzer();
    
    // Track published versions to prevent stale diagnostics
    private published_versions: Map<string, number> = new Map();
    
    // Cache filtered diagnostics by (uri, version, config_hash)
    private filtered_cache: Map<string, Map<string, Diagnostic[]>> = new Map();

    constructor(connection: Connection, debounce_manager?: DocumentDebounceManager) {
        this.connection = connection;
        this.debounce_manager = debounce_manager || null;
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
        cancellation_token?: CancellationToken,
        forward_scope?: ForwardResolvedScope
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
        const the_diagnostics = await this.get_diagnostics(document, config, workspace_symbols, scope_resolver, cancellation_token, forward_scope);

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
        cancellation_token?: CancellationToken,
        forward_scope?: ForwardResolvedScope
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
        // Only pass config if assume_call_site is explicitly set to avoid
        // overriding the default with undefined
        const resolve_config = config.cross_file?.assume_call_site
            ? {
                assume_call_site: config.cross_file.assume_call_site,
                max_forward_depth: config.cross_file?.max_forward_depth,
                diagnostics: {
                    max_depth: config.cross_file?.diagnostics?.max_depth,
                },
            }
            : { 
                max_forward_depth: config.cross_file?.max_forward_depth,
                diagnostics: {
                    max_depth: config.cross_file?.diagnostics?.max_depth,
                },
            };
        const resolved_scope = scope_resolver ? await scope_resolver.resolve(
            document.uri,
            document.content,
            resolve_config,
            cancellation_token
        ) : undefined;
        
        for (const my_diagnostic of this.extract_semantic_diagnostics(document)) {
            // Suppress Stata-specific semantic diagnostics in embedded contexts
            if (this.is_in_embedded_context(my_diagnostic.range.start, the_context_ranges)) {
                continue;
            }
            
            // Check if this is an undefined symbol that's actually defined in cross-file scope
            if (resolved_scope && 
                (my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                 my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)) {
                const symbol_name = this.extract_symbol_name_from_diagnostic(my_diagnostic);
                if (symbol_name) {
                    // Check if defined in cross-file scope (different sourceUri)
                    if (this.is_symbol_defined_in_scope(symbol_name, resolved_scope.symbols, my_diagnostic.code, document.uri)) {
                        continue; // Skip - symbol is defined in parent file
                    }
                    
                    // Check if this macro is a c_local from a program in the resolved scope
                    // This handles the case where the analyzer didn't have workspace symbols
                    // but the scope resolver found the program via @lsp-done-by chain
                    if (my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO) {
                        if (this.is_c_local_from_resolved_program(symbol_name, resolved_scope.symbols, document, my_diagnostic.range.start.line)) {
                            continue; // Skip - macro is a c_local from a program in resolved scope
                        }
                    }
                    
                    // Check if symbol is out-of-scope (defined after call site or excluded by inheritance)
                    // Only match out-of-scope symbols of the same type as the reference
                    const reference_scope = this.extract_macro_scope_from_diagnostic(my_diagnostic);
                    const out_of_scope = resolved_scope.out_of_scope_symbols.find(
                        s => s.name === symbol_name && this.out_of_scope_type_matches_reference(s.type, reference_scope)
                    );
                    if (out_of_scope) {
                        // Check config severity for out-of-scope
                        const out_of_scope_severity = config.cross_file?.diagnostics?.out_of_scope;
                        if (out_of_scope_severity === 'off') {
                            continue;
                        }
                        // Emit more informative out-of-scope diagnostic based on reason
                        const source_file = out_of_scope.source_uri.split('/').pop() || out_of_scope.source_uri;
                        let message: string;
                        if (out_of_scope.reason === 'inheritance_excludes_locals') {
                            message = `'${symbol_name}' is defined in ${source_file} but local macros are not inherited via do/run (use include or @lsp-included-by)`;
                        } else {
                            // Convert 0-indexed call_site_line to 1-indexed for display
                            const display_line = out_of_scope.call_site_line + 1;
                            message = `'${symbol_name}' is defined in ${source_file} but after the call site (line ${display_line})`;
                        }
                        the_diagnostics.push({
                            range: my_diagnostic.range,
                            message,
                            severity: this.cross_file_severity_to_lsp(out_of_scope_severity),
                            source: 'sight',
                            code: StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
                        });
                        continue;
                    }
                }
            }
            
            // Check if this is an undefined symbol that's defined in forward-call symbols
            // Use resolved_scope.forward_call_symbols as primary source, fall back to forward_scope.call_sites
            const forward_call_sites = resolved_scope?.forward_call_symbols ?? forward_scope?.call_sites;
            if (forward_call_sites && 
                (my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO ||
                 my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)) {
                const symbol_name = this.extract_symbol_name_from_diagnostic(my_diagnostic);
                if (symbol_name) {
                    const diag_line = my_diagnostic.range.start.line;
                    let found_in_forward_call = false;
                    for (const call_site of forward_call_sites) {
                        if (call_site.call_line < diag_line &&
                            this.is_symbol_in_forward_call(symbol_name, call_site.symbols, my_diagnostic.code, call_site.effective_type)) {
                            found_in_forward_call = true;
                            break;
                        }
                    }
                    if (found_in_forward_call) {
                        continue; // Skip - symbol is defined in forward-called file before this line
                    }
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

        // Add directive-related diagnostics if scope resolver is provided
        if (resolved_scope) {
            for (const my_directive_diag of resolved_scope.diagnostics) {
                const converted = this.convert_directive_diagnostic(my_directive_diag, config);
                if (converted) {
                    the_diagnostics.push(converted);
                }
            }
        }

        // Add forward-scope diagnostics (missing file, max depth, cycle)
        if (forward_scope) {
            for (const my_forward_diag of forward_scope.diagnostics) {
                const converted = this.convert_directive_diagnostic(my_forward_diag, config);
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
            undefinedVariableEnabled: config.diagnostics.undefinedVariableEnabled,
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
    private extract_semantic_diagnostics(document: DocumentState): Array<{
        message: string;
        range: any;
        code: number;
        severity: 'error' | 'warning' | 'information' | 'hint';
    }> {
        const semantic_diags: Array<{
            message: string;
            range: any;
            code: number;
            severity: 'error' | 'warning' | 'information' | 'hint';
        }> = [];
        for (const diag of document.diagnostics) {
            if (diag.code && typeof diag.code === 'number') {
                const code = diag.code as number;
                if (code >= 2001 && code <= 2002) {
                    // This is a semantic error code
                    const severity_map: Record<DiagnosticSeverity, 'error' | 'warning' | 'information' | 'hint'> = {
                        [DiagnosticSeverity.Error]: 'error',
                        [DiagnosticSeverity.Warning]: 'warning',
                        [DiagnosticSeverity.Information]: 'information',
                        [DiagnosticSeverity.Hint]: 'hint',
                    };
                    semantic_diags.push({
                        message: diag.message,
                        range: diag.range,
                        code,
                        severity: severity_map[diag.severity ?? DiagnosticSeverity.Error],
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

    /**
     * Convert a parser error to an LSP Diagnostic.
     */
    private convert_parser_error(
        error: ParseError,
        config: StataLSPConfig
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
        diagnostic_range: any
    ): boolean {
        const diagnostic_line = diagnostic_range.start.line;
        const line_count = get_line_count(document);
        
        // Check current line for @lsp-ignore
        if (diagnostic_line < line_count) {
            const current_line = get_line_text(document, diagnostic_line);
            if (current_line.includes('// @lsp-ignore')) {
                return true;
            }
        }
        
        // Check previous line for @lsp-ignore-next
        if (diagnostic_line > 0) {
            const previous_line = get_line_text(document, diagnostic_line - 1);
            if (previous_line.includes('// @lsp-ignore-next')) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Convert a semantic diagnostic to an LSP Diagnostic.
     */
    private convert_semantic_diagnostic(
        diagnostic: {
            message: string;
            range: any;
            code: number;
            severity: 'error' | 'warning' | 'information' | 'hint';
        },
        config: StataLSPConfig,
        document?: DocumentState
    ): Diagnostic | null {
        // Check suppression first for undefined symbol diagnostics
        if (document && 
            (diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO ||
             diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)) {
            if (this.should_suppress_undefined_symbol(document, diagnostic.range)) {
                return null; // Suppressed
            }
        }

        let severity: DiagnosticSeverity | null;

        // Determine severity based on diagnostic code and config

        switch (diagnostic.code) {
            case StataDiagnosticCode.UNDEFINED_MACRO:
            case StataDiagnosticCode.UNDEFINED_VARIABLE: {
                const severity_setting = diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO
                    ? config.diagnostics.severity.undefinedMacro
                    : config.diagnostics.severity.undefinedVariable;
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
        context_ranges: any[]
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
     */
    private convert_directive_diagnostic(
        diagnostic: DirectiveDiagnostic,
        config: StataLSPConfig
    ): Diagnostic | null {
        // Check config severity for missing file diagnostics
        const missing_file_severity = config.cross_file?.diagnostics?.missing_file;
        if (diagnostic.message.includes('Cannot read file') && missing_file_severity === 'off') {
            return null;
        }

        const severity = diagnostic.message.includes('Cannot read file')
            ? this.cross_file_severity_to_lsp(missing_file_severity)
            : this.semantic_severity_to_lsp(diagnostic.severity);

        return {
            range: diagnostic.range,
            message: diagnostic.message,
            severity,
            source: 'sight',
        };
    }

    /**
     * Convert cross-file config severity to LSP DiagnosticSeverity.
     */
    private cross_file_severity_to_lsp(
        severity?: 'error' | 'warning' | 'information' | 'off'
    ): DiagnosticSeverity {
        switch (severity) {
            case 'error':
                return DiagnosticSeverity.Error;
            case 'warning':
                return DiagnosticSeverity.Warning;
            case 'information':
                return DiagnosticSeverity.Information;
            default:
                return DiagnosticSeverity.Information;
        }
    }

    /**
     * Extract symbol name from a diagnostic message.
     * Handles multiple formats:
     * - Local macro format: `name' (backtick + apostrophe)
     * - Global macro format: $name (dollar sign prefix)
     * - Quoted format: 'name' (single quotes)
     */
    private extract_symbol_name_from_diagnostic(
        diagnostic: { message: string; code: number }
    ): string | null {
        // Try local macro format first: `name'
        const local_macro_match = diagnostic.message.match(/`([^']+)'/);
        if (local_macro_match) {
            return local_macro_match[1];
        }

        // Try global macro format: $name
        const global_macro_match = diagnostic.message.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (global_macro_match) {
            return global_macro_match[1];
        }

        // Fall back to quoted format: 'name'
        const quoted_match = diagnostic.message.match(/'([^']+)'/);
        return quoted_match ? quoted_match[1] : null;
    }

    /**
     * Check if a symbol is defined in the resolved scope AND comes from a different file.
     * Only symbols from different files should suppress undefined symbol diagnostics.
     * Symbols from the same file should preserve forward reference detection.
     */
    private is_symbol_defined_in_scope(
        symbol_name: string,
        symbols: SymbolTable,
        diagnostic_code: number,
        current_document_uri: string
    ): boolean {
        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_MACRO) {
            // Check local macros
            const local_macro = symbols.localMacros.get(symbol_name);
            if (local_macro && local_macro.sourceUri && local_macro.sourceUri !== current_document_uri) {
                return true;
            }
            
            // Check global macros
            const global_macro = symbols.globalMacros.get(symbol_name);
            if (global_macro && global_macro.sourceUri && global_macro.sourceUri !== current_document_uri) {
                return true;
            }
            
            return false;
        } else if (diagnostic_code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
            // Check variables, scalars, and matrices (all can be referenced as variables)
            const variable = symbols.variables.get(symbol_name);
            if (variable && variable.sourceUri && variable.sourceUri !== current_document_uri) {
                return true;
            }
            
            const scalar = symbols.scalars?.get(symbol_name);
            if (scalar && scalar.sourceUri && scalar.sourceUri !== current_document_uri) {
                return true;
            }
            
            const matrix = symbols.matrices?.get(symbol_name);
            if (matrix && matrix.sourceUri && matrix.sourceUri !== current_document_uri) {
                return true;
            }
            
            return false;
        }
        return false;
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
        diagnostic_code: number,
        effective_type: 'do' | 'include'
    ): boolean {
        if (diagnostic_code === StataDiagnosticCode.UNDEFINED_MACRO) {
            // Local macros only visible from 'include' calls
            if (effective_type === 'include' && symbols.localMacros.has(symbol_name)) {
                return true;
            }
            
            // Check global macros (visible from both do and include)
            if (symbols.globalMacros.has(symbol_name)) {
                return true;
            }
            
            return false;
        } else if (diagnostic_code === StataDiagnosticCode.UNDEFINED_VARIABLE) {
            // Check variables, scalars, and matrices (all can be referenced as variables)
            if (symbols.variables.has(symbol_name)) {
                return true;
            }
            
            if (symbols.scalars?.has(symbol_name)) {
                return true;
            }
            
            if (symbols.matrices?.has(symbol_name)) {
                return true;
            }
            
            return false;
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
     * Extract the macro scope (local or global) from a diagnostic message.
     * 
     * Local macro references use backtick-apostrophe syntax: `name'
     * Global macro references use dollar sign syntax: $name or ${name}
     * 
     * @param diagnostic - The diagnostic containing the message to parse
     * @returns 'local' if the message contains local macro syntax,
     *          'global' if it contains global macro syntax,
     *          null if neither can be determined
     */
    private extract_macro_scope_from_diagnostic(
        diagnostic: { message: string; code: number }
    ): 'local' | 'global' | null {
        // Check for local macro syntax: `name'
        if (diagnostic.message.includes('`') && diagnostic.message.includes("'")) {
            const local_match = diagnostic.message.match(/`[^']+'/);
            if (local_match) {
                return 'local';
            }
        }
        
        // Check for global macro syntax: $name or ${name}
        if (diagnostic.message.includes('$')) {
            const global_match = diagnostic.message.match(/\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?/);
            if (global_match) {
                return 'global';
            }
        }
        
        return null;
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
     * @param reference_scope - The scope of the reference ('local', 'global', or null)
     * @returns true if the types match, false otherwise
     */
    private out_of_scope_type_matches_reference(
        out_of_scope_type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix',
        reference_scope: 'local' | 'global' | null
    ): boolean {
        // If we couldn't determine the reference scope, fall back to matching
        // This preserves backward compatibility for edge cases
        if (reference_scope === null) {
            return true;
        }
        
        // Match local references to local out-of-scope symbols
        if (reference_scope === 'local' && out_of_scope_type === 'local') {
            return true;
        }
        
        // Match global references to global out-of-scope symbols
        if (reference_scope === 'global' && out_of_scope_type === 'global') {
            return true;
        }
        
        return false;
    }

}
