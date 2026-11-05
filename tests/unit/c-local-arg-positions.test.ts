import { describe, it, expect } from 'bun:test';
import {
    AnalysisResult,
    SemanticAnalyzer,
    create_empty_symbol_table,
} from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import {
    ResolvedScope,
    StataDiagnosticCode,
    StataLSPConfig,
    SymbolTable,
} from '../../src/types';
import { ScopeResolver } from '../../src/scope-resolver';
import { create_real_document_state } from '../test-context-helper';

const DIAGNOSTICS_CONFIG: StataLSPConfig = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning',
            undefinedVariable: 'information',
            styleWarnings: 'hint',
        },
    },
    completion: {},
    formatting: { indentSize: 4, indentStyle: 'spaces' },
    adoPaths: [],
    indexWorkspace: true,
};

/**
 * `c_local` names taken from a program's positional arguments:
 * `args where` then `` c_local `where' ``, `` c_local `1' ``, and a
 * leading `gettoken where 0 : 0`. Each case here was checked against
 * StataMP 18 (the caller gets the local named by the argument).
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

function positions_of(code: string, program_name: string): number[] | undefined {
    return analyze(code).symbols.programs.get(program_name)?.c_local_arg_positions;
}

describe('c_local argument positions: extraction', () => {
    it('records the args position of a c_local name', () => {
        expect(positions_of([
            'program define setter',
            '    args where',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([1]);
        expect(positions_of([
            'program define setter',
            '    args a where b',
            '    if 1 {',
            '        c_local `where\' 1',
            '    }',
            'end',
        ].join('\n'), 'setter')).toEqual([2]);
    });

    it('reads an args list continued over lines with comments', () => {
        expect(positions_of([
            'program define setter',
            '    args out1 /* first */ ///',
            '         out2',
            '    c_local `out2\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([2]);
    });

    it('records numbered c_local names', () => {
        expect(positions_of([
            'program define setter',
            '    c_local `2\' 1',
            '    c_local `1\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([1, 2]);
    });

    it('records a leading gettoken run from 0', () => {
        expect(positions_of([
            'program define setter',
            '    gettoken where 0 : 0',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([1]);
        expect(positions_of([
            'program define setter',
            '    gettoken id 0 : 0, parse(", ")',
            '    syntax [, `id\'(name)]',
            '    c_local `id\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([1]);
        // A later read is not counted: under parse(" ,") the call
        // `setter x, rhs` gives b the comma, not rhs.
        expect(positions_of([
            'program define setter',
            '    gettoken a 0 : 0, parse(" ,")',
            '    gettoken b 0:0, parse(" ,")',
            '    c_local `b\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // `gettoken a : 0` reads the next word without consuming it.
        expect(positions_of([
            'program define setter',
            '    gettoken a : 0',
            '    c_local `a\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([1]);
    });

    it('skips a name the body defines again', () => {
        expect(positions_of([
            'program define setter',
            '    args where',
            '    local where other',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        expect(positions_of([
            'program define setter',
            '    args where',
            '    args where',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
    });

    it('skips positions that the body may shift first', () => {
        // args after `macro shift` reads shifted positions.
        expect(positions_of([
            'program define setter',
            '    mac shift',
            '    args where',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // Numbered locals with tokenize anywhere in the body.
        expect(positions_of([
            'program define setter',
            '    c_local `1\' 1',
            '    tokenize "a b"',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // `` local `n' `` may set a numbered local.
        expect(positions_of([
            'program define setter',
            '    local `n\' x',
            '    args where',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        expect(positions_of([
            'program define setter',
            '    c_local `1\' 1',
            '    local `n\'',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // gettoken into a numbered local.
        expect(positions_of([
            'program define setter',
            '    gettoken 1 rest : other',
            '    args where',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // An args before a later tokenize still counts.
        expect(positions_of([
            'program define setter',
            '    args where',
            '    tokenize "a b"',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toEqual([1]);
    });

    it('skips gettoken reads it cannot count', () => {
        // parse() without a space: the first token runs to the comma.
        expect(positions_of([
            'program define setter',
            '    gettoken where 0 : 0, parse(",")',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // `0` reassigned first.
        expect(positions_of([
            'program define setter',
            '    local 0 `"x `0\'"\'',
            '    gettoken where 0 : 0',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // A gettoken into a macro-named local, which may be `0`.
        expect(positions_of([
            'program define setter',
            '    gettoken `target\' rest : other',
            '    gettoken where 0 : 0',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
        // An earlier conditional read from 0.
        expect(positions_of([
            'program define setter',
            '    if 1 {',
            '        gettoken skip 0 : 0',
            '    }',
            '    gettoken where 0 : 0',
            '    c_local `where\' 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
    });

    it('ignores c_local names built from more than one macro', () => {
        expect(positions_of([
            'program define setter',
            '    args where',
            '    c_local `where\'_x 1',
            'end',
        ].join('\n'), 'setter')).toBeUndefined();
    });
});

describe('c_local argument positions: calls', () => {
    const SETTERS = [
        'program define by_args',
        '    args a where',
        '    c_local `where\' 1',
        'end',
        'program define by_digit',
        '    c_local `1\' 1',
        'end',
        'program define by_gettoken',
        '    gettoken where 0 : 0, parse(" ,")',
        '    c_local `where\' 1',
        'end',
    ];

    it('defines the named local in the caller', () => {
        const result = analyze([
            ...SETTERS,
            'by_args x foo',
            'by_digit bar',
            'by_gettoken baz , opt',
            'display "`foo\' `bar\' `baz\'"',
        ].join('\n'));
        expect(undefined_macros(result)).toEqual([]);
    });

    it('works through prefixes', () => {
        const result = analyze([
            ...SETTERS,
            'quietly by_digit q1',
            'capture noisily by_digit c1',
            'qui: by_args x q2',
            'display "`q1\' `c1\' `q2\'"',
        ].join('\n'));
        expect(undefined_macros(result)).toEqual([]);
    });

    it('defines the local in the calling program', () => {
        const result = analyze([
            ...SETTERS,
            'program define caller',
            '    by_digit rhs',
            '    display "`rhs\'"',
            'end',
            'display "`rhs\'"',
        ].join('\n'));
        // Only the do-file reference: the call ran in caller's frame.
        expect(undefined_macros(result)).toEqual(['rhs']);
    });

    it('still warns when it cannot tell the name', () => {
        // In Stata `m4.x` is an invalid name (r(198)) and the others
        // define a local that depends on runtime values or quoting.
        // A macro before the position may expand to any number of
        // words, so the word after it is not resolved either.
        const result = analyze([
            ...SETTERS,
            'local nm m1',
            'by_digit `nm\'',
            'by_digit "m2"',
            'by_digit',
            'by_digit m4.x',
            'by_args `nm\' m6',
            'by_args "a b"',
            'display "`m1\' `m2\' `m4\' `m6\' `b\'"',
        ].join('\n'));
        expect(undefined_macros(result).sort()).toEqual(
            ['b', 'm1', 'm2', 'm4', 'm6']
        );
    });

    it('counts a quoted word as one position', () => {
        const result = analyze([
            ...SETTERS,
            'by_args "a b" found',
            'display "`found\'"',
        ].join('\n'));
        expect(undefined_macros(result)).toEqual([]);
    });

    it('does not define the local before the call', () => {
        const result = analyze([
            ...SETTERS,
            'display "`late\'"',
            'by_digit late',
        ].join('\n'));
        expect(undefined_macros(result)).toEqual(['late']);
    });

    it('defines the local at the argument word', () => {
        const code = [
            ...SETTERS,
            'by_digit rhs',
            'by_digit rhs',
        ].join('\n');
        const result = analyze(code);
        const symbol = result.symbols.localMacros.get('rhs');
        expect(symbol?.location.range).toEqual({
            start: { line: 11, character: 9 },
            end: { line: 11, character: 12 },
        });
        expect(symbol?.sourceUri).toBe('file:///test.do');
        expect(symbol?.additional_definitions?.map((d) => d.location.range.start))
            .toEqual([{ line: 12, character: 9 }]);
    });

    it('uses a workspace program from another file', () => {
        const setter = analyze([
            'program define _getrhs',
            '    args where',
            '    c_local `where\' x',
            'end',
        ].join('\n'), undefined, 'file:///ado/_getrhs.ado');
        const workspace_symbols = create_empty_symbol_table();
        for (const [my_name, my_program] of setter.symbols.programs) {
            workspace_symbols.programs.set(my_name, my_program);
        }
        const result = analyze([
            'program define avplot',
            '    _getrhs rhs',
            '    display "`rhs\'"',
            'end',
        ].join('\n'), workspace_symbols);
        expect(undefined_macros(result)).toEqual([]);
    });
});

describe('c_local argument positions: resolved-scope fallback', () => {
    async function diagnose(content: string): Promise<string[]> {
        const provider = new DiagnosticsProvider({ sendDiagnostics: () => {} });
        const symbols = create_empty_symbol_table();
        symbols.programs.set('setter', {
            name: 'setter',
            location: {
                uri: 'file:///parent.do',
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 3, character: 3 },
                },
            },
            sourceUri: 'file:///parent.do',
            c_local_arg_positions: [1],
        });
        const resolved_scope: ResolvedScope = {
            chain: [],
            symbols,
            out_of_scope_symbols: [],
            diagnostics: [],
            has_directives: false,
            has_auto_parents: false,
            is_standalone: false,
            scan_complete_at_resolve_time: true,
        };
        const scope_resolver = new ScopeResolver();
        scope_resolver.resolve = async () => resolved_scope;
        const the_diagnostics = await provider.get_diagnostics(
            create_real_document_state(content),
            DIAGNOSTICS_CONFIG,
            undefined,
            scope_resolver
        );
        return the_diagnostics
            .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
            .map((d) => (d.data as { symbol_name?: string }).symbol_name ?? '');
    }

    it('suppresses a local passed to a resolved-scope program', async () => {
        expect(await diagnose([
            'quietly setter rhs',
            'display "`rhs\'"',
        ].join('\n'))).toEqual([]);
    });

    it('keeps warnings the call does not cover', async () => {
        expect((await diagnose([
            'display "`early\'"',
            'setter early',
            'setter `nm\'',
            'setter "quoted"',
            'program define other',
            '    display "`early\'"',
            'end',
            'display "`quoted\'"',
        ].join('\n'))).sort()).toEqual(['early', 'early', 'nm', 'quoted']);
    });
});
