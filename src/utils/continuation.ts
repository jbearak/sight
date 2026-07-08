import { Token } from '../types';

/**
 * Whether `my_token` is the STATEMENT_TERMINATOR swallowed by a
 * preceding `///` continuation — trivia, not a real statement end.
 *
 * Only a newline terminator qualifies: `///` consumes exactly the line
 * break that follows it. A `;` terminator under `#delimit ;` is always a real
 * statement end.
 *
 * Shared by every token scan that applies this rule, so it cannot
 * drift between them. Callers either track an in-continuation flag
 * across trivia (e.g. statement spans, the diagnostics token scans,
 * the analyzer's Mata-setter forward scan) or pass "the token
 * adjacent to this terminator is a CONTINUATION" when they only
 * ever look one token away from a continuation (e.g. brace
 * placement, hover statement-start, the parser's trivia skips, the
 * analyzer's Mata-setter backward scan). Both are equivalent
 * because the lexer emits the swallowed '\n' terminator directly
 * after its continuation token.
 */
export function is_swallowed_continuation_terminator(
    my_token: Token,
    in_continuation: boolean
): boolean {
    return (
        my_token.type === 'STATEMENT_TERMINATOR' &&
        in_continuation &&
        my_token.value === '\n'
    );
}
