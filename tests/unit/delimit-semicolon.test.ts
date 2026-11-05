/**
 * Formatting, parsing, and directives under `#delimit ;`.
 *
 * Stata 18 behavior these tests rely on (checked with StataMP 18):
 * - a line break is whitespace, so `di 1 // c` then `2;` displays 12;
 * - a `;` inside a `//` comment is part of the comment, so
 *   `di "A" // c;` then `di "B";` is one statement;
 * - a `//`, block, or `*` comment may follow the mode on the
 *   `#delimit` line: `#delimit ; // c`, `#delimit ; * c`.
 */

import { describe, expect, it } from 'bun:test';
import { create_empty_symbol_table } from '../../src/analyzer';
import { build_parse_document } from '../../src/cli/parse-json';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { analyze_source } from '../../src/source-analysis';
import { CommandNode, DirectiveNode, StataNode } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

type Json = Record<string, unknown>;

/** Format a fixture in the selected mode and return the resulting source. */
function format_source(source: string, mode: FormatterMode): string {
    const lex_result = new StataLexer().tokenize(source);
    const parse_result = new StataParser().parse(lex_result.tokens);
    expect(parse_result.errors).toEqual([]);
    const edits = new CodeFormatter().format({
        uri: 'file:///delimit-semicolon.do',
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

function parse_nodes(source: string): StataNode[] {
    const tokens = new StataLexer().tokenize(source).tokens;
    return new StataParser().parse(tokens).ast.nodes;
}

function is_command(node: StataNode | undefined): node is CommandNode {
    return node?.type === 'command';
}

describe('the final newline under #delimit ;', () => {
    // No line break token ends a `;` statement, so the file's trailing
    // line breaks were dropped in source-preserving mode.
    const SOURCES = [
        '#delimit ;\ndi 1;\n',
        '#delimit ;\ndi 1;\ndi 2;\n',
        '#delimit ;\ndi 1;\n// tail\n',
        '#delimit ;\ndi 1;\n/* tail */\n',
        '#delimit ;\nprogram foo;\n    di 1;\nend;\n',
        '#delimit ;\nif 1 {;\n    di 1;\n};\n',
    ];

    for_each_formatter_mode('is kept', mode => {
        for (const my_source of SOURCES) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });

    it('keeps blank lines and no final newline as in #delimit cr [source-preserving]', () => {
        for (const my_source of [
            '#delimit ;\ndi 1;\n\ndi 2;\n',
            '#delimit ;\ndi 1;\n\n\n',
            '#delimit ;\ndi 1;',
            'di 1\n\n\n',
            'di 1',
        ]) {
            expect(format_stable(my_source, 'source-preserving')).toBe(my_source);
        }
    });
});

describe('a // comment inside a ;-terminated statement', () => {
    for_each_formatter_mode('keeps the code after it on the next line', mode => {
        const source = '#delimit ;\ndi 1 // c\n    2;\n';
        // Source-preserving mode puts a `;`-mode continuation line at
        // column 0, with or without a comment.
        const expected = mode === 'ast'
            ? source
            : '#delimit ;\ndi 1 // c\n2;\n';
        expect(format_stable(source, mode)).toBe(expected);
    });

    for_each_formatter_mode('keeps the terminator out of the comment', mode => {
        for (const my_source of [
            '#delimit ;\ndi 1 // c\n;\n',
            '#delimit ;\nif 1 di 1 // c\n;\n',
        ]) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
        const in_program = '#delimit ;\nprogram foo;\n    di 1 // c\n    ;\nend;\n';
        expect(format_stable(in_program, mode)).toBe(mode === 'ast'
            ? in_program
            : '#delimit ;\nprogram foo;\n    di 1 // c\n;\nend;\n');
    });

    for_each_formatter_mode('keeps every argument with several comments', mode => {
        const source = '#delimit ;\ndi 1 // a\n    // b\n    2;\n';
        const expected = mode === 'ast'
            ? source
            : '#delimit ;\ndi 1 // a\n// b\n2;\n';
        expect(format_stable(source, mode)).toBe(expected);
    });

    for_each_formatter_mode('moves to the end of a value, still before its own line break', mode => {
        // The AST printer prints the value and options from strings, so
        // the comment goes after them.
        const the_cases: [string, string][] = [
            ['#delimit ;\nlocal x = 1 // c\n+ 2;\n', '#delimit ;\nlocal x = 1 + 2 // c\n;\n'],
            ['#delimit ;\nreg y x // c\n, robust;\n', '#delimit ;\nreg y x, robust // c\n;\n'],
        ];
        for (const [my_source, my_ast] of the_cases) {
            expect(format_stable(my_source, mode))
                .toBe(mode === 'ast' ? my_ast : my_source);
        }
    });

    it('is whitespace to the parser, not the end of the statement', () => {
        const command = parse_nodes('#delimit ;\ndi 1 // c\n 2;\n')[1];
        expect(is_command(command)).toBe(true);
        if (!is_command(command)) {
            return;
        }
        expect(command.varlist?.map(my_item => my_item.name)).toEqual(['1', '2']);
        expect(command.interiorTrivia?.map(my_comment => my_comment.content))
            .toEqual(['// c']);
        expect(command.trailingTrivia).toBeUndefined();
    });

    it('is reported as interior in sight parse --json, with the code after it', () => {
        const document = build_parse_document({
            path: '/tmp/sight-test/file.do',
            content: '#delimit ;\ndi 1 // c\n 2;\n',
            sight_version: 'test',
        });
        const command = (document.statements as Json[])[1];
        expect((command.args as Json[]).map(my_arg => my_arg.text)).toEqual(['1', '2']);
        const comments = command.comments as Record<string, Json[]>;
        expect(comments.interior.map(my_comment => my_comment.text)).toEqual(['// c']);
        expect(comments.trailing).toEqual([]);
    });
});

describe('comments before a statement under #delimit ;', () => {
    // The AST printer gave each one a `;`. A `*` comment already ends
    // with its `;` (`* note;` became `* note;;`), and after `//` the
    // `;` is part of the comment; both gained one more on each format.
    for_each_formatter_mode('take no added terminator', mode => {
        for (const my_source of [
            '#delimit ;\ngen a = 1;\n* note;\ngen b = 2;\n',
            '#delimit ;\ndi 1;\n// c\ndi 2;\n',
            '#delimit ;\ndi 1;\n/* c */\ndi 2;\n',
            '#delimit ;\nif 1 {;\n    * note;\n    di 2;\n};\n',
            '#delimit ;\nif 1 {;\n    // c\n    di 2;\n};\n',
            '#delimit ;\nprogram foo;\n    // c\n    di 2;\nend;\n',
        ]) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });

    for_each_formatter_mode('move to their own line after code, with no added terminator', mode => {
        const source = '#delimit ;\ngen a = 1; * note;\ngen b = 2;\n';
        expect(format_stable(source, mode)).toBe(mode === 'ast'
            ? '#delimit ;\ngen a = 1;\n* note;\ngen b = 2;\n'
            : source);
    });
});

describe('a comment on the #delimit line', () => {
    const SOURCES = [
        '#delimit ; // c\ndi 1;\n#delimit cr\n',
        '#delimit ; /* c */\ndi 1;\n#delimit cr\n',
        '#delimit ; * c\ndi 1;\n#delimit cr\n',
        '#delimit ; /* a */ // b\ndi 1;\n#delimit cr\n',
        '#delimit ;\ndi 1;\n#delimit cr // c\ndi 2\n',
        '#delimit cr /* c */\ndi 2\n',
        'if 1 {\n    #delimit ; // c\n    di 1;\n    #delimit cr\n}\n',
    ];

    for_each_formatter_mode('is kept', mode => {
        for (const my_source of SOURCES) {
            expect(format_stable(my_source, mode)).toBe(my_source);
        }
    });

    it('is its own token, after a directive token that ends at the mode', () => {
        const the_tokens = new StataLexer().tokenize('#delimit ; // c\ndi 1;\n').tokens;
        expect(the_tokens.slice(0, 2).map(my_token => [my_token.type, my_token.value]))
            .toEqual([['DELIMIT_DIRECTIVE', '#delimit ;'], ['COMMENT_LINE', '// c']]);
    });

    it('leaves the mode to the directive, not to a ; in the comment', () => {
        const the_modes = parse_nodes('#delimit ;\ndi 1;\n#delimit cr // c;\ndi 2\n')
            .filter((my_node): my_node is DirectiveNode => my_node.type === 'directive')
            .map(my_node => my_node.mode);
        expect(the_modes).toEqual(['semicolon', 'cr']);
    });

    it('keeps the rest of the line in the directive token when it is not a comment', () => {
        for (const my_source of ['#delimit ;;\ndi 1;\n', '#delimit ; ///\ndi 1;\n']) {
            const the_tokens = new StataLexer().tokenize(my_source).tokens;
            expect(the_tokens[0].type).toBe('DELIMIT_DIRECTIVE');
            expect(the_tokens[0].value).toBe(my_source.split('\n')[0]);
            expect(the_tokens[1].type).toBe('WORD');
        }
    });

    it('is reported as the directive\'s trailing comment in sight parse --json', () => {
        const document = build_parse_document({
            path: '/tmp/sight-test/file.do',
            content: '#delimit ; // sight: local a\ndi `a\';\n#delimit cr\n',
            sight_version: 'test',
        });
        const directive = (document.statements as Json[])[0];
        expect(directive.text).toBe('#delimit ;');
        const comments = directive.comments as Record<string, Json[]>;
        expect(comments.trailing.map(my_comment => [my_comment.text, my_comment.directive]))
            .toEqual([['// sight: local a', { kind: 'declare', symbol_kind: 'local', names: ['a'] }]]);
    });

    describe('with a Sight directive', () => {
        /** Names of the locals the analyzer reports as undefined. */
        function undefined_macros(content: string): string[] {
            return analyze_source(content, 'file:///tmp/sight-test/file.do')
                .analysis.diagnostics
                .filter(my_diagnostic => my_diagnostic.code === 'UNDEFINED_MACRO')
                .map(my_diagnostic => my_diagnostic.message.match(/`([A-Za-z_]\w*)'/)?.[1] ?? '');
        }

        it('registers a declaration from that line on', () => {
            expect(undefined_macros('#delimit ; // sight: local a\ndi `a\';\ndi `b\';\n#delimit cr\n'))
                .toEqual(['b']);
        });

        it('applies ignore-next to the statement after the directive', () => {
            expect(undefined_macros('#delimit ; // sight: ignore-next\ndi `a\';\ndi `b\';\n#delimit cr\n'))
                .toEqual(['b']);
        });

        it('applies a trailing ignore to its own line only, as after code', () => {
            expect(undefined_macros('#delimit ; // sight: ignore\ndi `a\';\n#delimit cr\n'))
                .toEqual(['a']);
        });
    });
});
