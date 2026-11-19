/**
 * Issue #62: a name set by `tempfile` was reported as an undefined
 * local when the `tempfile` sat in a brace block, a one-line `if`,
 * a `///` continuation, or a `#delimit ;` section. In each snippet
 * below the name is set before `save` uses it, so none should warn.
 */

import { describe, expect, it } from 'bun:test';
import { SemanticAnalyzer } from '../src/analyzer';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { StataDiagnosticCode } from '../src/types';

function undefined_macros(source: string): string[] {
    const { tokens } = new StataLexer().tokenize(source);
    const { ast } = new StataParser().parse(tokens);
    const result = new SemanticAnalyzer().analyze(
        ast,
        'file:///test.do',
        undefined,
        { undefined_macro_enabled: true },
        tokens
    );
    return result.diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => `${d.range.start.line}: ${d.message}`);
}

const SAVE = 'save "`filename\'"';

const THE_CASES: Array<[string, string]> = [
    ['the two lines alone', `tempfile filename\n${SAVE}\n`],
    [
        'both lines inside quietly { }',
        `quietly {\n    tempfile filename\n    ${SAVE}\n}\n`,
    ],
    [
        'tempfile inside quietly { }, save after it',
        `quietly {\n    tempfile filename\n}\n${SAVE}\n`,
    ],
    [
        'both lines inside capture { }',
        `capture {\n    tempfile filename\n    ${SAVE}\n}\n`,
    ],
    [
        'tempfile inside quietly { } in a program',
        'program foo\n    quietly {\n        tempfile filename\n'
            + `    }\n    ${SAVE}\nend\n`,
    ],
    [
        'a /// continuation in the declaration',
        `tempfile a ///\n    filename\n${SAVE}\n`,
    ],
    [
        'under #delimit ;',
        `#delimit ;\ntempfile filename;\n${SAVE};\n#delimit cr\n`,
    ],
    ['a one-line if', `if 1 tempfile filename\n${SAVE}\n`],
    [
        'a one-line if with an expression',
        `if c(stata_version) >= 14 tempfile filename\n${SAVE}\n`,
    ],
];

describe('issue #62: tempfile names are defined locals', () => {
    for (const [my_label, my_source] of THE_CASES) {
        it(`does not warn: ${my_label}`, () => {
            expect(undefined_macros(my_source)).toEqual([]);
        });
    }

    it('still warns when the name was never declared', () => {
        expect(undefined_macros(
            `quietly {\n    tempfile other\n}\n${SAVE}\n`
        )).toEqual(['3: `filename\' is not defined']);
    });
});
