/**
 * Where `input` data without its own `end` stops, and how the
 * formatters treat its rows, each settled in StataMP 18:
 *
 * - Inside a `{ }` block, a row whose first code is `}` closes a block
 *   opened before the `input`, so the data ends before it, even when
 *   an unrelated `end` follows (`set obs 1`, `if _N == 1 {`,
 *   `input score`, `10`, `}`: one row of data).
 * - The look-ahead for the `end` that might close the data counts a
 *   block opened behind a prefix (`quietly input price`), but not
 *   `by g: input`, which reads no data ("input may not be combined
 *   with by").
 * - Neither formatter changes a data row, with or without `end`.
 */

import { describe, expect, it } from 'bun:test';
import type * as vscode from 'vscode';
import { find_code_to_send } from '../../client/src/send-to-stata/statement-detector';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { CommandNode, StataNode } from '../../src/types';
import { create_mock_document } from '../property/helpers';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(my_source: string) {
    return new StataParser().parse(new StataLexer().tokenize(my_source).tokens);
}

/** The `input` commands of `my_source`, at any depth, in order. */
function input_commands(my_source: string): CommandNode[] {
    const the_inputs: CommandNode[] = [];
    const visit = (the_nodes: readonly StataNode[]) => {
        for (const my_node of the_nodes) {
            if (my_node.type === 'command' && my_node.input_data !== undefined) {
                the_inputs.push(my_node);
            }
            if ('body' in my_node && Array.isArray(my_node.body)) {
                visit(my_node.body as StataNode[]);
            }
        }
    };
    visit(parse(my_source).ast.nodes);
    return the_inputs;
}

/** Each `input`'s data, and whether it has its own `end`. */
function input_data_of(my_source: string): Array<[string, boolean]> {
    return input_commands(my_source).map((my_input) => [
        my_input.input_data?.content ?? '',
        my_input.input_data?.has_end !== false,
    ]);
}

function format_text(my_source: string, my_mode: FormatterMode): string {
    const the_edits = new CodeFormatter().format(
        create_document_state(my_source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(my_mode)
    );
    return the_edits.length > 0 ? the_edits[0].newText : my_source;
}

/** Format twice; the first pass must give `expected`, the second no change. */
function expect_formats_to(my_source: string, my_mode: FormatterMode, expected: string): void {
    const my_once = format_text(my_source, my_mode);
    expect(my_once).toBe(expected);
    expect(format_text(my_once, my_mode)).toBe(my_once);
}

function send_statement(my_source: string, my_line: number): string {
    const my_document = create_mock_document(my_source) as
        unknown as vscode.TextDocument;
    return find_code_to_send(my_document, 'statement', my_line, null).code;
}

describe('input data in a brace block, and an input behind a prefix', () => {
    // The first `input` fills its one observation at `10`, and `}`
    // closes the `if`; StataMP 18 then runs `summarize score` and
    // reads `42` for `quietly input price`.
    const BRACED = 'clear\nset obs 1\nif _N == 1 {\n    input score\n    10\n}\n' +
        'summarize score\nclear\nquietly input price\n42\nend\nlist\n';

    it('ends the data at the closing brace', () => {
        expect(parse(BRACED).errors).toEqual([]);
        expect(input_data_of(BRACED)).toEqual([['    10', false], ['42', true]]);
        const the_nodes = parse(BRACED).ast.nodes;
        expect(the_nodes.map((my_node) => my_node.type)).toEqual([
            'command', 'command', 'if', 'command', 'command', 'command',
            'command',
        ]);
        const my_if = the_nodes[2];
        expect(my_if.type === 'if' && my_if.range.end.line).toBe(5);
    });

    it('sends summarize score on its own', () => {
        expect(send_statement(BRACED, 6)).toBe('summarize score');
        expect(send_statement(BRACED, 2)).toBe(
            'if _N == 1 {\n    input score\n    10\n}');
    });

    for_each_formatter_mode('keeps the code as written', (my_mode) => {
        expect_formats_to(BRACED, my_mode, BRACED);
    });
});

describe('a block opened behind a prefix claims the next end', () => {
    // No braces: only the prefixed `input` decides where the first
    // data ends.
    const PREFIXES = [
        'quietly ', 'qui: ', 'capture noisily ', 'version 18: ',
        'frame fx: ', 'cap version 18: qui ',
    ];

    it('for an input', () => {
        for (const my_prefix of PREFIXES) {
            const my_source = `input score\n10\nsummarize score\nclear\n` +
                `${my_prefix}input price\n42\nend\nlist\n`;
            expect(parse(my_source).errors).toEqual([]);
            expect(input_data_of(my_source)).toEqual([['10', false], ['42', true]]);
        }
    });

    it('for a mata or python block', () => {
        for (const my_opener of [
            'quietly mata:', 'capture python', 'by g: mata:', 'version 18: mata',
        ]) {
            const my_source = `input str5 a\nParis\nlocal n = _N\n${my_opener}\nend\n`;
            expect(input_data_of(my_source)).toEqual([['Paris', false]]);
        }
    });

    it('not for by: input, which reads no data', () => {
        // The lexer reads no data after `by g: input` either, so the
        // `end` closes the first data.
        const my_source = 'input score\n10\nsummarize score\n' +
            'by g: input price\n42\nend\nlist\n';
        expect(input_data_of(my_source)).toEqual([
            ['10\nsummarize score\nby g: input price\n42', true],
        ]);
    });

    it('not for a program behind a prefix, which the lexer does not open', () => {
        const my_source = 'input x\n1\n2 3\nquietly program define p\nend\n';
        expect(input_data_of(my_source)).toEqual([
            ['1\n2 3\nquietly program define p', true],
        ]);
    });
});

describe('a closing brace row ends input data in a brace block', () => {
    // Each `end` is unrelated: nothing before it opens a block.
    const CASES: Array<[string, string]> = [
        ['if 1 {\n    input x\n    10\n}\nlist\nend\n', '    10'],
        ['if 1 {\n    input x\n    10\n    display x\n}\nlist\nend\n', '    10'],
        ['if 1 {\n    input x\n    10\n} // note\nlist\nend\n', '    10'],
        ['if 1 {\n    input str8 city\n    Paris\n}\nlist\nend\n', '    Paris'],
        ['if 1 {\n    input str8 city\n    Paris\n}\ndisplay city\n' +
            'clear\ninput y\n1\nend\n', '    Paris'],
        ['foreach v in a {\n    if 1 {\n        input str8 s\n        x\n    }\n}\n' +
            'list\nend\n', '        x'],
        ['#delimit ;\nif 1 {\n    input x;\n    10;\n}\nlist;\nend;\n', '    10'],
    ];

    it('for numeric and string declarations', () => {
        for (const [my_source, my_data] of CASES) {
            expect(parse(my_source).errors).toEqual([]);
            expect(input_data_of(my_source)[0]).toEqual([my_data, false]);
        }
    });

    it('but not outside a brace block, where the end closes the data', () => {
        // A `}` there closes nothing Sight counts; under string
        // variables it fits, and Stata reads it as data.
        const my_source = 'input str8 city\nParis\n}\nend\n';
        expect(input_data_of(my_source)).toEqual([['Paris\n}', true]]);
    });

    it('nor after a brace block the input does not sit in', () => {
        const my_source = 'if 1 {\n    display 1\n}\ninput str8 city\nParis\n}\nend\n';
        expect(input_data_of(my_source)).toEqual([['Paris\n}', true]]);
    });

    it('nor after a brace block of Mata code', () => {
        const my_source = 'mata {\n    x = 1\n}\ninput str8 city\nParis\n}\nend\n';
        expect(input_data_of(my_source)).toEqual([['Paris\n}', true]]);
    });
});

describe('the formatters leave input data rows as written', () => {
    const FMTDRIFT = 'clear\nset obs 1\nif _N == 1 {\n    input str8 city\n' +
        '    Paris\n    display city\n}\n';

    for_each_formatter_mode('in the last row of data without end', (my_mode) => {
        expect(input_data_of(FMTDRIFT)).toEqual([['    Paris', false]]);
        expect_formats_to(FMTDRIFT, my_mode, FMTDRIFT);
    });

    // Rows at column 0, at eight spaces and after a tab, with and
    // without `end`; the statement after the data keeps its indent.
    const ROWS = 'Paris\n        Rome\n\tOslo';
    const KEPT = [
        `if 1 {\n    input str8 city\n${ROWS}\n    display city\n}\n`,
        `if 1 {\n    input str8 city\n${ROWS}\n}\n`,
        `if 1 {\n    input str8 city\n    Paris\n}\nlist\n`,
    ];

    for_each_formatter_mode('in every row, with or without end', (my_mode) => {
        for (const my_source of KEPT) {
            expect_formats_to(my_source, my_mode, my_source);
        }
    });

    for_each_formatter_mode('and indent the end and the statement after', (my_mode) => {
        expect_formats_to(
            `if 1 {\n    input str8 city\n${ROWS}\nend\n    display city\n}\n`, my_mode,
            `if 1 {\n    input str8 city\n${ROWS}\n    end\n    display city\n}\n`);
        expect_formats_to(
            `if 1 {\n    input str8 city\n${ROWS}\ndisplay city\n}\n`, my_mode,
            `if 1 {\n    input str8 city\n${ROWS}\n    display city\n}\n`);
    });

    const SEMICOLON = [
        '#delimit ;\nif 1 {;\n    input str8 city;\n    Paris;\n    display city;\n};\n',
        '#delimit ;\nif 1 {;\n    input str8 city;\n    Paris; display city;\n};\n',
        '#delimit ;\nif 1 {;\n    input x;\n    1;\n        2; end;\n    list;\n};\n',
    ];

    for_each_formatter_mode('under #delimit ;', (my_mode) => {
        for (const my_source of SEMICOLON) {
            const my_once = format_text(my_source, my_mode);
            expect(format_text(my_once, my_mode)).toBe(my_once);
            if (my_mode === 'source-preserving') {
                expect(my_once).toBe(my_source);
            }
        }
    });
});
