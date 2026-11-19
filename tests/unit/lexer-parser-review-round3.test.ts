/**
 * Regressions from a third cold review of the lexer, parser and
 * formatter, each settled in StataMP 18 where it is a claim about
 * Stata:
 *
 * - Under `#delimit ;`, the bare `end` of a Mata block ends a
 *   statement, so `#delimit cr` on the next line is a directive.
 * - The source-preserving formatter leaves the later lines of a
 *   one-line `mata:` statement under `#delimit ;` as written: a `//`
 *   line there is a comment when indented and code at column 0.
 * - `input` data ends before a row with more fields than declared
 *   variables (`Paris` then `local n = _N` under `input str5 city`),
 *   and `,` and `/` are fields of their own.
 * - Under `#delimit ;`, a quoted `input` field may span lines; the
 *   row scanner is linear in the source.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    create_input_quote_scan,
    input_row_end,
    is_consistent_input_row,
    is_input_data_row,
} from '../../src/utils/input-data';
import { is_program_definition_header } from '../../src/utils/program-definition';
import { CommandNode, StataNode, Token } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function lex(my_source: string): Token[] {
    return new StataLexer().tokenize(my_source).tokens;
}

function parse(my_source: string, structured = false) {
    return new StataParser({ structured }).parse(lex(my_source));
}

function nodes_of(my_source: string, structured = false): StataNode[] {
    return parse(my_source, structured).ast.nodes;
}

/** Each node's type, or a command's name. */
function shape(the_nodes: StataNode[]): string[] {
    return the_nodes.map((my_node) =>
        my_node.type === 'command' ? my_node.name : my_node.type);
}

function command_at(the_nodes: StataNode[], index: number): CommandNode {
    const my_node = the_nodes[index];
    if (my_node?.type !== 'command') {
        throw new Error(`node ${index} is ${my_node?.type}, not a command`);
    }
    return my_node;
}

function directive_lines(my_source: string): number[] {
    return lex(my_source)
        .filter((my_token) => my_token.type === 'DELIMIT_DIRECTIVE')
        .map((my_token) => my_token.range.start.line);
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

/**
 * How many characters of `my_source` `run` reads: by index, and
 * through `indexOf` (the characters it passes over).
 */
function source_reads(my_source: string, run: (my_text: string) => void): number {
    let my_reads = 0;
    const my_counted = new Proxy(new String(my_source), {
        get(my_target, my_key) {
            if (typeof my_key === 'string' && /^\d+$/.test(my_key)) {
                my_reads++;
            }
            if (my_key === 'indexOf') {
                return (my_search: string, my_from = 0) => {
                    const my_found = my_source.indexOf(my_search, my_from);
                    my_reads += (my_found === -1 ? my_source.length : my_found) -
                        my_from;
                    return my_found;
                };
            }
            const my_value: unknown = Reflect.get(my_target, my_key, my_target);
            return typeof my_value === 'function'
                ? my_value.bind(my_source)
                : my_value;
        },
    });
    run(my_counted as unknown as string);
    return my_reads;
}

/** Reads for 1000 copies of `my_unit` over reads for 250. */
function growth(
    my_unit: string, run: (my_text: string) => void,
    my_prefix = '', my_suffix = ''
): number {
    const my_small = source_reads(
        my_prefix + my_unit.repeat(250) + my_suffix, run);
    const my_large = source_reads(
        my_prefix + my_unit.repeat(1000) + my_suffix, run);
    return my_large / my_small;
}

describe('the end of a Mata block under #delimit ;', () => {
    // StataMP 18: `mata;` ... `end` then `#delimit cr` (or `#d cr`)
    // runs the directive, and the lines after it are cr statements.
    const MATA_END = '#delimit ;\nmata;\nx = 1\nend\n#delimit cr\n' +
        'local result 42\ndisplay `result\'\n';

    it('ends a statement, so #delimit cr after it is a directive', () => {
        expect(directive_lines(MATA_END)).toEqual([0, 4]);
        expect(directive_lines(MATA_END.replace('#delimit cr', '#d cr')))
            .toEqual([0, 4]);
        expect(shape(nodes_of(MATA_END)))
            .toEqual(['directive', 'embedded_block', 'directive', 'macro_def', 'display']);
    });

    it('is not like the end of a program, input data or a brace', () => {
        // StataMP 18 reads each of these `end`s (and `}`) on to the
        // next `;`, so the `#delimit cr` after them is not a directive.
        for (const my_source of [
            '#delimit ;\nprogram p;\ndisplay 1;\nend\n#delimit cr\ndi 2;\n',
            '#delimit ;\ninput v;\n1;\nend\n#delimit cr\ndi 2;\n',
            '#delimit ;\nif 1 {;\ndi 1;\n}\n#delimit cr\ndi 2;\n',
        ]) {
            expect(directive_lines(my_source)).toEqual([0]);
        }
    });
});

describe('the later lines of a one-line mata: statement', () => {
    for_each_formatter_mode('stay as written under #delimit ;', (my_mode) => {
        // Moved to column 0, the `//` line would be code in Stata.
        expect_formats_to(
            '#delimit ;\n    mata: x = 1\n    // add the correction\n    + 2;\n#delimit cr\n',
            my_mode,
            '#delimit ;\nmata: x = 1\n    // add the correction\n    + 2;\n#delimit cr\n');
        // A `*` line, and a Python one-liner, likewise.
        expect_formats_to(
            '#delimit ;\nif 1 {;\n        mata: y = 2\n    * 3;\n' +
                '        python: print(1 +\n    // c\n    2);\n};\n#delimit cr\n',
            my_mode,
            '#delimit ;\nif 1 {;\n    mata: y = 2\n    * 3;\n' +
                '    python: print(1 +\n    // c\n    2);\n};\n#delimit cr\n');
    });
});

describe('input data and the number of fields in a row', () => {
    it('counts , and / as fields of their own', () => {
        // StataMP 18: `3/4` under `input x y` gives "'/' cannot be read
        // as a number"; `x/y z` under three string variables gives
        // `x`, `/`, `y`.
        expect(is_consistent_input_row('3/4', ['numeric', 'numeric'])).toBe(false);
        expect(is_consistent_input_row('3 / 4', ['numeric', 'numeric'])).toBe(false);
        expect(is_input_data_row('x/y', ['text', 'text', 'text'])).toBe(true);
        expect(is_input_data_row('x/y z', ['text', 'text', 'text'])).toBe(false);
        expect(is_input_data_row('x, y', ['text', 'text'])).toBe(false);
        expect(is_input_data_row('x, y', ['text', 'text', 'text'])).toBe(true);
    });

    it('is not data with more fields than variables', () => {
        expect(is_input_data_row('Paris', ['text'])).toBe(true);
        expect(is_input_data_row('local n = _N', ['text'])).toBe(false);
        expect(is_input_data_row('"New York" 2', ['text', 'numeric'])).toBe(true);
        expect(is_input_data_row('1 2', ['numeric'])).toBe(false);
        expect(is_input_data_row('5 ///\n6', ['numeric', 'numeric'])).toBe(true);
        expect(is_input_data_row('1 // a b c', ['numeric'])).toBe(true);
        expect(is_input_data_row('', ['numeric'])).toBe(true);
        // Stata reads such a row, ignoring the extra field.
        expect(is_consistent_input_row('1 2', ['numeric'])).toBe(true);
    });

    const STRING_OBS = 'clear\nset obs 1\ninput str5 city\nParis\nlocal n = _N\n' +
        'program define report\n    display 1\nend\ndisplay `n\'\n';

    it('ends string input before a row with too many fields', () => {
        const the_nodes = nodes_of(STRING_OBS);
        expect(shape(the_nodes)).toEqual(
            ['clear', 'set', 'input', 'macro_def', 'program', 'display']);
        const my_input = command_at(the_nodes, 2);
        expect(my_input.input_data?.content).toBe('Paris');
        expect(my_input.input_data?.has_end).toBe(false);
    });

    for_each_formatter_mode('keeps the string data and the code after it', (my_mode) => {
        expect_formats_to(STRING_OBS, my_mode, STRING_OBS);
    });

    it('keeps rows that fit string variables as data up to end', () => {
        const the_nodes = nodes_of(
            'input str12 a str12 b\nprogram demo\nNew-York USA\nend\nlist\n');
        expect(shape(the_nodes)).toEqual(['input', 'list']);
        expect(command_at(the_nodes, 0).input_data?.content)
            .toBe('program demo\nNew-York USA');
    });

    it('lexes many string input blocks without end in linear time', () => {
        const lex_it = (my_text: string) => {
            new StataLexer().tokenize(my_text);
        };
        for (const my_unit of [
            'input str5 a\nfoo\nlocal x 1 2\n',
            'input str5 (a b c d e f)\nx y\n',
            'input str5 a str5 b\n"x y\nz\n',
        ]) {
            expect(growth(my_unit, lex_it)).toBeLessThan(5);
        }
    });
});

describe('a quoted input field under #delimit ;', () => {
    const DATA_QUOTE = 'clear\n#delimit ;\ninput str20 note double amount;\n' +
        '"Long\nlabel" 42;\nend;\n';

    it('may span lines; the record ends at its ;', () => {
        // StataMP 18 reads the record as note "Long label", amount 42.
        const my_result = parse(DATA_QUOTE);
        expect(my_result.errors).toEqual([]);
        const the_nodes = my_result.ast.nodes;
        expect(shape(the_nodes)).toEqual(['clear', 'directive', 'input']);
        const my_input = command_at(the_nodes, 2);
        expect(my_input.input_data?.content).toBe('"Long\nlabel" 42');
        expect(my_input.input_data?.has_end).toBeUndefined();
    });

    for_each_formatter_mode('is kept by the formatter', (my_mode) => {
        expect_formats_to(DATA_QUOTE, my_mode, DATA_QUOTE);
    });

    it('ends at the end of its line under #delimit cr', () => {
        const my_source = '"Long\nlabel" 42\n';
        expect(input_row_end(my_source, 0, false)).toBe(5);
        expect(input_row_end(my_source, 0, true)).toBe(my_source.length);
    });

    it('ends at the end of its line when no quote closes it', () => {
        const my_source = '"abc 1;\nx 2;\n';
        expect(input_row_end(my_source, 0, true)).toBe(11);
    });

    it('ends at a ; inside a compound quote', () => {
        // StataMP 18 reads `` `"a;b"'; `` as two records, and a
        // compound quote over two lines as one.
        expect(input_row_end('`"a;b"\'; ', 0, true)).toBe(3);
        expect(input_row_end('`"p\nq"\'; ', 0, true)).toBe(7);
        expect(input_row_end('`"abc 1;\nx 2;\n', 0, true)).toBe(7);
    });

    it('is scanned in linear time', () => {
        const scan_rows = (my_is_semicolon: boolean) => (my_text: string) => {
            const my_scan = create_input_quote_scan();
            let my_start = 0;
            while (my_start < my_text.length) {
                my_start = input_row_end(
                    my_text, my_start, my_is_semicolon, my_scan) + 1;
            }
        };
        // Many records on one physical line, and quotes that nothing
        // closes, compound ones too.
        expect(growth('"a" 1; ', scan_rows(true), '', '\n')).toBeLessThan(5);
        expect(growth('"a" 1\n', scan_rows(false))).toBeLessThan(5);
        expect(growth('`"a\n', scan_rows(true))).toBeLessThan(5);
        expect(growth('`"a;\n', scan_rows(true))).toBeLessThan(5);
        expect(growth('"a\n', scan_rows(false))).toBeLessThan(5);
    });
});

describe('a program named with a Unicode letter', () => {
    it('is a definition that its end closes', () => {
        // StataMP 18 defines and runs `π`, `café2` and `_é`, and
        // rejects `½x` ("invalid name").
        for (const my_name of ['π', 'café2', '_é', 'x½']) {
            const my_result = parse(`program ${my_name}\nargs x\nend\n`);
            expect(my_result.errors).toEqual([]);
            expect(shape(my_result.ast.nodes)).toEqual(['program']);
        }
        expect(is_program_definition_header(' ½x')).toBe(false);
    });

    it('is one word, as are other names with Unicode letters', () => {
        const the_words = lex('local café 1\ngen x½ = 1\n')
            .filter((my_token) => my_token.type === 'WORD')
            .map((my_token) => my_token.value);
        expect(the_words).toEqual(['local', 'café', 'gen', 'x½']);
    });
});

describe('plugin in a program header', () => {
    it('declares a plugin only as an option of its own', () => {
        expect(is_program_definition_header(' p, plugin')).toBe(false);
        expect(is_program_definition_header(' p, plugin using("p.dll")')).toBe(false);
        expect(is_program_definition_header(' p, properties(a) plugin')).toBe(false);
        // StataMP 18 runs the body of these programs.
        expect(is_program_definition_header(' p, properties(plugin)')).toBe(true);
        expect(is_program_definition_header(' p, rclass properties(svyb plugin)'))
            .toBe(true);
    });

    it('in properties() leaves a definition that its end closes', () => {
        const my_result = parse(
            'program define p, properties(plugin)\n    display 1\nend\np\n');
        expect(my_result.errors).toEqual([]);
        expect(shape(my_result.ast.nodes)).toEqual(['program', 'p']);
    });
});

describe('a bracket touching a name in assert', () => {
    it('is a subscript, not a weight', () => {
        const my_assert = command_at(
            nodes_of('assert x[`weight\'] == 1\n', true), 0);
        expect(my_assert.weight).toBeUndefined();
        // In a varlist it is still the weight.
        expect(command_at(nodes_of('summarize price[`weight\'`exp\']\n'), 0).weight)
            .toBeDefined();
    });

    for_each_formatter_mode('stays attached to its name', (my_mode) => {
        const my_source = 'local weight 1\nassert x[`weight\'] == 1\n';
        expect_formats_to(my_source, my_mode, my_source);
    });
});

describe('a string under #delimit ;', () => {
    function string_errors(my_source: string): number[] {
        return new StataLexer().tokenize(my_source).errors
            .map((my_error) => my_error.range.start.line);
    }

    it('may span lines in compound quotes', () => {
        // StataMP 18: `` local b `"p `` then `` q"'; `` sets b.
        const my_source = '#delimit ;\nlocal b `"p\nq"\';\n' +
            'display `"B[`b\']"\';\n#delimit cr\n';
        expect(string_errors(my_source)).toEqual([]);
        expect(shape(nodes_of(my_source)))
            .toEqual(['directive', 'macro_def', 'display', 'directive']);
    });

    it('ends at a ; inside compound quotes', () => {
        // StataMP 18 reads `` local txt `"one; `` as a statement
        // ("invalid syntax"); the `"` after `two` then opens a string
        // that nothing closes.
        expect(string_errors('#delimit ;\nlocal txt `"one;\ntwo"\';\n'))
            .toEqual([1, 2]);
    });

    it('that nothing closes ends at the end of its line', () => {
        const my_source = '#delimit ;\ndisplay "oops;\nlocal one 1;\n' +
            'local two 2;\ndisplay `one\' + `two\';\n';
        expect(string_errors(my_source)).toEqual([1]);
        expect(shape(nodes_of(my_source)))
            .toEqual(['directive', 'display', 'macro_def', 'macro_def', 'display']);
        // A later `"` closes it, as in Stata.
        expect(shape(nodes_of('#delimit ;\ndisplay "a;\nb";\nlocal one 1;\n')))
            .toEqual(['directive', 'display', 'macro_def']);
    });

    it('that nothing closes costs linear time', () => {
        const lex_it = (my_text: string) => {
            new StataLexer().tokenize(my_text);
        };
        expect(growth('display "a;\n', lex_it, '#delimit ;\n')).toBeLessThan(5);
        expect(growth('display `"a;\n', lex_it, '#delimit ;\n')).toBeLessThan(5);
    });
});
