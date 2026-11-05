import { describe, expect, it } from 'bun:test';
import { create_empty_symbol_table } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
    mode_specific_assertion,
} from '../property/helpers/formatter-test-utils';

/** Format a fixture in the selected mode and return the resulting source. */
function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const edits = new CodeFormatter().format({
        uri: 'file:///syntax-statement.do',
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

/** Format twice and check the second pass changes nothing. */
function format_idempotent(source: string, mode: FormatterMode): string {
    const formatted = format_source(source, mode);
    expect(format_source(formatted, mode)).toBe(formatted);
    return formatted;
}

const SIGNATURE = 'syntax varlist(numeric) [if] [in] [, Detail Level(cilevel)]';

// The AST printer used to print nothing for a `syntax` statement, which
// deleted it from the program.
describe('formatting a syntax statement', () => {
    for_each_formatter_mode('keeps a bare syntax', mode => {
        expect(format_idempotent('syntax\n', mode)).toBe('syntax\n');
    });

    for_each_formatter_mode('keeps syntax with a varlist', mode => {
        expect(format_idempotent('syntax varlist\n', mode))
            .toBe('syntax varlist\n');
    });

    for_each_formatter_mode('keeps a bare syntax inside a program', mode => {
        expect(format_idempotent('program p\nsyntax\nend\n', mode))
            .toBe('program p\n    syntax\nend\n');
    });

    for_each_formatter_mode('keeps a full signature, case included', mode => {
        const source = `program p\n${SIGNATURE}\nend\n`;
        expect(format_idempotent(source, mode))
            .toBe(`program p\n    ${SIGNATURE}\nend\n`);
    });

    for_each_formatter_mode('keeps a signature continued with ///', mode => {
        const source = [
            'program p',
            'syntax varlist(numeric) [if] [in] ///',
            '[, Detail Level(cilevel)]',
            'end',
            '',
        ].join('\n');
        const formatted = format_idempotent(source, mode);
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                expect(formatted).toBe([
                    'program p',
                    '    syntax varlist(numeric) [if] [in] ///',
                    '    [, Detail Level(cilevel)]',
                    'end',
                    '',
                ].join('\n'));
            },
            // The AST printer joins continued lines, as it does for
            // commands.
            'ast': () => {
                expect(formatted).toBe(`program p\n    ${SIGNATURE}\nend\n`);
            },
        });
    });

    for_each_formatter_mode('keeps the words around a /// continuation apart', mode => {
        const source = 'program p\nsyntax varlist, Detail ///\nLevel(real 95)\nend\n';
        const formatted = format_idempotent(source, mode);
        expect(formatted).not.toContain('DetailLevel');
        expect(formatted).toContain('Level(real 95)');
    });

    for_each_formatter_mode('keeps a multi-line signature under #delimit ;', mode => {
        const source = [
            '#delimit ;',
            'program p;',
            'syntax varlist',
            '[if] [, Detail];',
            'end;',
            '#delimit cr',
            '',
        ].join('\n');
        const formatted = format_idempotent(source, mode);
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                expect(formatted).toContain('syntax varlist\n[if] [, Detail];');
            },
            'ast': () => {
                expect(formatted).toBe([
                    '#delimit ;',
                    'program p;',
                    '    syntax varlist [if] [, Detail];',
                    'end;',
                    '#delimit cr',
                    '',
                ].join('\n'));
            },
        });
    });

    for_each_formatter_mode('keeps prefixes and comments', mode => {
        const source = [
            'program p',
            '* parse the call',
            'quietly syntax anything [, *] // all options',
            'end',
            '',
        ].join('\n');
        expect(format_idempotent(source, mode)).toBe([
            'program p',
            '    * parse the call',
            '    quietly syntax anything [, *] // all options',
            'end',
            '',
        ].join('\n'));
    });

    for_each_formatter_mode('keeps syntax after prefixes', mode => {
        const the_statements = [
            'capture syntax',
            'capture syntax varlist',
            'quietly syntax anything [, *]',
            'capture noisily syntax varlist',
            `cap noi ${SIGNATURE}`,
            'version 14: syntax varlist',
        ];
        const source = ['program p', ...the_statements, 'end', ''].join('\n');
        expect(format_idempotent(source, mode)).toBe([
            'program p',
            ...the_statements.map(my_statement => `    ${my_statement}`),
            'end',
            '',
        ].join('\n'));
    });

    for_each_formatter_mode('keeps syntax whole after a comment between prefixes', mode => {
        const source = 'program p\ncapture /* c */ noisily syntax varlist\nend\n';
        const formatted = format_idempotent(source, mode);
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                expect(formatted).toBe(
                    'program p\n    capture /* c */ noisily syntax varlist\nend\n');
            },
            'ast': () => {
                expect(formatted).toBe(
                    'program p\n    capture noisily syntax varlist /* c */\nend\n');
            },
        });
    });

    for_each_formatter_mode('keeps a spec with strings and macros as written', mode => {
        const source =
            'syntax [anything(name=x id="a b")] using/ [, TItle(string asis) `opt\']\n';
        expect(format_idempotent(source, mode)).toBe(source);
    });

    for_each_formatter_mode('keeps the spec after a block comment', mode => {
        const source = 'program p\nsyntax varlist /* c */ [if]\nend\n';
        const formatted = format_idempotent(source, mode);
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                expect(formatted)
                    .toBe('program p\n    syntax varlist /* c */ [if]\nend\n');
            },
            // As for commands, the AST printer moves the comment to the
            // end of the statement.
            'ast': () => {
                expect(formatted)
                    .toBe('program p\n    syntax varlist [if] /* c */\nend\n');
            },
        });
    });
});

describe('parsing a syntax statement with a block comment', () => {
    it('reads the comment as whitespace and keeps the rest of the spec', () => {
        const source = 'program p\nsyntax varlist /* c */ [if]\nend\n';
        const parse_result = new StataParser()
            .parse(new StataLexer().tokenize(source).tokens);
        expect(parse_result.errors).toEqual([]);
        const program = parse_result.ast.nodes[0];
        if (program?.type !== 'program') {
            throw new Error('expected a program');
        }
        expect(program.body.map(my_node => my_node.type)).toEqual(['syntax']);
        const syntax_node = program.body[0];
        if (syntax_node?.type !== 'syntax') {
            throw new Error('expected a syntax statement');
        }
        expect(syntax_node.signature.arguments.map(my_arg => my_arg.type))
            .toEqual(['varlist', 'if']);
        expect(syntax_node.arguments).toBe('varlist [if]');
        expect(syntax_node.interiorTrivia?.map(my_comment => my_comment.content))
            .toEqual(['/* c */']);
    });

    it('reads a comment between prefixes as whitespace', () => {
        const parse_result = new StataParser().parse(new StataLexer()
            .tokenize('capture /* c */ noisily syntax varlist\n').tokens);
        expect(parse_result.ast.nodes.map(my_node => my_node.type))
            .toEqual(['syntax']);
        const syntax_node = parse_result.ast.nodes[0];
        if (syntax_node?.type !== 'syntax') {
            throw new Error('expected a syntax statement');
        }
        expect(syntax_node.prefix?.map(my_prefix => my_prefix.name))
            .toEqual(['capture', 'noisily']);
        expect(syntax_node.interiorTrivia?.map(my_comment => my_comment.content))
            .toEqual(['/* c */']);
    });

    it('leaves a block comment at the end as trailing trivia', () => {
        const parse_result = new StataParser()
            .parse(new StataLexer().tokenize('syntax varlist /* c */\n').tokens);
        const syntax_node = parse_result.ast.nodes[0];
        if (syntax_node?.type !== 'syntax') {
            throw new Error('expected a syntax statement');
        }
        expect(syntax_node.interiorTrivia).toBeUndefined();
        expect(syntax_node.trailingTrivia?.map(my_comment => my_comment.content))
            .toEqual(['/* c */']);
    });
});
