/**
 * Comment detection utilities.
 *
 * Uses lexer tokens when available and falls back to a best-effort
 * string heuristic that tracks string boundaries and block-comment
 * nesting depth.
 */

import { Position } from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { Token } from '../types';
import { get_line_text, compute_line_offsets } from './line-utils';

export function is_cursor_in_comment(document: DocumentState, position: Position): boolean {
    if (document.tokens && document.tokens.length > 0) {
        return is_cursor_in_comment_from_tokens(document.tokens, position);
    }

    return is_cursor_in_comment_heuristic(document.content, position);
}

function is_cursor_in_comment_from_tokens(tokens: Token[], position: Position): boolean {
    for (const my_token of tokens) {
        if (
            my_token.type === 'COMMENT_LINE' ||
            my_token.type === 'COMMENT_BLOCK' ||
            my_token.type === 'CONTINUATION'
        ) {
            if (is_position_in_range(position, my_token.range)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * True when the position falls inside a Stata block comment specifically (not a
 * `//` / line-leading `*` line comment). Directives are inert inside block
 * comments, so providers use this to avoid resolving/completing a
 * directive-looking line that is actually block-commented out.
 */
export function is_cursor_in_block_comment(document: DocumentState, position: Position): boolean {
    if (document.tokens && document.tokens.length > 0) {
        for (const my_token of document.tokens) {
            // A block comment is always inert; a line comment is inert only when
            // the lexer spans it across lines (e.g. a line-leading `*` followed
            // by a block opener), matching block_comment_lines for the parser.
            const is_block = my_token.type === 'COMMENT_BLOCK';
            const is_spanned_line = my_token.type === 'COMMENT_LINE' &&
                my_token.range.end.line > my_token.range.start.line;
            if ((is_block || is_spanned_line) &&
                is_position_in_range(position, my_token.range)) {
                return true;
            }
        }
        return false;
    }

    return is_in_block_comment(document.content, position);
}

function is_cursor_in_comment_heuristic(content: string, position: Position): boolean {
    const doc = { content, line_offsets: compute_line_offsets(content) };
    const current_line = get_line_text(doc, position.line);

    const line_comment_pos = find_line_comment_start(current_line);
    if (line_comment_pos !== -1 && position.character >= line_comment_pos) {
        return true;
    }

    return is_in_block_comment(content, position);
}

function find_line_comment_start(line: string): number {
    let in_string = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next_char = line[i + 1] || '';

        if (char === '"' && !in_string) {
            if (i > 0 && line[i - 1] === '`') {
                continue;
            }
            in_string = true;
            continue;
        }

        if (in_string && char === '"') {
            if (next_char === '"') {
                i++;
                continue;
            }
            in_string = false;
            continue;
        }

        if (in_string) {
            continue;
        }

        if (char === '/' && next_char === '/') {
            return i;
        }

        // `*` is a comment only when it is line-leading (everything before it
        // on the line is whitespace). Otherwise it is multiplication, e.g.,
        // `gen z = x * y`.
        if (char === '*' && line.slice(0, i).trim() === '') {
            return i;
        }
    }

    return -1;
}

function is_in_block_comment(content: string, position: Position): boolean {
    const doc = { content, line_offsets: compute_line_offsets(content) };
    let block_comment_depth = 0;

    for (let line_num = 0; line_num <= position.line; line_num++) {
        const line = get_line_text(doc, line_num);
        if (line === '' && line_num < position.line) {
            continue;
        }
        const end_char = line_num === position.line ? position.character : line.length;

        for (let i = 0; i < end_char; i++) {
            const char = line[i];
            const next_char = line[i + 1] || '';

            if (char === '/' && next_char === '*') {
                block_comment_depth++;
                i++;
                continue;
            }

            if (char === '*' && next_char === '/') {
                if (block_comment_depth > 0) {
                    block_comment_depth--;
                }
                i++;
                continue;
            }
        }
    }

    return block_comment_depth > 0;
}

function is_position_in_range(
    position: Position,
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
): boolean {
    if (position.line < range.start.line) return false;
    if (position.line === range.start.line && position.character < range.start.character) return false;

    // Token ends are exclusive, matching the lexer and other providers.
    if (position.line > range.end.line) return false;
    if (position.line === range.end.line && position.character >= range.end.character) return false;

    return true;
}
