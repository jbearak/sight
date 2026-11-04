import { describe, expect, it } from 'bun:test';
import { create_empty_symbol_table, SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(source: string) {
    const { tokens } = new StataLexer().tokenize(source);
    return { tokens, ...new StataParser().parse(tokens) };
}

function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const edits = new CodeFormatter().format({
        uri: 'file:///program.do',
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

describe('program definitions without define', () => {
    it('parses `program name` as a program with its body', () => {
        const { ast, errors } = parse('program myprog, rclass\n    di 1\nend\n');
        expect(errors).toEqual([]);
        expect(ast.nodes).toHaveLength(1);
        expect(ast.nodes[0]).toMatchObject({
            type: 'program', name: 'myprog', define_options: 'rclass',
        });
        expect(ast.nodes[0]).not.toHaveProperty('define_keyword');
    });

    it('accepts define abbreviations', () => {
        const { ast } = parse('program def myprog\nend\n');
        expect(ast.nodes[0]).toMatchObject({ type: 'program', name: 'myprog', define_keyword: 'def' });
    });

    it('reads a define header split across lines in #delimit ; mode', () => {
        const { ast } = parse('#delimit ;\nprogram define\np;\ndi 1;\nend;\n');
        expect(ast.nodes[1]).toMatchObject({ type: 'program', name: 'p', define_keyword: 'define' });
    });

    it('looks past comments and continuations in the header', () => {
        for (const my_source of [
            'program define /* header */ p\nend\n',
            'program define ///\n    p\nend\n',
        ]) {
            const { ast, errors } = parse(my_source);
            expect(errors).toEqual([]);
            expect(ast.nodes[0]).toMatchObject({ type: 'program', name: 'p', define_keyword: 'define' });
        }
    });

    it('parses a plugin declaration as a command with no body', () => {
        for (const my_source of [
            'program hello, plugin using("hello.plugin")\ndi 1\n',
            'program define hello, plugin\ndi 1\n',
        ]) {
            const { ast, errors } = parse(my_source);
            expect(errors).toEqual([]);
            expect(ast.nodes.map((n) => n.type)).toEqual(['command', 'command']);
        }
    });

    it('does not take a trailing define as the program name', () => {
        const { ast, errors } = parse('program define\ndi 1\n');
        expect(errors.map((e) => e.message)).toContain('Expected program name');
        expect(ast.nodes.some((n) => n.type === 'program')).toBe(false);
    });

    it('leaves program dir, drop, and list as commands', () => {
        for (const my_source of ['program drop myprog', 'program dir', 'program list myprog', 'program l']) {
            const { ast } = parse(`${my_source}\n`);
            expect(ast.nodes[0]).toMatchObject({ type: 'command', name: 'program' });
        }
    });

    it('registers the program for the analyzer', () => {
        const { ast, tokens } = parse('program myprog\n    args a\nend\nmyprog 1\n');
        const result = new SemanticAnalyzer().analyze(ast, 'test://p.do', undefined, undefined, tokens);
        expect(result.symbols.programs.has('myprog')).toBe(true);
    });

    for (const my_declaration of [
        'program hello, plugin using("hello.plugin")',
        'program define hello, plugin',
    ]) {
        for_each_formatter_mode(`keeps ${my_declaration} as a body-less declaration`, (mode) => {
            const source = `if 1 {\n${my_declaration}\ndi 1\n}\n`;
            const expected = `if 1 {\n    ${my_declaration}\n    di 1\n}\n`;
            const formatted = format_source(source, mode);
            expect(formatted).toBe(expected);
            expect(format_source(formatted, mode)).toBe(formatted);
        });
    }

    for_each_formatter_mode('indents the body like a program define body', (mode) => {
        const source = 'program myprog, rclass\ndi 1\nend\nprogram define p2\ndi 2\nend\n';
        const expected = 'program myprog, rclass\n    di 1\nend\nprogram define p2\n    di 2\nend\n';
        const formatted = format_source(source, mode);
        expect(formatted).toBe(expected);
        expect(format_source(formatted, mode)).toBe(formatted);
    });
});
