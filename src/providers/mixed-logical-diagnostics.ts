import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';

/**
 * Logical operator values tracked for mixed-operator detection.
 */
const LOGICAL_OPS: Set<string> = new Set(['&', '|']);

/**
 * Token types that end an expression segment.
 * These reset the mixed-operator tracking state.
 */
const EXPRESSION_BREAKERS: Set<string> = new Set([
    'STATEMENT_TERMINATOR',
    'COMMENT_LINE',
    'COMMENT_BLOCK',
    'COMMA',
    'LBRACE',
    'RBRACE',
]);

/**
 * State tracked while scanning an expression segment for mixed
 * logical operators at the same parenthesization depth.
 */
interface ExpressionState {
    /** Current parenthesis nesting depth. */
    paren_depth: number;
    /** Logical operators seen in the current expression segment. */
    logical_tokens: Array<{ token: Token; depth: number }>;
}

/**
 * Check if token `a` appears before token `b` in source order.
 */
function is_before(a: Token, b: Token): boolean {
    if (a.range.start.line !== b.range.start.line) {
        return a.range.start.line < b.range.start.line;
    }
    return a.range.start.character <= b.range.start.character;
}

/**
 * MixedLogicalOperatorAnalyzer detects expressions containing both `&` and `|`
 * operators at the same parenthesization level without explicit grouping.
 *
 * In Stata, `&` binds more tightly than `|`, so `x & y | z` evaluates as
 * `(x & y) | z`. Users may intend `x & (y | z)` instead. This analyzer
 * warns when both operators appear at the same shallowest logical depth in
 * the same expression segment, suggesting parentheses to clarify precedence.
 *
 * Follows the established Pattern B (standalone analyzer class invoked by
 * DiagnosticsProvider), matching IndentationDiagnosticAnalyzer and
 * OperatorSequenceAnalyzer.
 */
export class MixedLogicalOperatorAnalyzer {
    /**
     * Analyze a document's token stream for mixed `&` and `|` operators
     * without parentheses.
     *
     * @param document - The document state containing tokens and ignored_lines
     * @param config - LSP configuration for diagnostic settings
     * @returns Array of diagnostics for mixed logical operator expressions
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
        const config_severity = config.diagnostics?.severity?.mixedLogicalOperators ?? 'warning';
        if (config_severity === 'off') {
            return [];
        }

        const the_tokens = document.tokens;
        if (!the_tokens || the_tokens.length === 0) {
            return [];
        }

        const ignored_lines = document.ignored_lines ?? new Set<number>();
        const severity = this.resolve_severity(config_severity);

        const the_diagnostics: Diagnostic[] = [];
        let state = this.fresh_state();

        let in_continuation = false;

        for (let i = 0; i < the_tokens.length; i++) {
            const my_token = the_tokens[i];

            // STATEMENT_TERMINATOR after /// is part of the continuation,
            // not an expression breaker (the newline following /// is
            // tokenized as STATEMENT_TERMINATOR but is semantically trivia).
            if (my_token.type === 'STATEMENT_TERMINATOR' && in_continuation) {
                in_continuation = false;
                continue;
            }

            // Expression breakers reset tracking
            if (EXPRESSION_BREAKERS.has(my_token.type)) {
                in_continuation = false;
                this.flush(state, the_diagnostics, severity, ignored_lines);
                state = this.fresh_state();
                continue;
            }

            // Skip whitespace — it doesn't affect expression structure
            if (my_token.type === 'WHITESPACE') {
                continue;
            }

            // /// continuation: set flag so the next STATEMENT_TERMINATOR
            // is treated as trivia rather than an expression breaker
            if (my_token.type === 'CONTINUATION') {
                in_continuation = true;
                continue;
            }

            // Any non-trivia token clears the continuation flag
            in_continuation = false;

            // Track parenthesis depth
            if (my_token.type === 'LPAREN') {
                state.paren_depth++;
                continue;
            }
            if (my_token.type === 'RPAREN') {
                state.paren_depth = Math.max(0, state.paren_depth - 1);
                continue;
            }

            // Track all logical operators and evaluate them by their
            // shallowest shared depth when the expression is flushed.
            if (my_token.type === 'OPERATOR' && LOGICAL_OPS.has(my_token.value)) {
                state.logical_tokens.push({
                    token: my_token,
                    depth: state.paren_depth,
                });
            }
        }

        // Flush any remaining expression
        this.flush(state, the_diagnostics, severity, ignored_lines);

        return the_diagnostics;
    }

    /**
     * Create a fresh expression tracking state.
     */
    private fresh_state(): ExpressionState {
        return { paren_depth: 0, logical_tokens: [] };
    }

    /**
     * If the current expression state contains both `&` and `|` at the
     * shallowest logical depth, emit a diagnostic spanning that mixed range.
     */
    private flush(
        state: ExpressionState,
        the_diagnostics: Diagnostic[],
        severity: DiagnosticSeverity,
        ignored_lines: Set<number>
    ): void {
        if (state.logical_tokens.length === 0) {
            return;
        }

        let min_depth = state.logical_tokens[0].depth;
        for (const my_entry of state.logical_tokens) {
            if (my_entry.depth < min_depth) {
                min_depth = my_entry.depth;
            }
        }

        const relevant_tokens = state.logical_tokens
            .filter(my_entry => my_entry.depth === min_depth)
            .map(my_entry => my_entry.token);
        const and_tokens = relevant_tokens.filter(
            my_token => my_token.value === '&'
        );
        const or_tokens = relevant_tokens.filter(
            my_token => my_token.value === '|'
        );
        if (and_tokens.length === 0 || or_tokens.length === 0) {
            return;
        }

        const first_and = and_tokens[0];
        const first_or = or_tokens[0];
        const last_and = and_tokens[and_tokens.length - 1];
        const last_or = or_tokens[or_tokens.length - 1];
        const first_token = is_before(first_and, first_or)
            ? first_and : first_or;
        const last_token = is_before(last_and, last_or)
            ? last_or : last_and;

        // Check suppression via @lsp-ignore
        if (ignored_lines.has(first_token.range.start.line)) {
            return;
        }

        the_diagnostics.push({
            range: Range.create(first_token.range.start, last_token.range.end),
            message: "Mixed '&' and '|' without parentheses. "
                + "Use parentheses to clarify precedence "
                + "(e.g., '(x & y) | z' or 'x & (y | z)')",
            severity,
            source: 'sight',
            code: StataDiagnosticCode.MIXED_LOGICAL_OPERATORS,
        });
    }

    /**
     * Convert a config severity string to LSP DiagnosticSeverity.
     */
    private resolve_severity(
        config_severity: 'error' | 'warning' | 'information' | 'hint'
    ): DiagnosticSeverity {
        switch (config_severity) {
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
}
