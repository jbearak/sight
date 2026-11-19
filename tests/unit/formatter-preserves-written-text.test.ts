/**
 * Text the formatter must leave as written, in both modes, and reach
 * in one pass:
 *
 * - an inline `python:`/`mata:` statement whose string holds a `;`
 *   followed by a comment marker (`"a;\t//b"`);
 * - option arguments, which are often not expressions (a plugin's
 *   `using(plugins/my.plugin)`, `format(%9.0g)`, `eq(#2)`);
 * - the `()` of a call with no arguments (`display runiform()`);
 * - a blank data row between `input` and `end`.
 *
 * And under `#delimit ;`, a `///` after the `;` that ends a statement
 * doesn't make the next statement a continuation line.
 */

import { describe, expect } from 'bun:test';
import { CodeFormatter } from '../../src/providers/formatter';
import { IndentationDiagnosticAnalyzer } from '../../src/providers/indentation-diagnostics';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
    mode_specific_assertion,
} from '../property/helpers/formatter-test-utils';
import { create_document_state } from '../property/helpers/document-utils';

function format_source(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        { tabSize: 4, insertSpaces: true },
        create_formatter_config(mode));
    return edits[0]?.newText ?? source;
}

/** The first format's output, checked to be its own format. */
function format_once(source: string, mode: FormatterMode): string {
    const once = format_source(source, mode);
    expect(format_source(once, mode)).toBe(once);
    return once;
}

describe('an inline embedded statement with a ; in a string', () => {
    const the_sources = [
        'python: text = "a;\t//b"\n',
        'python: text = "a;\t/// b"\n',
        'python: text = "a;\t/* b */"\n',
        'mata: s = "a;\t//b"\n',
        'mata: s = "a;\t/* b */"\n',
        '#delimit ;\npython: text = "a;\t//b";\n#delimit cr\n',
        '#delimit ;\nmata: s = "a;\t/// b";\n#delimit cr\n',
    ];

    for_each_formatter_mode('comes back byte for byte', (mode) => {
        for (const my_source of the_sources) {
            expect(format_once(my_source, mode)).toBe(my_source);
        }
    });
});

describe('option arguments', () => {
    const the_sources = [
        'program define plug, plugin using(plugins/my.plugin)\n',
        'matrix list b, format(%9.0g)\n',
        '_predict double s if touse, xb eq(#2)\n',
        'graph export x.png, saving(c:\\data\\x.gph, replace) name(my-g)\n',
        'javacall a.B c, jars(libstata-plugin.jar)\n',
    ];

    for_each_formatter_mode('are printed as written', (mode) => {
        for (const my_source of the_sources) {
            expect(format_once(my_source, mode)).toBe(my_source);
        }
    });
});

describe('a call with no arguments', () => {
    for_each_formatter_mode('keeps its ()', (mode) => {
        const source = 'display runiform()\ndi _caller()\n';
        expect(format_once(source, mode)).toBe(source);
    });
});

describe('a blank input data row', () => {
    for_each_formatter_mode('is kept, without its blanks', (mode) => {
        expect(format_once('input x\n   \nend\n', mode)).toBe('input x\n\nend\n');
        expect(format_once('input x\nend\n', mode)).toBe('input x\nend\n');
        expect(format_once('input x\n\n\nend\n', mode)).toBe('input x\n\n\nend\n');
    });
});

describe('a /// after the ; that ends a #delimit ; statement', () => {
    const source = [
        '#delimit ;',
        'regress price',
        '    mpg; /// second model',
        '    regress mpg',
        '        weight;',
        '#delimit cr',
        '',
    ].join('\n');

    for_each_formatter_mode('formats in one pass', (mode) => {
        const once = format_once(source, mode);
        mode_specific_assertion(mode, {
            'source-preserving': () => {
                // The next statement goes to column 0, and its own
                // later line one level in.
                expect(once).toBe([
                    '#delimit ;',
                    'regress price',
                    '    mpg; /// second model',
                    'regress mpg',
                    '    weight;',
                    '#delimit cr',
                    '',
                ].join('\n'));
                const config = create_formatter_config(mode);
                config.diagnostics = { ...config.diagnostics, indentation: true };
                expect(new IndentationDiagnosticAnalyzer().analyze(
                    create_document_state(once), config)).toEqual([]);
            },
            'ast': () => {
                expect(once).toContain('regress mpg weight;');
            },
        });
    });
});
