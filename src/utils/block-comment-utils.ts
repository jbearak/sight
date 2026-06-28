/**
 * Block-comment line detection.
 *
 * LSP directives are honored only in standalone `//` or line-leading `*` line
 * comments; Stata block comments do not carry directives (see
 * docs/declaration-directives.md). The raw-line directive scanners in the
 * directive parser recognize a line as a directive (or a `do`/`include` call)
 * from its leading text, which would also match a line nested inside a
 * multi-line block comment. This helper reports the lines whose FIRST
 * non-whitespace character lies inside a block comment, so those scanners can
 * skip block-commented-out lines while still seeing real code that merely has a
 * trailing block comment (a `do "child.do"` line followed by an inline block
 * comment is still a real call).
 */

import { Token } from '../types';
import { StataLexer } from '../lexer';
import { compute_line_offsets, get_line_text, get_line_count } from './line-utils';

/**
 * Line indices (0-based) whose first non-whitespace character is inside a Stata
 * block comment. `tokens` should be the lexer tokens for `content`; when
 * omitted, `content` is lexed.
 */
export function block_comment_lines(content: string, tokens?: Token[]): Set<number> {
    const the_tokens = tokens ?? new StataLexer().tokenize(content).tokens;
    const the_block_ranges = the_tokens
        .filter(my_token => my_token.type === 'COMMENT_BLOCK')
        .map(my_token => my_token.range);

    const the_lines = new Set<number>();
    if (the_block_ranges.length === 0) {
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
        for (const my_range of the_block_ranges) {
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
