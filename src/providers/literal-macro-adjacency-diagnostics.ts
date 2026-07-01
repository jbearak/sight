import { Diagnostic, Range } from 'vscode-languageserver/node';
import { DocumentState } from '../document-store';
import { StataDiagnosticCode, StataLSPConfig, Token } from '../types';
import { diagnostic_code_description_fields } from '../utils/diagnostic-code-description';
import { resolve_diagnostic_severity } from '../utils/diagnostic-severity';
import {
    COMPARISON_OPERATORS,
    LOGICAL_OPERATORS,
    collect_significant_tokens,
    is_adjacent,
} from './diagnostic-token-stream';

/**
 * Macro reference token types.
 */
const MACRO_REF_TYPES: Set<string> = new Set([
    'MACRO_REF_LOCAL',
    'MACRO_REF_GLOBAL',
]);

/**
 * Keywords that introduce a boolean condition (exact case; Stata is
 * case-sensitive). A literal directly after one of these is the leading
 * operand of the condition, where a number-macro concatenation is a footgun
 * even with no comparison operator adjacent to the pair.
 */
const CONDITION_KEYWORDS: Set<string> = new Set(['if', 'while']);

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
 * A qualifying literal is a NUMBER or a complete closed STRING.
 */
function is_qualifying_literal(my_token: Token): boolean {
    if (my_token.type === 'NUMBER') {
        return true;
    }
    if (my_token.type === 'STRING') {
        return is_complete_string(my_token);
    }
    return false;
}

/**
 * Check whether a token is a comparison/logical operator.
 */
function is_expression_operator(my_token: Token | undefined): boolean {
    return (
        my_token !== undefined &&
        my_token.type === 'OPERATOR' &&
        (COMPARISON_OPERATORS.has(my_token.value) ||
            LOGICAL_OPERATORS.has(my_token.value))
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
 * a comparison/logical operator sits immediately before the literal or
 * immediately after the macro — or the literal is the leading operand of an
 * `if`/`while` condition. Only literal-then-macro is considered;
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

        const the_significant = collect_significant_tokens(the_tokens);
        const my_ignored_lines = document.ignored_lines ?? new Set<number>();
        const my_severity = resolve_diagnostic_severity(my_config_severity);

        const the_diagnostics: Diagnostic[] = [];

        for (let i = 1; i < the_significant.length; i++) {
            const my_macro = the_significant[i];
            const my_literal = the_significant[i - 1];

            if (
                !MACRO_REF_TYPES.has(my_macro.type) ||
                !is_qualifying_literal(my_literal) ||
                !is_adjacent(my_literal, my_macro)
            ) {
                continue;
            }

            // The pair is an operand of a comparison/logical expression when
            // such an operator sits immediately before the literal or
            // immediately after the macro, or when the literal is the leading
            // operand of an `if`/`while` condition.
            const pre_literal = i >= 2 ? the_significant[i - 2] : undefined;
            const after_macro =
                i + 1 < the_significant.length
                    ? the_significant[i + 1]
                    : undefined;

            const operator_before = is_expression_operator(pre_literal);
            const operator_after = is_expression_operator(after_macro);
            const leads_condition =
                pre_literal !== undefined &&
                pre_literal.type === 'WORD' &&
                CONDITION_KEYWORDS.has(pre_literal.value);

            if (
                (operator_before || operator_after || leads_condition) &&
                !my_ignored_lines.has(my_literal.range.start.line)
            ) {
                the_diagnostics.push({
                    range: Range.create(
                        my_literal.range.start,
                        my_macro.range.end
                    ),
                    message:
                        'Literal adjacent to macro reference in an ' +
                        'expression. Stata concatenates these during macro ' +
                        'expansion; add an operator, whitespace, or ' +
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

        return the_diagnostics;
    }
}
