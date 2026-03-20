import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';

/**
 * Logical operator values tracked for mixed-operator detection.
 */
const LOGICAL_OPS: Set<string> = new Set(['&', '|']);

/**
 * Top-level qualifier keywords that end the preceding expression segment.
 */
const QUALIFIER_BREAKERS: Set<string> = new Set(['if', 'in']);

/**
 * Token types that end an expression segment.
 * These reset the mixed-operator tracking state.
 */
const EXPRESSION_BREAKERS: Set<string> = new Set([
    'STATEMENT_TERMINATOR',
    'COMMENT_LINE',
    'LBRACE',
    'RBRACE',
]);

/**
 * State tracked for a single parenthesis group.
 */
interface GroupState {
    id: number;
    and_tokens: Token[];
    or_tokens: Token[];
    has_compound_logical_sequence: boolean;
}

/**
 * State tracked while scanning an expression segment for mixed
 * logical operators at the same parenthesization depth.
 */
interface ExpressionState {
    /** Current parenthesis nesting depth. */
    paren_depth: number;
    /** ID of the current parenthesis group. */
    current_group_id: number;
    /** Stack of active parenthesis groups. */
    group_stack: number[];
    /** Counter to assign unique group IDs. */
    next_group_id: number;
    /** Logical operators seen in the current expression segment, grouped by their parenthesis group. */
    groups: Map<number, GroupState>;
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
 * warns when both operators appear in the same parenthesis group,
 * suggesting parentheses to clarify precedence.
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
        const my_config_severity = config.diagnostics?.severity?.mixedLogicalOperators ?? 'warning';
        if (my_config_severity === 'off') {
            return [];
        }

        const the_tokens = document.tokens;
        if (!the_tokens || the_tokens.length === 0) {
            return [];
        }

        const my_ignored_lines = document.ignored_lines ?? new Set<number>();
        const my_severity = this.resolve_severity(my_config_severity);

        const my_diagnostics: Diagnostic[] = [];
        let my_state = this.fresh_state();
        let my_in_continuation = false;

        for (let i = 0; i < the_tokens.length; i++) {
            const my_token = the_tokens[i];

            if (my_token.type === 'STATEMENT_TERMINATOR' && my_in_continuation) {
                my_in_continuation = false;
                continue;
            }

            if (this.is_qualifier_breaker(my_token, my_state)) {
                my_in_continuation = false;
                this.flush(my_state, my_diagnostics, my_severity, my_ignored_lines);
                my_state = this.fresh_state();
                continue;
            }

            if (this.is_expression_breaker(my_token)) {
                my_in_continuation = false;
                this.flush(my_state, my_diagnostics, my_severity, my_ignored_lines);
                my_state = this.fresh_state();
                continue;
            }

            if (my_token.type === 'COMMA') {
                if (my_state.paren_depth === 0) {
                    my_in_continuation = false;
                    this.flush(my_state, my_diagnostics, my_severity, my_ignored_lines);
                    my_state = this.fresh_state();
                } else {
                    const my_new_group = my_state.next_group_id++;
                    my_state.group_stack[my_state.group_stack.length - 1] = my_new_group;
                    my_state.current_group_id = my_new_group;
                }
                continue;
            }

            if (my_token.type === 'WHITESPACE') {
                continue;
            }

            if (my_token.type === 'CONTINUATION') {
                my_in_continuation = true;
                continue;
            }

            my_in_continuation = false;

            if (my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') {
                my_state.paren_depth++;
                const my_new_group = my_state.next_group_id++;
                my_state.group_stack.push(my_new_group);
                my_state.current_group_id = my_new_group;
                continue;
            }
            if (my_token.type === 'RPAREN' || my_token.type === 'RBRACKET') {
                my_state.paren_depth = Math.max(0, my_state.paren_depth - 1);
                if (my_state.group_stack.length > 1) {
                    my_state.group_stack.pop();
                    my_state.current_group_id = my_state.group_stack[my_state.group_stack.length - 1];
                }
                continue;
            }

            if (my_token.type === 'OPERATOR' && LOGICAL_OPS.has(my_token.value)) {
                let my_group = my_state.groups.get(my_state.current_group_id);
                if (!my_group) {
                    my_group = {
                        id: my_state.current_group_id,
                        and_tokens: [],
                        or_tokens: [],
                        has_compound_logical_sequence: false,
                    };
                    my_state.groups.set(my_state.current_group_id, my_group);
                }

                if (this.starts_compound_logical_sequence(the_tokens, i, my_token)) {
                    my_group.has_compound_logical_sequence = true;
                }

                if (my_token.value === '&') {
                    my_group.and_tokens.push(my_token);
                } else {
                    my_group.or_tokens.push(my_token);
                }
            }
        }

        this.flush(my_state, my_diagnostics, my_severity, my_ignored_lines);

        return my_diagnostics;
    }

    private fresh_state(): ExpressionState {
        return {
            paren_depth: 0,
            current_group_id: 0,
            group_stack: [0],
            next_group_id: 1,
            groups: new Map(),
        };
    }

    private is_qualifier_breaker(my_token: Token, my_state: ExpressionState): boolean {
        return my_state.paren_depth === 0
            && my_token.type === 'WORD'
            && QUALIFIER_BREAKERS.has(my_token.value);
    }

    private is_expression_breaker(my_token: Token): boolean {
        return EXPRESSION_BREAKERS.has(my_token.type);
    }

    private starts_compound_logical_sequence(
        the_tokens: Token[],
        start_index: number,
        my_token: Token
    ): boolean {
        let my_in_continuation = false;
        for (let my_i = start_index + 1; my_i < the_tokens.length; my_i++) {
            const my_next_token = the_tokens[my_i];
            if (my_next_token.type === 'WHITESPACE') {
                continue;
            }
            if (my_next_token.type === 'CONTINUATION') {
                my_in_continuation = true;
                continue;
            }
            if (my_next_token.type === 'STATEMENT_TERMINATOR' && my_in_continuation) {
                my_in_continuation = false;
                continue;
            }
            if (my_next_token.type === 'OPERATOR' && my_next_token.value === my_token.value) {
                return true;
            }
            return false;
        }
        return false;
    }

    private flush(
        my_state: ExpressionState,
        my_diagnostics: Diagnostic[],
        my_severity: DiagnosticSeverity,
        my_ignored_lines: Set<number>
    ): void {
        for (const my_group of my_state.groups.values()) {
            if (my_group.has_compound_logical_sequence) {
                continue;
            }
            if (my_group.and_tokens.length === 0 || my_group.or_tokens.length === 0) {
                continue;
            }

            const my_first_and = my_group.and_tokens[0];
            const my_first_or = my_group.or_tokens[0];
            const my_last_and = my_group.and_tokens[my_group.and_tokens.length - 1];
            const my_last_or = my_group.or_tokens[my_group.or_tokens.length - 1];

            const my_first_token = is_before(my_first_and, my_first_or) ? my_first_and : my_first_or;
            const my_last_token = is_before(my_last_and, my_last_or) ? my_last_or : my_last_and;

            if (my_ignored_lines.has(my_first_token.range.start.line)) {
                continue;
            }

            my_diagnostics.push({
                range: Range.create(my_first_token.range.start, my_last_token.range.end),
                message: "Mixed '&' and '|' without parentheses. "
                    + "Use parentheses to clarify precedence "
                    + "(e.g., '(x & y) | z' or 'x & (y | z)')",
                severity: my_severity,
                source: 'sight',
                code: StataDiagnosticCode.MIXED_LOGICAL_OPERATORS,
            });
        }
    }

    private resolve_severity(
        my_config_severity: 'error' | 'warning' | 'information' | 'hint'
    ): DiagnosticSeverity {
        switch (my_config_severity) {
            case 'error': return DiagnosticSeverity.Error;
            case 'warning': return DiagnosticSeverity.Warning;
            case 'information': return DiagnosticSeverity.Information;
            case 'hint': return DiagnosticSeverity.Hint;
        }
    }
}
