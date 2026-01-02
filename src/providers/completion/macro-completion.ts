/**
 * Macro completion utilities.
 *
 * Centralizes:
 * - Macro context detection (local/global)
 * - Comment suppression for macro completions
 * - Replacement range computation for safe textEdit-based completions
 * - Closing delimiter detection for suffix insertion
 */

import { Position, Range } from 'vscode-languageserver';
import { DocumentState } from '../../document-store';
import { Token } from '../../types';
import { get_line_text, get_char_at_position, compute_line_offsets } from '../../utils/line-utils';

export const MACRO_IDENTIFIER_CHAR_REGEX = /[A-Za-z0-9_]/;

export type MacroScope = 'local' | 'global';
export type MacroForm = 'local' | 'global-braced' | 'global-unbraced';

export interface MacroCompletionContext {
    type: 'macro';
    scope: MacroScope;
    form: MacroForm;
    delimiterStart: Position;
    delimiterEnd?: Position; // For `...` or ${...} if closed
    identifierRange: Range; // The valid identifier range before the cursor
}

/**
 * Check if a closing delimiter exists immediately after the replacement range end.
 *
 * @param document - The document state
 * @param range_end - The end position of the replacement range
 * @param delimiter_char - The delimiter character to check for (' or })
 * @returns true if the delimiter exists immediately after range end
 */
export function has_closing_delimiter(
    document: DocumentState,
    range_end: Position,
    delimiter_char: string
): boolean {
    const char_at_end = get_char_at_position(document, range_end);
    return char_at_end === delimiter_char;
}

/**
 * Compute the replacement range for macro completions.
 * Returns the maximal contiguous span of macro identifier characters
 * surrounding the cursor position.
 *
 * @param document - The document state
 * @param position - The cursor position
 * @param context - The detailed macro context
 */
export function compute_macro_replacement_range(
    document: DocumentState,
    position: Position,
    context: MacroCompletionContext
): Range {
    const current_line = get_line_text(document, position.line);

    if (current_line === '') {
        return Range.create(position, position);
    }

    const cursor_char = position.character;

    // Use context delimiters to bound the range
    let min_start = context.delimiterStart.character;
    if (context.form === 'local') min_start += 1; // After `
    if (context.form === 'global-braced') min_start += 2; // After ${
    if (context.form === 'global-unbraced') min_start += 1; // After $

    // Find start of macro identifier chars
    let start_char = cursor_char;
    while (start_char > min_start) {
        const char = current_line[start_char - 1];
        if (!MACRO_IDENTIFIER_CHAR_REGEX.test(char)) {
            break;
        }
        start_char--;
    }

    // Find end of macro identifier chars
    let end_char = cursor_char;
    let max_end = current_line.length;
    if (context.delimiterEnd) {
        max_end = context.delimiterEnd.character;
    }

    while (end_char < max_end) {
        const char = current_line[end_char];
        if (!MACRO_IDENTIFIER_CHAR_REGEX.test(char)) {
            break;
        }
        end_char++;
    }

    return Range.create(
        Position.create(position.line, start_char),
        Position.create(position.line, end_char)
    );
}

/**
 * Detect whether the cursor is currently inside a macro reference.
 *
 * Local macro: cursor strictly between backtick and closing apostrophe.
 * Global macro: cursor after $ within identifier chars, or between ${ and }.
 *
 * Returns null when cursor is after closing apostrophe/brace, inside comments,
 * or after an invalid character in the macro name (e.g. `app.le|`).
 */
export function detect_macro_context(
    text_before_cursor: string,
    document?: DocumentState,
    position?: Position
): MacroCompletionContext | null {
    if (document && position && is_cursor_in_comment(document, position)) {
        return null;
    }

    const line_num = position ? position.line : 0; // fallback line 0 if only text provided

    const local_context = detect_local_macro_context(text_before_cursor, line_num, document, position);
    if (local_context) {
        return local_context;
    }

    const global_context = detect_global_macro_context(text_before_cursor, line_num);
    if (global_context) {
        return global_context;
    }

    return null;
}

/**
 * Detect local macro context.
 */
export function detect_local_macro_context(
    text_before_cursor: string, 
    line: number, 
    document?: DocumentState, 
    position?: Position
): MacroCompletionContext | null {
    let last_backtick_pos = -1;

    for (let i = 0; i < text_before_cursor.length; i++) {
        const char = text_before_cursor[i];
        const next_char = text_before_cursor[i + 1] || '';

        if (char === '`') {
            // Skip compound quote opener `"
            if (next_char === '"') {
                continue;
            }
            last_backtick_pos = i;
        }
    }

    if (last_backtick_pos < 0) {
        return null;
    }

    const after_backtick = text_before_cursor.substring(last_backtick_pos + 1);

    // Check if cursor is immediately before a closing apostrophe (auto-close case)
    let is_auto_close_case = false;
    if (document && position) {
        const char_after_cursor = get_char_at_position(document, position);
        is_auto_close_case = char_after_cursor === "'";
    }

    // If we have already seen a closing apostrophe after this backtick, then the
    // cursor is after the macro reference (e.g., `name'|) and we should not be
    // in macro context. Exception: auto-close case where cursor is before the apostrophe.
    if (after_backtick.includes("'") && !is_auto_close_case) {
        return null;
    }

    // Check for invalid characters in the prefix
    for (const char of after_backtick) {
        if (!MACRO_IDENTIFIER_CHAR_REGEX.test(char)) {
            // Found invalid char between backtick and cursor -> invalid tail
            return null;
        }
    }

    return {
        type: 'macro',
        scope: 'local',
        form: 'local',
        delimiterStart: Position.create(line, last_backtick_pos),
        identifierRange: Range.create(
            Position.create(line, last_backtick_pos + 1),
            Position.create(line, text_before_cursor.length)
        )
    };
}

/**
 * Detect global macro context with strict boundary checking.
 */
export function detect_global_macro_context(text_before_cursor: string, line: number): MacroCompletionContext | null {
    for (let i = text_before_cursor.length - 1; i >= 0; i--) {
        const char = text_before_cursor[i];

        if (char === '$') {
            const after_dollar = text_before_cursor.substring(i + 1);

            // Braced form: ${...}
            if (after_dollar.startsWith('{')) {
                // Cursor is between ${ and } (if brace not closed)
                if (!after_dollar.includes('}')) {
                    // Check for invalid chars inside brace
                    const content_inside = after_dollar.substring(1); // skip {
                    for (const ch of content_inside) {
                        if (!MACRO_IDENTIFIER_CHAR_REGEX.test(ch)) {
                            // Invalid char before cursor
                            return null;
                        }
                    }

                    return {
                        type: 'macro',
                        scope: 'global',
                        form: 'global-braced',
                        delimiterStart: Position.create(line, i),
                        identifierRange: Range.create(
                            Position.create(line, i + 2),
                            Position.create(line, text_before_cursor.length)
                        )
                    };
                }
                // Cursor is after closing } (e.g., ${name}|) -> not macro context
                continue;
            }

            // Unbraced form: $name
            // Scan forward from $ to ensure we are still connected to it
            // e.g. `$foo bar|` -> cursor is not in macro
            // e.g. `$fo|` -> cursor is in macro
            // But we iterate backwards, so `i` is the closest `$`.
            // Check if everything from $ to cursor is an identifier
            let is_valid_unbraced = true;
            if (after_dollar === '') {
                // $ at end of text
                is_valid_unbraced = true;
            } else {
                if (!/^[A-Za-z0-9_]+$/.test(after_dollar)) {
                    is_valid_unbraced = false;
                }
            }

            if (is_valid_unbraced) {
                // Ensure starts with letter if not empty?
                // Stata requirement: global names start with letter/underscore.
                // But partial typing `$1` might be valid for global? No, global names cannot start with digit.
                // However, we should be lenient during typing.
                return {
                    type: 'macro',
                    scope: 'global',
                    form: 'global-unbraced',
                    delimiterStart: Position.create(line, i),
                    identifierRange: Range.create(
                        Position.create(line, i + 1),
                        Position.create(line, text_before_cursor.length)
                    )
                };
            }
        }

        // Stop at whitespace or statement boundaries (optimization)
        if (char === ' ' || char === '\t' || char === '\n' || char === ';') {
            break;
        }
    }

    return null;
}

/**
 * Check if cursor position is inside a comment.
 * Uses best-effort detection with lexer tokens or simple heuristics.
 */
function is_cursor_in_comment(document: DocumentState, position: Position): boolean {
    if (document.tokens) {
        return is_cursor_in_comment_from_tokens(document.tokens, position);
    }

    return is_cursor_in_comment_heuristic(document.content, position);
}

function is_cursor_in_comment_from_tokens(tokens: Token[], position: Position): boolean {
    for (const my_token of tokens) {
        if (my_token.type === 'COMMENT_LINE' || my_token.type === 'COMMENT_BLOCK') {
            if (is_position_in_range(position, my_token.range)) {
                return true;
            }
        }
    }
    return false;
}

function is_cursor_in_comment_heuristic(content: string, position: Position): boolean {
    // Create a minimal document-like object for get_line_text
    const doc = { content, line_offsets: compute_line_offsets(content) };
    const current_line = get_line_text(doc, position.line);

    if (current_line === '') {
        return false;
    }

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

        // Track string boundaries (double quotes)
        if (char === '"' && !in_string) {
            // Check for compound quote start
            if (i > 0 && line[i - 1] === '`') {
                continue;
            }
            in_string = true;
            continue;
        }

        if (in_string && char === '"') {
            // Check for doubled quote escape
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

        if (char === '*' && (i === 0 || /\s/.test(line[i - 1]))) {
            return i;
        }
    }

    return -1;
}

function is_in_block_comment(content: string, position: Position): boolean {
    // Create a minimal document-like object for get_line_text
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

    if (position.line > range.end.line) return false;
    if (position.line === range.end.line && position.character > range.end.character) return false;

    return true;
}
