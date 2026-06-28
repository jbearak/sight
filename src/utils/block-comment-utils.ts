/**
 * Block-comment line detection.
 *
 * LSP directives are honored only in standalone `//` or line-leading `*` line
 * comments; Stata block comments do not carry directives (see
 * docs/declaration-directives.md). The raw-line directive scanners in the
 * directive parser recognize a line as a directive when its trimmed text starts
 * with `//` or `*`, which also matches `//`/`*` lines nested inside a multi-line
 * block comment. These helpers identify the lines covered by a block comment so
 * those scanners can skip them, matching the token-based analyzer.
 */

import { Token } from '../types';
import { StataLexer } from '../lexer';

/**
 * Line indices (0-based) covered by a Stata block comment, derived from
 * already-lexed tokens.
 */
export function block_comment_lines_from_tokens(tokens: Token[]): Set<number> {
    const the_lines = new Set<number>();
    for (const my_token of tokens) {
        if (my_token.type === 'COMMENT_BLOCK') {
            for (let my_line = my_token.range.start.line;
                my_line <= my_token.range.end.line;
                my_line++) {
                the_lines.add(my_line);
            }
        }
    }
    return the_lines;
}

/**
 * Line indices (0-based) covered by a Stata block comment in `content`.
 * Lexes the content; callers that already hold tokens should use
 * `block_comment_lines_from_tokens` instead.
 */
export function block_comment_lines_from_content(content: string): Set<number> {
    const { tokens } = new StataLexer().tokenize(content);
    return block_comment_lines_from_tokens(tokens);
}
