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
const PLUGIN_OPTION = /,.*\bplugin\b/;

/**
 * Whether `program` followed by `text_after_program` (the rest of its
 * physical line) defines a program: a name or `define` follows, not a
 * subcommand (`program drop x`), and there is no `plugin` option (a
 * plugin declaration has no body or `end`).
 */
export function is_program_definition_header(text_after_program: string): boolean {
    const my_match = FIRST_WORD.exec(text_after_program);
    if (my_match === null || PROGRAM_SUBCOMMANDS.has(my_match[1])) {
        return false;
    }
    const my_comment_start = text_after_program.indexOf('//');
    const my_code = my_comment_start === -1
        ? text_after_program
        : text_after_program.slice(0, my_comment_start);
    return !PLUGIN_OPTION.test(my_code);
}
