import { Position } from 'vscode-languageserver';
import { Token } from '../types';
import { is_swallowed_continuation_terminator } from './continuation';
import { find_last_token_starting_before } from './token-utils';

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
    'WHITESPACE',
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

/**
 * The physical end of an inline embedded statement (`mata:` / `python:`,
 * i.e. a `MATA_INLINE` / `PYTHON_INLINE` opener at `tokens[opener_index]`).
 */
export interface InlineEmbeddedEnd {
    /** Last physical line (0-based) covered by the inline statement. */
    end_line: number;
    /**
     * Index of the last token the inline statement consumes. The context
     * tracker advances its main loop to this index so no token inside the
     * statement — nor a trailing same-line opener after its terminator —
     * spawns a second, overlapping context range.
     */
    end_index: number;
}

/**
 * Compute where an inline `mata:` / `python:` statement ends (issue #309).
 *
 * Under `#delimit ;` an inline embedded statement legally continues onto
 * later physical lines and ends at the `;`; the context tracker must report
 * the embedded language on those continuation lines. This mirrors the
 * parser's single-line `parseEmbeddedLanguageBlock` collection exactly (see
 * `src/parser/index.ts`): scan forward from the opener collecting tokens
 * until the first `STATEMENT_TERMINATOR` or `EOF`. It is deliberately NOT
 * continuation-aware and does not special-case `DELIMIT_DIRECTIVE`, so the
 * computed range agrees with the AST's `embedded_block` span in every mode.
 *
 * `end_line` is the last CONTENT token's `range.end.line` (the terminating
 * `STATEMENT_TERMINATOR` is never a content token, so a `#delimit cr`
 * newline terminator's end-line-overshoots-to-next-line quirk never leaks
 * in; a multi-line content token such as a block comment correctly
 * contributes its own `end.line`). This equals the parser's
 * `previous().range.end.line`.
 *
 * `end_index` consumes the terminating `STATEMENT_TERMINATOR` (when
 * present); otherwise it is the last content token (EOF / ran off the end).
 * The context tracker advances its main loop to this index, which skips
 * every token BETWEEN the opener and the terminator (so an opener the lexer
 * re-triggers mid-statement cannot spawn an interior overlapping range) but
 * still lets the main loop process whatever follows the terminator on the
 * same physical line — a trailing block opener (which must open its
 * multi-line body) or a trailing inline opener (which the parser treats as
 * its own embedded_block, so it gets its own range too). A second inline
 * statement sharing the terminator line therefore keeps full context
 * coverage; the two whole-line ranges overlap only on that shared line, an
 * unavoidable and pre-existing limitation of line-granular context ranges
 * (a physical line cannot hold two languages), consistent with the parser's
 * overlapping single-line embedded_block spans.
 *
 * Bounded: never scans past `EOF`; an unterminated inline in `;` mode ends
 * at the last content line, matching the AST.
 */
export function inline_embedded_statement_end(
    tokens: Token[],
    opener_index: number
): InlineEmbeddedEnd {
    let my_last_content_index = opener_index; // opener itself when no content
    let my_i = opener_index + 1;
    while (
        my_i < tokens.length &&
        tokens[my_i].type !== 'STATEMENT_TERMINATOR' &&
        tokens[my_i].type !== 'EOF'
    ) {
        my_last_content_index = my_i;
        my_i++;
    }

    const end_line = tokens[my_last_content_index].range.end.line;

    // Consume the real terminator too (when there is one); otherwise resume
    // after the last content token (EOF / ran off the end).
    const end_index =
        my_i < tokens.length && tokens[my_i].type === 'STATEMENT_TERMINATOR'
            ? my_i
            : my_last_content_index;

    return { end_index, end_line };
}

/**
 * Token types after which the next significant token begins a new
 * statement (mirrors STATEMENT_BOUNDARY_TYPES in
 * src/providers/command-position.ts): a real statement terminator, a
 * `{`/`}` block delimiter, or a `#delimit` mode switch. A
 * STATEMENT_TERMINATOR is only a boundary when it is a REAL end — a
 * `\n` swallowed by a preceding `///` continuation is trivia, not a
 * boundary (see `is_swallowed_continuation_terminator`).
 */
const LOGICAL_BOUNDARY_TYPES: ReadonlySet<string> = new Set([
    'STATEMENT_TERMINATOR',
    'LBRACE',
    'RBRACE',
    'DELIMIT_DIRECTIVE',
    // A `mata`/`python` block opener and its `end` bound statements too:
    // under `#delimit ;` the block body carries no STATEMENT_TERMINATOR, so
    // without these a Stata statement right after `end` would walk back into
    // the block and mis-read its command as `mata`/`python`.
    'MATA_START',
    'PYTHON_START',
    'END_MATA',
    'END_PYTHON',
]);

/**
 * Trivia skipped when locating the first real token of a statement
 * (after a boundary). Same membership as LEADING_TRIVIA_TYPES minus the
 * `#delimit` switch, which is itself a boundary and never leads a
 * statement body.
 */
const STATEMENT_LEADING_TRIVIA_TYPES: ReadonlySet<string> = new Set([
    'COMMENT_LINE',
    'COMMENT_BLOCK',
    'CONTINUATION',
    'WHITESPACE',
    'STATEMENT_TERMINATOR',
]);

/**
 * Upper bound on how many tokens the backward walk inspects before
 * giving up and reporting "no usable start" (caller then falls back to
 * physical-line behavior). A real wrapped statement — even a very long
 * wrapped varlist (roughly 4000 variables, since Stata context emits no
 * WHITESPACE tokens so each identifier costs one token) — stays under this;
 * the cap
 * only fires on pathological input, e.g. an unterminated `#delimit ;`
 * statement, or a `#delimit ;` bare `mata`/`end` block whose embedded
 * content carries NO boundary token (no STATEMENT_TERMINATOR, no braces,
 * no DELIMIT_DIRECTIVE) reached via a non-STATA-gated caller. It bounds
 * per-keystroke cost without truncating realistic statements.
 */
const MAX_STATEMENT_TOKENS = 4096;

/**
 * The first token of the logical statement that contains `position`.
 */
export interface LogicalStatementStart {
    /** Index into `tokens` of the statement's first significant token. */
    index: number;
    /** Zero-based line of that token's start. */
    line: number;
    /** Zero-based character of that token's start. */
    character: number;
}

/**
 * Locate the first token of the logical statement containing the cursor
 * `position`, walking backward over the token stream (issue #310).
 *
 * A logical statement can span several physical lines: `#delimit ;`
 * makes newlines insignificant, and `///` continues a line under
 * `#delimit cr`. Physical-line-only heuristics therefore lose the
 * command on wrapped statements; this walk recovers it from the tokens.
 *
 * The cursor token is found in O(log n) via
 * `find_last_token_starting_at_or_before` (shared with hover). The walk
 * then scans backward to the nearest real boundary
 * (LOGICAL_BOUNDARY_TYPES), skipping `///`-swallowed `\n` terminators,
 * and returns the first non-trivia token after that boundary (or the
 * first token of the file). The scan is bounded by MAX_STATEMENT_TOKENS.
 *
 * `min_line` clamps the walk: it never inspects a token that starts on a
 * line before `min_line`. Callers pass the first line of the cursor's
 * contiguous Stata region (the line after the nearest `mata`/`python`
 * block that ends above the cursor) so the logical statement can never
 * absorb embedded-language tokens from a block above — including a
 * nested `{ }` inside a `mata { ... }` block, which no token-type
 * boundary alone distinguishes from a real Stata block.
 *
 * Returns `undefined` when there is no usable start — empty/undefined
 * tokens, no token at or before the cursor, the cap is hit, or the
 * boundary is immediately before the cursor with no statement token
 * between them (e.g. a fresh blank line right after a terminator). The
 * caller falls back to physical-line behavior in every such case.
 */
export function logical_statement_start(
    tokens: Token[] | undefined,
    position: Position,
    min_line: number = 0
): LogicalStatementStart | undefined {
    if (tokens === undefined || tokens.length === 0) {
        return undefined;
    }

    // Anchor on the last token starting STRICTLY BEFORE the cursor, not
    // at-or-before: a boundary token whose start equals the cursor (the
    // common "cursor at end of a line, immediately before its `;`/newline
    // terminator" position) is the current statement's terminator, not a
    // token the cursor is inside. Anchoring at-or-before would self-match
    // that terminator as the boundary and wrongly report "no statement".
    let search_index = find_last_token_starting_before(tokens, position);
    // Defensive: never anchor on EOF.
    while (search_index >= 0 && tokens[search_index].type === 'EOF') {
        search_index--;
    }
    if (search_index < 0) {
        return undefined;
    }

    // Walk backward to the token index of the nearest real boundary, or
    // -1 for the start of the file (or the region floor `min_line`).
    // Bounded by MAX_STATEMENT_TOKENS.
    let boundary_index = -1;
    let my_steps = 0;
    for (let my_i = search_index; my_i >= 0; my_i--) {
        if (++my_steps > MAX_STATEMENT_TOKENS) {
            return undefined;
        }
        const my_token = tokens[my_i];
        if (my_token.range.start.line < min_line) {
            // Reached the floor of the cursor's Stata region: an embedded
            // block sits above. Do not absorb its tokens; stop here as if at
            // the start of input.
            break;
        }
        if (
            is_swallowed_continuation_terminator(
                my_token,
                my_i > 0 && tokens[my_i - 1].type === 'CONTINUATION'
            )
        ) {
            // Swallowed `///` newline: trivia, keep walking.
            continue;
        }
        if (LOGICAL_BOUNDARY_TYPES.has(my_token.type)) {
            boundary_index = my_i;
            break;
        }
    }

    // Whether the tokens after the boundary are a `mata`/`python` block BODY
    // (embedded content), not a Stata statement: the boundary is the block
    // opener itself, or the `{` of a `mata { ... }` / `python { ... }` block.
    // Reached only when the cursor sits at/just before the block's closer
    // (`end` / `}`) on a line the context tracker calls Stata — the backward
    // walk then lands inside the block body. Treating that body as a Stata
    // statement would offer variable/command completions built from embedded
    // code, so fall through to the fresh-position Case B instead.
    let boundary_opens_embedded_body = false;
    if (boundary_index >= 0) {
        const my_boundary_type = tokens[boundary_index].type;
        if (
            my_boundary_type === 'MATA_START' ||
            my_boundary_type === 'PYTHON_START'
        ) {
            boundary_opens_embedded_body = true;
        } else if (my_boundary_type === 'LBRACE') {
            for (let my_j = boundary_index - 1; my_j >= 0; my_j--) {
                const my_prev_type = tokens[my_j].type;
                if (CONTINUATION_NEUTRAL_TYPES.has(my_prev_type) ||
                    my_prev_type === 'WHITESPACE') {
                    continue;
                }
                boundary_opens_embedded_body =
                    my_prev_type === 'MATA_START' ||
                    my_prev_type === 'PYTHON_START';
                break;
            }
        }
    }

    // First non-trivia token after the boundary (the statement's head).
    // Start at the boundary, or at the region floor when the walk stopped
    // there (boundary_index === -1), whichever is later, and never accept a
    // token below the floor.
    let first_index = -1;
    for (let my_i = boundary_index + 1; my_i < tokens.length; my_i++) {
        const my_token = tokens[my_i];
        if (my_token.type === 'EOF') {
            break;
        }
        if (my_token.range.start.line < min_line) {
            continue;
        }
        if (!STATEMENT_LEADING_TRIVIA_TYPES.has(my_token.type)) {
            first_index = my_i;
            break;
        }
    }

    // Case A: the statement has a real head token at or before the cursor.
    if (first_index !== -1 && !boundary_opens_embedded_body) {
        const my_start = tokens[first_index].range.start;
        const at_or_before_cursor =
            my_start.line < position.line ||
            (my_start.line === position.line &&
                my_start.character <= position.character);
        if (at_or_before_cursor) {
            return {
                index: first_index,
                line: my_start.line,
                character: my_start.character,
            };
        }
    }

    // Case B: an empty statement position — the cursor sits at/just after a
    // boundary with no statement token yet before it (right after a `;` on a
    // shared physical line, in a new statement's leading whitespace, or on a
    // blank line). The statement "starts" where the boundary left off. Report
    // it on the cursor's own line so the caller slices the current physical
    // line from just after the boundary (dropping any earlier statement that
    // shares the line) and treats it as a fresh — not continuation —
    // statement.
    // Clamp to the cursor: when the cursor sits INSIDE a multi-character
    // boundary token (e.g. editing within `#delimit ;` or a `mata` opener),
    // the boundary's end is past the cursor, and an unclamped resume character
    // would make the caller's `substring(resume, cursor)` reverse its
    // arguments and splice in text after the cursor.
    const resume_character =
        boundary_index >= 0 &&
        tokens[boundary_index].range.end.line === position.line
            ? Math.min(
                  tokens[boundary_index].range.end.character,
                  position.character
              )
            : 0;
    return {
        index: first_index >= 0 ? first_index : boundary_index + 1,
        line: position.line,
        character: resume_character,
    };
}
