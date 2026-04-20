/**
 * String-literal detection utilities.
 *
 * Uses lexer tokens to determine whether a cursor sits inside the literal
 * text of a string (i.e., a STRING token), excluding embedded macro
 * references within compound strings — the lexer emits those as separate
 * MACRO_REF_LOCAL / MACRO_REF_GLOBAL tokens, so they fall through naturally.
 */

import { Position } from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { Token } from '../types';

export function is_cursor_in_string_literal(document: DocumentState, position: Position): boolean {
    if (!document.tokens || document.tokens.length === 0) {
        return false;
    }
    return is_cursor_in_string_literal_from_tokens(document.tokens, position);
}

function is_cursor_in_string_literal_from_tokens(tokens: Token[], position: Position): boolean {
    for (const my_token of tokens) {
        // Tokens are in source order, so once a token starts strictly after
        // the cursor, no later token can contain the cursor either.
        if (is_range_start_after_position(my_token.range.start, position)) {
            return false;
        }
        if (my_token.type !== 'STRING') {
            continue;
        }
        if (is_position_in_range(position, my_token.range)) {
            return true;
        }
    }
    return false;
}

function is_range_start_after_position(
    range_start: { line: number; character: number },
    position: Position
): boolean {
    if (range_start.line > position.line) return true;
    if (range_start.line === position.line && range_start.character > position.character) {
        return true;
    }
    return false;
}

function is_position_in_range(
    position: Position,
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
): boolean {
    if (position.line < range.start.line) return false;
    if (position.line === range.start.line && position.character < range.start.character) return false;

    if (position.line > range.end.line) return false;
    if (position.line === range.end.line && position.character >= range.end.character) return false;

    return true;
}
