import { describe, expect, it } from 'bun:test';
import { create_empty_symbol_table } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataNode } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
    mode_specific_assertion,
    skip_for_mode,
} from '../property/helpers/formatter-test-utils';

/** Format a fixture in the selected mode and return the resulting source. */
function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const edits = new CodeFormatter().format({
        uri: 'file:///continuation-notes.do',
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

/** `the_lines` inside `if 1 { }`, as written and as formatted. */
function in_block(the_lines: string[]): { source: string; expected: string } {
    return {
        source: ['if 1 {', ...the_lines, '}', ''].join('\n'),
        expected: ['if 1 {', ...the_lines.map(my_line => `    ${my_line}`), '}', '']
            .join('\n'),
    };
}

// The AST printer used to join the lines of a continued statement and
// drop the note after each `///`: `reg y x /// note` then `z` became
// `reg y x z`. Statements keep their lines when a `///` has a note.
const NOTED_STATEMENTS: Array<[string, string[]]> = [
    ['a command', ['reg y x /// outcome first', '    z']],
    ['options', ['reg y x, /// see appendix', '    robust']],
    ['an if qualifier', ['reg y x if a > 1 & /// adults', '    b < 2']],
    ['an expression', ['gen x = 1 + /// base', '    2']],
    ['a macro value', ['local a b /// first two', '    c']],
    ['a macro expression', ['local a = 1 + /// base', '    2']],
    ['prefixes', ['capture noisily reg y x /// note', '    z']],
    ['an inline if', ['if a & /// note', '    b di 1']],
    ['a comment after the statement', ['reg y x /// note', '    z // trail']],
    ['a nested inline if', ['if a if b di 1 /// note', '    + 2 // trail']],
];

describe('formatting a statement with a note after ///', () => {
    for (const [my_name, my_lines] of NOTED_STATEMENTS) {
        for_each_formatter_mode(`keeps the note and lines of ${my_name}`, mode => {
            const { source, expected } = in_block(my_lines);
            expect(format_idempotent(source, mode)).toBe(expected);
        });
    }

    for_each_formatter_mode('keeps the note and lines of syntax', mode => {
        const source = [
            'program p',
            'syntax varlist /// what to summarize',
            '    [if] [, Detail]',
            'end',
            '',
        ].join('\n');
        expect(format_idempotent(source, mode)).toBe([
            'program p',
            '    syntax varlist /// what to summarize',
            '        [if] [, Detail]',
            'end',
            '',
        ].join('\n'));
    });

    const NOTED_HEADERS: Array<[string, string[]]> = [
        ['an if header', ['if a > 1 & /// adults', '    b < 2 {']],
        ['a foreach header', ['foreach v in a /// first', '    b {']],
        ['a forvalues header', ['forvalues i = 1 /// from', '    / 3 {']],
        ['a while header', ['while a & /// note', '    b {']],
        ['a header with { on its own line', ['foreach v in a b /// note', '{']],
    ];
    for (const [my_name, my_header] of NOTED_HEADERS) {
        for_each_formatter_mode(`keeps the note and lines of ${my_name}`, mode => {
            const { source, expected } = in_block([...my_header, 'di 1', '}']);
            const expected_body = expected.replace('    di 1', '        di 1');
            expect(format_idempotent(source, mode)).toBe(expected_body);
        });
    }

    for_each_formatter_mode('moves continuation lines with the statement', mode => {
        const source = 'if 1 {\nreg y x /// note\n  z\n}\n        di 1 /// note\n    + 2\n';
        expect(format_idempotent(source, mode))
            .toBe('if 1 {\n    reg y x /// note\n      z\n}\ndi 1 /// note\n+ 2\n');
    });

    // Whether a continued line is indented decides whether it joins the
    // token before the `///`: `b///` then `c` at column 0 is `bc`.
    for_each_formatter_mode('keeps whether a continued line joins', mode => {
        // The source-preserving formatter re-indents continued lines and
        // changes both values; that is a separate bug.
        skip_for_mode(mode, 'source-preserving', () => {
            // A `///` alone on a line continues a tight chain only from
            // column 0.
            const the_cases: Array<[string, string]> = [
                ['if 1 {\nlocal a b/// note\nc\n}\n', 'bc'],
                ['        local a b/// note\n    c\n', 'b c'],
                ['if 1 {\nlocal a b/// note\n///\nc\n}\n', 'bc'],
                ['if 1 {\nlocal a b /// note\n/// note\nc\n}\n', 'b c'],
                ['if 1 {\nlocal a b/// note\n  ///\nc\n}\n', 'b c'],
            ];
            for (const [my_source, my_value] of the_cases) {
                expect(macro_values(my_source)).toEqual([my_value]);
                const formatted = format_idempotent(my_source, mode);
                expect(macro_values(formatted)).toEqual([my_value]);
            }
        });
    });

    for_each_formatter_mode('still joins a /// with no note', mode => {
        const formatted = format_idempotent('reg y x ///\n    z\n', mode);
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                expect(formatted).toBe('reg y x ///\n    z\n');
            },
            'ast': () => {
                expect(formatted).toBe('reg y x z\n');
            },
        });
    });
});

/** Values of the macro definitions in `source`, in blocks too. */
function macro_values(source: string): string[] {
    const the_values: string[] = [];
    const visit = (the_nodes: StataNode[]): void => {
        for (const my_node of the_nodes) {
            if (my_node.type === 'macro_def') {
                the_values.push(my_node.value);
            } else if ('body' in my_node && Array.isArray(my_node.body)) {
                visit(my_node.body);
            }
        }
    };
    visit(parse_nodes(source));
    return the_values;
}

/** Parse `source` and return its top-level statements. */
function parse_nodes(source: string): StataNode[] {
    const parse_result = new StataParser()
        .parse(new StataLexer().tokenize(source).tokens);
    expect(parse_result.errors).toEqual([]);
    return parse_result.ast.nodes;
}

describe('parsing a statement with a note after ///', () => {
    it('keeps its lines and their columns', () => {
        const [node] = parse_nodes('  reg y x /// note\n      z ///\n  w\n');
        expect(node?.type).toBe('command');
        if (node?.type !== 'command') {
            return;
        }
        expect(node.noted_lines).toEqual([
            { column: 2, text: 'reg y x /// note' },
            { column: 6, text: 'z ///' },
            { column: 2, text: 'w' },
        ]);
    });

    it('keeps only the header of a block', () => {
        const [node] = parse_nodes('foreach v in a /// note\n b {\ndi 1 /// two\n 2\n}\n');
        if (node?.type !== 'foreach') {
            throw new Error('expected a foreach loop');
        }
        expect(node.noted_lines).toEqual([
            { column: 0, text: 'foreach v in a /// note' },
            { column: 1, text: 'b {' },
        ]);
        const body = node.body[0];
        expect(body?.type === 'command' ? body.noted_lines?.length : 0).toBe(2);
    });

    it('keeps nothing for a /// without a note or one in a string', () => {
        for (const my_source of ['reg y x ///\nz\n', 'di "a /// b"\n']) {
            const [node] = parse_nodes(my_source);
            expect(node !== undefined && 'noted_lines' in node).toBe(false);
        }
    });
});
