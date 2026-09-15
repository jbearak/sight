import { describe, expect } from 'bun:test';
import { create_empty_symbol_table } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const config = create_formatter_config(mode);
    const edits = new CodeFormatter().format({
        uri: 'file:///inline-if.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: create_empty_symbol_table(),
        diagnostics: [],
    }, { tabSize: 4, insertSpaces: true }, config);
    return edits[0]?.newText ?? source;
}

describe('single-statement if formatting', () => {
    for_each_formatter_mode('preserves a nested brace body', mode => {
        const source = [
            'if 1 if 2 {',
            '    local selected yes',
            '}',
            '* following comment',
            'display "`selected\'"',
            '',
        ].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(source);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    const the_adjacent_names = ['L.foo', 'L2.foo', 'F.bar', 'D.foo', 'αβ'];
    for (const my_name of the_adjacent_names) {
        for_each_formatter_mode(`preserves ${my_name} in the condition`, mode => {
            const source = `if ${my_name} == 1 local selected yes\n`;
            const formatted = format_source(source, mode);
            expect(formatted).toBe(source);
            expect(format_source(formatted, mode)).toBe(formatted);
        });
    }

    for_each_formatter_mode('preserves macro operators in brace conditions', mode => {
        const source = [
            "local comparison >",
            "if value `comparison' 1 {",
            '    local selected yes',
            '}',
            '',
        ].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(source);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    const the_embedded_commands = [
        'mata: st_local("selected", "yes")',
        'python: print("selected")',
    ];
    for (const my_command of the_embedded_commands) {
        for_each_formatter_mode(`preserves inline ${my_command}`, mode => {
            const source = `if (1) ${my_command}\ndisplay "done"\n`;
            const formatted = format_source(source, mode);
            expect(formatted).toBe(source);
            expect(format_source(formatted, mode)).toBe(formatted);
        });
        for_each_formatter_mode(`prints one terminator for ${my_command}`, mode => {
            const source = `${my_command}\ndisplay "done"\n`;
            const formatted = format_source(source, mode);
            expect(formatted).toBe(source);
            expect(format_source(formatted, mode)).toBe(formatted);
        });
    }

    for_each_formatter_mode('preserves inline definitions and comments', mode => {
        const source = [
            'if (1) local wide_var cm13 // selected variable',
            '* following comment',
            'display "`wide_var\'"',
            '',
        ].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(source);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps nested inline commands at body depth', mode => {
        const source = [
            'program define example',
            'if (1) {',
            'if (2) if (3) local selected yes',
            '* following comment',
            'display "done"',
            '}',
            'end',
            '',
        ].join('\n');
        const expected = [
            'program define example',
            '    if (1) {',
            '        if (2) if (3) local selected yes',
            '        * following comment',
            '        display "done"',
            '    }',
            'end',
            '',
        ].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(expected);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('preserves an interstitial block comment', mode => {
        const source = 'if (1) /* choose variable */ local selected yes\n';
        const formatted = format_source(source, mode);
        expect(formatted).toBe(source);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('preserves one semicolon per inline if', mode => {
        const source = [
            '#delimit ;',
            'if (1) local selected yes;',
            'display "`selected\'";',
            '#delimit cr',
            '',
        ].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toContain('if (1) local selected yes;\n');
        expect(formatted).not.toContain('{');
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('retains a continued inline body', mode => {
        const source = 'if (1) ///\n    local selected yes\ndisplay "done"\n';
        const formatted = format_source(source, mode);
        const parsed = new StataParser().parse(
            new StataLexer().tokenize(formatted).tokens
        );
        const my_if = parsed.ast.nodes[0];
        expect(parsed.errors).toEqual([]);
        expect(my_if.type).toBe('if');
        if (my_if.type !== 'if') return;
        expect(my_if.is_single_statement).toBe(true);
        expect(my_if.condition).toBe('(1)');
        expect(my_if.body[0].type).toBe('macro_def');
        expect(parsed.ast.nodes[1].type).toBe('command');
        expect(format_source(formatted, mode)).toBe(formatted);
    });
});
