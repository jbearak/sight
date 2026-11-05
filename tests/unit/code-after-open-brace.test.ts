/**
 * Code after a `{` on its line. Stata 18 (checked on StataMP 18) runs
 * an `if` block and ignores that code, but stops at any other block
 * with "code follows on the same line as open brace" (r(198)).
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ParseErrorCode } from '../../src/types';
import { parser_error_severity } from '../../src/utils/syntax-error-severity';

function brace_codes(source: string): string[] {
    const { tokens } = new StataLexer().tokenize(source);
    return new StataParser().parse(tokens).errors
        .map((my_error) => my_error.code)
        .filter((my_code): my_code is ParseErrorCode =>
            my_code === ParseErrorCode.CODE_AFTER_OPEN_BRACE ||
            my_code === ParseErrorCode.CODE_FOLLOWS_OPEN_BRACE);
}

function block(header: string): string {
    return `${header} di "after"\n    di "body"\n}\n`;
}

describe('code after an open brace', () => {
    it('warns after an if header, which Stata runs', () => {
        for (const my_source of [
            block('if 1 {'),
            block('quietly if 1 {'),
            block('capture if 1 {'),
            block('version 18: if 1 {'),
            'if 0 {\n}\nelse if 1 { di "after"\n    di "body"\n}\n',
            'foreach x in a {\n    if 1 { di "after"\n        di "body"\n    }\n}\n',
        ]) {
            expect({ my_source, codes: brace_codes(my_source) })
                .toEqual({ my_source, codes: [ParseErrorCode.CODE_AFTER_OPEN_BRACE] });
        }
    });

    it('is an error after any other header, where Stata stops', () => {
        for (const my_source of [
            block('{'),
            block('quietly {'),
            block('noisily {'),
            block('capture {'),
            block('cap noi {'),
            block('version 18: {'),
            block('foreach x in a {'),
            block('forvalues i = 1/2 {'),
            block('while 0 {'),
            block('frame default {'),
            block('capture foreach x in a {'),
            block('qui foreach x in a {'),
            'if 0 {\n}\nelse { di "after"\n    di "body"\n}\n',
        ]) {
            expect({ my_source, codes: brace_codes(my_source) })
                .toEqual({ my_source, codes: [ParseErrorCode.CODE_FOLLOWS_OPEN_BRACE] });
        }
    });

    it('reports nothing for a comment after the brace', () => {
        expect(brace_codes('quietly {  /* c */\n    di 1\n}\nif 1 {  // c\n    di 1\n}\n'))
            .toEqual([]);
    });

    it('gives each code its severity', () => {
        expect(parser_error_severity(ParseErrorCode.CODE_AFTER_OPEN_BRACE)).toBe('warning');
        expect(parser_error_severity(ParseErrorCode.CODE_FOLLOWS_OPEN_BRACE)).toBe('error');
    });
});
