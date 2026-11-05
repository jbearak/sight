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
function format_source(source: string, mode: FormatterMode, allow_errors = false): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    if (!allow_errors) {
        expect(parse_result.errors).toEqual([]);
    }
    const edits = new CodeFormatter().format({
        uri: 'file:///statement-structure.do',
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

// Statements the parser used to split into several nodes (or truncate):
// prefixes with arguments, `by` varlists, weights, and operators after a
// varlist. Both formatters must keep each one whole on its line.
const STATEMENTS = [
    'assert x > 0',
    'display a + b',
    'svy: reg y x',
    'version 14: gen x = 1',
    'bootstrap, reps(10): reg y x',
    'reg y x if a [pw=w]',
    'gen x:lbl = 1',
    'tab x [fw=n]',
    'collapse (mean) x (sum) y [aw=w], by(g)',
    'mi estimate, dots: reg y x',
    'quietly bys id (t), sort: gen n = _n',
    'capture noisily by id: replace x = 1 if missing(x)',
    'merge m:1 id using `f\', nogen',
    'merge 1:1 id using "data`v\'.dta", keep(match)',
    'append using a b, force',
    'gettoken a b : c, parse(" ")',
    'log using "x.log", replace text',
    'scalar s = M[1, 2]',
    'infix id 1-3 using data.raw',
    'use x - z using f',
    'fp <x_pow>: reg y <x_pow>',
    'version 14: local x = 1',
    'capture local y 2',
];

describe('formatting statements with prefixes, weights, and extra arguments', () => {
    for_each_formatter_mode('re-indents each statement and keeps it whole', mode => {
        const source = ['if 1 {', ...STATEMENTS, '}', ''].join('\n');
        const expected = ['if 1 {', ...STATEMENTS.map((s) => `    ${s}`), '}', ''].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(expected);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('indents a loop after a colon prefix', mode => {
        const source = ['version 14: foreach x in a b {', 'di 1', '}', ''].join('\n');
        const expected = ['version 14: foreach x in a b {', '    di 1', '}', ''].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(expected);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps a macro value with an interior comment on one line', mode => {
        const source = 'if 1 {\nlocal x a /* note */ b\n}\n';
        const formatted = format_source(source, mode);
        // Neither mode may split `b` into a statement of its own. The AST
        // printer moves the comment after the value.
        expect(formatted.split('\n')[1]).toBe(mode === 'ast'
            ? '    local x a b /* note */'
            : '    local x a /* note */ b');
        expect(formatted.split('\n')).toHaveLength(4);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps a continued varlist in one statement', mode => {
        const source = ['if 1 {', 'reg y x ///', '    z w, robust', '}', ''].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted.split('\n')[1]).toMatch(/^ {4}reg y x/);
        expect(formatted).toContain('z w, robust');
        expect(format_source(formatted, mode)).toBe(formatted);
    });
});

// Statements with a block comment between their tokens. The
// source-preserving formatter keeps each line as written. The AST printer
// keeps every comment: one among the arguments stays in place, and one
// inside an expression, qualifier, weight, or option list moves to the end
// of the statement, where Stata still reads the same code.
const INTERIOR_COMMENTS: Array<[string, string]> = [
    ['reg y /* explanation */ x', 'reg y /* explanation */ x'],
    // A parenthesized group prints its own comments, once.
    ['collapse (mean /* c */) x (sum) /* d */ y', 'collapse (mean /* c */) x (sum) /* d */ y'],
    ['reg y/* c */ x', 'reg y /* c */ x'],
    // A standalone string statement keeps its source, comments included.
    ['"a" /* c */ "b"', '"a" /* c */ "b"'],
    ['gen x = a /* c */ + b', 'gen x = a + b /* c */'],
    ['keep if a /* c */ & b', 'keep if a & b /* c */'],
    ['gen x = a /* c */ * b', 'gen x = a * b /* c */'],
    ['sum x if y /* c */ > 0, detail', 'sum x if y > 0, detail /* c */'],
    ['reg y x [aw=w /* c */ * 2]', 'reg y x [aw=w * 2] /* c */'],
    ['reg y x, robust /* c */ cluster(id)', 'reg y x, robust cluster(id) /* c */'],
    ['local z = a /* c */ + b', 'local z = a + b /* c */'],
    ['reg y /* a */ x if b /* c */ & d // note', 'reg y /* a */ x if b & d /* c */ // note'],
    // A comment around the colon of unab or a prefix; one inside the
    // prefixes goes before the command's arguments.
    ['unab x /* c */ : a b', 'unab x: /* c */ a b'],
    ['unab x : a /* c */ b', 'unab x: a /* c */ b'],
    ['unab x : a b, /* c */ min(1)', 'unab x: a b, min(1) /* c */'],
    ['quietly /* c */ : gen x = 1', 'quietly: gen /* c */ x = 1'],
    ['capture /* c */ noisily gen x = 1', 'capture noisily gen /* c */ x = 1'],
    ['version 14: /* c */ gen x = 1', 'version 14: gen /* c */ x = 1'],
];

describe('formatting statements with interior block comments', () => {
    for_each_formatter_mode('keeps each comment and each statement whole', mode => {
        const source = ['if 1 {', ...INTERIOR_COMMENTS.map(([s]) => s), '}', ''].join('\n');
        const expected = [
            'if 1 {',
            ...INTERIOR_COMMENTS.map(([my_source, my_ast]) =>
                `    ${mode === 'ast' ? my_ast : my_source}`),
            '}',
            '',
        ].join('\n');
        const formatted = format_source(source, mode);
        expect(formatted).toBe(expected);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps a comment at the end of the line after the statement', mode => {
        const source = 'gen x = a /* c */\nkeep if b /* d */ // note\n';
        const formatted = format_source(source, mode);
        expect(formatted).toBe(source);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps a comment between a prefix and a block, and the block', mode => {
        // Loops, if blocks, and braces don't keep interior comments, so
        // a comment before one stays out of the prefix chain.
        const the_sources = [
            'version 14: /* c */ foreach x in a b {\n    di 1\n}\n',
            'capture /* c */ while 1 {\n    di 1\n}\n',
            'quietly /* c */ : foreach x in a {\n    di 1\n}\n',
            'quietly /* c */ if 1 {\n    di 1\n}\n',
        ];
        for (const my_source of the_sources) {
            const formatted = format_source(my_source, mode, true);
            expect(formatted).toContain('/* c */');
            expect(formatted).toContain('di 1');
        }
    });

    for_each_formatter_mode('keeps a comment before syntax, also after ///', mode => {
        // syntax nodes don't keep interior comments either. The command
        // after `///` decides, as on the same line. (AST formatting
        // already drops a prefixed syntax, and what follows `///` here,
        // on main; this checks only the comment.)
        for (const my_source of [
            'capture /* c */ noisily syntax varlist\n',
            'capture /* c */ noisily ///\n    syntax varlist\n',
            'quietly /* c */ : ///\n    syntax varlist\n',
            'capture /* c */ noisily ///\n    foreach x in a {\n    di 1\n}\n',
        ]) {
            expect(format_source(my_source, mode, true)).toContain('/* c */');
        }
    });

    for_each_formatter_mode('keeps a * line that continues a #delimit ; statement', mode => {
        const source = '#delimit ;\ngen y = a\n* b;\ngen z = 1;\n#delimit cr\n';
        const formatted = format_source(source, mode);
        // Stata 18 reads `* b` here as multiplication, not a comment.
        if (mode === 'ast') {
            expect(formatted).toContain('gen y = a * b;\ngen z = 1;');
        } else {
            expect(formatted).toBe(source);
        }
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps a * comment that runs to the next ; under #delimit ;', mode => {
        // Stata 18 runs none of the code inside these comments.
        for (const my_source of [
            '#delimit ;\n* comment\ngen q = 9;\ngen r = 1;\n#delimit cr\n',
            '#delimit ;\n* c // x ; gen q = 1;\ngen r = 1;\n#delimit cr\n',
            '#delimit ;\n* c /* ;\n */ gen q = 1;\ngen r = 1;\n#delimit cr\n',
        ]) {
            const formatted = format_source(my_source, mode);
            expect(formatted).toBe(my_source);
            expect(format_source(formatted, mode)).toBe(formatted);
        }
    });

    for_each_formatter_mode('keeps a * comment between #delimit ; statements, with its one ;', mode => {
        for (const [my_source, my_ast] of [
            ['#delimit ;\ngen y = 1;\n* multi\n  line\n  gen q = 9;\ngen r = 1;\n#delimit cr\n', undefined],
            ['#delimit ;\ngen y = a;\n* one;\n* two;\n#delimit cr\n', undefined],
            ['#delimit ;\ngen y = a; * c; gen z = 2;\n#delimit cr\n',
                '#delimit ;\ngen y = a;\n* c;\ngen z = 2;\n#delimit cr\n'],
        ] as const) {
            const formatted = format_source(my_source, mode);
            expect(formatted).toBe(mode === 'ast' && my_ast ? my_ast : my_source);
            expect(format_source(formatted, mode)).toBe(formatted);
        }
    });

    for_each_formatter_mode('keeps a * comment that runs to the end of the file under #delimit ;', mode => {
        const source = '#delimit ;\ngen r = 1;\n* c\n#delimit cr\ngen q = 1\n';
        const formatted = format_source(source, mode);
        expect(formatted).toContain('gen r = 1;\n* c\n#delimit cr\ngen q = 1');
        expect(formatted).not.toContain('gen q = 1;');
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps the line a * comment joins with ///', mode => {
        const source = '* c ///\ngen q = 1\ngen r = 1\n';
        const formatted = format_source(source, mode);
        expect(formatted).toBe(source);
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('keeps * after /// or a colon as code', mode => {
        for (const [my_source, my_ast] of [
            ['gen r = a ///\n* b\n', 'gen r = a * b\n'],
            ['unab x : *\n', 'unab x:*\n'],
            ['mata: z = x :* y\n', 'mata: z = x :* y\n'],
            ['mata:\nz = x :* y\nw = (x\n:* y)\nend\n', 'mata:\nz = x :* y\nw = (x\n:* y)\nend\n'],
        ]) {
            const formatted = format_source(my_source, mode);
            expect(formatted).toBe(mode === 'ast' ? my_ast : my_source);
            expect(format_source(formatted, mode)).toBe(formatted);
        }
    });

    for_each_formatter_mode('keeps interior comments in #delimit ; mode', mode => {
        const source = '#delimit ;\nreg y /* c */ x;\ngen z = a /* d */ * b;\n#delimit cr\n';
        const formatted = format_source(source, mode);
        expect(formatted).toContain('reg y /* c */ x;');
        expect(formatted).toContain(mode === 'ast' ? 'gen z = a * b /* d */;' : 'gen z = a /* d */ * b;');
        expect(format_source(formatted, mode)).toBe(formatted);
    });
});
