/**
 * Under `#delimit ;` a line break doesn't end a statement, so the `{`
 * of a block can be on the line after its header. StataMP 18 runs
 *
 *     #delimit ;
 *     if 1
 *     {;
 *     di "IN";
 *     };
 *
 * and the same for `else`, `foreach`, `while` and `capture noisily`.
 * Sight reported OPEN_BRACE_ALONE there, comparing physical lines. In
 * cr mode Stata stops at `if 1` alone ("{ required", r(100)), so the
 * error stays.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ParseErrorCode } from '../../src/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    mode_specific_assertion,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

function error_codes(my_source: string): ParseErrorCode[] {
    return new StataParser()
        .parse(new StataLexer().tokenize(my_source).tokens)
        .errors.map((my_error) => my_error.code);
}

const SEMICOLON_SOURCES: Array<[string, string]> = [
    ['if', '#delimit ;\nif 1\n{;\n    di "IN";\n};\n#delimit cr\n'],
    ['if and else', '#delimit ;\nif 0\n{;\n    di "IN";\n};\nelse\n{;\n    di "ELSE";\n};\n#delimit cr\n'],
    ['foreach', '#delimit ;\nforeach i in 1 2\n{;\n    di "`i\'";\n};\n#delimit cr\n'],
    ['while', '#delimit ;\nwhile `i\' < 2\n{;\n    local i = `i\' + 1;\n};\n#delimit cr\n'],
    ['capture noisily', '#delimit ;\ncapture noisily\n{;\n    di "CAP";\n};\n#delimit cr\n'],
];

describe('open brace on the line after its header under #delimit ;', () => {
    for (const [my_name, my_source] of SEMICOLON_SOURCES) {
        it(`accepts ${my_name}`, () => {
            expect(error_codes(my_source)).toEqual([]);
        });
    }

    it('still reports an open brace alone in cr mode', () => {
        expect(error_codes('if 1\n{\n    di 1\n}\n')).toContain(ParseErrorCode.OPEN_BRACE_ALONE);
    });
});

describe('open brace on the line after its header under #delimit ;: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    for_each_formatter_mode('indents the body and is idempotent', (my_mode) => {
        const my_source = '#delimit ;\nif 1\n{;\ndi "IN";\n};\n#delimit cr\n';
        const my_once = format_text(my_source, my_mode);
        // AST formatting joins the `{` to the header; the source-preserving
        // formatter leaves it where it is.
        mode_specific_assertion(my_mode, {
            'ast': () => expect(my_once)
                .toBe('#delimit ;\nif 1 {;\n    di "IN";\n};\n#delimit cr\n'),
            'source-preserving': () => expect(my_once)
                .toBe('#delimit ;\nif 1\n{;\n    di "IN";\n};\n#delimit cr\n'),
        });
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });
});
