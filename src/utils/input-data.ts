/**
 * Where the data after an `input` statement ends, judged from the
 * variables the statement declares.
 *
 * StataMP 18 reads the lines (under `#delimit ;`, the `;`-ended
 * records) after `input` as data up to one whose first word is `end`,
 * unless it stops sooner: once it has filled the observations of a
 * dataset that already has some (`set obs 1` then `input x`), it
 * stops, and the lines after are commands. Sight cannot know the
 * number of observations, so it reads what the `input` statement
 * declares instead:
 *
 * - A row is consistent with the declaration when each numeric
 *   variable among the first n fields (n declared variables) has a
 *   field that Stata reads as a number. Extra fields are ignored
 *   (`1 2` under `input x` gives x = 1), a missing string field is
 *   blank, and a blank row is skipped, as in Stata.
 * - A row that is not consistent makes Stata print "cannot be read as
 *   a number" and drop it, which no working do-file relies on, so
 *   Sight reads the data as having ended before it: `input score`,
 *   `10`, `local label score` is one row of data and then a `local`.
 * - A string variable takes any field, so `program demo` under
 *   `input str12 a str12 b` is data, as it is in Stata.
 * - A row with more fields than declared variables is not data
 *   either, and the data ends before it (`is_input_data_row`). Stata
 *   would ignore the extra fields, but rows of real data don't have
 *   them, while the code after an `input` without `end` usually
 *   does: under `input str5 city`, `Paris` is data and the
 *   `local n = _N` after it is code. A row with at most as many
 *   fields as variables, and a number for each numeric one, is still
 *   data, whatever it looks like.
 * - When the declaration can't be read (no varlist, a macro, a
 *   range), every row is data up to `end`.
 *
 * Settled in StataMP 18: a field is a run of non-blanks; `,` and `/`
 * end a field and are each a field of their own (`3,4` under
 * `input x y` gives "',' cannot be read as a number", and `x/y z`
 * under three string variables gives `x`, `/`, `y`); a double-quoted or
 * compound-quoted field is one field and never a number (`"5"` is
 * rejected for a numeric variable); `//` and block comments are
 * blanks, and `///` joins the next line to the row; under
 * `#delimit ;` a quoted field may span lines (the record ends at the
 * `;` after its closing quote); a numeric variable with a value label
 * (`x:yn` with option `label`) takes any text.
 */

/** How a declared variable reads a field: as a number, or any text. */
export type InputFieldKind = 'numeric' | 'text';

// The storage types `input` takes before a variable name.
const STORAGE_TYPE = /^(?:byte|int|long|float|double|str[1-9][0-9]*|strL)$/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A declaration piece: a word (with an optional `:label`), or a paren.
const DECLARATION_PIECE = /[()]|[^\s()]+/g;
// What Stata 18 reads as a number in `input` data: decimal (with `d`
// or `e` exponents), its own hexadecimal form (`1.0X+003`), and the
// missing values `.` and `.a` to `.z`.
const STATA_NUMBER =
    /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?|[+-]?\d\.[0-9a-fA-F]*[xX][+-][0-9a-fA-F]+|\.[a-z]?)$/;

/**
 * The kind of each variable that the text after an `input` command
 * word declares, in order, or null when it can't be read (no varlist,
 * a macro, a range or wildcard, an unbalanced paren). `text` may hold
 * comments and `///` joins; options after a comma are ignored.
 */
export function input_declaration_fields(text: string): InputFieldKind[] | null {
    const my_code = strip_comments(text);
    const my_comma = my_code.indexOf(',');
    const my_varlist = my_comma === -1 ? my_code : my_code.slice(0, my_comma);
    const the_pieces = my_varlist.match(DECLARATION_PIECE) ?? [];
    const the_fields: InputFieldKind[] = [];
    let i = 0;
    while (i < the_pieces.length) {
        const my_piece = the_pieces[i];
        let my_type: string | null = null;
        if (STORAGE_TYPE.test(my_piece) && i + 1 < the_pieces.length) {
            my_type = my_piece;
            i++;
        }
        const the_names: string[] = [];
        if (my_type !== null && the_pieces[i] === '(') {
            i++;
            while (i < the_pieces.length && the_pieces[i] !== ')') {
                the_names.push(the_pieces[i]);
                i++;
            }
            if (i >= the_pieces.length || the_names.length === 0) {
                return null;
            }
            i++; // the `)`
        } else {
            the_names.push(the_pieces[i]);
            i++;
        }
        for (const my_name of the_names) {
            const my_kind = declared_kind(my_name, my_type);
            if (my_kind === null) {
                return null;
            }
            the_fields.push(my_kind);
        }
    }
    return the_fields.length === 0 ? null : the_fields;
}

/** How `name` (perhaps `name:label`) of storage type `type` reads. */
function declared_kind(name: string, type: string | null): InputFieldKind | null {
    const my_colon = name.indexOf(':');
    const my_variable = my_colon === -1 ? name : name.slice(0, my_colon);
    if (!VARIABLE_NAME.test(my_variable) || STORAGE_TYPE.test(my_variable)) {
        return null;
    }
    if (my_colon !== -1) {
        // A value label lets a numeric variable take its label text.
        return LABEL_NAME.test(name.slice(my_colon + 1)) ? 'text' : null;
    }
    return type !== null && type.startsWith('str') ? 'text' : 'numeric';
}

/**
 * Whether Sight reads the data row `row` (as for
 * `is_consistent_input_row`) as data under the declared `fields`: it
 * is consistent with them, and has no more fields than they do.
 */
export function is_input_data_row(
    row: string, fields: readonly InputFieldKind[]
): boolean {
    const the_values = row_fields(strip_comments(row), fields.length + 1);
    return the_values.length <= fields.length &&
        values_fit_fields(the_values, fields);
}

/**
 * Whether the data row `row` (one line, with its `///` joins, or one
 * `;`-ended record, without the terminator) is consistent with the
 * declared `fields` (see the module comment): Stata reads it without
 * complaint, ignoring any extra fields.
 */
export function is_consistent_input_row(
    row: string, fields: readonly InputFieldKind[]
): boolean {
    return values_fit_fields(
        row_fields(strip_comments(row), fields.length), fields);
}

/**
 * Whether the first fields of a row, `values`, give each numeric
 * variable of `fields` a number (or are none: a blank row).
 */
function values_fit_fields(
    values: readonly RowField[], fields: readonly InputFieldKind[]
): boolean {
    const the_values = values;
    if (the_values.length === 0) {
        return true;
    }
    for (let i = 0; i < fields.length; i++) {
        if (fields[i] !== 'numeric') {
            continue;
        }
        const my_value = the_values[i];
        if (my_value === undefined || my_value.quoted ||
                !STATA_NUMBER.test(my_value.text)) {
            return false;
        }
    }
    return true;
}

interface RowField {
    text: string;
    quoted: boolean;
}

/** Up to `count` fields of the comment-free row `row`. */
function row_fields(row: string, count: number): RowField[] {
    const the_fields: RowField[] = [];
    let i = 0;
    while (i < row.length && the_fields.length < count) {
        const my_char = row[i];
        if (my_char === ' ' || my_char === '\t' || my_char === '\r' ||
                my_char === '\n') {
            i++;
            continue;
        }
        if (my_char === ',' || my_char === '/') {
            the_fields.push({ text: my_char, quoted: false });
            i++;
            continue;
        }
        const my_close = my_char === '"' ? '"'
            : my_char === '`' && row[i + 1] === '"' ? '"\'' : null;
        if (my_close !== null) {
            const my_start = i + (my_close === '"' ? 1 : 2);
            const my_end = row.indexOf(my_close, my_start);
            const my_stop = my_end === -1 ? row.length : my_end;
            the_fields.push({ text: row.slice(my_start, my_stop), quoted: true });
            i = my_end === -1 ? row.length : my_stop + my_close.length;
            continue;
        }
        let my_end = i;
        while (my_end < row.length && !/[\s,/]/.test(row[my_end])) {
            my_end++;
        }
        the_fields.push({ text: row.slice(i, my_end), quoted: false });
        i = my_end;
    }
    return the_fields;
}

/**
 * `text` with block comments (nested, as in Stata) and `//` comments
 * (at the start or after a blank, to the end of their line, which a
 * `///` joins to the next) replaced by a blank. Quoted text is kept.
 */
function strip_comments(text: string): string {
    const the_parts: string[] = [];
    let my_kept_from = 0;
    let i = 0;
    while (i < text.length) {
        const my_char = text[i];
        if (my_char === '"') {
            const my_end = text.indexOf('"', i + 1);
            i = my_end === -1 ? text.length : my_end + 1;
            continue;
        }
        let my_comment_end = -1;
        if (my_char === '/' && text[i + 1] === '*') {
            my_comment_end = block_comment_end(text, i);
        } else if (my_char === '/' && text[i + 1] === '/' &&
                (i === 0 || /\s/.test(text[i - 1]))) {
            const my_newline = text.indexOf('\n', i);
            my_comment_end = my_newline === -1 ? text.length : my_newline;
            if (text.startsWith('///', i) && my_newline !== -1) {
                my_comment_end = my_newline + 1;
            }
        }
        if (my_comment_end === -1) {
            i++;
            continue;
        }
        the_parts.push(text.slice(my_kept_from, i), ' ');
        i = my_comment_end;
        my_kept_from = i;
    }
    the_parts.push(text.slice(my_kept_from));
    return the_parts.join('');
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
 * Where the quotes in one source have been found to have no closing
 * quote: for a `"` and for a compound `"'`, the least offset from
 * which a search found none, so no later search from there or beyond
 * scans the rest of the source again. Share one per source.
 */
export interface InputQuoteScan {
    no_close_from: { simple: number; compound: number };
}

/** A fresh `InputQuoteScan` for one source. */
export function create_input_quote_scan(): InputQuoteScan {
    return { no_close_from: { simple: Infinity, compound: Infinity } };
}

/**
 * The offset of the terminator that ends the data row starting at
 * `start` in `source` (a newline, or under `#delimit ;` a `;`), or the
 * source's length if none does. A `///` comment joins the next line to
 * the row, as does a block comment open at a newline; a `;` or `///`
 * inside a double-quoted or compound-quoted field is text (StataMP 18
 * reads the record `"a;end";` as the value `a;end`), except that under
 * `#delimit ;` a `;` ends the record even inside a compound quote
 * (StataMP 18 reads `` `"a;b"'; `` as two records). Under
 * `#delimit ;` a quoted field runs on across lines to its closing
 * quote, as in Stata (`"Long` then `label" 42;` is one record); under
 * `#delimit cr` it ends at the end of its line. A quote that no
 * closing quote follows ends at the end of its line (Stata would read
 * to the end of the file). Linear in the source over all the rows of
 * one source when they share `quote_scan`.
 */
export function input_row_end(
    source: string, start: number, is_semicolon: boolean,
    quote_scan: InputQuoteScan = create_input_quote_scan()
): number {
    let i = start;
    while (i < source.length) {
        const my_char = source[i];
        if (my_char === '\n' && !is_semicolon) {
            return i;
        }
        if (my_char === ';' && is_semicolon) {
            return i;
        }
        if (my_char === '"' || (my_char === '`' && source[i + 1] === '"')) {
            i = quoted_field_end(source, i, is_semicolon, quote_scan);
            continue;
        }
        if (my_char === '/' && source[i + 1] === '*') {
            i = block_comment_end(source, i);
            continue;
        }
        if (my_char === '/' && source[i + 1] === '/' &&
                (i === start || /\s/.test(source[i - 1]))) {
            const my_newline = source.indexOf('\n', i);
            if (my_newline === -1) {
                return source.length;
            }
            // `///` joins the next line; under `#delimit ;` every line
            // break is a blank, so the record goes on either way.
            i = source.startsWith('///', i) || is_semicolon
                ? my_newline + 1
                : my_newline;
            continue;
        }
        i++;
    }
    return source.length;
}

/**
 * The offset just past the quoted field that opens at `start` (a `"`,
 * or the `` `" `` of a compound quote) in `source`: past its closing
 * quote; at the `;` that ends the record inside a compound quote under
 * `#delimit ;`; or, when it has none (under `#delimit cr`, none on its
 * line), at the end of its line. Reads each character at most once, apart
 * from one scan to the end of the source per kind of quote, which
 * `quote_scan` remembers.
 */
function quoted_field_end(
    source: string, start: number, is_semicolon: boolean,
    quote_scan: InputQuoteScan
): number {
    const is_compound = source[start] === '`';
    const my_kind = is_compound ? 'compound' : 'simple';
    let i = start + (is_compound ? 2 : 1);
    let my_newline = -1;
    while (i < source.length && i < quote_scan.no_close_from[my_kind]) {
        const my_char = source[i];
        if (my_char === '"' && (!is_compound || source[i + 1] === '\'')) {
            return i + (is_compound ? 2 : 1);
        }
        if (my_char === ';' && is_compound && is_semicolon) {
            return i;
        }
        if (my_char === '\n') {
            if (!is_semicolon) {
                return i;
            }
            if (my_newline === -1) {
                my_newline = i;
            }
        }
        i++;
    }
    // No closing quote: from here on, none will be found.
    quote_scan.no_close_from[my_kind] = Math.min(
        quote_scan.no_close_from[my_kind], start);
    if (my_newline === -1) {
        my_newline = source.indexOf('\n', start);
    }
    return my_newline === -1 ? source.length : my_newline;
}

/**
 * Whether the data row starting at `start` (just after the terminator
 * of the row before) has `end` as its first word: blanks (under
 * `#delimit ;`, line breaks too), then `end` not followed by a word
 * character or `.`.
 */
export function is_input_end_row(
    source: string, start: number, is_semicolon: boolean
): boolean {
    let i = start;
    while (source[i] === ' ' || source[i] === '\t' || source[i] === '\r' ||
            (is_semicolon && source[i] === '\n')) {
        i++;
    }
    return source.startsWith('end', i) &&
        !/[A-Za-z0-9_.]/.test(source[i + 3] ?? '');
}
