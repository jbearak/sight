import { describe, expect, it } from 'bun:test';
import embedded_cache from '../../src/command-database/caches/v18.json' with { type: 'json' };
import { SemanticAnalyzer } from '../../src/analyzer';
import { build_parse_document } from '../../src/cli/parse-json';
import { CommandDatabase } from '../../src/command-database';
import type { CommandCache } from '../../src/command-database/types';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode, StataNode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    create_formatter_config,
    DEFAULT_FORMATTING_OPTIONS,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';

function parse(source: string) {
    const { tokens } = new StataLexer().tokenize(source);
    return { ...new StataParser().parse(tokens), tokens };
}

function format(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits[0]?.newText ?? source;
}

function undefined_macro_messages(source: string): string[] {
    const { ast, tokens } = parse(source);
    const result = new SemanticAnalyzer().analyze(
        ast, 'test://file.do', undefined, { undefined_macro_enabled: true }, tokens
    );
    return result.diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => d.message);
}

function prefix_names(node: StataNode | undefined): string[] {
    if (node === undefined || !('prefix' in node)) {
        return [];
    }
    return (node.prefix ?? []).map((my_prefix) => my_prefix.name);
}

function comment_texts(node: StataNode | undefined): string[] {
    if (node === undefined || !('interiorTrivia' in node)) {
        return [];
    }
    return (node.interiorTrivia ?? []).map((my_comment) => my_comment.content);
}

// Each runs with its body in Stata 18 (checked in a do-file).
const THE_PREFIXED_BLOCKS: Array<{ source: string; type: StataNode['type']; prefixes: string[] }> = [
    { source: 'capture while 1 {\n    di 1\n}\n', type: 'while', prefixes: ['capture'] },
    { source: 'quietly if 1 {\n    di 1\n}\n', type: 'if', prefixes: ['quietly'] },
    { source: 'noisily foreach x in a b {\n    di 1\n}\n', type: 'foreach', prefixes: ['noisily'] },
    { source: 'capture forvalues i = 1/2 {\n    di 1\n}\n', type: 'forvalues', prefixes: ['capture'] },
    { source: 'cap noi foreach x in a {\n    di 1\n}\n', type: 'foreach', prefixes: ['cap', 'noi'] },
    { source: 'capture frame f {\n    di 1\n}\n', type: 'frame', prefixes: ['capture'] },
    { source: 'version 14: foreach x in a b {\n    di 1\n}\n', type: 'foreach', prefixes: ['version'] },
    // Stata rejects a loop after a colon prefix, but formatting must
    // not delete the body.
    { source: 'frame f: capture while 1 {\n    di 1\n}\n', type: 'while', prefixes: ['frame', 'capture'] },
    { source: 'capture frame f: if 1 {\n    di 1\n}\n', type: 'if', prefixes: ['capture', 'frame'] },
];

describe('prefixed control flow', () => {
    it('parses as the control-flow node with its prefixes and body', () => {
        for (const my_case of THE_PREFIXED_BLOCKS) {
            const { ast, errors } = parse(my_case.source);
            expect(errors).toEqual([]);
            expect(ast.nodes).toHaveLength(1);
            const node = ast.nodes[0];
            expect(node?.type).toBe(my_case.type);
            expect(prefix_names(node)).toEqual(my_case.prefixes);
            expect(node !== undefined && 'body' in node ? node.body : []).toHaveLength(1);
        }
    });

    it('parses a prefixed else with its body', () => {
        const { ast, errors } = parse('if 0 {\n}\nqui else {\n    di 1\n}\n');
        expect(errors).toEqual([]);
        const node = ast.nodes[1];
        expect(node?.type).toBe('else');
        expect(prefix_names(node)).toEqual(['qui']);
    });

    it('keeps an inline if after a prefix', () => {
        const { ast, errors } = parse('quietly if 1 di 1\n');
        expect(errors).toEqual([]);
        expect(ast.nodes[0]).toMatchObject({ type: 'if', is_single_statement: true });
    });

    it('reads a comment around a prefix as whitespace before a block', () => {
        const the_cases: Array<[string, StataNode['type']]> = [
            ['quietly /* c */ {\n    di 1\n}\n', 'command'],
            ['capture /* c */ while 1 {\n    di 1\n}\n', 'while'],
            ['version 14 /* c */ : foreach x in a b {\n    di 1\n}\n', 'foreach'],
            ['version 14: /* c */ foreach x in a b {\n    di 1\n}\n', 'foreach'],
            ['quietly /* c */ : foreach x in a {\n    di 1\n}\n', 'foreach'],
            ['capture /* c */ noisily ///\n    foreach x in a {\n    di 1\n}\n', 'foreach'],
            ['capture: /* c */ mata: x = 1\n', 'embedded_block'],
            ['capture /* c */ frame f: if 1 {\n    di 1\n}\n', 'if'],
        ];
        for (const [my_source, my_type] of the_cases) {
            const { ast, errors } = parse(my_source);
            expect(errors).toEqual([]);
            expect(ast.nodes).toHaveLength(1);
            expect(ast.nodes[0]?.type).toBe(my_type);
            expect(comment_texts(ast.nodes[0])).toEqual(['/* c */']);
        }
    });

    it('keeps header comments out of the condition and loop spec', () => {
        const the_cases: Array<[string, Record<string, string>]> = [
            ['if x /* c */ > 1 {\n}\n', { condition: 'x > 1' }],
            ['if x /* c */ > 1 di 1\n', { condition: 'x > 1' }],
            ['while x /* c */ > 1 {\n}\n', { condition: 'x > 1' }],
            ['foreach v in a /* c */ b {\n}\n', { loopVar: 'v', loopSpec: 'in a b' }],
            ['foreach v /* c */ in a b {\n}\n', { loopVar: 'v', loopSpec: 'in a b' }],
            ['forvalues i = 1 /* c */ /2 {\n}\n', { loopVar: 'i', loopSpec: '= 1 /2' }],
        ];
        for (const [my_source, my_fields] of the_cases) {
            const { ast, errors } = parse(my_source);
            expect(errors).toEqual([]);
            expect(ast.nodes).toHaveLength(1);
            expect(ast.nodes[0]).toMatchObject(my_fields);
            expect(comment_texts(ast.nodes[0])).toEqual(['/* c */']);
        }
        const { ast, errors } = parse('if 0 {\n}\nelse /* c */ {\n    di 1\n}\n');
        expect(errors).toEqual([]);
        expect(ast.nodes[1]).toMatchObject({ type: 'else', body: [{ name: 'di' }] });
        expect(comment_texts(ast.nodes[1])).toEqual(['/* c */']);
    });

    it('reads a /// continuation before a colon as whitespace', () => {
        const the_cases: Array<[string, string]> = [
            ['unab x ///\n: a\n', 'unab'],
            ['unab x /* c */ ///\n: a\n', 'unab'],
            ['unab x : a ///\n b\n', 'unab'],
            ['quietly ///\n: gen x = 1\n', 'gen'],
            ['quietly /* c */ ///\n: gen x = 1\n', 'gen'],
            ['capture /* c */ ///\nnoisily gen x = 1\n', 'gen'],
            ['version 14 ///\n: gen x = 1\n', 'gen'],
            ['gettoken a b ///\n: c\n', 'gettoken'],
        ];
        for (const [my_source, my_name] of the_cases) {
            const { ast, errors } = parse(my_source);
            expect(errors).toEqual([]);
            expect(ast.nodes).toHaveLength(1);
            expect(ast.nodes[0]).toMatchObject({ type: 'command', name: my_name });
        }
        const [unab] = parse('unab x : a ///\n b\n').ast.nodes;
        expect(unab?.type === 'command' ? unab.varlist?.map((v) => v.name) : [])
            .toEqual(['x', 'a', 'b']);
    });

    it('still defines macros and checks references inside the body', () => {
        expect(undefined_macro_messages(
            "capture if 1 {\n    local y 1\n}\ndisplay `y'\n"
        )).toEqual([]);
        expect(undefined_macro_messages(
            "quietly foreach v in a {\n    local z 1\n}\ndisplay `z'\n"
        )).toEqual([]);
        expect(undefined_macro_messages(
            "capture while 1 {\n    display `nope'\n}\n"
        )).toHaveLength(1);
    });
});

describe('formatting prefixed control flow', () => {
    // Source, then the AST printer's output where it differs. The
    // source-preserving formatter keeps comments where they were.
    const THE_FORMATTED: Array<[string, string?]> = [
        ['capture while 1 {\n    di 1\n}\n'],
        ['quietly if 1 {\n    di 1\n}\n'],
        ['noisily foreach x in a b {\n    di 1\n}\n'],
        ['capture forvalues i = 1/2 {\n    di 1\n}\n', 'capture forvalues i = 1 / 2 {\n    di 1\n}\n'],
        ['capture frame f {\n    di 1\n}\n'],
        ['frame f: capture while 1 {\n    di 1\n}\n'],
        ['capture frame f: if 1 {\n    di 1\n}\n'],
        ['if 0 {\n}\nqui else {\n    di 1\n}\n'],
        ['quietly if 1 di 1\n'],
        ['quietly {\n    di 1\n}\n'],
        ['quietly /* c */ {\n    di 1\n}\n'],
        ['capture mata: x = 1\n'],
        ['capture: /* c */ mata: x = 1\n'],
        ['quietly python: print(1)\n'],
        ['capture /* c */ while 1 {\n    di 1\n}\n', 'capture while 1 /* c */ {\n    di 1\n}\n'],
        ['version 14 /* c */ : foreach x in a b {\n    di 1\n}\n',
            'version 14: foreach x in a b /* c */ {\n    di 1\n}\n'],
        ['quietly /* c */ if 1 di 1\n', 'quietly if 1 /* c */ di 1\n'],
        ['capture /* c */ frame f: if 1 {\n    di 1\n}\n', 'capture frame f: if 1 /* c */ {\n    di 1\n}\n'],
        ['frame f /* c */ {\n    di 1\n}\n', 'frame f /* c */ {\n    di 1\n}\n'],
        ['frame f: /* c */ while 1 {\n    di 1\n}\n', 'frame f: while 1 /* c */ {\n    di 1\n}\n'],
        ['capture frame f /* c */ : if 1 {\n    di 1\n}\n', 'capture frame f: if 1 /* c */ {\n    di 1\n}\n'],
        ['foreach v in a /* c */ b {\n    di 1\n}\n', 'foreach v in a b /* c */ {\n    di 1\n}\n'],
        ['foreach v /* c */ in a b {\n    di 1\n}\n', 'foreach v in a b /* c */ {\n    di 1\n}\n'],
        ['while x /* c */ > 1 {\n    di 1\n}\n', 'while x > 1 /* c */ {\n    di 1\n}\n'],
        ['if x /* c */ > 1 {\n    di 1\n}\n', 'if x > 1 /* c */ {\n    di 1\n}\n'],
        ['if x /* c */ > 1 di 1\n', 'if x > 1 /* c */ di 1\n'],
        ['if 0 {\n}\nelse /* c */ {\n    di 1\n}\n'],
        ['forvalues i = 1 /* c */ /2 {\n    di 1\n}\n', 'forvalues i = 1 / 2 /* c */ {\n    di 1\n}\n'],
        ['unab x ///\n    : a\n', 'unab x: a\n'],
        ['quietly ///\n    : gen x = 1\n', 'quietly: gen x = 1\n'],
        ['quietly /* c */ ///\n    : gen x = 1\n', 'quietly: gen /* c */ x = 1\n'],
        ['capture /* c */ ///\n    noisily gen x = 1\n', 'capture noisily gen /* c */ x = 1\n'],
        ['quietly /* c */ ///\n    {\n    di 1\n}\n', 'quietly /* c */ {\n    di 1\n}\n'],
    ];

    for_each_formatter_mode('keeps the body, prefixes, and comments', (mode) => {
        for (const [my_source, my_ast_output] of THE_FORMATTED) {
            expect(parse(my_source).errors).toEqual([]);
            const expected = mode === 'ast' ? my_ast_output ?? my_source : my_source;
            const formatted = format(my_source, mode);
            expect(formatted).toBe(expected);
            expect(format(formatted, mode)).toBe(formatted);
        }
    });

    for_each_formatter_mode('indents and keeps an unindented prefixed body', (mode) => {
        const formatted = format('capture while 1 {\ndi 1\n}\n', mode);
        expect(formatted).toBe('capture while 1 {\n    di 1\n}\n');
    });
});

describe('sight parse --json for prefixed control flow', () => {
    const database = new CommandDatabase();
    database.load_cache(embedded_cache as CommandCache);

    it('reports the prefixes and the comments among them', () => {
        const document = build_parse_document({
            path: '/x/test.do',
            content: 'capture /* c */ foreach v in a /* d */ b {\n    di 1\n}\nqui if 1 {\n}\n',
            sight_version: 'test',
            command_database: database,
        });
        const [loop, condition] = document.statements as Array<Record<string, any>>;
        expect(loop).toMatchObject({ kind: 'foreach', variable: 'v' });
        expect(loop.prefixes.map((p: Record<string, any>) => p.name)).toEqual(['capture']);
        expect(loop.spec.items.map((i: Record<string, any>) => i.text)).toEqual(['a', 'b']);
        expect(loop.comments.interior.map((c: Record<string, any>) => c.text))
            .toEqual(['/* c */', '/* d */']);
        expect(loop.body).toHaveLength(1);
        expect(condition).toMatchObject({ kind: 'if' });
        expect(condition.prefixes.map((p: Record<string, any>) => p.canonical_name))
            .toEqual(['quietly']);
    });
});
