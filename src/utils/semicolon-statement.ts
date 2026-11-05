import { Token, TokenType } from '../types';

const COMMENT_TOKEN_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
    'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION',
]);

// `#delimit ;`, with the `;` as the first thing after the keyword.
const DELIMIT_SEMICOLON_PATTERN = /^#delimit[ \t]*;/;

/**
 * Tracks whether the current `#delimit ;` statement has begun, comments
 * included. Stata 18 ends a statement only at `;`, and reads a `//` or
 * `///` at column 0 as a comment only on a statement's first line: after
 * `// c`, a block comment, or `di 1; // c`, a `// d` at column 0 on the
 * next line is code ("/ is not a valid command name"). A `;` (also the
 * one ending `* c;`), `#delimit` with its own comment, and the `end` of
 * a mata or python block start a fresh statement.
 *
 * Feed it every token in order. `is_open` is then the state before the
 * next token.
 */
export class SemicolonStatementTracker {
    is_open = false;
    // Line of the last `#delimit`, whose own comment starts no statement.
    private delimit_directive_line = -1;

    /**
     * Note `token`, read under `delimiter_mode` (the mode in effect
     * after it, for a `#delimit`).
     */
    note(token: Token, delimiter_mode: 'cr' | 'semicolon'): void {
        if (token.type === 'WHITESPACE') {
            return;
        }
        if (token.type === 'DELIMIT_DIRECTIVE') {
            this.delimit_directive_line = token.range.end.line;
            this.is_open = false;
            return;
        }
        const is_star_comment_end = token.type === 'COMMENT_LINE' &&
            token.value.startsWith('*') && token.value.endsWith(';') &&
            delimiter_mode === 'semicolon';
        if ((token.type === 'STATEMENT_TERMINATOR' && token.value === ';') ||
            token.type === 'END_MATA' || token.type === 'END_PYTHON' ||
            is_star_comment_end) {
            this.is_open = false;
            return;
        }
        if (token.type === 'STATEMENT_TERMINATOR' ||
            (COMMENT_TOKEN_TYPES.has(token.type) &&
             token.range.start.line === this.delimit_directive_line)) {
            return;
        }
        this.is_open = true;
    }
}

/** The delimiter mode a `#delimit` token sets. */
export function delimit_directive_mode(token: Token): 'cr' | 'semicolon' {
    return DELIMIT_SEMICOLON_PATTERN.test(token.value) ? 'semicolon' : 'cr';
}

/**
 * Lines that start with a `//` or `///` in the middle of a
 * `#delimit ;` statement (tokens lexed from `start_mode`): a comment
 * there (indented in the source)
 * must not move to column 0, where Stata 18 reads it as code, and the
 * code the lexer made of slashes at column 0 must stay there, where
 * indenting it would make it a comment.
 */
export function find_mid_statement_slash_lines(
    tokens: Token[],
    start_mode: 'cr' | 'semicolon' = 'cr'
): { comment_lines: Set<number>; code_lines: Set<number> } {
    const comment_lines = new Set<number>();
    const code_lines = new Set<number>();
    const tracker = new SemicolonStatementTracker();
    let delimiter_mode = start_mode;
    let previous_line = -1;
    for (let i = 0; i < tokens.length; i++) {
        const my_token = tokens[i];
        if (my_token.type === 'DELIMIT_DIRECTIVE') {
            delimiter_mode = delimit_directive_mode(my_token);
        }
        const my_line = my_token.range.start.line;
        const is_line_start = my_token.type !== 'WHITESPACE' &&
            my_line > previous_line;
        if (is_line_start && delimiter_mode === 'semicolon' &&
            tracker.is_open) {
            if (COMMENT_TOKEN_TYPES.has(my_token.type) &&
                my_token.value.startsWith('//')) {
                comment_lines.add(my_line);
            } else if (is_column0_slash_pair(my_token, tokens[i + 1])) {
                code_lines.add(my_line);
            }
        }
        tracker.note(my_token, delimiter_mode);
        if (my_token.type !== 'WHITESPACE') {
            // A `\n` terminator ends on the next line.
            previous_line = my_token.type === 'STATEMENT_TERMINATOR'
                ? my_token.range.start.line
                : my_token.range.end.line;
        }
    }
    return { comment_lines, code_lines };
}

/** Are `token` and `next` the `//` at column 0 the lexer read as code? */
function is_column0_slash_pair(token: Token, next: Token | undefined): boolean {
    return token.type === 'OPERATOR' && token.value === '/' &&
        token.range.start.character === 0 &&
        next?.type === 'OPERATOR' && next.value === '/' &&
        next.range.start.line === token.range.start.line &&
        next.range.start.character === 1;
}
