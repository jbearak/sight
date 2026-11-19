/**
 * Parser bugs in code new since v0.15.1, each checked against StataMP 18:
 *
 * - `mata: ///` then `x = 2` runs `x = 2` in Mata: the `///` joins the
 *   lines. The parser stopped at the line break, so `x = 2` became a
 *   Stata command and AST formatting printed `mata: /// note` then
 *   `V = X'` as `V = X`, dropping the transpose.
 * - `` svy, `opts': mean income `` lost `` `opts' `` (a `subpop()`)
 *   when AST formatting printed the prefix.
 * - `if 1 mata` opens a Mata block that runs to its `end`; the parser
 *   read `1 mata` as the condition.
 */

import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataNode } from '../../src/types';
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

function nodes_of(my_source: string): StataNode[] {
    return parse(my_source).ast.nodes;
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

describe('an inline mata: statement continued with ///', () => {
    it('takes the next line as its Mata code', () => {
        const the_nodes = nodes_of('mata: ///\nx = 2\nlocal ok 1\n');
        expect(the_nodes.map((my_node) => my_node.type))
            .toEqual(['embedded_block', 'macro_def']);
        const my_block = the_nodes[0];
        if (my_block?.type !== 'embedded_block') throw new Error('no block');
        expect(my_block.content).toBe('x = 2');
        expect(my_block.range.end).toEqual({ line: 1, character: 5 });
    });

    it('joins code on both lines with a space', () => {
        const my_block = nodes_of('mata: x = /// note\n    2\n')[0];
        if (my_block?.type !== 'embedded_block') throw new Error('no block');
        expect(my_block.content).toBe('x = 2');
    });

    it('keeps strings, braces and quotes on the continued line', () => {
        const my_block = nodes_of(
            'mata: ///\n    if (1) { s = "a//b" ; V = X\' }\ndi 1\n')[0];
        if (my_block?.type !== 'embedded_block') throw new Error('no block');
        expect(my_block.content).toBe('if (1) { s = "a//b" ; V = X\' }');
    });

    it('still ends at an unjoined line break', () => {
        const the_nodes = nodes_of('mata: x = 1\nlocal ok 1\n');
        expect(the_nodes.map((my_node) => my_node.type))
            .toEqual(['embedded_block', 'macro_def']);
    });

    const SOURCES = [
        'mata: /// transpose\n    V = X\'\n',
        'python: /// note\n    print(1)\n',
    ];
    for (const my_source of SOURCES) {
        for_each_formatter_mode(`keeps the code of ${JSON.stringify(my_source)}`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            const my_code = my_source.split('\n')[1].trim();
            expect(my_once).toContain(my_code);
            expect(my_once).toContain(my_source.split('\n')[0]);
            expect(format_text(my_once, my_mode)).toBe(my_once);
        });
    }

    it('is printed on one line when its /// has no note', () => {
        expect(format_text('quietly mata: ///\n    V = X\'\n', 'ast'))
            .toBe('quietly mata: V = X\'\n');
    });
});

describe('prefix options from a macro', () => {
    it('are options of the prefix', () => {
        const my_node = nodes_of(
            'svy, `opts\' $g ${h} `o\'(x) subpop(a): mean income\n')[0];
        if (my_node?.type !== 'command') throw new Error('no command');
        const my_prefix = my_node.prefix?.[0];
        expect(my_prefix?.options?.map((my_option) =>
            [my_option.name, my_option.argument])).toEqual([
            ['`opts\'', undefined],
            ['$g', undefined],
            ['${h}', undefined],
            ['`o\'', 'x'],
            ['subpop', 'a'],
        ]);
        expect(my_node.name).toBe('mean');
    });

    const SOURCES = [
        'local opts subpop(eligible)\nsvy, `opts\': mean income\n',
        'svy linearized, `opts\' $more: mean income\n',
        'bootstrap r(mean), reps(10) `x\'_y: summarize y\n',
    ];
    for (const my_source of SOURCES) {
        for_each_formatter_mode(`keeps them in ${JSON.stringify(my_source)}`, (my_mode) => {
            const my_once = format_text(my_source, my_mode);
            expect(my_once).toBe(my_source);
        });
    }
});

describe('an if whose command is mata or python', () => {
    for (const [my_language, my_line] of [['mata', 'x = 1'], ['python', 'print(1)']]) {
        it(`opens a ${my_language} block to its end`, () => {
            const my_result = parse(`if 1 ${my_language}\n${my_line}\nend\ndisplay 2\n`);
            expect(my_result.errors).toEqual([]);
            const [my_if, my_display] = my_result.ast.nodes;
            if (my_if?.type !== 'if') throw new Error('no if');
            expect(my_if.condition).toBe('1');
            expect(my_if.is_single_statement).toBe(true);
            const my_block = my_if.body[0];
            if (my_block?.type !== 'embedded_block') throw new Error('no block');
            expect(my_block.language).toBe(my_language);
            expect(my_block.content).toBe(my_line);
            expect(my_display?.type).toBe('command');
        });
    }

    for_each_formatter_mode('keeps if 1 mata and its block', (my_mode) => {
        const my_source = 'if 1 mata\nx = 1\nend\ndisplay 2\n';
        const my_once = format_text(my_source, my_mode);
        expect(my_once).toBe(my_source);
    });
});
