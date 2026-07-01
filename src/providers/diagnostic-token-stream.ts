import { Token } from '../types';

/**
 * Comparison operators. Stata evaluates these left-to-right, each yielding 0/1;
 * `=` alone is assignment, not comparison, so it is excluded.
 */
export const COMPARISON_OPERATORS: Set<string> = new Set([
    '==', '!=', '~=', '<', '<=', '>', '>=',
]);

/**
 * Binary logical operators.
 */
export const LOGICAL_OPERATORS: Set<string> = new Set(['&', '|']);

/**
 * Spaced comparison operators that Stata accepts as their compact form.
 * `= =` is intentionally excluded: it is not accepted consistently across
 * Stata expression contexts and is handled by OperatorSequenceAnalyzer.
 */
const SPACED_COMPARISON_OPERATOR_PAIRS: Map<string, string> = new Map([
    ['< =', '<='],
    ['> =', '>='],
    ['! =', '!='],
    ['~ =', '~='],
]);

function normalized_spaced_comparison_operator(
    first: Token,
    second: Token | undefined
): Token | undefined {
    if (
        first.type !== 'OPERATOR' ||
        second?.type !== 'OPERATOR'
    ) {
        return undefined;
    }

    const my_compact_operator = SPACED_COMPARISON_OPERATOR_PAIRS.get(
        `${first.value} ${second.value}`
    );
    if (!my_compact_operator) {
        return undefined;
    }

    return {
        type: 'OPERATOR',
        value: my_compact_operator,
        range: {
            start: first.range.start,
            end: second.range.end,
        },
    };
}

/**
 * Collect the significant tokens of a document for token-stream diagnostics,
 * dropping tokens that are semantically whitespace for expression analysis:
 * - WHITESPACE and CONTINUATION (`///`) tokens.
 * - The STATEMENT_TERMINATOR that immediately follows a `///` continuation —
 *   it is the newline after `///` and is part of the continuation, not a real
 *   statement break.
 * - Inline block comments, which are whitespace-equivalent in Stata.
 * - Line comments (`//`, `*`): they end only the comment text, not the
 *   statement. In `#delimit cr` the newline after the comment is a real
 *   STATEMENT_TERMINATOR (preserved) that bounds the statement; under
 *   `#delimit ;` the statement continues to the `;`. Dropping the comment
 *   itself lets both modes rely on real terminators for boundaries.
 *
 * Real STATEMENT_TERMINATOR, braces, parentheses, operators, and operands are
 * preserved, so callers still see statement/segment boundaries.
 *
 * Spaced comparison operators that Stata accepts as compact comparisons are
 * normalized in this stream (`< =` -> `<=`, etc.) so semantic diagnostics see
 * Stata-equivalent forms. Raw-token style diagnostics still use the original
 * document tokens.
 *
 * Centralizing this keeps the continuation/comment/operator-normalization rules
 * in one place so the sibling analyzers cannot drift apart on the same
 * construct.
 */
export function collect_significant_tokens(tokens: Token[]): Token[] {
    const the_unfiltered_significant: Token[] = [];
    let my_in_continuation = false;

    for (const my_token of tokens) {
        if (my_token.type === 'STATEMENT_TERMINATOR' && my_in_continuation) {
            my_in_continuation = false;
            continue;
        }
        if (my_token.type === 'WHITESPACE') {
            continue;
        }
        if (my_token.type === 'CONTINUATION') {
            my_in_continuation = true;
            continue;
        }
        if (
            my_token.type === 'COMMENT_BLOCK' ||
            my_token.type === 'COMMENT_LINE'
        ) {
            // Comments are whitespace-equivalent for expression analysis; skip
            // without disturbing continuation state.
            continue;
        }
        my_in_continuation = false;
        the_unfiltered_significant.push(my_token);
    }

    const the_significant: Token[] = [];
    for (let i = 0; i < the_unfiltered_significant.length; i++) {
        const my_token = the_unfiltered_significant[i];
        const my_normalized_operator = normalized_spaced_comparison_operator(
            my_token,
            the_unfiltered_significant[i + 1]
        );

        if (my_normalized_operator) {
            the_significant.push(my_normalized_operator);
            i++;
            continue;
        }

        the_significant.push(my_token);
    }

    return the_significant;
}

/**
 * Whether two tokens are directly adjacent in the source with no whitespace
 * between them (the first token's end position equals the second's start).
 * Directly adjacent operands form a single expanded operand via macro
 * concatenation (a number immediately followed by a macro reference);
 * separated operands do not.
 */
export function is_adjacent(first: Token, second: Token): boolean {
    return (
        first.range.end.line === second.range.start.line &&
        first.range.end.character === second.range.start.character
    );
}
