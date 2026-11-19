/**
 * The characters of a Stata name (a variable, macro or program name),
 * as StataMP 18 reads them: a name starts with a letter or `_`, and
 * goes on with letters, digits and `_`. A letter may be any Unicode
 * letter (`program π`, `program café2`, `local café 5` all work), and
 * after the first character any Unicode digit or number, or a
 * combining mark, too (`program x½` works; `program ½x` is "invalid
 * name"). Exact case.
 */

// Non-ASCII letters, and what else a name may go on with.
const UNICODE_LETTER = /\p{L}/u;
const UNICODE_NAME_PART = /[\p{L}\p{M}\p{N}]/u;

/** Regex source for one character that can start a name. */
export const NAME_START_SOURCE = '[\\p{L}_]';

/** Regex source for one character that can go on a name. */
export const NAME_PART_SOURCE = '[\\p{L}\\p{M}\\p{N}_]';

/**
 * Whether the UTF-16 unit `char` is a letter: ASCII, or a Unicode
 * letter in the Basic Multilingual Plane.
 */
export function is_name_letter(char: string): boolean {
    if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')) {
        return true;
    }
    return char > '\x7f' && UNICODE_LETTER.test(char);
}

/**
 * Whether `char` can go on a name after its first character, other
 * than `_`: a letter, a digit, or a Unicode number or combining mark.
 */
export function is_name_letter_or_digit(char: string): boolean {
    if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
            (char >= '0' && char <= '9')) {
        return true;
    }
    return char > '\x7f' && UNICODE_NAME_PART.test(char);
}
