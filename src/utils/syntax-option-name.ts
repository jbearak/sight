/**
 * How Stata reads an option name declared in `syntax`.
 *
 * The leading capitals are the minimum abbreviation and are typed in
 * lowercase; the rest of the name is typed as written. An option
 * without an argument whose name starts with `no` is negatable: the
 * `no` comes first in every spelling, and the local is named without
 * it. Checked in StataMP 18:
 *
 *     declared      typed as             local
 *     Detail        d … detail           detail
 *     CACHE         cache                cache
 *     cache         cache                cache
 *     MyOption      m … myOption         myOption
 *     myOPTion      myOPTion             myOPTion
 *     noCONStant    nocons … noconstant  constant
 *     nolog         nolog                log
 *     NOLOg         nolo … nolog         nolog
 *     noABc(str)    noABc                noABc
 */

/** The spellings and local of one `syntax` option. */
export interface SyntaxOptionSpelling {
    /** The option typed in full. */
    full: string;
    /** The shortest spelling Stata accepts; every longer prefix of
     *  `full` is accepted too. */
    min_abbreviation: string;
    /** The local macro `syntax` stores the option in. */
    local_name: string;
}

const UPPERCASE_RE = /[A-Z]/;

/** How Stata reads `syntax` option `name`. */
export function syntax_option_spelling(
    name: string,
    has_argument: boolean
): SyntaxOptionSpelling {
    const prefix = !has_argument && name.length > 2 && name.startsWith('no')
        ? 'no'
        : '';
    const rest = name.slice(prefix.length);
    let capitals = 0;
    while (capitals < rest.length && UPPERCASE_RE.test(rest[capitals])) {
        capitals++;
    }
    const head = rest.slice(0, capitals).toLowerCase();
    const local_name = head + rest.slice(capitals);
    const full = prefix + local_name;
    return {
        full,
        min_abbreviation: capitals > 0 ? prefix + head : full,
        local_name,
    };
}
