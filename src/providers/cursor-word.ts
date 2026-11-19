/**
 * Which characters a scan for the word under the cursor reads over:
 * those of a Stata name as the lexer reads it (see
 * `src/utils/stata-name.ts`), so the editor and the lexer agree on
 * where a name such as `café` ends.
 */
import { is_name_letter_or_digit } from '../utils/stata-name';

/** Whether `char` can be part of a name past its first character. */
export function is_name_char(char: string): boolean {
    return char === '_' || is_name_letter_or_digit(char);
}

/**
 * Whether `line[index]` is a name character, or `index` is past the
 * end of `line`: a backward scan for the word under a cursor past the
 * end of its line walks back to the line's last word, as the regex
 * test these scans replaced did (`/[a-zA-Z0-9_]/.test(undefined)`
 * is true: it tests the string "undefined").
 */
export function is_name_char_or_past_end(
    line: string,
    index: number
): boolean {
    return index >= line.length || is_name_char(line[index]);
}
