/**
 * The operands of `: list` are macro names written bare, so they are
 * checked as local macro references; its subcommand words are not.
 * Each form below runs in Stata 18 (checked on StataMP 18).
 */

import { describe, expect, it } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { MacroDefNode, StataDiagnosticCode } from '../../src/types';

function parse(source: string) {
    const { tokens } = new StataLexer().tokenize(source);
    return { ...new StataParser().parse(tokens), tokens };
}

/** The bare-word and explicit macro references of the one extended macro. */
function operand_names(source: string): string[] {
    const { ast } = parse(source);
    const node = ast.nodes.find(
        (my_node): my_node is MacroDefNode => my_node.type === 'macro_def'
    );
    return (node?.extendedFunction?.macroRefs ?? []).map((my_ref) => my_ref.name);
}

function undefined_macros(source: string): string[] {
    const { ast, tokens } = parse(source);
    return new SemanticAnalyzer()
        .analyze(ast, 'file:///test.do', undefined, { undefined_macro_enabled: true }, tokens)
        .diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => d.symbol_name ?? '');
}

describe(': list operands', () => {
    it('reads the macro name after each one-operand subcommand', () => {
        const the_cases: Array<[string, string[]]> = [
            ['local r : list uniq a', ['a']],
            ['local r : list dups a', ['a']],
            ['local r : list sort a', ['a']],
            ['local r : list clean a', ['a']],
            ['local r : list sizeof a', ['a']],
            ['local r : list retokenize a', ['a']],
            ['local r : list retok a', ['a']],
            ['local r : list retokeni a', ['a']],
            ['local r : list posof "x y" in a', ['a']],
        ];
        for (const [my_source, my_expected] of the_cases) {
            expect({ my_source, found: operand_names(my_source) })
                .toEqual({ my_source, found: my_expected });
        }
    });

    it('reads both names around each operator', () => {
        for (const my_operator of ['|', '&', '-', '==', '===', 'in']) {
            const source = `local r : list a ${my_operator} b`;
            expect({ source, found: operand_names(source) })
                .toEqual({ source, found: ['a', 'b'] });
        }
    });

    it('reads a subcommand word as a macro name where Stata does', () => {
        // `list sort sort` sorts the local named sort; `list sort | b`
        // and `list posof in b` are binary.
        expect(operand_names('local r : list sort sort')).toEqual(['sort']);
        expect(operand_names('local r : list sort | b')).toEqual(['sort', 'b']);
        expect(operand_names('local r : list posof in b')).toEqual(['posof', 'b']);
        // Stata reads subcommands exactly as written: `retoke` is one,
        // `reto` and `Uniq` are not (they fail with r(198)).
        expect(operand_names('local r : list reto a')).toEqual(['reto', 'a']);
    });

    it('does not read a word glued to a macro reference as a name', () => {
        // `` `dim'list `` is a name built at run time.
        expect(operand_names("local r : list sizeof `dim'list")).toEqual(['dim']);
        expect(operand_names("local r : list sizeof b`dim'")).toEqual(['dim']);
        expect(operand_names("local r : list a`i' | b")).toEqual(['i', 'b']);
    });

    it('keeps explicit macro references among the operands', () => {
        expect(operand_names("local r : list `x' - $g")).toEqual(['x', 'g']);
    });

    it('reads no bare-word operands from other extended functions', () => {
        // Their bare words are keywords, strings, or names that are not
        // checked as macros (`subinstr local a`, `piece 1 5 of`).
        for (const my_source of [
            'local r : word count a b c',
            'local r : word 2 of a b c',
            'local r : piece 1 5 of "abc def"',
            'local r : subinstr local a "x" "X"',
            'local r : length local a',
            'local r : copy local a',
            'local r : properties regress',
            'local r : results r',
            'local r : sizeof local a',
        ]) {
            expect({ my_source, found: operand_names(my_source) })
                .toEqual({ my_source, found: [] });
        }
    });

    it('does not report a subcommand as an undefined macro', () => {
        const source = [
            'local el "a b"',
            'local r1 : list retok el',
            'local r2 : list retokenize el',
            'local r3 : list posof "a" in el',
            'local r4 : list uniq el',
            '',
        ].join('\n');
        expect(undefined_macros(source)).toEqual([]);
    });

    it('still reports an undefined operand', () => {
        expect(undefined_macros('local r : list retok nosuch\n')).toEqual(['nosuch']);
        expect(undefined_macros('local a 1\nlocal r : list nosuch2 - a\n')).toEqual(['nosuch2']);
    });
});
