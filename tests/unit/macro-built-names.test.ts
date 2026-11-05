/**
 * Names joined to macro references: `` local foo`x' 1 `` defines `foo`
 * followed by the value of `x` (`foo3` when `x` is 3), not `foo`, and
 * `` gen v`i' = 1 `` creates `v2`, not `v`. Checked in StataMP 18,
 * which also reads `` local foo`x'bar ``, `` local foo${g} ``,
 * `` global gg`x' ``, the `: fcn`, `= exp` and `++` forms, and
 * `` args a`x' b `` the same way, and ends the name at a quote:
 * `` local q`x'"a b" `` defines `q3` as `a b`.
 */
import { describe, expect, it } from 'bun:test';
import { CommandDatabase } from '../../src/command-database';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CompletionProvider } from '../../src/providers/completion';
import { DefinitionProvider } from '../../src/providers/definition';
import { CodeFormatter } from '../../src/providers/formatter';
import { HoverProvider } from '../../src/providers/hover';
import { ReferencesProvider } from '../../src/providers/references';
import { SymbolProvider } from '../../src/providers/symbols';
import { StataNode, StataDiagnosticCode } from '../../src/types';
import { create_document_state } from '../property/helpers/document-utils';
import {
    DEFAULT_FORMATTING_OPTIONS,
    FormatterMode,
    create_formatter_config,
    for_each_formatter_mode,
} from '../property/helpers/formatter-test-utils';

function first_node(source: string): StataNode | undefined {
    const tokens = new StataLexer().tokenize(source + '\n').tokens;
    return new StataParser().parse(tokens).ast.nodes[0];
}

function format(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        DEFAULT_FORMATTING_OPTIONS,
        create_formatter_config(mode)
    );
    return edits[0]?.newText ?? source;
}

/** Messages of the UNDEFINED_MACRO diagnostics. */
function undefined_macros(source: string): string[] {
    return create_document_state(source).diagnostics
        .filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((my_diagnostic) => my_diagnostic.message);
}

function undefined_variables(source: string): string[] {
    return create_document_state(source).diagnostics
        .filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)
        .map((my_diagnostic) => my_diagnostic.message);
}

describe('parser: macro names joined to macro references', () => {
    const CASES: {
        source: string;
        name: string;
        value: string;
        parts: string[];
    }[] = [
        { source: "local foo`x' 1", name: "foo`x'", value: '1', parts: ['foo', "`x'"] },
        { source: "global gg`x' 2", name: "gg`x'", value: '2', parts: ['gg', "`x'"] },
        { source: "local foo`x'bar 4", name: "foo`x'bar", value: '4', parts: ['foo', "`x'", 'bar'] },
        { source: 'local foo${g} 5', name: 'foo${g}', value: '5', parts: ['foo', '${g}'] },
        { source: 'local foo$g 6', name: 'foo$g', value: '6', parts: ['foo', '$g'] },
        { source: "local m`x'n`x' 5", name: "m`x'n`x'", value: '5', parts: ['m', "`x'", 'n', "`x'"] },
        { source: "local ee`x' = 1+2", name: "ee`x'", value: '1+2', parts: ['ee', "`x'"] },
        { source: "local ++foo`x'", name: "foo`x'", value: '++', parts: ['foo', "`x'"] },
        // A quote, `=` or `:` ends the name
        { source: "local q`x'\"a b\"", name: "q`x'", value: '"a b"', parts: ['q', "`x'"] },
        { source: "local q`x'`\"a b\"'", name: "q`x'", value: '`"a b"\'', parts: ['q', "`x'"] },
        { source: "local ee`x'=1", name: "ee`x'", value: '1', parts: ['ee', "`x'"] },
    ];

    for (const my_case of CASES) {
        it(`reads ${my_case.source} as naming ${my_case.name}`, () => {
            const node = first_node(my_case.source);
            if (node?.type !== 'macro_def') {
                throw new Error(`expected macro_def, got ${node?.type}`);
            }
            expect(node.name).toBe(my_case.name);
            expect(node.value).toBe(my_case.value);
            expect((node.name_parts ?? []).map((my_part) =>
                my_part.kind === 'text' ? my_part.value : my_part.text))
                .toEqual(my_case.parts);
        });
    }

    it('reads the extended form with the joined name', () => {
        for (const my_source of ["local ww`x' : word 2 of a b c", "local ww`x':word 2 of a b c"]) {
            const node = first_node(my_source);
            if (node?.type !== 'macro_def') {
                throw new Error(`expected macro_def, got ${node?.type}`);
            }
            expect(node.name).toBe("ww`x'");
            expect(node.extendedFunction).toMatchObject({ name: 'word', args: '2 of a b c' });
            expect(node.name_parts).toHaveLength(2);
        }
    });

    // A name joined to a macro can reach the `:`, so the function after
    // it may be a macro too: `` : `ch'(scalars) `` is `e(scalars)` when
    // `ch` is `e`, and `` : `what'names m `` is `rownames m` (StataMP 18)
    it('reads an extended function named by macros', () => {
        const CASES = [
            { source: "local x : `ch'(scalars)", name: "`ch'", args: '(scalars)' },
            { source: "global SR_`n'_s : `ch'(scalars)", name: "`ch'", args: '(scalars)' },
            { source: "local holdnm : `what'names `xx'", name: "`what'names", args: "`xx'" },
            { source: 'local x : $f(macros)', name: '$f', args: '(macros)' },
        ];
        for (const my_case of CASES) {
            const tokens = new StataLexer().tokenize(my_case.source + '\n').tokens;
            const result = new StataParser().parse(tokens);
            expect(result.errors).toEqual([]);
            expect(result.ast.nodes[0]).toMatchObject({
                type: 'macro_def',
                extendedFunction: { name: my_case.name, args: my_case.args },
            });
        }
    });

    it('reads the joined name under #delimit ;', () => {
        const tokens = new StataLexer().tokenize("#delimit ;\nlocal dd`x' 4 ;\n").tokens;
        const node = new StataParser().parse(tokens).ast.nodes
            .find((my_node) => my_node.type === 'macro_def');
        expect(node).toMatchObject({ name: "dd`x'", value: '4' });
    });

    it('leaves a plain name without name_parts', () => {
        const node = first_node('local foo 1');
        expect(node).toMatchObject({ type: 'macro_def', name: 'foo', value: '1' });
        expect(node && 'name_parts' in node).toBe(false);
    });

    it('keeps a name that starts with a macro as a command', () => {
        for (const my_source of ["local `x' 9", "local `a'`b' 1", "local `x'foo 1"]) {
            expect(first_node(my_source)?.type).toBe('command');
        }
    });
});

describe('analyzer: a macro-built name defines nothing it can name', () => {
    it('still reports `foo\' after local foo`x\' 1', () => {
        expect(undefined_macros("local x 3\nlocal foo`x' 1\ndi \"`foo'\"\n"))
            .toEqual(["`foo' is not defined"]);
    });

    it('still reports $gg after global gg`x\' 1', () => {
        expect(undefined_macros("local x 3\nglobal gg`x' 1\ndi \"$gg\"\n"))
            .toEqual(['$gg is not defined']);
    });

    it('defines nothing for each macro definition form', () => {
        for (const my_source of [
            "local foo`x' : word 1 of a b",
            "local foo`x' = 1",
            "local ++foo`x'",
            "local foo`x'bar 1",
        ]) {
            const document = create_document_state(`local x 3\n${my_source}\n`);
            expect([...document.symbols.localMacros.keys()]).toEqual(['x']);
        }
    });

    it('keeps a plain definition of the same prefix', () => {
        expect(undefined_macros("local x 3\nlocal foo 2\nlocal foo`x' 1\ndi \"`foo'\"\n"))
            .toEqual([]);
    });

    it('reads on past an extended function named by a macro', () => {
        expect(undefined_macros(
            "program p\n    local ch e\n    local x : `ch'(scalars)\n    di \"`x'\"\nend\n"
        )).toEqual([]);
    });

    it('reports a macro used in the name', () => {
        expect(undefined_macros("local foo`x' 1\n")).toEqual(["`x' is not defined"]);
    });
});

describe('analyzer: variable, scalar and matrix names built from macros', () => {
    it('defines no variable v for gen, egen, input or rename', () => {
        for (const my_source of [
            "gen v`i' = 1",
            "gen double v`i' = 1",
            "egen v`i' = mean(x)",
            "input v`i'",
            "rename x v`i'",
            "confirm variable v`i'",
        ]) {
            const document = create_document_state(`local i 2\n${my_source}\n`);
            expect([...document.symbols.variables.keys()]).toEqual([]);
        }
    });

    it('still defines a plain new variable', () => {
        const document = create_document_state('gen double v = 1\nrename v w\n');
        expect([...document.symbols.variables.keys()].sort()).toEqual(['v', 'w']);
    });

    it('defines no scalar sc or matrix m', () => {
        const document = create_document_state(
            "local x 3\nscalar sc`x' = 1\nmatrix m`x' = J(1,1,0)\nmatrix define n`x' = J(1,1,0)\n"
        );
        expect([...document.symbols.scalars.keys()]).toEqual([]);
        expect([...document.symbols.matrices.keys()]).toEqual([]);
    });

    it('does not check a macro-built name as a variable', () => {
        expect(undefined_variables("local i 2\nreplace v`i' = 2\n")).toEqual([]);
        expect(undefined_variables("local x 3\ndi sc`x'\n")).toEqual([]);
        expect(undefined_variables('replace v = 2\n')).toEqual(['v may not be defined']);
    });
});

describe('providers: a macro-built name is not a definition', () => {
    const SOURCE = "local x 3\nlocal foo`x' 1\ngen v`x' = 1\ndi \"`foo'\" v\n";
    // On `foo` in `di "`foo'"`, and on `v` after it
    const FOO_REFERENCE = { line: 3, character: 6 };
    const V_REFERENCE = { line: 3, character: 11 };

    it('leaves foo and v out of the outline', () => {
        const the_names = new SymbolProvider()
            .get_document_symbols(create_document_state(SOURCE))
            .map((my_symbol) => my_symbol.name);
        expect(the_names).toEqual(["`x'"]);
    });

    it('finds no definition, hover or declaration for foo', async () => {
        const document = create_document_state(SOURCE);
        expect(await new DefinitionProvider().get_definition(document, FOO_REFERENCE))
            .toBeNull();
        expect(await new HoverProvider(new CommandDatabase())
            .get_hover(document, FOO_REFERENCE)).toBeNull();
        const the_references = await new ReferencesProvider().get_references(
            document, FOO_REFERENCE, { includeDeclaration: true }
        );
        expect(the_references.map((my_reference) => my_reference.range.start.line))
            .toEqual([3]);
    });

    it('finds no references to v at the gen', async () => {
        const the_references = await new ReferencesProvider().get_references(
            create_document_state(SOURCE), V_REFERENCE, { includeDeclaration: true }
        );
        expect(the_references.map((my_reference) => my_reference.range.start.line))
            .not.toContain(2);
    });

    it('does not offer foo in completion', async () => {
        const source = "local x 3\nlocal foo`x' 1\ndi \"`\n";
        const the_items = await new CompletionProvider(new CommandDatabase())
            .get_completions(create_document_state(source), { line: 2, character: 5 }, '`');
        const the_labels = the_items.map((my_item) => my_item.label);
        expect(the_labels).toContain('x');
        expect(the_labels).not.toContain('foo');
    });
});

describe('formatter: macro-built names print unchanged', () => {
    const SOURCES = [
        "local foo`x' 1",
        "global gg`x' 2",
        "local foo`x'bar 4",
        'local foo${g} 5',
        'local foo$g 6',
        "local ww`x' : word 2 of a b c",
        "local ee`x' = 1 + 2",
        "local ++foo`x'",
        "capture local foo`x' 1",
        "args a`x' b",
        "gen v`x' = 1",
    ];

    for_each_formatter_mode('keeps each name joined to its macros', (mode) => {
        for (const my_source of SOURCES) {
            const once = format(my_source, mode);
            expect(once.trimEnd()).toBe(my_source);
            expect(format(once, mode)).toBe(once);
        }
    });

    // The AST formatter puts a space before the quoted value, which
    // Stata reads the same (`` local q"a b" `` is `` local q "a b" ``)
    for_each_formatter_mode('ends the name at a quote', (mode) => {
        const expected = mode === 'ast'
            ? "local q`x' \"a b\""
            : "local q`x'\"a b\"";
        const once = format("local q`x'\"a b\"", mode);
        expect(once.trimEnd()).toBe(expected);
        expect(format(once, mode)).toBe(once);
    });

    // Stata reads `: e (scalars)` as `: e(scalars)`, so the AST
    // formatter may space the arguments as it does for `r(scalars)`,
    // but a function name joined to a macro stays whole.
    for_each_formatter_mode('keeps a macro-named extended function', (mode) => {
        const CASES = [
            {
                source: "local x`y' : `ch'(scalars)",
                ast: "local x`y' : `ch' (scalars)",
            },
            {
                source: "local holdnm : `what'names `xx'",
                ast: "local holdnm : `what'names `xx'",
            },
        ];
        for (const my_case of CASES) {
            const once = format(my_case.source, mode);
            expect(once.trimEnd())
                .toBe(mode === 'ast' ? my_case.ast : my_case.source);
            expect(format(once, mode)).toBe(once);
        }
    });

    for_each_formatter_mode('keeps the name joined under #delimit ;', (mode) => {
        const source = "#delimit ;\nlocal dd`x' 4 ;\n#delimit cr\n";
        const once = format(source, mode);
        expect(once).toContain("local dd`x' 4");
        expect(format(once, mode)).toBe(once);
    });
});
