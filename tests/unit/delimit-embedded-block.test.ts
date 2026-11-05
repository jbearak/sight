/**
 * Mata and python blocks under `#delimit ;`, as StataMP 18 reads them:
 *
 * - `mata;` and `mata:;` open a block. Mata reads it line by line,
 *   with its own `;` statements, so `end;` and a bare `end` both close
 *   it (an indented `end;` too), as without `#delimit ;`.
 * - `python;` and `python:;` open a block that Stata hands to Python as
 *   `;`-ended statements, joining lines until each `;`. The block ends
 *   at a statement that is exactly `end`: `end;`, `end ;`, or `end`
 *   with its `;` on the next line, starting in column 0 right after the
 *   previous `;`. An indented `end;`, `print(1); end;` on one line, a
 *   bare `end` (joined to the next line) and `end foo;` stay Python.
 *
 * The lexer and the context tracker must agree, so the Stata code after
 * the block is formatted and diagnosed as Stata.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { ContextTracker } from '../../src/context-tracker';
import { LanguageContext } from '../../src/context-tracker/types';
import { StataDiagnosticCode } from '../../src/types';
import { CodeFormatter } from '../../src/providers/formatter';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
} from '../property/helpers/formatter-test-utils';

interface DelimitCase {
    name: string;
    // Lines after `#delimit ;`
    lines: string[];
    // Line (0-based, counting `#delimit ;` as 0) of the block's `end`
    end_line: number;
}

const MATA_CASES: DelimitCase[] = [
    { name: 'mata; ... end;', lines: ['mata;', 'x = 1;', 'end;', 'di 1;'], end_line: 3 },
    { name: 'mata; ... bare end', lines: ['mata;', 'x = 1;', 'end', 'di 1;'], end_line: 3 },
    { name: 'mata ; ... end ;', lines: ['mata ;', 'x = 1;', 'end ;', 'di 1;'], end_line: 3 },
    { name: 'indented end;', lines: ['mata;', 'x = 1;', '   end;', 'di 1;'], end_line: 3 },
    { name: 'mata:; ... end;', lines: ['mata:;', 'x = 1;', 'end;', 'di 1;'], end_line: 3 },
    {
        name: 'a statement over two lines',
        lines: ['mata;', 'x = 1 +', '2;', 'end;', 'di 1;'],
        end_line: 4,
    },
];

const PYTHON_CASES: DelimitCase[] = [
    { name: 'python; ... end;', lines: ['python;', 'print(1);', 'end;', 'di 1;'], end_line: 3 },
    { name: 'end ;', lines: ['python;', 'print(1);', 'end ;', 'di 1;'], end_line: 3 },
    {
        name: 'end with its ; on the next line',
        lines: ['python;', 'print(1);', 'end', ';', 'di 1;'],
        end_line: 3,
    },
    { name: 'python:; ... end;', lines: ['python:;', 'print(1);', 'end;', 'di 1;'], end_line: 3 },
    {
        name: 'python:; with block content on its line',
        lines: ['python:;print(1);', 'end;', 'di 1;'],
        end_line: 2,
    },
    {
        name: 'not an indented end;',
        lines: ['python;', 'print(1);', '  end;', 'print(2);', 'end;', 'di 1;'],
        end_line: 5,
    },
    {
        name: 'not end; after another statement on its line',
        lines: ['python;', 'print(1); end;', 'print(2);', 'end;', 'di 1;'],
        end_line: 4,
    },
    {
        name: 'not a bare end joined to the next line',
        lines: ['python;', 'print(1);', 'end', 'print(2);', 'end;', 'di 1;'],
        end_line: 5,
    },
    {
        name: 'not end foo;',
        lines: ['python;', 'print(1);', 'end foo;', 'print(2);', 'end;', 'di 1;'],
        end_line: 5,
    },
];

function source_of(my_case: DelimitCase): string {
    return ['#delimit ;', ...my_case.lines].join('\n') + '\n';
}

describe('embedded blocks under #delimit ;', () => {
    for (const [my_language, the_cases] of [
        ['mata', MATA_CASES],
        ['python', PYTHON_CASES],
    ] as const) {
        for (const my_case of the_cases) {
            it(`${my_language}: ${my_case.name}`, () => {
                const my_source = source_of(my_case);
                const the_tokens = new StataLexer().tokenize(my_source).tokens;
                const my_end_type = my_language === 'mata' ? 'END_MATA' : 'END_PYTHON';
                const the_end_lines = the_tokens
                    .filter((my_token) => my_token.type === my_end_type)
                    .map((my_token) => my_token.range.start.line);
                expect(the_end_lines).toEqual([my_case.end_line]);

                const my_tracker = new ContextTracker();
                my_tracker.initialize_from_tokens(the_tokens, my_source);
                const the_blocks = my_tracker
                    .get_all_context_ranges()
                    .filter((my_range) => !my_range.is_single_line);
                expect(the_blocks).toHaveLength(1);
                expect(the_blocks[0]?.end_delimiter?.range.start.line)
                    .toBe(my_case.end_line);
                expect(my_tracker.validate_context_structure()).toEqual([]);
                // The `di 1;` after the block is Stata
                expect(
                    my_tracker.get_context_at_position({
                        line: my_case.lines.indexOf('di 1;') + 1,
                        character: 0,
                    })
                ).toBe(LanguageContext.STATA);
            });
        }
    }

    it('diagnoses the Stata code after the block', () => {
        for (const my_opener of ['mata;', 'python;']) {
            const my_source =
                `#delimit ;\n${my_opener}\nx = 1;\nend;\ndisplay "\`nope'";\n`;
            const the_tokens = new StataLexer().tokenize(my_source).tokens;
            const my_ast = new StataParser().parse(the_tokens).ast;
            const my_result = new SemanticAnalyzer().analyze(
                my_ast,
                'file:///test.do',
                undefined,
                { undefined_macro_enabled: true },
                the_tokens
            );
            const the_undefined = my_result.diagnostics
                .filter((my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO)
                .map((my_diag) => my_diag.symbol_name);
            expect(the_undefined).toEqual(['nope']);
        }
    });
});

describe('embedded blocks under #delimit ;: formatting', () => {
    const formatter = new CodeFormatter();

    function format_text(my_source: string, my_mode: 'source-preserving' | 'ast'): string {
        const the_edits = formatter.format(
            create_document_state(my_source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(my_mode)
        );
        return the_edits.length > 0 ? the_edits[0].newText : my_source;
    }

    for_each_formatter_mode(
        'formats the Stata code after mata; and python; blocks',
        (my_mode) => {
            const my_source = [
                '#delimit ;',
                'mata;',
                'x = 1;',
                'end;',
                '    display 1;',
                'python;',
                'print(1);',
                'end;',
                '    display 2;',
                '#delimit cr',
                '    display 3',
                '',
            ].join('\n');
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe([
                '#delimit ;',
                'mata;',
                'x = 1;',
                'end;',
                'display 1;',
                'python;',
                'print(1);',
                'end;',
                'display 2;',
                '#delimit cr',
                'display 3',
                '',
            ].join('\n'));
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );

    for_each_formatter_mode(
        'keeps mata:; as written',
        (my_mode) => {
            const my_source = '#delimit ;\nmata:;\nx = 1;\nend;\ndisplay 1;\n';
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        }
    );
});
