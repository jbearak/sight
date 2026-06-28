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
import { StataLexer } from '../lexer';
import { compute_line_offsets, get_line_text, get_line_count } from './line-utils';

/**
 * Line indices (0-based) whose first non-whitespace character is inside a
 * multi-line comment token. `tokens` should be the lexer tokens for `content`;
 * when omitted, `content` is lexed.
 *
 * Only multi-line comments are considered: a single-line comment (the common
 * `// sight: ...` directive, or an inline block comment) never hides a
 * directive, so it is excluded and a real directive on its own line still
 * parses. Anchoring on the line's first non-whitespace character means a real
 * code line with a trailing multi-line comment opener (code, then a block
 * opener) is NOT marked — its leading text is the code, not the comment — while
 * a comment opener whose leading text is itself the comment (a bare block
 * opener, or a line-leading-star span) IS marked.
 */
export function block_comment_lines(content: string, tokens?: Token[]): Set<number> {
    const the_tokens = tokens ?? new StataLexer().tokenize(content).tokens;
    const the_comment_ranges = the_tokens
        .filter(my_token =>
            (my_token.type === 'COMMENT_BLOCK' || my_token.type === 'COMMENT_LINE') &&
            my_token.range.end.line > my_token.range.start.line)
        .map(my_token => my_token.range);

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
        for (const my_range of the_comment_ranges) {
            const after_start = my_line > my_range.start.line ||
                (my_line === my_range.start.line && my_col >= my_range.start.character);
            const before_end = my_line < my_range.end.line ||
                (my_line === my_range.end.line && my_col < my_range.end.character);
            if (after_start && before_end) {
                the_lines.add(my_line);
                break;
            }
        }
    }
    return the_lines;
}
