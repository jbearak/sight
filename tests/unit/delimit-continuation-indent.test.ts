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

    it('take the configured indent style on the first format [source-preserving]', () => {
        // A tab added to a spaces-indented line was normalized only by
        // a second format.
        const source = 'program foo\nreg y x ///\n    z\nend\n';
        expect(format_stable(source, 'source-preserving', { insert_spaces: false }))
            .toBe('program foo\n\treg y x ///\n\t\tz\nend\n');
    });
});
