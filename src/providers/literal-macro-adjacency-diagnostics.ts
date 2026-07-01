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
 * case-sensitive). A literal that is the leading operand of one of these is
 * suspicious, where a number-macro concatenation is a footgun even with no
 * comparison operator adjacent to the pair.
 */
const CONDITION_KEYWORDS: Set<string> = new Set(['if', 'while']);

/**
 * Grouping-open token types skipped when scanning backward for the operator
 * that governs a literal-macro pair, so `if (1`b')` reads the same as
 * `if 1`b'`.
 */
const GROUP_OPEN_TYPES: Set<string> = new Set(['LPAREN', 'LBRACKET']);

/**
 * Grouping-close token types skipped when scanning forward for the governing
 * operator, so `(1`b') == a` reads the same as `1`b' == a`.
 */
const GROUP_CLOSE_TYPES: Set<string> = new Set(['RPAREN', 'RBRACKET']);

/**
 * Unary prefix operators skipped when scanning backward, so `a == -1`b'`
 * reads the same as `a == 1`b'`.
 */
const UNARY_PREFIX_OPERATORS: Set<string> = new Set(['-', '+', '!', '~']);

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
 * The token that governs the operand starting at `index`, scanning backward
 * past grouping-open and unary-prefix tokens. For `if (1`b')` this is `if`;
 * for `a == -1`b'` this is `==`. Also reports how many *wrapping* grouping-open
 * tokens were skipped, so the forward scan can skip exactly the matching
 * closers (the parentheses that wrap the operand alone) and no more.
 *
 * A grouping-open that is a function-call/subscript opener (preceded by a name
 * or a prior call/subscript result, e.g. the `(` in `strlen(1`x')`) is NOT a
 * wrapper: the operand is an argument, so the scan stops at the callee and the
 * paren is not counted — otherwise the forward scan would cross the call's
 * closing paren and mis-attribute a following operator to the argument. An
 * `if`/`while` before the paren is a condition, not a call, so it still counts
 * as a wrapper. Returns an undefined token at the start of input.
 */
function governing_before(
    the_significant: Token[],
    index: number
): { token: Token | undefined; group_opens: number } {
    let my_group_opens = 0;
    for (let my_i = index - 1; my_i >= 0; my_i--) {
        const my_token = the_significant[my_i];
        if (GROUP_OPEN_TYPES.has(my_token.type)) {
            const my_before_paren =
                my_i - 1 >= 0 ? the_significant[my_i - 1] : undefined;
            if (is_call_opener(my_before_paren)) {
                // Function-call / subscript opener: the operand is an
                // argument, not a wrapped operand. Stop at the callee.
                return {
                    token: my_before_paren,
                    group_opens: my_group_opens,
                };
            }
            my_group_opens++;
            continue;
        }
        if (
            my_token.type === 'OPERATOR' &&
            UNARY_PREFIX_OPERATORS.has(my_token.value)
        ) {
            continue;
        }
        return { token: my_token, group_opens: my_group_opens };
    }
    return { token: undefined, group_opens: my_group_opens };
}

/**
 * Whether the token immediately before a grouping-open makes it a function-call
 * or subscript opener rather than a plain grouping paren: a non-keyword WORD
 * (callee name) or a preceding call/subscript result. `if`/`while` before the
 * paren is a condition, so it does NOT count as a call opener.
 */
function is_call_opener(my_token: Token | undefined): boolean {
    if (my_token === undefined) {
        return false;
    }
    if (my_token.type === 'RPAREN' || my_token.type === 'RBRACKET') {
        return true;
    }
    return (
        my_token.type === 'WORD' && !CONDITION_KEYWORDS.has(my_token.value)
    );
}

/**
 * The token that governs the operand ending at `index`, scanning forward past
 * up to `max_group_closes` grouping-close tokens. For `(1`b') == a` (one
 * wrapping paren) this is `==`. The cap is essential: a grouping-close that
 * exceeds the wrap depth closes an ENCLOSING group (e.g. the `)` of a function
 * call in `foo(y, 2`g') > 0`), whose following operator governs the group, not
 * this operand — so we must stop there rather than cross the call boundary.
 * Returns an undefined token at the end of input.
 */
function governing_after(
    the_significant: Token[],
    index: number,
    max_group_closes: number
): Token | undefined {
    let my_remaining_closes = max_group_closes;
    for (let my_i = index + 1; my_i < the_significant.length; my_i++) {
        const my_token = the_significant[my_i];
        if (GROUP_CLOSE_TYPES.has(my_token.type)) {
            if (my_remaining_closes > 0) {
                my_remaining_closes--;
                continue;
            }
            return my_token;
        }
        return my_token;
    }
    return undefined;
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
            // such an operator governs it before or after — looking past
            // grouping parentheses and unary prefixes, so `if (1`b')` and
            // `a == -1`b'` read the same as their bare forms — or when the
            // literal is the leading operand of an `if`/`while` condition.
            const before = governing_before(the_significant, i - 1);
            const governor_after = governing_after(
                the_significant,
                i,
                before.group_opens
            );

            const operator_before = is_expression_operator(before.token);
            const operator_after = is_expression_operator(governor_after);
            const leads_condition =
                before.token !== undefined &&
                before.token.type === 'WORD' &&
                CONDITION_KEYWORDS.has(before.token.value);

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
