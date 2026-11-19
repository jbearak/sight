/**
 * Abbreviations of `#delimit`. StataMP 18 accepts any abbreviation down
 * to `#d`: `#d ;`, `#de ;`, `#del ;` and `#delim ;` print "delimiter now
 * ;", `#d cr`, `#del cr`, `#delim cr` and `#delimi cr` print "delimiter
 * now cr", and multi-line statements between them run. Base ado files
 * use `#del ;` widely. Sight knew only the full word, so after `#d ;` it
 * kept ending statements at line breaks and reported false errors.
 *
 * Matching is exact-case, like the rest of Stata: `#D ;` and `#define ;`
 * are not directives, and neither is a `#d` inside a statement, where
 * `#` is the factor-variable interaction operator (`i.a#d`).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import type * as vscode from 'vscode';
import { detect_statement } from '../../client/src/send-to-stata/statement-detector';
import { initialize_builtin_commands } from '../../src/commands/builtin-commands';
import { DocumentStore } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { CodeFormatter } from '../../src/providers/formatter';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { Token } from '../../src/types';
import { create_mock_document } from '../property/helpers';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

const ABBREVIATIONS = ['#d', '#de', '#del', '#deli', '#delim', '#delimi'];

// A `;` region with statements and blocks spanning lines.
const DO_FILE_SOURCE = [
    'sysuse auto, clear',
    '#delimit ;',
    'regress price mpg',
    '    if foreign == 1 ;',
    'if 1 {; display',
    '  "a" ; };',
    'foreach v in a b {;',
    '  display',
    '    "`v\'" ;',
    '};',
    '#delimit cr',
    'display "x"',
    '',
].join('\n');

// A `syntax` statement over several lines in a program.
const PROGRAM_SOURCE = [
    'program Est',
    '\t#delimit ;',
    '\tsyntax  varlist(numeric min=2 max=2)',
    '\t        [if] [in] [fw aw iw]',
    '\t[,',
    '\t\tLevel(cilevel)',
    '\t] ;',
    '\tregress `varlist\' `if\' `in\', level(`level\') ;',
    '\t#delimit cr',
    'end',
    '',
].join('\n');

/** `source` with each `#delimit` spelled `keyword`. */
function abbreviate(source: string, keyword: string): string {
    return source.replaceAll('#delimit', keyword);
}

/**
 * The tokens, with each directive reduced to the mode it sets, and no
 * range on a directive's line, where the spelling moves columns.
 */
function token_shape(source: string): unknown[] {
    const the_tokens = new StataLexer().tokenize(source).tokens;
    const directive_lines = new Set(the_tokens
        .filter((my_token) => my_token.type === 'DELIMIT_DIRECTIVE')
        .map((my_token) => my_token.range.start.line));
    return the_tokens.map((my_token: Token) => {
        if (my_token.type === 'DELIMIT_DIRECTIVE') {
            return { type: my_token.type, mode: my_token.value.endsWith(';') };
        }
        if (directive_lines.has(my_token.range.start.line)) {
            return { type: my_token.type, value: my_token.value };
        }
        return my_token;
    });
}

/** The AST, without the directive spelling and range. */
function ast_shape(source: string): unknown {
    const tokens = new StataLexer().tokenize(source).tokens;
    const ast = new StataParser().parse(tokens).ast;
    return JSON.parse(JSON.stringify(ast, (_key, my_value: unknown) => {
        if (typeof my_value === 'object' && my_value !== null &&
            (my_value as { type?: unknown }).type === 'directive') {
            const { range: _range, keyword: _keyword, ...my_rest } =
                my_value as Record<string, unknown>;
            return my_rest;
        }
        return my_value;
    }));
}

let document_count = 0;

/** What the diagnostics provider reports, as `line:col code`. */
async function diagnostics(source: string): Promise<string[]> {
    const my_store = new DocumentStore();
    const my_provider = new DiagnosticsProvider({ sendDiagnostics: () => {} });
    const my_uri = `file:///delimit-abbreviation-${document_count++}.do`;
    await my_store.open(my_uri, source, 1);
    const my_document = my_store.get(my_uri);
    if (my_document === undefined) {
        throw new Error('document did not open');
    }
    const the_diagnostics =
        await my_provider.get_diagnostics(my_document, DEFAULT_SETTINGS);
    return the_diagnostics.map((my_diagnostic) =>
        `${my_diagnostic.range.start.line}:` +
        `${my_diagnostic.range.start.character} ` +
        `${String(my_diagnostic.code)} ${my_diagnostic.message}`);
}

beforeAll(() => {
    initialize_builtin_commands();
});

describe('#delimit abbreviations', () => {
    for (const my_keyword of ABBREVIATIONS) {
        it(`${my_keyword} lexes like #delimit`, () => {
            for (const my_source of [DO_FILE_SOURCE, PROGRAM_SOURCE]) {
                expect(token_shape(abbreviate(my_source, my_keyword)))
                    .toEqual(token_shape(my_source));
            }
        });

        it(`${my_keyword} parses like #delimit`, () => {
            for (const my_source of [DO_FILE_SOURCE, PROGRAM_SOURCE]) {
                expect(ast_shape(abbreviate(my_source, my_keyword)))
                    .toEqual(ast_shape(my_source));
            }
        });

        it(`${my_keyword} gets the diagnostics of #delimit`, async () => {
            expect(await diagnostics(abbreviate(DO_FILE_SOURCE, my_keyword)))
                .toEqual([]);
            expect(await diagnostics(abbreviate(PROGRAM_SOURCE, my_keyword)))
                .toEqual(await diagnostics(PROGRAM_SOURCE));
        });
    }

    it('accepts a ; right after the keyword', () => {
        const the_tokens = new StataLexer().tokenize('#d;\ndi\n1;\n').tokens;
        expect(the_tokens[0]).toMatchObject({
            type: 'DELIMIT_DIRECTIVE', value: '#d;',
        });
    });
});

describe('not #delimit', () => {
    const NOT_DIRECTIVES: Array<[string, string]> = [
        ['another word', '#define ;\n'],
        ['upper case', '#D ;\n'],
        ['upper case after #d', '#Delimit ;\n'],
        ['a longer word', '#delimitx ;\n'],
        ['an interaction', 'regress y i.a#d\n'],
        ['an interaction mid-line', 'regress y x#de z\n'],
        ['an interaction under ;', '#delimit ;\nregress y\n  i.a#d ;\n'],
    ];

    for (const [my_name, my_source] of NOT_DIRECTIVES) {
        it(`leaves ${my_name} alone`, () => {
            const the_tokens = new StataLexer().tokenize(my_source).tokens;
            const the_directives = the_tokens.filter((my_token) =>
                my_token.type === 'DELIMIT_DIRECTIVE');
            expect(the_directives.map((my_token) => my_token.value))
                .toEqual(my_source.startsWith('#delimit ;\n')
                    ? ['#delimit ;']
                    : []);
        });
    }

    it('keeps line breaks as statement ends after #D ;', async () => {
        expect(await diagnostics('#D ;\ndisplay 1\ndisplay 2\n'))
            .not.toContainEqual(expect.stringContaining('syntax'));
        const the_tokens = new StataLexer()
            .tokenize('#D ;\ndisplay 1\ndisplay 2\n').tokens;
        expect(the_tokens.filter((my_token) =>
            my_token.type === 'STATEMENT_TERMINATOR' &&
            my_token.value === '\n').length).toBe(3);
    });
});

describe('formatting keeps the #delimit spelling', () => {
    const SOURCE = '#d ;\ndisplay\n    1 ;\n#del cr\ndisplay 2\n';

    function format_source(source: string, mode: FormatterMode): string {
        const edits = new CodeFormatter().format(
            create_document_state(source),
            DEFAULT_FORMATTING_OPTIONS,
            create_formatter_config(mode));
        return edits[0]?.newText ?? source;
    }

    for_each_formatter_mode('#d ; and #del cr', (mode) => {
        const formatted = format_source(SOURCE, mode);
        const the_lines = formatted.split('\n');
        expect(the_lines[0]).toBe('#d ;');
        expect(the_lines).toContain('#del cr');
        expect(formatted).not.toContain('#delimit');
        expect(format_source(formatted, mode)).toBe(formatted);
    });

    for_each_formatter_mode('formats #d ; like #delimit ;', (mode) => {
        expect(format_source(abbreviate(DO_FILE_SOURCE, '#del'), mode))
            .toBe(abbreviate(format_source(DO_FILE_SOURCE, mode), '#del'));
    });
});

describe('Send to Stata under #d ;', () => {
    it('sends a statement that spans lines', () => {
        const the_lines = ['#d ;', 'reg price', '  mpg;', '#d cr', 'di 1'];
        const document = create_mock_document(the_lines.join('\n')) as
            unknown as vscode.TextDocument;
        expect(detect_statement(document, 1))
            .toEqual({ start_line: 1, end_line: 2 });
        expect(detect_statement(document, 4))
            .toEqual({ start_line: 4, end_line: 4 });
    });
});
