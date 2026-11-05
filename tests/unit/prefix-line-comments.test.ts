import { describe, expect, it } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataNode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(source: string) {
    const { tokens } = new StataLexer().tokenize(source);
    return new StataParser().parse(tokens);
}

function format(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits[0]?.newText ?? source;
}

/** The statements of a parse, without `#delimit` directives. */
function statements(source: string): StataNode[] {
    return parse(source).ast.nodes.filter((my_node) => my_node.type !== 'directive');
}

function prefix_names(node: StataNode | undefined): string[] {
    if (node === undefined || !('prefix' in node)) {
        return [];
    }
    return (node.prefix ?? []).map((my_prefix) => my_prefix.name);
}

function comment_texts(node: StataNode | undefined, field: 'interiorTrivia' | 'trailingTrivia'): string[] {
    if (node === undefined || !(field in node)) {
        return [];
    }
    const the_comments = (node as { [key: string]: unknown })[field];
    return Array.isArray(the_comments)
        ? the_comments.map((my_comment: { content: string }) => my_comment.content)
        : [];
}

describe('a prefix with no command', () => {
    // Each is valid in Stata 18 (checked in a do-file).
    it('parses without an error, keeping a comment as trivia', () => {
        const the_cases: Array<[string, string[]]> = [
            ['capture\n', []],
            ['quietly:\n', []],
            ['capture: * note\n', ['* note']],
            ['quietly * note\n', ['* note']],
            ['#delimit ;\nquietly\n* note;\n', ['* note;']],
        ];
        for (const [my_source, my_comments] of the_cases) {
            const { errors } = parse(my_source);
            expect(errors).toEqual([]);
            const the_nodes = statements(my_source);
            expect(the_nodes).toHaveLength(1);
            expect(the_nodes[0]).toMatchObject({ type: 'command', name: '' });
            expect(comment_texts(the_nodes[0], 'trailingTrivia')).toEqual(my_comments);
        }
    });

    it('ends at a * comment that runs to ; under #delimit ;', () => {
        // Stata 18 ends `quietly` at the comment's `;`, so `di 1` runs
        // without the prefix.
        const the_cases: Array<[string, string[]]> = [
            ['quietly\n', ['quietly']],
            ['frame f: quietly\n', ['frame', 'quietly']],
            ['frame f:\n', ['frame']],
        ];
        for (const [my_prefix, my_names] of the_cases) {
            const source = `#delimit ;\n${my_prefix}* note;\ndi 1;\n`;
            expect(parse(source).errors).toEqual([]);
            const the_nodes = statements(source);
            expect(the_nodes).toHaveLength(2);
            expect(prefix_names(the_nodes[0])).toEqual(my_names);
            expect(the_nodes[1]).toMatchObject({ type: 'command', name: 'di' });
            expect(prefix_names(the_nodes[1])).toEqual([]);
        }
    });

    it('still reports a prefix before something that is not a command', () => {
        expect(parse('quietly }\n').errors.map((e) => e.message))
            .toContain('Expected command name');
    });
});

describe('// comments in control-flow headers under #delimit ;', () => {
    it('reads them as whitespace in the prefixes and header', () => {
        const the_cases: Array<[string, StataNode['type'], string[], Record<string, string>]> = [
            ['capture // c\nwhile 1 {;\n    di 1;\n};\n', 'while', ['capture'], { condition: '1' }],
            ['quietly // c\n{;\n    di 1;\n};\n', 'command', ['quietly'], {}],
            ['version 14 // c\n: foreach x in a {;\n    di 1;\n};\n', 'foreach', ['version'], { loopSpec: 'in a' }],
            ['foreach x in a // c\nb {;\n    di 1;\n};\n', 'foreach', [], { loopSpec: 'in a b' }],
            ['if 1 // c\n> 0 {;\n    di 1;\n};\n', 'if', [], { condition: '1 > 0' }],
            ['while 1 // c\n> 0 {;\n    di 1;\n};\n', 'while', [], { condition: '1 > 0' }],
        ];
        for (const [my_body, my_type, my_prefixes, my_fields] of the_cases) {
            const source = `#delimit ;\n${my_body}`;
            expect(parse(source).errors).toEqual([]);
            const the_nodes = statements(source);
            expect(the_nodes).toHaveLength(1);
            expect(the_nodes[0]).toMatchObject({ type: my_type, ...my_fields });
            expect(prefix_names(the_nodes[0])).toEqual(my_prefixes);
            expect(comment_texts(the_nodes[0], 'interiorTrivia')).toEqual(['// c']);
        }
    });
});

describe('formatting a prefix with no command, and // header comments', () => {
    // Source, then the AST printer's output where it differs. The
    // source-preserving formatter keeps comments where they were.
    const THE_FORMATTED: Array<[string, string?]> = [
        ['capture\n'],
        ['quietly:\n'],
        ['capture: * note\n'],
        ['quietly * note\n'],
        ['#delimit ;\nquietly\n* note;\ndi 1;\n', '#delimit ;\nquietly;\n* note;\ndi 1;\n'],
        ['#delimit ;\nframe f: quietly\n* note;\ndi 1;\n', '#delimit ;\nframe f: quietly;\n* note;\ndi 1;\n'],
        ['frame f: * note\n'],
        // A `//` comment ends its line, and `{` must stay on the
        // header's, so AST formatting puts the comment after the
        // keyword and indents the rest. Stata reads a `//` at the start
        // of a later line as code, so each one after the first is
        // indented too.
        ['#delimit ;\ncapture // c\nwhile 1 {;\n    di 1;\n};\n',
            '#delimit ;\ncapture while // c\n    1 {;\n    di 1;\n};\n'],
        ['#delimit ;\nquietly // c\n{;\n    di 1;\n};\n',
            '#delimit ;\nquietly // c\n    {;\n    di 1;\n};\n'],
        ['#delimit ;\nforeach x in a // c\nb {;\n    di 1;\n};\n',
            '#delimit ;\nforeach // c\n    x in a b {;\n    di 1;\n};\n'],
        ['#delimit ;\nif 1 // c\n> 0 {;\n    di 1;\n};\n',
            '#delimit ;\nif // c\n    1 > 0 {;\n    di 1;\n};\n'],
        ['#delimit ;\nif 1 // c\n> 0 di 1;\n', '#delimit ;\nif // c\n    1 > 0 di 1;\n'],
        ['#delimit ;\nversion 14 // c\n: foreach x in a {;\n    di 1;\n};\n',
            '#delimit ;\nversion 14: foreach // c\n    x in a {;\n    di 1;\n};\n'],
        ['#delimit ;\nif 1 {;\n};\nelse // c\n{;\n    di 2;\n};\n',
            '#delimit ;\nif 1 {;\n};\nelse // c\n    {;\n    di 2;\n};\n'],
        ['#delimit ;\ncapture /* b */ // c\n    noisily foreach x in a // d\nb {;\n    di 1;\n};\n',
            '#delimit ;\ncapture noisily foreach // c\n    // d\n    x in a b /* b */ {;\n    di 1;\n};\n'],
    ];

    for_each_formatter_mode('keeps the code and prints comments as comments', (mode) => {
        for (const [my_source, my_ast_output] of THE_FORMATTED) {
            expect(parse(my_source).errors).toEqual([]);
            const expected = mode === 'ast' ? my_ast_output ?? my_source : my_source;
            const formatted = format(my_source, mode);
            expect(formatted).toBe(expected);
            expect(format(formatted, mode)).toBe(formatted);
        }
    });
});
