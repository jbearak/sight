/**
 * `//` and `///` at the start of a line.
 *
 * Checked on StataMP 18:
 *
 * - Under `#delimit ;`, a `//` or `///` at column 0 is a comment only on
 *   a statement's first line, and a comment doesn't end a statement.
 *   `// c` then `// d` is r(199) ("/ is not a valid command name"), as
 *   is a column-0 `// d` after a block comment or after `di 1; // c`.
 *   Indented, `// d` is a comment. `local a b` then `/// x` then `c;`
 *   stores `b /// x c`, also after `local a b ///`. A `;` (also the one
 *   ending `* c;`), `#delimit ; // c`, and `end;` after a mata block
 *   start a fresh statement. After `// c` then a column-0 `// d`, a
 *   `#delimit cr` is part of the statement and doesn't run.
 * - Under `#delimit cr`, a `///` that starts a line joins the next line
 *   to it at any indentation. Nothing comes before it on the joined
 *   line, so the next line runs as its own statement: `local a b` then
 *   `///` then `c` runs `c` (r(199)); `#delimit`, `end`, `}`, and `*`
 *   comments on the next line still work.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ContextTracker } from '../../src/context-tracker';
import { DocumentStore } from '../../src/document-store';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { PrettyPrinter } from '../../src/pretty-printer';
import { CodeFormatter } from '../../src/providers/formatter';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { LexerErrorCode, StataNode, Token } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    for_each_formatter_mode_property,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

const COMMENT_TYPES = new Set(['COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION']);

/** `type:value` for each token other than EOF and terminators. */
function shapes(source: string): string[] {
    return new StataLexer().tokenize(source).tokens
        .filter((t) => t.type !== 'EOF' && t.type !== 'STATEMENT_TERMINATOR')
        .map((t) => `${t.type}:${t.value}`);
}

function mid_statement_errors(source: string) {
    return new StataLexer().tokenize(source).errors.filter(
        (e) => e.code === LexerErrorCode.SLASHES_MID_STATEMENT);
}

function nodes_of(source: string): StataNode[] {
    return new StataParser().parse(new StataLexer().tokenize(source).tokens).ast.nodes;
}

/**
 * The text of each comment token, in order, leaving out bare `///`
 * joins, which the AST printer rewraps.
 */
function comment_texts(tokens: Token[]): string[] {
    return tokens
        .filter((t) => COMMENT_TYPES.has(t.type))
        .filter((t) => t.type !== 'CONTINUATION' || t.value.replace(/^\/+/, '').trim() !== '')
        .map((t) => t.value);
}

describe('lexing a column-0 // or /// under #delimit ;', () => {
    it('reads a // after a comment on the line above as code', () => {
        expect(shapes('#delimit ;\n// c\n// d\ndi "x";\n')).toEqual([
            'DELIMIT_DIRECTIVE:#delimit ;', 'COMMENT_LINE:// c',
            'OPERATOR:/', 'OPERATOR:/', 'WORD:d', 'WORD:di', 'STRING:"x"',
        ]);
    });

    for (const my_source of [
        '#delimit ;\n/* b */\n// d\ndi "x";\n',
        '#delimit ;\n/* b\n*/\n// d\ndi "x";\n',
        '#delimit ;\ndi "A"; // c\n// d\ndi "x";\n',
        '#delimit ;\ndi "A"; /* b */\n// d\ndi "x";\n',
        '#delimit ;\n// c\n\n// d\ndi "x";\n',
        '#delimit ;\n// c\n    // d\n// e\ndi "x";\n',
        '#delimit ;\n/// c\n// d\ndi "x";\n',
        '#delimit ;\n// c\n/// d\ndi "x";\n',
        '#delimit ;\nmata;\nx = 1;\nend;\n// c\n// d\ndi "x";\n',
    ]) {
        it(`reads the last column-0 slashes in ${JSON.stringify(my_source)} as code`, () => {
            expect(mid_statement_errors(my_source)).toHaveLength(1);
        });
    }

    for (const my_source of [
        '#delimit ;\n// c\ndi "x";\n',
        '#delimit ;\ndi "A";\n// c\ndi "x";\n',
        '#delimit ;\ndi "A";\n\n// c\ndi "x";\n',
        '#delimit ;\n// c\n    // d\ndi "x";\n',
        '#delimit ;\n// c\n\t// d\ndi "x";\n',
        '#delimit ;\n/* b */\n    // d\ndi "x";\n',
        '#delimit ;\n* c;\n// d\ndi "x";\n',
        '#delimit ;\ndi "A"; * c;\n// d\ndi "x";\n',
        '#delimit ; // c\n// d\ndi "x";\n',
        '#delimit ;\nmata;\nx = 1;\nend;\n// c\ndi "x";\n',
        '#delimit ;\ndi "A";\n/// x\ndi "x";\n',
        '#delimit ;\nlocal a b\n    /// x\nc;\n',
        '// c\n// d\ndi "x"\n',
    ]) {
        it(`reads every slash line in ${JSON.stringify(my_source)} as a comment`, () => {
            expect(mid_statement_errors(my_source)).toEqual([]);
        });
    }

    it('keeps a mid-statement /// and its note in the statement', () => {
        expect(shapes('#delimit ;\nlocal a b\n/// x\nc;\n')).toEqual([
            'DELIMIT_DIRECTIVE:#delimit ;', 'WORD:local', 'WORD:a', 'WORD:b',
            'OPERATOR:/', 'OPERATOR:/', 'OPERATOR:/', 'WORD:x', 'WORD:c',
        ]);
        expect(shapes('#delimit ;\nlocal a b ///\n/// x\nc;\n'))
            .toContain('OPERATOR:/');
    });

    it('ends the statement at a ; after mid-statement slashes', () => {
        const the_tokens = new StataLexer().tokenize('#delimit ;\nlocal a b\n// x;\ndi 1;\n').tokens;
        expect(the_tokens.filter((t) => t.type === 'STATEMENT_TERMINATOR'))
            .toHaveLength(2);
    });

    it('warns at the slash run', () => {
        expect(mid_statement_errors('#delimit ;\nlocal a b\n/// x\nc;\n')
            .map((e) => e.range)).toEqual([{
                start: { line: 2, character: 0 },
                end: { line: 2, character: 3 },
            }]);
    });

    it('is a warning diagnostic', async () => {
        const document_store = new DocumentStore();
        const provider = new DiagnosticsProvider({ sendDiagnostics: () => {} } as any);
        const uri = 'file:///column0-slashes.do';
        await document_store.open(uri, '#delimit ;\n// c\n// d\ndi 1;\n', 1);
        const the_diagnostics = await provider.get_diagnostics(
            document_store.get(uri)!, DEFAULT_SETTINGS);
        expect(the_diagnostics
            .filter((d) => d.code === LexerErrorCode.SLASHES_MID_STATEMENT)
            .map((d) => d.severity))
            .toEqual([DiagnosticSeverity.Warning]);
    });
});

describe('lexing a /// that starts a line under #delimit cr', () => {
    for (const my_source of ['///\nc', '    ///\nc', '\t/// note\nc', 'if 1 {\n    ///\n    c\n}']) {
        it(`reads ${JSON.stringify(my_source)} as a comment line`, () => {
            const the_shapes = shapes(my_source);
            expect(the_shapes.some((s) => s.startsWith('CONTINUATION'))).toBe(false);
            expect(the_shapes.some((s) => s.startsWith('COMMENT_LINE:///'))).toBe(true);
        });
    }

    it('still continues a chain at any indentation', () => {
        for (const my_source of ['local a b ///\n///\nc', 'local a b ///\n    ///\nc']) {
            expect(shapes(my_source).filter((s) => s.startsWith('CONTINUATION')))
                .toHaveLength(2);
            expect(nodes_of(my_source)).toHaveLength(1);
        }
    });
});

describe('parsing column-0 slashes under #delimit ;', () => {
    it('keeps a mid-statement /// in the macro value', () => {
        expect(nodes_of('#delimit ;\nlocal a b\n/// x\nc;\n')[1])
            .toMatchObject({ type: 'macro_def', value: 'b /// x c' });
    });

    it('keeps a statement that starts with // as written', () => {
        const the_nodes = nodes_of('#delimit ;\n// c\n// d\ndi "x";\n');
        expect(the_nodes[1]).toMatchObject({
            type: 'command',
            name: '',
            noted_lines: [{ column: 0, text: '// d' }, { column: 0, text: 'di "x"' }],
        });
    });
});

interface FormatOptions {
    preserve_alignment?: boolean;
    insert_spaces?: boolean;
}

const SETTINGS: FormatOptions[] = [
    { preserve_alignment: true },
    { preserve_alignment: false },
    { insert_spaces: false },
];

function format_source(source: string, mode: FormatterMode, options: FormatOptions): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    const tracker = new ContextTracker();
    tracker.initialize_from_tokens(lex_result.tokens, source);
    const config = create_formatter_config(mode);
    config.formatting = {
        ...config.formatting,
        preserve_alignment: options.preserve_alignment ?? true,
    };
    const edits = new CodeFormatter().format({
        uri: 'file:///column0-slashes.do',
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

/**
 * Format `source`, require a second pass to change nothing, and
 * require Stata to read the output's slashes as it read the source's:
 * the same comments, and code at column 0 where there was code.
 */
function format_keeping_slashes(
    source: string, mode: FormatterMode, options: FormatOptions
): string {
    const formatted = format_source(source, mode, options);
    expect(format_source(formatted, mode, options)).toBe(formatted);
    expect_same_slashes(source, formatted);
    return formatted;
}

/** Require Stata to read the slashes in `after` as in `before`. */
function expect_same_slashes(before: string, after: string): void {
    const slash_comments = (source: string): string[] =>
        comment_texts(new StataLexer().tokenize(source).tokens)
            .filter((t) => t.startsWith('//'));
    expect(slash_comments(after)).toEqual(slash_comments(before));
    expect(mid_statement_errors(after).length)
        .toBe(mid_statement_errors(before).length);
}

describe('formatting slash comments under #delimit ;', () => {
    // Each stays valid Stata only if no `//` line moves to column 0.
    const VALID_SOURCES = [
        '#delimit ;\n// c\n    // d\ndi "x";\n#delimit cr\n',
        '#delimit ;\ndi "A";\n/* b */\n    // d\ndi "x";\n#delimit cr\n',
        '#delimit ;\ndi "A";\n/* b */ // c\ndi "x";\n#delimit cr\n',
        '#delimit ;\ndi "A"; // c\n    // d\ndi "x";\n#delimit cr\n',
        '#delimit ;\ndi "A";\n// c\n    // d\n#delimit cr\ndi "B"\n',
        '#delimit ;\ndi "A";\n// c\n    // d\n',
        '#delimit ;\n// c\n    /// d\n    // e\ndi "x";\n',
        '#delimit ;\n    local a b///\n    // x\n    c;\n',
        '#delimit ;\nif 1 {;\n    // c\n    // d\n    di "x";\n};\n',
        // A `;` in a comment doesn't end the statement.
        '#delimit ;\n// c\n    // d;\n    // e\ndi 1;\n',
    ];

    for_each_formatter_mode('never moves a // line to column 0 mid-statement', (mode) => {
        for (const my_source of VALID_SOURCES) {
            for (const my_settings of SETTINGS) {
                const formatted = format_keeping_slashes(my_source, mode, my_settings);
                expect(mid_statement_errors(formatted)).toEqual([]);
            }
        }
    });

    for_each_formatter_mode('indents a later // line one level', (mode) => {
        expect(format_keeping_slashes(
            '#delimit ;\n// c\n    // d\ndi "x";\n', mode, {}))
            .toBe('#delimit ;\n// c\n    // d\ndi "x";\n');
        expect(format_keeping_slashes(
            '#delimit ;\n// c\n    // d\ndi "x";\n', mode, { insert_spaces: false }))
            .toBe('#delimit ;\n// c\n\t// d\ndi "x";\n');
    });

    for_each_formatter_mode('keeps the first // of a statement at column 0', (mode) => {
        for (const my_source of [
            '#delimit ;\n// c\ndi "x";\n',
            '#delimit ;\ndi "A";\n// c\ndi "x";\n',
            '#delimit ;\n* c;\n// d\ndi "x";\n',
            '#delimit ; // c\n// d\ndi "x";\n',
        ]) {
            expect(format_keeping_slashes(my_source, mode, {})).toBe(my_source);
        }
    });

    for_each_formatter_mode('keeps code at column 0 as code', (mode) => {
        for (const my_source of [
            '#delimit ;\n// c\n// d\ndi "x";\n',
            '#delimit ;\nlocal a b\n/// x\nc;\n',
            '#delimit ;\nif 1 {;\nlocal a b\n/// x\nc;\n};\n',
            '#delimit ;\nif 1 {;\n// c\n// d\ndi "x";\n};\n',
        ]) {
            for (const my_settings of SETTINGS) {
                const formatted = format_keeping_slashes(my_source, mode, my_settings);
                expect(formatted).toMatch(/^\/\/\/? ?[dx]$/m);
            }
        }
    });

    // Lines of a `#delimit ;` section: comments at column 0 and
    // indented, block comments, and statements, some over two lines.
    const SECTION_LINE = fc.constantFrom(
        '// c', '    // d', '\t// e', '/// f', '    /// g', '/* b */',
        '/* b */ // h', '* s;', 'di "x";', 'local a b', 'c;', '    c;',
        'di "y"; // i', '', 'local e b ///', '    f /// note',
        'reg y x, robust///', '    // j;', '// k;',
    );

    for_each_formatter_mode_property(
        'keeps the meaning of the slashes in a #delimit ; section',
        fc.tuple(
            fc.array(SECTION_LINE, { maxLength: 8 }),
            fc.array(SECTION_LINE, { maxLength: 4 }),
            fc.constantFrom(...SETTINGS),
        ),
        (mode, [the_lines, the_block_lines, my_settings]) => {
            // Over two passes: a second pass can still move a comment
            // from inside a statement to after its `;` (AST printer).
            // A `;` ends each run of lines, so the block's braces aren't
            // inside another statement.
            const source = [
                '#delimit ;', ...the_lines, ';',
                'if 1 {;', ...the_block_lines, ';', '};', '#delimit cr', '',
            ].join('\n');
            const once = format_source(source, mode, my_settings);
            expect_same_slashes(source, once);
            expect_same_slashes(source, format_source(once, mode, my_settings));
        },
        60,
    );
});

describe('PrettyPrinter.printNode under #delimit ;', () => {
    it('indents a later // comment of one node and leaves no mark', () => {
        const the_nodes = nodes_of('#delimit ;\n// c\n    // d\ndi "x";\n');
        const printer = new PrettyPrinter();
        const printed = the_nodes.map((my_node) => printer.printNode(my_node)).join('');
        expect(printed).toBe('#delimit ;\n// c\n    // d\ndi "x";\n');
    });
});

describe('formatting a /// line that starts a statement under #delimit cr', () => {
    for_each_formatter_mode('is idempotent at any indentation', (mode) => {
        for (const my_source of [
            'if 1 {\nlocal a b\n///\nc\n}\n',
            'program define foo\n/// Does X\ndi "x"\nend\n',
            'program define foo\n    /// Does X\n    di "x"\nend\n',
            '//////////\n// Section\n//////////\nuse data\n',
        ]) {
            for (const my_settings of SETTINGS) {
                format_keeping_slashes(my_source, mode, my_settings);
            }
        }
    });

    for_each_formatter_mode('indents the next line as a statement', (mode) => {
        expect(format_keeping_slashes(
            'program define foo\n/// Does X\ndi "x"\nend\n', mode,
            { preserve_alignment: false }))
            .toBe('program define foo\n    /// Does X\n    di "x"\nend\n');
    });
});
