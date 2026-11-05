import { describe, it, expect } from 'bun:test';
import {
    AnalysisResult,
    SemanticAnalyzer,
    create_empty_symbol_table,
} from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

/**
 * A name joined to a macro, such as `` c_local foo`x' 1 ``, is one
 * word: Stata defines `foo` followed by the value of `x` (`foo3`), not
 * `foo`. StataMP 18 confirms this for `c_local`, `args`, `gettoken`
 * and `tempvar`. The parser splits the word at the macro, so these
 * tests check that no command registers the literal prefix.
 */

function analyze(
    code: string,
    workspace_symbols?: SymbolTable,
    uri: string = 'file:///test.do'
): AnalysisResult {
    const tokens = new StataLexer().tokenize(code).tokens;
    const ast = new StataParser().parse(tokens).ast;
    return new SemanticAnalyzer().analyze(
        ast,
        uri,
        workspace_symbols,
        { undefined_macro_enabled: true },
        tokens
    );
}

function undefined_macros(result: AnalysisResult): string[] {
    return result.diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => /`([^']+)'/.exec(d.message)?.[1] ?? d.message);
}

function setter(name_text: string): string[] {
    return [
        'program define setter',
        '    local x 3',
        `    c_local ${name_text} 1`,
        'end',
    ];
}

describe('c_local name joined to a macro', () => {
    const JOINED_NAMES: Array<[string, string]> = [
        ['foo`x\'', 'foo'],
        ['`x\'foo', 'foo'],
        ['foo`x\'bar', 'foo'],
        ['${g}foo', 'foo'],
    ];

    for (const [my_text, my_prefix] of JOINED_NAMES) {
        it(`does not define ${my_prefix} from c_local ${my_text}`, () => {
            const result = analyze([
                ...setter(my_text),
                'setter',
                `display "\`${my_prefix}'"`,
            ].join('\n'));
            expect(result.symbols.programs.get('setter')?.c_locals)
                .toBeUndefined();
            expect(undefined_macros(result)).toContain(my_prefix);
        });
    }

    it('records no argument position for a name of two macros', () => {
        const result = analyze([
            'program define setter',
            '    args a b',
            '    c_local `a\'`b\' 1',
            'end',
            'setter rhs lhs',
            'display "`rhs\'"',
        ].join('\n'));
        const program = result.symbols.programs.get('setter');
        expect(program?.c_locals).toBeUndefined();
        expect(program?.c_local_arg_positions).toBeUndefined();
        expect(undefined_macros(result)).toEqual(['rhs']);
    });

    it('still defines a plain c_local name', () => {
        const result = analyze([
            ...setter('foo'),
            'setter',
            'display "`foo\'"',
        ].join('\n'));
        expect(result.symbols.programs.get('setter')?.c_locals)
            .toEqual(['foo']);
        expect(undefined_macros(result)).toEqual([]);
    });

    // A quote ends the name: StataMP 18 defines `qa` and `qb` here.
    it('defines a name followed directly by a quoted value', () => {
        const result = analyze([
            'program define setter',
            '    local v "hello"',
            '    c_local qa"`v\'"',
            '    c_local qb`"`v\'"\'',
            'end',
            'setter',
            'display "`qa\' `qb\'"',
        ].join('\n'));
        expect(result.symbols.programs.get('setter')?.c_locals)
            .toEqual(['qa', 'qb']);
        expect(undefined_macros(result)).toEqual([]);
    });

    it('reads c_local `opt\' followed by a quote as option-named', () => {
        for (const my_value of ['"x"', '`"x"\'']) {
            const result = analyze([
                'program define setter',
                '    syntax [, Local(string)]',
                `    c_local \`local'${my_value}`,
                'end',
                'setter, local(rhs)',
                'display "`rhs\'"',
            ].join('\n'));
            expect(
                result.symbols.programs.get('setter')
                    ?.macro_creating_local_options
            ).toEqual(['local']);
            expect(undefined_macros(result)).toEqual([]);
        }
    });

    it('does not define the prefix from a workspace program', () => {
        const ado = analyze(
            setter('foo`x\'').join('\n'),
            undefined,
            'file:///ado/setter.ado'
        );
        expect(ado.symbols.programs.get('setter')?.c_locals).toBeUndefined();
        const workspace_symbols = create_empty_symbol_table();
        for (const [my_name, my_program] of ado.symbols.programs) {
            workspace_symbols.programs.set(my_name, my_program);
        }
        const result = analyze(
            ['setter', 'display "`foo\'"'].join('\n'),
            workspace_symbols
        );
        expect(undefined_macros(result)).toEqual(['foo']);
    });

    it('does not read c_local `opt\'_x as an option-named local', () => {
        const result = analyze([
            'program define setter',
            '    syntax [, Local(string)]',
            '    c_local `local\'_x 1',
            'end',
        ].join('\n'));
        expect(
            result.symbols.programs.get('setter')?.macro_creating_local_options
        ).toBeUndefined();
    });
});

describe('local-defining commands with a name joined to a macro', () => {
    const CASES: Array<[string, string]> = [
        ['tempvar tv`x\'', 'tv'],
        ['tempname tn`x\'', 'tn'],
        ['tempfile tf`x\'', 'tf'],
        ['args ar`x\'', 'ar'],
        ['gettoken gt`x\' rest : s', 'gt'],
        ['gettoken first gt`x\' : s', 'gt'],
        ['file read fh fr`x\'', 'fr'],
    ];

    for (const [my_statement, my_prefix] of CASES) {
        it(`${my_statement} does not define ${my_prefix}`, () => {
            const result = analyze([
                'local x 3',
                'local s "a b"',
                my_statement,
                `display "\`${my_prefix}'"`,
            ].join('\n'));
            expect(undefined_macros(result)).toEqual([my_prefix]);
        });
    }

    it('reads the word after a joined gettoken name as the second name', () => {
        const result = analyze([
            'local x 3',
            'local s "a b"',
            'gettoken gt`x\' rest : s',
            'display "`rest\'"',
        ].join('\n'));
        expect(undefined_macros(result)).toEqual([]);
    });

    it('still defines the plain names next to a joined one', () => {
        const result = analyze([
            'local x 3',
            'tempvar a tv`x\' b',
            'display "`a\' `b\'"',
        ].join('\n'));
        expect(undefined_macros(result)).toEqual([]);
    });

    it('counts args positions by word', () => {
        const result = analyze([
            'program define setter',
            '    local x 3',
            '    args a`x\' where',
            '    c_local `where\' 1',
            'end',
            'setter one rhs',
            'display "`rhs\'"',
        ].join('\n'));
        expect(
            result.symbols.programs.get('setter')?.c_local_arg_positions
        ).toEqual([2]);
        expect(undefined_macros(result)).toEqual([]);
    });
});
