/**
 * Indentation of the later lines of a statement under `#delimit ;`.
 *
 * Under `#delimit ;` a line break is whitespace, so each later line of a
 * statement continues it, as the line after a `///` does in
 * `#delimit cr`. Source-preserving formatting indents the two the same
 * way; it used to put every such line at column 0.
 */

import { describe, expect, it } from 'bun:test';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ContextTracker } from '../../src/context-tracker';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataNode } from '../../src/types';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

interface FormatOptions {
    preserve_alignment?: boolean;
    insert_spaces?: boolean;
}

/** Format a fixture in the selected mode and return the resulting source. */
function format_source(
    source: string,
    mode: FormatterMode,
    options: FormatOptions = {}
): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const tracker = new ContextTracker();
    tracker.initialize_from_tokens(lex_result.tokens, source);
    const config = create_formatter_config(mode);
    config.formatting = {
        ...config.formatting,
        preserve_alignment: options.preserve_alignment ?? true,
    };
    const edits = new CodeFormatter().format({
        uri: 'file:///delimit-continuation-indent.do',
        content: source,
        version: 1,
        ast: parse_result.ast,
        tokens: lex_result.tokens,
        line_offsets: lex_result.line_offsets,
        symbols: create_empty_symbol_table(),
        diagnostics: [],
        context_ranges: tracker.get_all_context_ranges(),
    }, { tabSize: 4, insertSpaces: options.insert_spaces ?? true }, config);
    return edits[0]?.newText ?? source;
}

/** Format twice and require the second pass to change nothing. */
function format_stable(
    source: string,
    mode: FormatterMode,
    options: FormatOptions = {}
): string {
    const formatted = format_source(source, mode, options);
    expect(format_source(formatted, mode, options)).toBe(formatted);
    return formatted;
}

/** The leading whitespace of each line. */
function indents(source: string): string[] {
    return source.split('\n').map(my_line => my_line.match(/^[ \t]*/)?.[0] ?? '');
}

/**
 * One program with a statement whose lines are `the_lines`, written
 * with `///` continuations under `#delimit cr` and as one statement
 * under `#delimit ;`. Both start with a `#delimit` line so the line
 * numbers match.
 */
function cr_and_semicolon(the_lines: string[]): [string, string] {
    const cr = ['#delimit cr', 'program foo', the_lines.join(' ///\n'), 'end', ''];
    const semicolon = ['#delimit ;', 'program foo;', the_lines.join('\n') + ';', 'end;', ''];
    return [cr.join('\n'), semicolon.join('\n')];
}

describe('continuation lines under #delimit ;', () => {
    // Statement layouts: the first line's indentation, then each
    // continuation line's.
    const LAYOUTS: string[][] = [
        ['reg y x', 'z'],
        ['reg y x', '    z'],
        ['  reg y x', '          z', '          w'],
        ['    syntax varlist', '    [if] [, Detail]'],
        ['syntax varlist', '[if] [, Detail]'],
        ['\treg y x', '\t\tz'],
        ['gen x = 1', '    + 2', '        + 3'],
    ];
    const SETTINGS: FormatOptions[] = [
        { preserve_alignment: true },
        { preserve_alignment: false },
        { insert_spaces: false },
    ];

    it('are indented as the lines after /// are in #delimit cr [source-preserving]', () => {
        for (const my_layout of LAYOUTS) {
            const [cr, semicolon] = cr_and_semicolon(my_layout);
            for (const my_settings of SETTINGS) {
                const cr_formatted = format_stable(cr, 'source-preserving', my_settings);
                const semicolon_formatted = format_stable(
                    semicolon, 'source-preserving', my_settings);
                expect({ layout: my_layout, settings: my_settings, indents: indents(semicolon_formatted) })
                    .toEqual({ layout: my_layout, settings: my_settings, indents: indents(cr_formatted) });
            }
        }
    });

    it('are indented from the statement\'s first line when a /// is among them [source-preserving]', () => {
        // The line after the `///` took the `///` line as its base.
        const source = '#delimit ;\nprogram foo;\nreg y\nx ///\nz;\nend;\n';
        expect(format_stable(source, 'source-preserving'))
            .toBe('#delimit ;\nprogram foo;\n    reg y\n    x ///\n    z;\nend;\n');
        expect(format_stable(source, 'source-preserving', { preserve_alignment: false }))
            .toBe('#delimit ;\nprogram foo;\n    reg y\n        x ///\n        z;\nend;\n');
    });

    for_each_formatter_mode('keep the syntax spec of a program indented', mode => {
        const source = '#delimit ;\nprogram foo;\nsyntax varlist\n[if] [, Detail];\nend;\n';
        expect(format_stable(source, mode)).toBe(mode === 'ast'
            ? '#delimit ;\nprogram foo;\n    syntax varlist [if] [, Detail];\nend;\n'
            : '#delimit ;\nprogram foo;\n    syntax varlist\n    [if] [, Detail];\nend;\n');
    });

    for_each_formatter_mode('keep their alignment, moved with the first line', mode => {
        const source = '#delimit ;\nprogram foo;\n  reg y x\n          z\n          w;\nend;\n';
        expect(format_stable(source, mode)).toBe(mode === 'ast'
            ? '#delimit ;\nprogram foo;\n    reg y x z w;\nend;\n'
            : '#delimit ;\nprogram foo;\n    reg y x\n            z\n            w;\nend;\n');
    });

    for_each_formatter_mode('leave statements between them at their own depth', mode => {
        for (const my_source of [
            '#delimit ;\ndi 1;\n// c\ndi 2;\n',
            '#delimit ;\nif 1 {;\n    di 1;\n};\n',
            '#delimit ;\nprogram foo;\n    di 1;\n    di 2;\nend;\n',
        ]) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });
});

describe('indentation diagnostics after formatting under #delimit ;', () => {
    // The formatter indents continuation lines deeper than their
    // statement; the diagnostics must not flag what it produces.
    for_each_formatter_mode('report nothing for continuation lines', mode => {
        for (const my_source of [
            '#delimit ;\nprogram foo;\nsyntax varlist\n[if] [, Detail];\nend;\n',
            '#delimit ;\nprogram foo;\n  reg y x\n          z\n          w;\nend;\n',
            '#delimit ;\nforeach v in a\n    b {;\n    di 1;\n};\n',
            // A line deeper than a comment inside the statement.
            '#delimit ;\nreg y x\n    // c\n        z;\n',
        ]) {
            const config = create_formatter_config(mode);
            config.diagnostics = { ...config.diagnostics, indentation: true };
            const formatted = format_stable(my_source, mode);
            expect(new IndentationDiagnosticAnalyzer().analyze(
                create_document_state(formatted), config
            )).toEqual([]);
        }
    });
});

describe('a statement after an inline mata: under #delimit ;', () => {
    // The inline statement's `;` was inside its formatting placeholder,
    // so the next statement read as part of it: it stayed at column 0,
    // and with continuation indentation it moved on each format.
    for_each_formatter_mode('is indented at its own depth', mode => {
        for (const my_source of [
            '#delimit ;\nprogram foo;\nmata: x = 1;\ndi 1;\nend;\n',
            '#delimit ;\nprogram foo;\npython: print(1);\ndi 1;\nend;\n',
        ]) {
            const expected = my_source.replace(/\n(mata|python|di)/g, '\n    $1');
            expect(format_stable(my_source, mode)).toBe(expected);
        }
    });

    for_each_formatter_mode('is indented at its own depth after a comment', mode => {
        // A comment after the `;` hid it, so `di 1;` moved on each
        // format. The AST printer puts a comment after `;` on its own
        // line.
        for (const my_comment of ['// c', '/* c */']) {
            const source = `#delimit ;\nprogram foo;\nmata: x = 1; ${my_comment}\ndi 1;\nend;\n`;
            expect(format_stable(source, mode)).toBe(mode === 'ast'
                ? `#delimit ;\nprogram foo;\n    mata: x = 1;\n    ${my_comment}\n    di 1;\nend;\n`
                : `#delimit ;\nprogram foo;\n    mata: x = 1; ${my_comment}\n    di 1;\nend;\n`);
        }
    });

    it('keeps a second inline statement on its line as written [source-preserving]', () => {
        // `; /* a */ python: ... /* b */` read as one trailing comment,
        // which left the python statement to the Stata formatter.
        const source = '#delimit ;\nmata: x = 1; /* a */ python:\tprint(1); /* b */\ndi 1;\n';
        expect(format_stable(source, 'source-preserving')).toBe(source);
    });

    for_each_formatter_mode('keeps the inline statement as written', mode => {
        // Under `#delimit ;`, `y = 2;` is a statement of its own; the
        // AST printer puts it on its own line.
        const source = '#delimit ;\nmata: x = 1; y = 2;\ndi 1;\n';
        expect(format_stable(source, mode)).toBe(mode === 'ast'
            ? '#delimit ;\nmata: x = 1;\ny = 2;\ndi 1;\n'
            : source);
    });
});

describe('continuation lines after /// in #delimit cr', () => {
    it('all sit one level in without alignment [source-preserving]', () => {
        // The newline after the first `///` ended the run, so each
        // further `///` line went one level deeper.
        const source = 'program foo\ngen x = 1 ///\n+ 2 ///\n+ 3\nend\n';
        expect(format_stable(source, 'source-preserving', { preserve_alignment: false }))
            .toBe('program foo\n    gen x = 1 ///\n        + 2 ///\n        + 3\nend\n');
    });

    it('move by the statement\'s shift in columns with tabs [source-preserving]', () => {
        // A 2-column shift added a whole tab, moving the aligned line 4.
        expect(format_stable('program foo\n  reg y x ///\n          z\nend\n',
            'source-preserving', { insert_spaces: false }))
            .toBe('program foo\n\treg y x ///\n\t\t\tz\nend\n');
        expect(format_stable('program foo\n\t  reg y x ///\n\t  z\nend\n',
            'source-preserving', { insert_spaces: false }))
            .toBe('program foo\n\treg y x ///\n\tz\nend\n');
    });

    it('take the configured indent style on the first format [source-preserving]', () => {
        // A tab added to a spaces-indented line was normalized only by
        // a second format.
        const source = 'program foo\nreg y x ///\n    z\nend\n';
        expect(format_stable(source, 'source-preserving', { insert_spaces: false }))
            .toBe('program foo\n\treg y x ///\n\t\tz\nend\n');
    });
});

describe('lines after a /// with no space before it', () => {
    // The parser joins `b///` and a column-0 `c` into `bc`, and reads an
    // indented `c` as a separate word, so re-indenting either changed the
    // value: inside a block `c` moved in (`bc` to `b c`), and at the top
    // level a statement moving left pulled `c` to column 0 (`b c` to `bc`).
    // (Stata itself doesn't continue a line after a tight `///`.)
    function macro_values(source: string): string[] {
        const the_values: string[] = [];
        const visit = (the_nodes: StataNode[]): void => {
            for (const my_node of the_nodes) {
                if (my_node.type === 'macro_def') {
                    the_values.push(my_node.value);
                }
                if ('body' in my_node && Array.isArray(my_node.body)) {
                    visit(my_node.body);
                }
            }
        };
        visit(new StataParser().parse(new StataLexer().tokenize(source).tokens).ast.nodes);
        return the_values;
    }

    const SOURCES = [
        'if 1 {\nlocal a b///\nc\n}\n',
        '    local a b/// note\n  c\n',
        'if 1 {\n        local a b/// note\n  c\n}\n',
        '  local a b///\n  c\n',
        'if 1 {\nlocal a b///\n///\nc\n}\n',
        'if 1 {\nlocal a b///\n  ///\nc\n}\n',
        '#delimit ;\nif 1 {;\nlocal a b///\nc;\n};\n',
        '#delimit ;\n  local a b///\n  c;\n',
    ];

    for_each_formatter_mode('keep the macro value', mode => {
        for (const my_preserve_alignment of [true, false]) {
            for (const my_source of SOURCES) {
                const formatted = format_stable(my_source, mode, {
                    preserve_alignment: my_preserve_alignment,
                });
                expect({ source: my_source, values: macro_values(formatted) })
                    .toEqual({ source: my_source, values: macro_values(my_source) });
            }
        }
    });

    it('stay at column 0 or keep a space [source-preserving]', () => {
        expect(format_stable('if 1 {\nlocal a b///\nc\n}\n', 'source-preserving'))
            .toBe('if 1 {\n    local a b///\nc\n}\n');
        expect(format_stable('  local a b///\n  c\n', 'source-preserving'))
            .toBe('local a b///\n c\n');
    });
});
