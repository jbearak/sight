/**
 * Regressions from a cold review of the lexer, parser and formatter,
 * each settled in StataMP 18 where it is a claim about Stata:
 *
 * - `#delimit` (or `#d`) is a directive only as the first code of a
 *   statement: at the start of a line after blanks and block
 *   comments, or under `#delimit ;` after a `;`; not in macro text
 *   (`local tag {#d ;}`), after a prefix, or at the start of a line
 *   inside a `#delimit ;` statement.
 * - `input` data ends at `end`, or before a row that does not fit the
 *   variables `input` declares (see src/utils/input-data.ts): a row
 *   with text where a numeric variable needs a number. A row that fits
 *   (`program demo` under `input str12 a str12 b`) is data.
 * - The lexer decides where a program definition starts, and the
 *   parser follows it, so a definition header split over lines, after
 *   a `;`, behind a `//` comment, or named by a macro keeps its `end`.
 * - `mi xeq: notes: mata:` is a note, not a Mata opener.
 * - `` summarize x[`weight'`exp'] `` has a weight; a glued
 *   `` `opts'in `` is a qualifier (and the statement is left as
 *   written); `char rename a b, replace` keeps its option.
 * - AST formatting keeps the data of a continued `if … input`, Mata
 *   after a `//` comment under `#delimit ;`, and a tab before a `///`
 *   in a Python one-liner.
 * - Smaller fixes: `` program de`p' ``, `"a;end"` as a record, data
 *   after `else if 1 input`, hover on a `///`-joined Mata line, an
 *   old-shape directive node, an empty `;` record, `cd using/data`.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { PrettyPrinter } from '../../src/pretty-printer';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import embedded_cache from '../../src/command-database/caches/v18.json' with { type: 'json' };
import {
    input_declaration_fields,
    is_consistent_input_row,
} from '../../src/utils/input-data';
import type { CommandCache } from '../../src/command-database/types';
import {
    CommandNode,
    LanguageContext,
    StataAST,
    StataNode,
    Token,
} from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';
import { tokenize_stata } from './helpers/textmate-tokenizer';

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

describe('#delimit is a directive only as the first code of a statement', () => {
    it('is not one in macro text', () => {
        const my_source = 'local tag {#d ;}\nlocal k 1\ndisplay `k\'\n';
        expect(directive_lines(my_source)).toEqual([]);
        expect(shape(nodes_of(my_source))).toEqual(['macro_def', 'macro_def', 'display']);
        expect(directive_lines('local color ;#d text\n')).toEqual([]);
        expect(directive_lines('local x {#delimit ;}\n')).toEqual([]);
    });

    it('is one after blanks and block comments at the start of a line', () => {
        expect(directive_lines('  #d ;\ndi 1;\n')).toEqual([0]);
        expect(directive_lines('/* note */ #d ;\ndi 1;\n')).toEqual([0]);
        expect(directive_lines('/* a\n b */ #d ;\ndi 1;\n')).toEqual([1]);
    });

    it('is one after a ; under #delimit ;, on the same line too', () => {
        expect(directive_lines('#d ;\ndi 1; #delimit cr\ndi 2\n')).toEqual([0, 1]);
        expect(directive_lines('#d ;\ndi 1;#d cr\ndi 2\n')).toEqual([0, 1]);
        expect(directive_lines('#d ;\ndi 1\n;#d cr\ndi 2\n')).toEqual([0, 2]);
    });

    it('is not one inside a statement, after a prefix, or after a join', () => {
        // Under `#delimit ;`, `di 1` then `#d cr` is `di 1 #d cr`
        expect(directive_lines('#d ;\ndi 1\n#d cr\ndi 2\n')).toEqual([0]);
        expect(directive_lines('#d ;\ndi 1 /* x\n*/ #d cr\n')).toEqual([0]);
        expect(directive_lines('quietly #d ;\n')).toEqual([]);
        expect(directive_lines('di 1 ///\n#d ;\n')).toEqual([]);
        expect(directive_lines('di 1 /* x\n*/ #d ;\n')).toEqual([]);
    });
});

describe('TextMate grammar: where #delimit is a directive', () => {
    const DIRECTIVE = 'keyword.control.directive.delimit.stata';

    async function directive_texts(my_source: string): Promise<string[]> {
        return (await tokenize_stata(my_source))
            .filter((my_token) => my_token.scopes.includes(DIRECTIVE))
            .map((my_token) => my_token.text);
    }

    it('scopes one after a block comment', async () => {
        expect(await directive_texts('/* note */ #d ;')).toEqual(['#d']);
    });

    it('does not scope one after a ; under #delimit cr', async () => {
        expect(await directive_texts('local color ;#d text')).toEqual([]);
    });

    it('scopes one after a ; under #delimit ;', async () => {
        expect(await directive_texts('#d ;\ndi 1; #d cr\nlocal c ;#d x'))
            .toEqual(['#d', '#d']);
    });
});

describe('input data and the variables input declares', () => {
    it('reads the declaration', () => {
        expect(input_declaration_fields(' str12 a str12 b')).toEqual(['text', 'text']);
        expect(input_declaration_fields(' x byte y str3 s, label'))
            .toEqual(['numeric', 'numeric', 'text']);
        expect(input_declaration_fields(' double(x y) str3 s'))
            .toEqual(['numeric', 'numeric', 'text']);
        expect(input_declaration_fields(' x:yn')).toEqual(['text']);
        for (const my_unknown of ['', ' `vars\'', ' x1-x3', ' $vars', ' double(x']) {
            expect(input_declaration_fields(my_unknown)).toBeNull();
        }
    });

    it('checks rows as StataMP 18 reads them', () => {
        const NUMERIC = ['numeric' as const];
        // Extra fields are ignored; a field ends at `,` or `/`
        for (const my_row of ['1 2', '1 local label', '-1.5e3', '.a', '.', '1d3',
            '1.0X+003', '1,000', '1/2', '', '  ', '1 // c', '5 ///\n6']) {
            expect(is_consistent_input_row(my_row, NUMERIC)).toBe(true);
        }
        for (const my_row of ['local label score', '"5"', '-.a', '1e', ',', '$x', '`x\'']) {
            expect(is_consistent_input_row(my_row, NUMERIC)).toBe(false);
        }
        // A missing numeric field fails, a missing string field doesn't
        expect(is_consistent_input_row('1', ['numeric', 'numeric'])).toBe(false);
        expect(is_consistent_input_row('1', ['numeric', 'text'])).toBe(true);
        expect(is_consistent_input_row('"a b" 2', ['text', 'numeric'])).toBe(true);
        expect(is_consistent_input_row('3,4', ['numeric', 'numeric'])).toBe(false);
    });

    it('reads rows that fit string variables as data', () => {
        for (const my_source of [
            'input str12 a str12 b\nprogram demo\nNew-York USA\nend\n',
            'input str12 a str12 b\nprogram define\nend\nlist\n',
            'clear\ninput str8 action str8 target\nprogram alpha\nrun bogus\nend\n',
        ]) {
            const my_result = parse(my_source);
            expect(my_result.errors).toEqual([]);
            const the_nodes = my_result.ast.nodes;
            expect(the_nodes.some((my_node) => my_node.type === 'program')).toBe(false);
            const my_input = the_nodes.find((my_node) =>
                my_node.type === 'command' && my_node.name === 'input');
            expect(my_input?.type === 'command' && my_input.input_data?.content)
                .toContain('program');
        }
    });

    for_each_formatter_mode('keeps rows that look like code as data', (my_mode) => {
        const my_source = 'input str12 a str12 b\nprogram demo\nNew-York USA\nend\n';
        expect_formats_to(my_source, my_mode, my_source);
    });

    const ENDS_EARLY = [
        'clear',
        'set obs 1',
        'generate id = 1',
        'input score',
        '10',
        'local label score',
        'program define helper',
        '    display 1',
        'end',
        'display "`label\'"',
        'helper',
        '',
    ].join('\n');

    it('ends before a row that does not fit the declaration', () => {
        const the_nodes = nodes_of(ENDS_EARLY);
        expect(shape(the_nodes)).toEqual([
            'clear', 'set', 'generate', 'input', 'macro_def', 'program',
            'display', 'helper',
        ]);
        const my_input = command_at(the_nodes, 3);
        expect(my_input.input_data?.content).toBe('10');
        expect(my_input.input_data?.has_end).toBe(false);
    });

    for_each_formatter_mode('keeps data that ends without end', (my_mode) => {
        expect_formats_to(ENDS_EARLY, my_mode, ENDS_EARLY);
    });

    it('ends after a filled record under #delimit ;, before a program', () => {
        const my_source = '#delimit ;\nset obs 1;\ninput x; 1; program define demo;\n' +
            '    display 2;\nend;\ndemo;\n';
        const the_nodes = nodes_of(my_source);
        expect(shape(the_nodes)).toEqual(['directive', 'set', 'input', 'program', 'demo']);
        expect(command_at(the_nodes, 2).input_data?.content).toBe(' 1');
    });

    for_each_formatter_mode('keeps the record before the program', (my_mode) => {
        const my_source = '#delimit ;\nset obs 1;\ninput x; 1; program define demo;\n' +
            '    display 2;\nend;\ndemo;\n';
        const my_once = format_text(my_source, my_mode);
        expect(my_once).toContain(' 1;');
        expect(shape(nodes_of(my_once))).toEqual(['directive', 'set', 'input', 'program', 'demo']);
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });

    it('reads a quoted ; in a record as text', () => {
        const the_nodes = nodes_of('#delimit ;\ninput str20 s;\n"a;end";\nend;\nlist;\n');
        expect(shape(the_nodes)).toEqual(['directive', 'input', 'list']);
        expect(command_at(the_nodes, 1).input_data?.content).toBe('"a;end"');
    });

    it('attaches data after else if 1 input', () => {
        const my_result = parse('if 0 di 0\nelse if 1 input str10 town\nParis\nend\nlist\n');
        expect(shape(my_result.ast.nodes)).toEqual(['if', 'else', 'list']);
    });

    it('lexes many input blocks in linear time', () => {
        /** How many characters of the source the lexer reads. */
        function source_reads(my_unit: string, count: number): number {
            const my_source = my_unit.repeat(count);
            let my_reads = 0;
            const my_counted = new Proxy(new String(my_source), {
                get(my_target, my_key) {
                    if (typeof my_key === 'string' && /^\d+$/.test(my_key)) {
                        my_reads++;
                    }
                    const my_value: unknown = Reflect.get(my_target, my_key, my_target);
                    return typeof my_value === 'function'
                        ? my_value.bind(my_source)
                        : my_value;
                },
            });
            // The lexer reads the source by index and through String
            // methods; the proxy counts the reads.
            new StataLexer().tokenize(my_counted as unknown as string);
            return my_reads;
        }
        for (const my_unit of [
            'clear\ninput x\n1\nend /*\n',
            'input str5 a\nfoo\n',
            'input x\n1\n',
        ]) {
            const my_small = source_reads(my_unit, 250);
            const my_large = source_reads(my_unit, 1000);
            // Linear: four times the blocks, about four times the reads
            // (quadratic would be sixteen)
            expect(my_large / my_small).toBeLessThan(5);
        }
    });
});

describe('a program definition starts where the lexer says', () => {
    for (const my_source of [
        '#delimit ;\nprogram\n    define p;\n    input x;\nend;\ndisplay 1;\n',
        '#delimit ;\ndisplay 0; program define p;\n    input x;\nend;\ndisplay 1;\n',
        '#delimit ;\nprogram // header\n define p;\n    input x;\nend;\ndisplay 1;\n',
        'local q p\nprogram `q\'\n    input x\nend\ndisplay 1\n',
    ]) {
        it(`closes at its end: ${JSON.stringify(my_source.slice(0, 30))}`, () => {
            const my_result = parse(my_source);
            expect(my_result.errors).toEqual([]);
            const the_nodes = my_result.ast.nodes;
            const my_program = the_nodes.find((my_node) => my_node.type === 'program');
            if (my_program?.type !== 'program') throw new Error('no program');
            expect(my_program.closed_by_end).toBe(true);
            expect(shape(my_program.body)).toEqual(['input']);
            const my_last = the_nodes[the_nodes.length - 1];
            expect(my_last?.type === 'command' && my_last.name).toBe('display');
        });
    }

    it('names a program from a define abbreviation glued to a macro', () => {
        const my_program = nodes_of('local p foo\nprogram de`p\'\n    display 1\nend\n')[1];
        if (my_program?.type !== 'program') throw new Error('no program');
        expect(my_program.name).toBe('de`p\'');
        expect(my_program.define_keyword).toBeUndefined();
    });

    for_each_formatter_mode('keeps program de`p\' as written', (my_mode) => {
        const my_source = 'local p foo\nprogram de`p\'\n    display 1\nend\n';
        expect_formats_to(my_source, my_mode, my_source);
    });
});

describe('a colon after a prefixed command', () => {
    const SOURCE = 'mi xeq: notes: mata:\nlocal x 1\ndisplay `x\'\n';

    it('does not open Mata after notes:', () => {
        expect(shape(nodes_of(SOURCE))).toEqual(['notes', 'macro_def', 'display']);
        expect(shape(nodes_of('mi xeq: by g: mata: x = 1\n'))).toEqual(['embedded_block']);
    });

    for_each_formatter_mode('leaves the note as written', (my_mode) => {
        expect_formats_to(SOURCE, my_mode, SOURCE);
    });
});

describe('a bracket touching a name', () => {
    it('is a weight in a varlist', () => {
        const my_node = command_at(nodes_of('summarize x[`weight\'`exp\']\n', true), 0);
        expect(my_node.weight?.keyword).toBe('`weight\'');
        expect(my_node.varlist?.map((my_item) => my_item.name)).toEqual(['x']);
    });

    it('is still a subscript in an expression', () => {
        const my_node = command_at(nodes_of('generate x = price[`weight\']\n', true), 0);
        expect(my_node.expression).toBe('price[`weight\']');
        expect(my_node.weight).toBeUndefined();
    });
});

describe('a qualifier glued to the end of a macro in a varlist', () => {
    it('is the qualifier, and the statement is left as written', () => {
        const my_result = parse('local opts ""\nsummarize x `opts\'in 1/2\n', true);
        expect(command_at(my_result.ast.nodes, 1).inExpression).toBe('1/2');
        expect(my_result.ast.unprintable_ranges).toHaveLength(1);
    });
});

describe('char rename', () => {
    it('keeps its option', () => {
        const my_node = command_at(nodes_of('char rename oldvar newvar, replace\n'), 0);
        expect(my_node.options?.map((my_option) => my_option.name)).toEqual(['replace']);
        // A variable named rename still takes free text
        const my_text = command_at(nodes_of('char rename[note] a, b\n'), 0);
        expect(my_text.options ?? []).toEqual([]);
    });
});

describe('AST formatting keeps all the code', () => {
    for_each_formatter_mode('keeps the data of a continued if … input', (my_mode) => {
        const my_source = 'if 1 input /// fields\n    str5 town\nParis\nend\nlist\n';
        expect_formats_to(my_source, my_mode, my_source);
    });

    for_each_formatter_mode('keeps Mata after a // comment under #delimit ;', (my_mode) => {
        const my_source = '#delimit ;\nmata: x = 1 // comment\n    ///\n    + 2;\ndisplay 1;\n';
        const my_once = format_text(my_source, my_mode);
        const the_nodes = nodes_of(my_once);
        expect(shape(the_nodes)).toEqual(['directive', 'embedded_block', 'display']);
        const my_block = the_nodes[1];
        expect(my_block?.type === 'embedded_block' && my_block.content).toContain('+ 2');
        expect(format_text(my_once, my_mode)).toBe(my_once);
    });

    for_each_formatter_mode('keeps a tab before /// in a Python one-liner', (my_mode) => {
        // Stata joins at the `///` (it does not know '...' strings), so
        // the tab is part of the Python text
        const my_source = 'python: s = \'a;\t/// b\'\ndisplay 1\n';
        expect_formats_to(my_source, my_mode, my_source);
    });

    it('reads ; and /// inside a double-quoted string as text', () => {
        for (const my_source of [
            'python: s = "a;\t/// b"\ndisplay 1\n',
            'mata: s = "a\t/// b"\ndisplay 1\n',
            '#delimit ;\npython: s = "a;b";\ndisplay 1;\n',
            '#delimit ;\nmata: s = "a;b";\ndisplay 1;\n',
        ]) {
            const the_nodes = nodes_of(my_source);
            const my_last = the_nodes[the_nodes.length - 1];
            expect(my_last?.type === 'command' && my_last.name).toBe('display');
        }
    });

    for_each_formatter_mode('keeps an empty record under #delimit ;', (my_mode) => {
        const my_source = '#delimit ;\ninput x;\n;\nend;\nlist;\n';
        expect_formats_to(my_source, my_mode, my_source);
    });

    it('prints a directive node without a keyword as #delimit', () => {
        const my_ast: StataAST = {
            nodes: [{
                type: 'directive',
                directive: 'delimit',
                mode: 'semicolon',
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            } as unknown as StataNode],
        };
        expect(new PrettyPrinter().print(my_ast)).toContain('#delimit ;');
    });
});

describe('a ///-joined line of a mata: statement', () => {
    const SOURCE = 'mata: ///\n    display = 1\n';

    it('is Mata, with no Stata help on hover', async () => {
        const my_document = create_document_state(SOURCE);
        const my_position = { line: 1, character: 5 };
        expect(my_document.context_tracker?.get_context_at_position(my_position))
            .toBe(LanguageContext.MATA);
        const my_database = new CommandDatabase();
        my_database.load_cache(embedded_cache as CommandCache);
        expect(await new HoverProvider(my_database).get_hover(my_document, my_position))
            .toBeNull();
    });
});

describe('cd using/data', () => {
    it('changes to a directory named using/data', () => {
        const my_node = command_at(nodes_of('cd using/data\n', true), 0);
        expect(my_node.varlist?.map((my_item) => my_item.name)).toEqual(['using/data']);
        expect(my_node.using).toBeUndefined();
    });
});
