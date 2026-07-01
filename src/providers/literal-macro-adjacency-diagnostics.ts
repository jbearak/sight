import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';

/**
 * Comparison and logical operators. A literal operand that immediately follows
 * one of these is in an expression context where adjacency to a macro is
 * likely a mistake rather than intentional text concatenation.
 */
const EXPRESSION_OPERATORS: Set<string> = new Set([
    '==', '!=', '~=', '<', '<=', '>', '>=',  // comparison
    '&', '|',                                // logical
]);

/**
 * Macro reference token types.
 */
const MACRO_REF_TYPES: Set<string> = new Set([
    'MACRO_REF_LOCAL',
    'MACRO_REF_GLOBAL',
]);

/**
 * Keywords that begin a boolean condition region (exact case; Stata is
 * case-sensitive). Both the `if` command/qualifier and `while` are followed by
 * a boolean expression where literal-macro adjacency is suspicious.
 */
const CONDITION_STARTERS: Set<string> = new Set(['if', 'while']);

/**
 * Trivia token types skipped when tracking the previous significant token.
 */
const TRIVIA_TYPES: Set<string> = new Set(['WHITESPACE', 'CONTINUATION']);

/**
 * Check if two tokens are directly adjacent in the source with no intervening
 * whitespace (the literal's end position equals the macro's start position).
 */
function is_raw_adjacent(literal: Token, macro: Token): boolean {
    return (
        literal.range.end.line === macro.range.start.line &&
        literal.range.end.character === macro.range.start.character
    );
}

/**
 * Check if a STRING token is a complete, closed string literal (opens and
 * closes with a quote) rather than a fragment produced by macro interpolation.
 *
 * The lexer splits interpolated strings into segments: `"prefix`x'"` becomes
 * STRING `"prefix` (opening only) + MACRO_REF + STRING `"` (closing only), and
 * `"`x'"` becomes STRING `"` + MACRO_REF + STRING `"`. Those fragments are
 * legitimate interpolation, not the suspicious `"x"`macro'` concatenation, so
 * only complete strings qualify.
 */
function is_complete_string(my_token: Token): boolean {
    const my_value = my_token.value;
    // Compound string: `"..."'
    if (my_value.startsWith('`"') && my_value.endsWith('"\'')) {
        return my_value.length >= 4;
    }
    // Simple string: "..."
    return (
        my_value.length >= 2 &&
        my_value.startsWith('"') &&
        my_value.endsWith('"')
    );
}

/**
 * LiteralMacroAdjacencyAnalyzer detects a numeric or complete string literal
 * placed directly against a following macro reference in an expression
 * context, e.g. `a == 1`b'`. Stata concatenates these during macro expansion,
 * so if `b'` expands to `0`, `1`b'` becomes `10`, not `1` — usually a mistake.
 *
 * The rule is deliberately narrow to avoid the many intentional uses of macro
 * adjacency (`gen x`i'`, `use "data`year'.dta"`, `display "prefix`name'"`). A
 * literal is flagged only when it is a NUMBER or a complete closed STRING that
 * is raw-adjacent to a following macro AND either (a) directly follows a
 * comparison/logical operator, or (b) sits inside an `if`/`while` condition
 * region. Only literal-then-macro is considered; macro-then-literal
 * (`` `b'1 ``) is far more often intentional.
 */
export class LiteralMacroAdjacencyAnalyzer {
    /**
     * Analyze a document's token stream for suspicious literal-macro adjacency.
     *
     * @param document - The document state containing tokens and ignored_lines
     * @param config - LSP configuration for diagnostic settings
     * @returns Array of literal-macro-adjacency diagnostics
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
        const my_config_severity =
            config.diagnostics?.severity?.literalMacroAdjacency ?? 'hint';
        if (my_config_severity === 'off') {
            return [];
        }

        const the_tokens = document.tokens;
        if (!the_tokens || the_tokens.length === 0) {
            return [];
        }

        const my_ignored_lines = document.ignored_lines ?? new Set<number>();
        const my_severity = this.resolve_severity(my_config_severity);

        const the_diagnostics: Diagnostic[] = [];

        // Token before the current candidate literal, and the candidate
        // literal itself (both tracking only significant tokens).
        let pre_literal: Token | undefined = undefined;
        let prev_significant: Token | undefined = undefined;

        let paren_depth = 0;
        let in_condition = false;
        let my_in_continuation = false;

        for (let i = 0; i < the_tokens.length; i++) {
            const my_token = the_tokens[i];

            // The newline after `///` is part of the continuation, not a
            // statement break.
            if (my_token.type === 'STATEMENT_TERMINATOR' && my_in_continuation) {
                my_in_continuation = false;
                continue;
            }

            if (TRIVIA_TYPES.has(my_token.type)) {
                if (my_token.type === 'CONTINUATION') {
                    my_in_continuation = true;
                }
                continue;
            }

            my_in_continuation = false;

            // Detect the suspicious adjacency: previous significant token is a
            // qualifying literal that is raw-adjacent to this macro reference.
            if (
                MACRO_REF_TYPES.has(my_token.type) &&
                prev_significant &&
                this.is_qualifying_literal(prev_significant) &&
                is_raw_adjacent(prev_significant, my_token)
            ) {
                const follows_expression_operator =
                    pre_literal !== undefined &&
                    pre_literal.type === 'OPERATOR' &&
                    EXPRESSION_OPERATORS.has(pre_literal.value);

                if (
                    (follows_expression_operator || in_condition) &&
                    !my_ignored_lines.has(prev_significant.range.start.line)
                ) {
                    the_diagnostics.push({
                        range: Range.create(
                            prev_significant.range.start,
                            my_token.range.end
                        ),
                        message:
                            'Literal adjacent to macro reference in an ' +
                            'expression. Stata concatenates these during ' +
                            'macro expansion; add an operator, whitespace, or ' +
                            'parentheses if that was not intended.',
                        severity: my_severity,
                        source: 'sight',
                        code: StataDiagnosticCode.LITERAL_MACRO_ADJACENCY,
                        ...diagnostic_code_description_fields(
                            StataDiagnosticCode.LITERAL_MACRO_ADJACENCY
                        ),
                    });
                }
            }

            // Update condition-region and paren-depth state.
            in_condition = this.next_condition_state(
                my_token,
                paren_depth,
                in_condition
            );
            if (my_token.type === 'LPAREN' || my_token.type === 'LBRACKET') {
                paren_depth++;
            } else if (
                my_token.type === 'RPAREN' ||
                my_token.type === 'RBRACKET'
            ) {
                paren_depth = Math.max(0, paren_depth - 1);
            }

            // Advance the two-token significant history.
            pre_literal = prev_significant;
            prev_significant = my_token;
        }

        return the_diagnostics;
    }

    /**
     * A qualifying literal is a NUMBER or a complete closed STRING.
     */
    private is_qualifying_literal(my_token: Token): boolean {
        if (my_token.type === 'NUMBER') {
            return true;
        }
        if (my_token.type === 'STRING') {
            return is_complete_string(my_token);
        }
        return false;
    }

    /**
     * Compute the next `in_condition` value given the current token.
     *
     * The region turns on after an `if`/`while` keyword and off at a statement
     * terminator, an opening brace, a top-level comma (end of an `if`
     * qualifier, start of options), or an `in` qualifier. `else` is not a
     * condition starter; `else if` starts its condition via the `if` token.
     */
    private next_condition_state(
        my_token: Token,
        paren_depth: number,
        current: boolean
    ): boolean {
        if (my_token.type === 'WORD') {
            if (CONDITION_STARTERS.has(my_token.value)) {
                return true;
            }
            if (my_token.value === 'in' && paren_depth === 0) {
                return false;
            }
            return current;
        }

        if (
            my_token.type === 'STATEMENT_TERMINATOR' ||
            my_token.type === 'LBRACE' ||
            my_token.type === 'RBRACE' ||
            my_token.type === 'COMMENT_LINE' ||
            my_token.type === 'COMMENT_BLOCK'
        ) {
            return false;
        }

        if (my_token.type === 'COMMA' && paren_depth === 0) {
            return false;
        }

        return current;
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
