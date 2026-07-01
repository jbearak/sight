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
 * Collect the significant tokens of a document for token-stream diagnostics,
 * dropping tokens that are semantically whitespace for expression analysis:
 * - WHITESPACE and CONTINUATION (`///`) tokens.
 * - The STATEMENT_TERMINATOR that immediately follows a `///` continuation —
 *   it is the newline after `///` and is part of the continuation, not a real
 *   statement break.
 * - Inline block comments, which are whitespace-equivalent in Stata and can
 *   appear mid-expression.
 *
 * Real STATEMENT_TERMINATOR, COMMENT_LINE, braces, parentheses, operators, and
 * operands are preserved, so callers still see statement/segment boundaries.
 *
 * Centralizing this keeps the continuation/comment rules in one place so the
 * sibling analyzers cannot drift apart on the same construct.
 */
export function collect_significant_tokens(tokens: Token[]): Token[] {
    const the_significant: Token[] = [];
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
        if (my_token.type === 'COMMENT_BLOCK') {
            // Whitespace-equivalent; skip without disturbing continuation state.
            continue;
        }
        my_in_continuation = false;
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
