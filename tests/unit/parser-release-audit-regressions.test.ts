/**
 * Parser regressions since v0.15.1, each checked against StataMP 18.
 *
 * - `include using/setup.do` includes the file `using/setup.do`.
 * - `` program `cmdname' `` defines the program the macro names, and
 *   its `end` closes the definition (as in Stata's dtaverify_115.ado).
 * - Under `#delimit ;`, `program // note` then `define p;` defines `p`.
 * - `` `stem'using `` is one name, not a macro and the `using` keyword.
 * - `` price[`weight'] `` is a subscript, not a weight clause.
 * - The text of `label variable`, `label data`, `label define`, `char`
 *   and `note …:` is text: Stata reads `in`, `if` and `using` there as
 *   words (`la var income in` sets the label "in").
 * - AST formatting kept no comment of a program header or of a `///`
 *   note before an inline `mata:`.
 * - A long run of `//` comments inside a `#delimit ;` statement took
 *   quadratic time.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { find_end_diagnostics } from '../../src/providers/end-diagnostics';
import { CommandNode, StataNode, Token } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    for_each_formatter_mode,
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(my_source: string, structured = false) {
    const the_tokens = new StataLexer().tokenize(my_source).tokens;
    return new StataParser({ structured }).parse(the_tokens);
}

function nodes_of(my_source: string, structured = false): StataNode[] {
    return parse(my_source, structured).ast.nodes;
}

function command_at(the_nodes: StataNode[], index: number): CommandNode {
    const my_node = the_nodes[index];
    if (my_node?.type !== 'command') {
        throw new Error(`node ${index} is ${my_node?.type}, not a command`);
    }
    return my_node;
}

const formatter = new CodeFormatter();

function format_text(my_source: string, my_mode: FormatterMode): string {
    const the_edits = formatter.format(
        create_document_state(my_source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(my_mode)
    );
    return the_edits.length > 0 ? the_edits[0].newText : my_source;
}

describe('a file path whose first directory is named using', () => {
    for (const my_command of ['include', 'do', 'run']) {
        it(`is the path of ${my_command}`, () => {
            const my_node = command_at(nodes_of(`${my_command} using/setup.do\n`), 0);
            expect(my_node.varlist?.[0]?.name).toBe('using/setup.do');
        });
    }

    it('is still the using keyword of use', () => {
        const my_node = command_at(nodes_of('use using data.dta\n', true), 0);
        expect(my_node.using?.paths.map((my_path) => my_path.text))
            .toEqual(['data.dta']);
    });
});

describe('a program named by a macro', () => {
    const SOURCE = 'local cmdname "dtaverify_115"\nprogram `cmdname\'\n' +
        '\tversion 13\n\tdisplay "hi"\nend\n';

    it('is a program definition closed by its end', () => {
        const the_nodes = nodes_of(SOURCE);
        expect(the_nodes.map((my_node) => my_node.type))
            .toEqual(['macro_def', 'program']);
        const my_program = the_nodes[1];
        if (my_program?.type !== 'program') throw new Error('no program');
        expect(my_program.name).toBe('`cmdname\'');
        expect(my_program.closed_by_end).toBe(true);
        expect(my_program.body).toHaveLength(2);
        expect(find_end_diagnostics(the_nodes, SOURCE)).toEqual([]);
    });

    it('may follow define and run on across a touching suffix', () => {
        const my_program = nodes_of('program define `p\'_x, rclass\nend\n')[0];
        if (my_program?.type !== 'program') throw new Error('no program');
        expect(my_program.name).toBe('`p\'_x');
        expect(my_program.define_keyword).toBe('define');
        expect(my_program.define_options).toBe('rclass');
    });

    it('is not taken from a subcommand', () => {
        for (const my_source of ['program drop `x\'\n', 'capture program drop $x\n']) {
            expect(nodes_of(my_source)[0]?.type).toBe('command');
        }
    });
});

describe('a #delimit ; program header with a // comment', () => {
    it('reads define on the next line', () => {
        const my_source = '#delimit ;\nprogram // header comment\n    define p;\nend;\n';
        const the_nodes = nodes_of(my_source);
        const my_program = the_nodes[1];
        if (my_program?.type !== 'program') throw new Error('no program');
        expect(my_program.name).toBe('p');
        expect(my_program.define_keyword).toBe('define');
        expect(find_end_diagnostics(the_nodes, my_source)).toEqual([]);
    });
});

describe('a keyword glued to a macro', () => {
    const SETUP = 'local stem ho\n';

    it('is part of the name in an expression', () => {
        const my_node = command_at(
            nodes_of(`${SETUP}generate copy = \`stem'using + 1\n`, true), 1);
        expect(my_node.expression).toBe('`stem\'using + 1');
        expect(my_node.using).toBeUndefined();
    });

    for (const my_keyword of ['if', 'in']) {
        it(`${my_keyword} is part of the name in an expression`, () => {
            const my_node = command_at(
                nodes_of(`${SETUP}generate y = \`stem'${my_keyword} + 1\n`), 1);
            expect(my_node.expression).toBe(`\`stem'${my_keyword} + 1`);
            expect(my_node.ifExpression).toBeUndefined();
            expect(my_node.inExpression).toBeUndefined();
        });
    }

    it('is part of the name in a varlist', () => {
        const my_node = command_at(
            nodes_of(`${SETUP}summarize \`stem'in \`stem'using, detail\n`, true), 1);
        expect(my_node.inExpression).toBeUndefined();
        expect(my_node.using).toBeUndefined();
        expect(my_node.options?.map((my_option) => my_option.name)).toEqual(['detail']);
    });

    it('is still a keyword after a space', () => {
        const my_node = command_at(
            nodes_of(`${SETUP}summarize \`stem' in 1/2 using f\n`), 1);
        expect(my_node.inExpression).toBe('1/2');
    });
});

describe('a bracket after a name', () => {
    it('is a subscript, even of the weight macro', () => {
        const my_node = command_at(
            nodes_of('local weight 1\ngenerate x = price[`weight\']\n', true), 1);
        expect(my_node.expression).toBe('price[`weight\']');
        expect(my_node.weight).toBeUndefined();
    });

    it('is still a weight in the syntax idiom', () => {
        const my_node = command_at(
            nodes_of('regress y x [`weight\'`exp\'] if `touse\'\n', true), 0);
        expect(my_node.weight?.keyword).toBe('`weight\'');
        expect(my_node.ifExpression).toBe('`touse\'');
    });
});

describe('free text', () => {
    const FREE_TEXT = [
        'label variable income Change in income using weights',
        'la var income in',
        'lab def yesno 1 in 2 if, modify',
        'label data Change in income using w',
        'char income[note] Change in income using w',
        'note income: three in 1/2',
        'notes: Change in income using w if x',
    ];

    for (const my_statement of FREE_TEXT) {
        it(`has no qualifiers in ${my_statement}`, () => {
            const my_node = command_at(nodes_of(`${my_statement}\n`, true), 0);
            expect(my_node.ifExpression).toBeUndefined();
            expect(my_node.inExpression).toBeUndefined();
            expect(my_node.using).toBeUndefined();
        });
    }

    it('keeps the variable of label variable in the varlist', () => {
        const my_node = command_at(nodes_of('label variable income Change in income\n'), 0);
        expect(my_node.varlist?.slice(0, 2).map((my_item) => my_item.name))
            .toEqual(['variable', 'income']);
    });

    it('keeps the options of label define', () => {
        const my_node = command_at(nodes_of('label define yesno 1 in, modify\n'), 0);
        expect(my_node.options?.map((my_option) => my_option.name)).toEqual(['modify']);
    });

    it('leaves the qualifiers of notes drop and label save', () => {
        expect(command_at(nodes_of('notes drop income in 1\n'), 0).inExpression)
            .toBe('1');
        expect(command_at(nodes_of('notes replace income in 2: new text\n'), 0)
            .inExpression).toBeDefined();
        expect(command_at(nodes_of('label save yesno using f\n', true), 0).using)
            .toBeDefined();
    });

    const SOURCES = [
        ...FREE_TEXT.map((my_statement) => `${my_statement}\n`),
        'quietly label variable income Change in income // why\n',
        'if 1 {\n    note income: a in b\n}\n',
        '#delimit ;\nnote income: Change in\n    income using w;\n#delimit cr\n',
    ];
    for (const my_source of SOURCES) {
        for_each_formatter_mode(`keeps ${JSON.stringify(my_source)} as written`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }
});

describe('comments AST formatting used to drop', () => {
    const SOURCES = [
        'prog def report // called by the export job\n    di 2\nend\n',
        'program define report // called by the export job\n    di 2\nend\n',
        'program report, rclass // why\n    di 2\nend\n',
        'program /* c */ report\n    di 2\nend\n',
        'program report /* c */, rclass\n    di 2\nend\n',
        '#delimit ;\nprogram // header comment\n    define p;\n    di 2;\nend;\n',
        'capture /// tolerate an existing matrix\n    mata: mata drop X\n',
    ];
    for (const my_source of SOURCES) {
        for_each_formatter_mode(`keeps them in ${JSON.stringify(my_source)}`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            for (const my_comment of my_source.match(/\/\/\/?[^\n]*|\/\*[^*]*\*\//g) ?? []) {
                expect(my_once).toContain(my_comment);
            }
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }

    for_each_formatter_mode('still formats a program header with no comment', (my_mode) => {
        expect(format_text('program report\ndi 2\nend\n', my_mode))
            .toBe('program report\n    di 2\nend\n');
    });
});

describe('a run of // comments inside a #delimit ; statement', () => {
    /** How many times the parser reads a token for `count` comments. */
    function token_reads(count: number): number {
        const my_source = '#delimit ;\nkeep first\n' +
            '    // disabled_variable\n'.repeat(count) + '    last;\n';
        const the_tokens = new StataLexer().tokenize(my_source).tokens;
        let my_reads = 0;
        const my_counted = new Proxy(the_tokens, {
            get(my_target, my_key, my_receiver) {
                if (typeof my_key === 'string' && /^\d+$/.test(my_key)) {
                    my_reads++;
                }
                return Reflect.get(my_target, my_key, my_receiver);
            },
        }) as Token[];
        const my_result = new StataParser().parse(my_counted);
        expect(command_at(my_result.ast.nodes, 1).varlist?.map((my_item) => my_item.name))
            .toEqual(['first', 'last']);
        return my_reads;
    }

    it('takes linear time', () => {
        const my_small = token_reads(500);
        const my_large = token_reads(2000);
        // Linear: four times the comments, about four times the reads
        // (quadratic would be sixteen)
        expect(my_large / my_small).toBeLessThan(5);
    });
});
