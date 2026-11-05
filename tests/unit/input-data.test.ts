/**
 * `input` reads the lines after it as data, up to a line whose first
 * word is `end`. Checked in StataMP 18: the data is read literally
 * (`` `v' `` is not expanded), `end foo`, `end // c`, `end;` and an
 * indented `end` all end it, and inside a program definition the
 * data's `end` ends the definition instead.
 */

import { describe, it, expect } from 'bun:test';
import { create_empty_symbol_table, SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(source: string) {
    const lex_result = new StataLexer().tokenize(source);
    return { lex_result, parse_result: new StataParser().parse(lex_result.tokens) };
}

function format_source(source: string, mode: FormatterMode): string {
    const { lex_result, parse_result } = parse(source);
    const edits = new CodeFormatter().format({
        uri: 'file:///input-data.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: create_empty_symbol_table(),
        diagnostics: [],
    }, { tabSize: 4, insertSpaces: true }, create_formatter_config(mode));
    return edits[0]?.newText ?? source;
}

const SOURCE = [
    'input str8 name age',
    '"bob" 25',
    'john `v\'',
    'end',
    'list',
    '',
].join('\n');

describe('input data', () => {
    it('reads the data lines as data, not statements', () => {
        const { parse_result } = parse(SOURCE);
        const the_nodes = parse_result.ast.nodes;
        expect(the_nodes.map((my_node) => my_node.type === 'command'
            ? my_node.name : my_node.type)).toEqual(['input', 'list']);
        const input = the_nodes[0];
        expect(input?.type === 'command' ? input.input_data?.content : null)
            .toBe('"bob" 25\njohn `v\'');
        expect(input?.range.end).toEqual({ line: 3, character: 3 });
    });

    it('does not read a macro in the data', () => {
        const { lex_result, parse_result } = parse(SOURCE);
        const result = new SemanticAnalyzer().analyze(
            parse_result.ast, 'file:///input-data.do', undefined,
            { undefined_macro_enabled: true }, lex_result.tokens);
        expect(result.diagnostics.filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO))
            .toEqual([]);
    });

    it('ends at a line whose first word is end', () => {
        for (const end_line of ['end foo', 'end // done', '  end', 'end;']) {
            const { parse_result } = parse(`input x\n1\n${end_line}\ndi 1\n`);
            expect(parse_result.ast.nodes.map((my_node) => my_node.type === 'command'
                ? my_node.name : my_node.type)).toEqual(['input', 'di']);
        }
    });

    it('has no data in a program definition, whose end it reaches', () => {
        const { parse_result } = parse('program p\n    input z\n    7\nend\n');
        const program = parse_result.ast.nodes[0];
        expect(program?.type).toBe('program');
        expect(program?.type === 'program' ? program.closed_by_end : null).toBe(true);
    });

    it('reads the lines as statements without an end', () => {
        const { parse_result } = parse('input x\ndi 1\n');
        expect(parse_result.ast.nodes.map((my_node) => my_node.type === 'command'
            ? my_node.name : my_node.type)).toEqual(['input', 'di']);
    });

    for_each_formatter_mode('keeps the data as written', (mode) => {
        const source = [
            'if 1 {',
            'input x y',
            '  1    2',
            '"a"  3',
            'end',
            '}',
            '',
        ].join('\n');
        expect(format_source(source, mode)).toBe([
            'if 1 {',
            '    input x y',
            '  1    2',
            '"a"  3',
            '    end',
            '}',
            '',
        ].join('\n'));
    });

    for_each_formatter_mode('keeps an input with no data lines', (mode) => {
        expect(format_source('input x\nend\n', mode)).toBe('input x\nend\n');
    });
});
