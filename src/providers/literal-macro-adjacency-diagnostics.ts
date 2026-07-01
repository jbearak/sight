import { Diagnostic, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { resolve_diagnostic_severity } from '../utils/diagnostic-severity';

/**
 * Comparison and logical operators. A literal-macro operand adjacent to one of
 * these — on either side — is an operand of a comparison/logical expression,
 * where concatenation with a macro is likely a mistake rather than intentional
 * text building.
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
 * Trivia token types skipped when tracking significant tokens.
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
 * Check whether a token is a comparison/logical operator.
 */
function is_expression_operator(my_token: Token | undefined): boolean {
    return (
        my_token !== undefined &&
        my_token.type === 'OPERATOR' &&
        EXPRESSION_OPERATORS.has(my_token.value)
    );
}

/**
 * LiteralMacroAdjacencyAnalyzer detects a numeric or complete string literal
 * placed directly against a following macro reference where the pair is an
 * operand of a comparison/logical expression, e.g. `a == 1`b'`. Stata
 * concatenates these during macro expansion, so if `b'` expands to `0`,
 * `1`b'` becomes `10`, not `1` — usually a mistake.
 *
 * The rule is deliberately narrow to avoid the many intentional uses of macro
 * adjacency (`gen x`i'`, `use "data`year'.dta"`, `display "prefix`name'"`,
 * function arguments like `inlist(x, 1`a', 2)`). A literal is flagged only when
 * it is a NUMBER or a complete closed STRING that is raw-adjacent to a
 * following macro AND the pair is an operand of a comparison/logical operator —
 * that is, a comparison/logical operator sits immediately before the literal or
 * immediately after the macro. Only literal-then-macro is considered;
 * macro-then-literal (`` `b'1 ``) is far more often intentional.
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
        const my_severity = resolve_diagnostic_severity(my_config_severity);

        const the_diagnostics: Diagnostic[] = [];

        // Token before the current candidate literal, and the candidate
        // literal itself (both tracking only significant tokens).
        let pre_literal: Token | undefined = undefined;
        let prev_significant: Token | undefined = undefined;
        let my_in_continuation = false;

        for (let i = 0; i < the_tokens.length; i++) {
            const my_token = the_tokens[i];

            // The newline after `///` is tokenized as STATEMENT_TERMINATOR but
            // is part of the continuation — it must not become a significant
            // token, or a `///`-split expression would lose its operator
            // context.
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

            // Detect the suspicious adjacency: the previous significant token
            // is a qualifying literal raw-adjacent to this macro reference. A
            // STATEMENT_TERMINATOR simply becomes prev_significant and is never
            // a qualifying literal, so lines never bleed together here.
            if (
                MACRO_REF_TYPES.has(my_token.type) &&
                prev_significant &&
                this.is_qualifying_literal(prev_significant) &&
                is_raw_adjacent(prev_significant, my_token)
            ) {
                // The pair is an operand of a comparison/logical expression
                // when such an operator sits immediately before the literal
                // or immediately after the macro.
                const operator_before = is_expression_operator(pre_literal);
                const operator_after = is_expression_operator(
                    this.next_significant(the_tokens, i)
                );

                if (
                    (operator_before || operator_after) &&
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
     * Find the next significant token after `index`, skipping trivia. A
     * STATEMENT_TERMINATOR that follows a `///` continuation does not end the
     * scan (it is part of the continuation); any other terminator does.
     * Returns undefined if none is found before the statement ends.
     */
    private next_significant(
        the_tokens: Token[],
        index: number
    ): Token | undefined {
        let my_in_continuation = false;
        for (let my_i = index + 1; my_i < the_tokens.length; my_i++) {
            const my_token = the_tokens[my_i];
            if (my_token.type === 'WHITESPACE') {
                continue;
            }
            if (my_token.type === 'CONTINUATION') {
                my_in_continuation = true;
                continue;
            }
            if (my_token.type === 'STATEMENT_TERMINATOR') {
                if (my_in_continuation) {
                    my_in_continuation = false;
                    continue;
                }
                return undefined;
            }
            return my_token;
        }
        return undefined;
    }
}
