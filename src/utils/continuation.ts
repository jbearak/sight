import { Token } from '../types';

/**
 * Whether `my_token` is the STATEMENT_TERMINATOR swallowed by a
 * preceding `///` continuation — trivia, not a real statement end.
 *
 * Only a newline terminator qualifies: `///` consumes exactly the line
 * break that follows it. Under `#delimit cr` that line break lexes as a
 * STATEMENT_TERMINATOR with value '\n'; under `#delimit ;` it lexes as
 * WHITESPACE, so any STATEMENT_TERMINATOR seen mid-continuation there
 * is a literal `;` — always a real statement end.
 *
 * Shared by every token scan that applies this rule, so it cannot
 * drift between them. Callers either track an in-continuation flag
 * across trivia (statement spans, the diagnostics token scans) or
 * pass "the token adjacent to this terminator is a CONTINUATION"
 * when they only ever look one token away from a continuation
 * (brace placement, hover statement-start, the parser's trivia
 * skips). Both are equivalent because the lexer emits the swallowed
 * '\n' terminator directly after its continuation token.
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
