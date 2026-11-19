/**
 * Which `program` statements define a program (and so have a body that
 * runs to an `end`). The lexer decides, with program_header_text and
 * is_program_definition_header, and marks the `program` token
 * (Token.starts_program_definition), which the parser reads, so the
 * two agree on where a program definition starts.
 */

import { NAME_PART_SOURCE, NAME_START_SOURCE } from './stata-name';

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

// The first word after `program` (`.name` for a class member program,
// as in Stata's gsem_depvar_header.ado), or the quote of a macro that
// names the program (`` program `p' ``, `program $p`).
// A name may start with any letter Stata allows (`program π`), as the
// lexer reads it (see stata-name.ts).
const FIRST_WORD = new RegExp(
    `^[ \\t]+(\\.?${NAME_START_SOURCE}${NAME_PART_SOURCE}*|[\`$])`, 'u');
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
 * The offset of the newline that ends the line from `start` in
 * `source`, or -1 at the end of the source. A block comment still open
 * at a newline carries the line past it, as in Stata 18: `program /*
 * note` then `*\/ define foo` is `program define foo`. Nothing opens a
 * block comment once a `//` comment has started (see
 * LINE_COMMENT_START). One linear scan.
 */
function physical_line_end(source: string, start: number): number {
    let my_depth = 0;
    let i = start;
    while (i < source.length) {
        const my_char = source[i];
        if (my_char === '\n' && my_depth === 0) {
            return i;
        }
        if (my_char === '/' && source[i + 1] === '*') {
            my_depth++;
            i += 2;
        } else if (my_depth > 0 && my_char === '*' && source[i + 1] === '/') {
            my_depth--;
            i += 2;
        } else if (my_depth === 0 && my_char === '/' && source[i + 1] === '/' &&
                (i === start || source[i - 1] === ' ' || source[i - 1] === '\t')) {
            return source.indexOf('\n', i);
        } else {
            i++;
        }
    }
    return -1;
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
        const my_newline = physical_line_end(source, my_start);
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
 * The text of the statement from `start` in `source` (just past the
 * `program` word), with comments blanked: under `#delimit cr` the rest
 * of the logical line (see logical_line_text), under `#delimit ;` up to
 * the `;` that ends the statement, where a line break is a blank and a
 * `//` comment runs to the end of its line (`program // note` then
 * `define p;` defines p). One linear scan of the statement.
 */
export function program_header_text(
    source: string, start: number, is_semicolon: boolean
): string {
    if (!is_semicolon) {
        return logical_line_text(source, start);
    }
    const the_parts: string[] = [];
    let my_kept_from = start;
    let i = start;
    while (i < source.length && source[i] !== ';') {
        let my_comment_end = -1;
        if (source[i] === '/' && source[i + 1] === '*') {
            my_comment_end = block_comment_end(source, i);
        } else if (source[i] === '/' && source[i + 1] === '/' &&
                (i === start || /\s/.test(source[i - 1]))) {
            const my_newline = source.indexOf('\n', i);
            my_comment_end = my_newline === -1 ? source.length : my_newline;
        }
        if (my_comment_end === -1) {
            i++;
            continue;
        }
        the_parts.push(source.slice(my_kept_from, i), ' ');
        i = my_comment_end;
        my_kept_from = i;
    }
    the_parts.push(source.slice(my_kept_from, i));
    return the_parts.join('').replace(/\s/g, ' ');
}

/** Offset just past the block comment opening at `start` (nested). */
function block_comment_end(text: string, start: number): number {
    let my_depth = 0;
    let i = start;
    while (i < text.length) {
        if (text[i] === '/' && text[i + 1] === '*') {
            my_depth++;
            i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
            my_depth--;
            i += 2;
            if (my_depth === 0) {
                return i;
            }
        } else {
            i++;
        }
    }
    return text.length;
}

/**
 * Whether `program` followed by `text_after_program` (the rest of its
 * statement, see program_header_text) defines a program: a name or
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
    return my_comma === -1 || !has_plugin_option(my_code.slice(my_comma + 1));
}

/**
 * Whether the options `text` hold `plugin` as an option of its own,
 * outside any option's parentheses: `plugin using(x.dll)` does,
 * `properties(plugin)` doesn't (StataMP 18 defines a program with a
 * body there).
 */
function has_plugin_option(text: string): boolean {
    let my_depth = 0;
    let my_top_start = 0;
    const the_parts: string[] = [];
    for (let i = 0; i < text.length; i++) {
        const my_char = text[i];
        if (my_char === '(') {
            if (my_depth === 0) {
                the_parts.push(text.slice(my_top_start, i));
            }
            my_depth++;
        } else if (my_char === ')' && my_depth > 0) {
            my_depth--;
            if (my_depth === 0) {
                the_parts.push(' ');
                my_top_start = i + 1;
            }
        }
    }
    if (my_depth === 0) {
        the_parts.push(text.slice(my_top_start));
    }
    return PLUGIN_WORD.test(the_parts.join(''));
}
