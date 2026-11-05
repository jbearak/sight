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

/** Format a fixture in the selected mode and return the resulting source. */
function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const edits = new CodeFormatter().format({
        uri: 'file:///own-line-comments.do',
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

/** Format twice and require the second pass to change nothing. */
function format_stable(source: string, mode: FormatterMode): string {
    const formatted = format_source(source, mode);
    expect(format_source(formatted, mode)).toBe(formatted);
    return formatted;
}

describe('#delimit directives', () => {
    // `#delimit ;` ends at the end of its line; only the statements
    // after it take `;`.
    const SOURCES = [
        '#delimit ;\ndi 1;\n#delimit cr\n',
        '#delimit ;\ndi 1;\ndi 2;\n#delimit cr\ndi 3\n',
        // The comment after `#delimit ;` is attached to the directive.
        '#delimit ;\n* lead;\ndi 1;\n#delimit cr\n',
        '#delimit ;\n// lead\ndi 1;\n#delimit cr\n',
    ];

    for_each_formatter_mode('take no statement terminator', mode => {
        for (const my_source of SOURCES) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });
});

describe('comment-only lines at the end of the file', () => {
    // Each comment must keep its own line: after code on the same line,
    // `* tail` would be read as multiplication.
    const SOURCES = [
        'di 1\n* tail\n',
        'di 1\n* tail\n* tail2\n',
        'di 1\n// tail\n',
        'di 1\n/* tail */\n',
        'di 1\n/* a\n b */ * c\n',
        'di 1 // trailing\n* tail\n',
        'program foo\n    di 1\nend\n* tail\n',
        'if 1 {\n    di 1\n}\n// tail\n',
        'if 1 di 1\n* tail\n',
        'mata:\nx = 1\nend\n* tail\n',
        '"hello"\n* tail\n',
        '#delimit ;\ndi 1;\n#delimit cr\n* tail\n',
        '* only\n',
        '* a\n/* b */ // c\n',
    ];

    for_each_formatter_mode('stay on their own lines', mode => {
        for (const my_source of SOURCES) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });

    for_each_formatter_mode('stay on their own lines after a blank line', mode => {
        const formatted = format_stable('di 1\n\n// tail\n', mode);
        const the_lines = formatted.split('\n').filter(line => line !== '');
        expect(the_lines).toEqual(['di 1', '// tail']);
    });

    for_each_formatter_mode('stay on their own lines in #delimit ; mode', mode => {
        for (const my_source of [
            '#delimit ;\ndi 1;\n// tail\n',
            '#delimit ;\ndi 1;\n* tail;\n',
        ]) {
            const formatted = format_stable(my_source, mode);
            expect(formatted.trimEnd()).toBe(my_source.trimEnd());
        }
    });

    for_each_formatter_mode(
        'stay after the terminator of a #delimit ; statement', mode => {
            // The comment sits between the code and its `;`. Before the
            // fix, `di 1 // c;` swallowed the terminator. It is indented:
            // at column 0, Stata 18 reads it as code, since the
            // statement began on the line above.
            for (const my_source of [
                '#delimit ;\ndi 1\n    // c\n;\n',
                '#delimit ;\nif 1 di 1\n    // c\n;\n',
            ]) {
                const the_lines = format_stable(my_source, mode)
                    .split('\n')
                    .map(line => line.trim());
                expect(the_lines).toContain('// c');
                expect(the_lines.some(line => line.endsWith('// c;'))).toBe(false);
            }
        });
});
