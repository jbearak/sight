/**
 * Formatting keeps the text of strings with embedded macros, and keeps
 * together the pieces of a word the lexer splits, such as a macro
 * concatenated with a name.
 *
 * The lexer splits `"n=`n'"` into the string pieces `"n=` and `"`
 * around a macro token, and `` `p'`i' `` into two macro tokens. Stata
 * splits arguments at whitespace, so a space printed between pieces
 * that touched in the source changes what Stata reads: `di "n= `n'"`
 * prints `n= 5`, and `` gen `p' `i' = 1 `` is an error.
 */

import { describe, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function format(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits[0]?.newText ?? source;
}

/** Sources that both formatter modes must leave unchanged. */
const THE_STRING_CASES: string[] = [
    // Command arguments
    'di "n=`n\'"',
    'di `"x=`n\'"\'',
    'di "`a\'`b\'"',
    'di "a=`a\'`b\'=c"',
    'di "a`n\'b"',
    'di "(`n\')"',
    'di "`n\'-1"',
    'di "=`n\'"',
    'di `"=`n\'"\'',
    'di "a,b=`n\'"',
    'di "x=`n\'" as text "y"',
    'di "x=`n\'", nonl',
    'file write fh "n=`n\'" _n',
    'mycmd "a=`b\'", opt("c=`d\'")',
    // Nested macros and macro expressions
    'di "x=`a`b\'\'"',
    'di "x=`=1+2\'"',
    'di "x=`=`n\'*2\'"',
    // Globals
    'di "x=$g"',
    'di "x=${g}"',
    'di "x=${g}y"',
    'di "x=$g+1"',
    'di `"x=${g}=`n\'"\'',
    // Quotes in compound strings, and escaped macro characters
    'di `"say "hi" n=`n\'"\'',
    'di `"a `"b=`n\'"\' c"\'',
    'di `"a\\"b=`n\'"\'',
    'di "a\\`n\'b"',
    'di "a=\\$g"',
    // Prefixes
    'quietly di "n=`n\'"',
    'cap noi di "n=`n\'"',
    'by g: di "n=`n\'"',
    // Options, `= exp`, and `if`
    'reg y x, title("n=`n\'")',
    'reg y x, title(`"n=`n\'"\')',
    'gen y = "n=`n\'"',
    'replace y = "n=`n\'" if x == "m=`m\'"',
    'assert s == "n=`n\'"',
    'if "n=`n\'" == "x" di "y=`y\'"',
    'di ("n=`n\'")',
    // Macro values
    'local x "a=`y\'"',
    'local y : di "n=`n\'"',
    // Loop lists and conditions
    'foreach x in "a=`b\'" "c" {\n    di "`x\'=`b\'"\n}',
    'if "n=`n\'" == "x" {\n    di 1\n}',
    'while "n=`n\'" != "x" {\n    di 1\n}',
    'program define p\n    args a b\n    di "`a\'=`b\'"\nend',
];

/** Words the lexer splits that must stay one word. */
const THE_CONCATENATION_CASES: string[] = [
    'gen `p\'`i\' = 1',
    'gen x`i\' = 2',
    'gen `a\'_b = 3',
    'gen ${g}x = 4',
    'keep x$g',
    'keep pre`i\'post `a\'$b',
    'replace `p\'`i\' = 1 if `a\'_b == 2',
    // Expressions, options, and loop lists
    'gen y = `a\'_b + x`i\' * ${g}x',
    'reg y x if `a\'_b == 1, title(`a\'_b)',
    'local z = `n\'`m\' + 1',
    'by `a\'_g: di 1',
    'foreach v of varlist x`i\' `a\'_b {\n    di "`v\'"\n}',
    'program define p\n    syntax varlist [, title(string)]\n' +
        '    args a`i\' b\n    di "`title\'=`a`i\'\'"\nend',
];

/** Arguments separated by a space in the source keep it. */
const THE_SEPARATED_CASES: string[] = [
    'di x "`n\'"',
    'di "a=`n\'" "b"',
    'di "a=`n\'" "b=`m\'"',
    'di `"a=`n\'"\' `"b"\'',
    'mycmd `a\' `b\' "`c\'" $g ${h}',
];

describe('formatting strings with embedded macros', () => {
    for (const my_source of THE_STRING_CASES) {
        for_each_formatter_mode(`keeps ${JSON.stringify(my_source)}`, (mode) => {
            const source = `${my_source}\n`;
            const once = format(source, mode);
            expect(once).toBe(source);
            expect(format(once, mode)).toBe(once);
        });
    }
});

describe('formatting macro concatenation', () => {
    for (const my_source of THE_CONCATENATION_CASES) {
        for_each_formatter_mode(`keeps ${JSON.stringify(my_source)}`, (mode) => {
            const source = `${my_source}\n`;
            const once = format(source, mode);
            expect(once).toBe(source);
            expect(format(once, mode)).toBe(once);
        });
    }
});

describe('formatting separate string and macro arguments', () => {
    for (const my_source of THE_SEPARATED_CASES) {
        for_each_formatter_mode(`keeps ${JSON.stringify(my_source)}`, (mode) => {
            const source = `${my_source}\n`;
            const once = format(source, mode);
            expect(once).toBe(source);
            expect(format(once, mode)).toBe(once);
        });
    }
});
