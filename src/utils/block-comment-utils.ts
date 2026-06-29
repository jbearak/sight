/**
 * Multi-line comment continuation detection.
 *
 * LSP directives are honored only in standalone `//` or line-leading `*` line
 * comments; a line whose content is actually *inside* a comment that opened on
 * an earlier line carries no directive (see docs/declaration-directives.md).
 * The raw-line directive scanners in the directive parser recognize a line as a
 * directive from its leading text, which would also match a line nested inside a
 * multi-line comment. This helper reports the CONTINUATION lines of multi-line
 * comments — both Stata block comments and a line comment that the lexer spans
 * across lines (such as a line-leading star followed by a block-comment opener)
 * — so those scanners skip them, matching the token-based analyzer.
 *
 * A comment's own opening line is never reported, so a real `// sight: ...`
 * directive on its own line still parses; and a real code line that merely has a
 * trailing inline block comment (its leading text is not inside the comment) is
 * not reported either.
 */

import { Token } from '../types';
import { Range } from 'vscode-languageserver-textdocument';
import { StataLexer } from '../lexer';
import { compute_line_offsets, get_line_text, get_line_count } from './line-utils';

/**
 * Character spans of multi-line comment tokens (0-based line/character ranges).
 * `tokens` should be the lexer tokens for `content`; when omitted, `content` is
 * lexed.
 *
 * Considered comments are block comments (any — a block comment is never a
 * directive) and line comments the lexer spans across lines. A single-line line
 * comment (the common `// sight: ...` directive) is excluded so a real directive
 * on its own line still parses.
 */
export function block_comment_ranges(content: string, tokens?: Token[]): Range[] {
    const the_tokens = tokens ?? new StataLexer().tokenize(content).tokens;
    return the_tokens
        .filter(my_token =>
            my_token.type === 'COMMENT_BLOCK' ||
            (my_token.type === 'COMMENT_LINE' &&
                my_token.range.end.line > my_token.range.start.line))
        .map(my_token => my_token.range);
}

/**
 * Whether the (0-based line, character) position falls inside any of the given
 * comment ranges. The range is half-open: [start, end) — so the character just
 * after a closing comment marker is NOT inside.
 */
export function position_in_block_comment(
    line: number,
    character: number,
    ranges: Range[]
): boolean {
    for (const my_range of ranges) {
        const after_start = line > my_range.start.line ||
            (line === my_range.start.line && character >= my_range.start.character);
        const before_end = line < my_range.end.line ||
            (line === my_range.end.line && character < my_range.end.character);
        if (after_start && before_end) {
            return true;
        }
    }
    return false;
}

/**
 * Line indices (0-based) whose first non-whitespace character is inside a
 * multi-line comment token. `tokens` should be the lexer tokens for `content`;
 * when omitted, `content` is lexed.
 *
 * Anchoring on the line's first non-whitespace character means a real code line
 * with a trailing block comment (code, then a block opener) is NOT marked — its
 * leading text is the code, not the comment — while a comment whose leading text
 * is itself the comment (a bare block comment, or a line-leading-star span) IS
 * marked. Callers that need to test a non-leading position (e.g. a `match=`
 * substring anywhere on a line) should use {@link position_in_block_comment}
 * with {@link block_comment_ranges} instead.
 */
export function block_comment_lines(content: string, tokens?: Token[]): Set<number> {
    const the_comment_ranges = block_comment_ranges(content, tokens);

    const the_lines = new Set<number>();
    if (the_comment_ranges.length === 0) {
        return the_lines;
    }

    const doc = { content, line_offsets: compute_line_offsets(content) };
    const line_count = get_line_count(doc);
    for (let my_line = 0; my_line < line_count; my_line++) {
        const my_text = get_line_text(doc, my_line);
        const my_col = my_text.search(/\S/);
        if (my_col < 0) {
            continue; // blank line
        }
        if (position_in_block_comment(my_line, my_col, the_comment_ranges)) {
            the_lines.add(my_line);
        }
    }
    return the_lines;
}
