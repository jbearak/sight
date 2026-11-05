/**
 * Which `program` statements define a program (and so have a body that
 * runs to an `end`), shared by the lexer, the parser and the context
 * tracker so they agree on where a program definition starts.
 */

/** Words after `program` that make it a subcommand, not a definition. */
export const PROGRAM_SUBCOMMANDS: ReadonlySet<string> = new Set([
    'di', 'dir', 'drop', 'l', 'li', 'lis', 'list',
]);

const FIRST_WORD = /^[ \t]+([A-Za-z_][A-Za-z0-9_]*)/;
const PLUGIN_WORD = /\bplugin\b/;

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
 * Whether `program` followed by `text_after_program` (the rest of its
 * physical line) defines a program: a name or `define` follows, not a
 * subcommand (`program drop x`), and there is no `plugin` option (a
 * plugin declaration has no body or `end`).
 */
export function is_program_definition_header(text_after_program: string): boolean {
    const my_text = strip_inline_block_comments(text_after_program);
    const my_match = FIRST_WORD.exec(my_text);
    if (my_match === null || PROGRAM_SUBCOMMANDS.has(my_match[1])) {
        return false;
    }
    const my_comment_start = my_text.indexOf('//');
    const my_code = my_comment_start === -1
        ? my_text
        : my_text.slice(0, my_comment_start);
    // A `plugin` option: the word after the comma that starts options
    const my_comma = my_code.indexOf(',');
    return my_comma === -1 || !PLUGIN_WORD.test(my_code.slice(my_comma));
}
