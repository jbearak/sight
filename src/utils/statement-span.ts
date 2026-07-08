import { Token } from '../types';
import { is_swallowed_continuation_terminator } from './continuation';

/**
 * Inclusive physical-line span, zero-based LSP line numbers.
 */
export interface LineSpan {
    start_line: number;
    end_line: number;
}

/**
 * Token types skipped while searching for the first token of the "next
 * statement" after a directive comment: surrounding comments, a `///`
 * continuation and the newline it swallows, blank statement terminators, and a
 * `#delimit` mode switch — so an
 * `@lsp-ignore-next` immediately followed by `#delimit ;` targets the
 * first real statement under the new mode, not the mode-switch line.
 */
const LEADING_TRIVIA_TYPES: ReadonlySet<string> = new Set([
    'COMMENT_LINE',
    'COMMENT_BLOCK',
    'CONTINUATION',
    'STATEMENT_TERMINATOR',
    'DELIMIT_DIRECTIVE',
]);

/**
 * Token types that open a body the span walk must never enter: a `{`
 * block header, or a `mata`/`python` block start. The header line up to
 * and including the opener is part of the statement's span; the body is
 * not. (`MATA_INLINE`/`PYTHON_INLINE` are single-statement forms with no
 * persistent body, so they are ordinary statement tokens.)
 */
const BODY_OPENER_TYPES: ReadonlySet<string> = new Set([
    'LBRACE',
    'MATA_START',
    'PYTHON_START',
]);

/**
 * Trivia that does not disturb `///` continuation state while walking a
 * statement (mirrors collect_significant_tokens in
 * src/providers/diagnostic-token-stream.ts).
 */
const CONTINUATION_NEUTRAL_TYPES: ReadonlySet<string> = new Set([
    'COMMENT_LINE',
    'COMMENT_BLOCK',
]);

/**
 * Compute the inclusive physical-line span of the next logical statement
 * after `tokens[from_index]` (typically the index of a directive comment
 * token such as `// @lsp-ignore-next`).
 *
 * The walk is continuation-aware: a `///` CONTINUATION and the
 * STATEMENT_TERMINATOR immediately after it are part of the statement,
 * not a break (same rule as collect_significant_tokens in
 * src/providers/diagnostic-token-stream.ts). The statement ends at the
 * first real STATEMENT_TERMINATOR — a newline under `#delimit cr`, or
 * `;` under `#delimit ;` — or at a body opener (`{`, `mata`, `python`),
 * so a block header's lines are covered but its body never is.
 *
 * Lines are extended using each token's `range.start.line`, never
 * `range.end.line`: in `#delimit cr` mode a STATEMENT_TERMINATOR is the
 * `\n` character and its range ends at column 0 of the FOLLOWING line
 * (the lexer builds the range after advancing past the newline), so
 * `end.line` would drag an unrelated next line into the span. Any token
 * that spans lines has its later lines covered by the start lines of
 * the tokens that follow it.
 *
 * Returns undefined when no statement follows `from_index`.
 */
export function next_statement_line_span(
    tokens: Token[],
    from_index: number
): LineSpan | undefined {
    let my_first_index = from_index + 1;
    while (
        my_first_index < tokens.length &&
        LEADING_TRIVIA_TYPES.has(tokens[my_first_index].type)
    ) {
        my_first_index++;
    }
    if (
        my_first_index >= tokens.length ||
        tokens[my_first_index].type === 'EOF'
    ) {
        return undefined;
    }

    const start_line = tokens[my_first_index].range.start.line;
    let end_line = start_line;
    let my_in_continuation = false;

    for (let my_i = my_first_index; my_i < tokens.length; my_i++) {
        const my_token = tokens[my_i];

        if (my_token.type === 'EOF') {
            break;
        }

        if (my_token.type === 'STATEMENT_TERMINATOR') {
            end_line = Math.max(end_line, my_token.range.start.line);
            if (
                is_swallowed_continuation_terminator(
                    my_token,
                    my_in_continuation
                )
            ) {
                my_in_continuation = false;
                continue;
            }
            break;
        }

        if (my_token.type === 'CONTINUATION') {
            my_in_continuation = true;
            end_line = Math.max(end_line, my_token.range.start.line);
            continue;
        }

        end_line = Math.max(end_line, my_token.range.start.line);

        if (BODY_OPENER_TYPES.has(my_token.type)) {
            break;
        }

        if (!CONTINUATION_NEUTRAL_TYPES.has(my_token.type)) {
            my_in_continuation = false;
        }
    }

    return { start_line, end_line };
}
