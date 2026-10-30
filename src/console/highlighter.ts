/**
 * Syntax highlighting for one line of console input, using Sight's lexer.
 *
 * Colors are the 16 base ANSI colors so the user's terminal theme picks
 * the actual palette (as Raven's console does). The command word is found
 * by position: the first word of the statement after the standard
 * prefixes. Prefixes are matched exactly; Stata is case-sensitive, so
 * `Quietly` is not a prefix.
 */

import { StataLexer } from '../lexer';
import type { Token } from '../types';

export const SGR = {
    reset: '\x1b[0m',
    bold_blue: '\x1b[1;34m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    dim: '\x1b[2m',
} as const;

/** Input above this size is shown uncolored, keeping keystrokes cheap. */
const MAX_HIGHLIGHT_BYTES = 64 * 1024;

const COMMAND_PREFIXES = new Set([
    'qui', 'quietly', 'n', 'noi', 'noisily',
    'cap', 'capt', 'captu', 'captur', 'capture',
]);
const BY_PREFIXES = new Set(['by', 'bys', 'byso', 'bysor', 'bysort']);
const QUALIFIER_KEYWORDS = new Set(['if', 'in']);

function color_for(token: Token, state: { expect_command: boolean; in_by: boolean }): string | null {
    switch (token.type) {
        case 'STRING':
            return SGR.green;
        case 'NUMBER':
            return SGR.cyan;
        case 'MACRO_REF_LOCAL':
        case 'MACRO_REF_GLOBAL':
            return SGR.magenta;
        case 'COMMENT_LINE':
        case 'COMMENT_BLOCK':
            return SGR.dim;
        case 'COLON':
            if (state.in_by) {
                state.in_by = false;
                state.expect_command = true;
            }
            return null;
        case 'WORD':
            if (state.in_by) {
                return null;
            }
            if (state.expect_command) {
                if (COMMAND_PREFIXES.has(token.value)) {
                    return SGR.blue;
                }
                state.expect_command = false;
                if (BY_PREFIXES.has(token.value)) {
                    state.in_by = true;
                    return SGR.blue;
                }
                return SGR.bold_blue;
            }
            return QUALIFIER_KEYWORDS.has(token.value) ? SGR.blue : null;
        default:
            if (state.expect_command && token.type !== 'WHITESPACE') {
                state.expect_command = false;
            }
            return null;
    }
}

/**
 * Return `line` with ANSI color codes added. The visible text is
 * unchanged: every byte of the input appears, in order.
 */
export function highlight_stata(line: string): string {
    if (line.length === 0 || line.length > MAX_HIGHLIGHT_BYTES || line.includes('\n')) {
        return line;
    }
    let tokens: Token[];
    try {
        tokens = new StataLexer().tokenize(line).tokens;
    } catch {
        return line;
    }
    const state = { expect_command: true, in_by: false };
    const parts: string[] = [];
    let position = 0;
    for (const my_token of tokens) {
        if (my_token.type === 'EOF') {
            break;
        }
        const start = my_token.range.start.character;
        const end = my_token.range.end.character;
        if (my_token.range.start.line !== 0 || my_token.range.end.line !== 0
            || start < position || end < start) {
            break;
        }
        if (start > position) {
            parts.push(line.slice(position, start));
        }
        const color = color_for(my_token, state);
        const text = line.slice(start, end);
        parts.push(color ? `${color}${text}${SGR.reset}` : text);
        position = end;
    }
    if (position < line.length) {
        parts.push(line.slice(position));
    }
    return parts.join('');
}
