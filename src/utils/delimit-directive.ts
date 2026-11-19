/**
 * Spelling of the `#delimit` directive. Stata 18 accepts any
 * abbreviation down to `#d` (`#d ;`, `#del cr`), with exact case, so
 * `#D ;` and `#define ;` are not directives.
 */

// The keyword at the start of the text: `#d` through `#delimit`, as a
// whole word, so `#delimit;` matches but `#define` doesn't.
const DELIMIT_KEYWORD_SOURCE =
    '#d(?:e(?:l(?:i(?:m(?:i(?:t)?)?)?)?)?)?(?![A-Za-z0-9_])';
const DELIMIT_KEYWORD_PATTERN = new RegExp(`^${DELIMIT_KEYWORD_SOURCE}`);
const DELIMIT_KEYWORD_STICKY = new RegExp(DELIMIT_KEYWORD_SOURCE, 'y');
// `#delimit ;`, with the `;` as the first thing after the keyword.
const DELIMIT_SEMICOLON_PATTERN =
    new RegExp(`^${DELIMIT_KEYWORD_SOURCE}[ \\t]*;`);

/**
 * The length of the `#delimit` keyword (or an abbreviation) that
 * starts at `offset` in `source`, or 0 if there is none.
 */
export function delimit_keyword_length(
    source: string, offset: number
): number {
    DELIMIT_KEYWORD_STICKY.lastIndex = offset;
    const my_match = DELIMIT_KEYWORD_STICKY.exec(source);
    return my_match === null ? 0 : my_match[0].length;
}

/** The keyword as written at the start of a directive's text. */
export function delimit_keyword(text: string): string {
    return DELIMIT_KEYWORD_PATTERN.exec(text)?.[0] ?? '#delimit';
}

/** The delimiter mode a `#delimit` directive's text sets. */
export function delimit_text_mode(text: string): 'cr' | 'semicolon' {
    return DELIMIT_SEMICOLON_PATTERN.test(text) ? 'semicolon' : 'cr';
}
