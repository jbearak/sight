/**
 * Which `program` statements define a program (and so have a body that
 * runs to an `end`), shared by the lexer, the parser and the context
 * tracker so they agree on where a program definition starts.
 */

/**
 * `program` and the abbreviations Stata 18 accepts for it, down to `pr`
 * (`prog def roctab` in roctab.ado); `p` is unrecognized.
 */
export const PROGRAM_COMMAND_NAMES: ReadonlySet<string> = new Set([
    'pr', 'pro', 'prog', 'progr', 'progra', 'program',
]);

/**
 * Regex source for a definition header up to the name: `program` and
 * optionally `define`, each abbreviated as far as Stata allows
 * (`prog def`). Exact case.
 */
export const PROGRAM_HEADER_SOURCE =
    /pr(?:o(?:g(?:r(?:a(?:m)?)?)?)?)?\b(?:\s+de(?:f(?:i(?:n(?:e)?)?)?)?\b)?/.source;

/** Words after `program` that make it a subcommand, not a definition. */
export const PROGRAM_SUBCOMMANDS: ReadonlySet<string> = new Set([
    'di', 'dir', 'drop', 'l', 'li', 'lis', 'list',
]);

const FIRST_WORD = /^[ \t]+([A-Za-z_][A-Za-z0-9_]*)/;
const PLUGIN_WORD = /\bplugin\b/;
// A `//` comment start: as in Stata 18, at the start of the text or
// after a space or tab (`program p, rclass//x` has no comment).
const LINE_COMMENT_START = /(?<=^|[ \t])\/\//;

/**
 * `text` with each block comment that opens and closes on the line
 * replaced by a blank, as the parser reads it. Block comments nest,
 * as in Stata; an unclosed one is left as written. One linear scan.
 */
export function strip_inline_block_comments(text: string): string {
    const the_parts: string[] = [];
    let my_depth = 0;
    let my_kept_from = 0;
    let my_comment_start = 0;
    let i = 0;
    while (i < text.length) {
        if (text[i] === '/' && text[i + 1] === '*') {
            if (my_depth === 0) {
                the_parts.push(text.slice(my_kept_from, i));
                my_comment_start = i;
            }
            my_depth++;
            i += 2;
        } else if (my_depth > 0 && text[i] === '*' && text[i + 1] === '/') {
            my_depth--;
            i += 2;
            if (my_depth === 0) {
                the_parts.push(' ');
                my_kept_from = i;
            }
        } else {
            i++;
        }
    }
    the_parts.push(text.slice(my_depth > 0 ? my_comment_start : my_kept_from));
    return the_parts.join('');
}

/**
 * The text from `start` in `source` to the end of its logical line: the
 * rest of the physical line, and each following line that a `///`
 * joins to it, in place of the `///` and the note after it. A `///`
 * continues the line where a `//` comment could start (see
 * LINE_COMMENT_START), as in Stata 18: `program ///` then `define foo`
 * is `program define foo`. Block comments that close on their line are
 * blanked.
 */
export function logical_line_text(source: string, start: number): string {
    const the_parts: string[] = [];
    let my_start = start;
    for (;;) {
        const my_newline = source.indexOf('\n', my_start);
        const my_end = my_newline === -1 ? source.length : my_newline;
        const my_line = strip_inline_block_comments(
            source.slice(my_start, my_end).replace(/\r$/, ''));
        const my_comment = LINE_COMMENT_START.exec(my_line);
        if (my_newline === -1 || my_comment === null ||
                !my_line.startsWith('///', my_comment.index)) {
            the_parts.push(my_line);
            return the_parts.join('');
        }
        the_parts.push(my_line.slice(0, my_comment.index), ' ');
        my_start = my_newline + 1;
    }
}

/**
 * Whether `program` followed by `text_after_program` (the rest of its
 * logical line, see logical_line_text) defines a program: a name or
 * `define` follows, not a subcommand (`program drop x`), and there is
 * no `plugin` option (a plugin declaration has no body or `end`).
 */
export function is_program_definition_header(text_after_program: string): boolean {
    const my_text = strip_inline_block_comments(text_after_program);
    const my_match = FIRST_WORD.exec(my_text);
    if (my_match === null || PROGRAM_SUBCOMMANDS.has(my_match[1])) {
        return false;
    }
    const my_comment = LINE_COMMENT_START.exec(my_text);
    const my_code = my_comment === null
        ? my_text
        : my_text.slice(0, my_comment.index);
    // A `plugin` option: the word after the comma that starts options
    const my_comma = my_code.indexOf(',');
    return my_comma === -1 || !PLUGIN_WORD.test(my_code.slice(my_comma));
}
