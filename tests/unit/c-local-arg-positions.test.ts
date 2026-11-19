import { describe, it, expect } from 'bun:test';
import { Range } from 'vscode-languageserver-textdocument';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    AnalysisResult,
    SemanticAnalyzer,
    create_empty_symbol_table,
} from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import {
    TOKENIZE_MIN_ABBREVIATION,
    collect_c_local_arg_calls,
} from '../../src/analyzer/c-local-arg-positions';
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
        // Numbered locals with tokenize before the c_local.
        expect(positions_of([
            'program define setter',
            '    tokenize "a b"',
            '    c_local `1\' 1',
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
            '    local `n\'',
            '    c_local `1\' 1',
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
    async function diagnose(
        content: string,
        setter_range: Range = {
            start: { line: 0, character: 0 },
            end: { line: 3, character: 3 },
        },
        setter_uri: string = 'file:///parent.do'
    ): Promise<string[]> {
        const provider = new DiagnosticsProvider({ sendDiagnostics: () => {} });
        const symbols = create_empty_symbol_table();
        symbols.programs.set('setter', {
            name: 'setter',
            location: {
                uri: setter_uri,
                range: setter_range,
            },
            sourceUri: setter_uri,
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

    it('keeps the warning when this file defines the program after a call', async () => {
        // The resolved scope holds this file's own later definition.
        const code = [
            'setter rhs',
            'display "`rhs\'"',
            'program define setter',
            '    args where',
            '    c_local `where\' 1',
            'end',
        ].join('\n');
        expect(await diagnose(code, {
            start: { line: 2, character: 0 },
            end: { line: 5, character: 3 },
        }, 'file:///test.do')).toEqual(['rhs']);
    });

    it('keeps the warning after a top-level program drop', async () => {
        expect(await diagnose([
            'program drop setter',
            'setter rhs',
            'display "`rhs\'"',
        ].join('\n'))).toEqual(['rhs']);
        // A drop that may not run (inside a block) is not counted.
        expect(await diagnose([
            'if 0 {',
            '    program drop setter',
            '}',
            'setter rhs',
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

describe('c_local argument positions: resets after the c_local', () => {
    // A reset of the numbered locals after `` c_local `1' `` ran
    // cannot undo the caller's local (StataMP 18: `result` is set).
    function numbered(the_body: string[]): number[] | undefined {
        return positions_of(
            ['program define setter', ...the_body, 'end'].join('\n'),
            'setter'
        );
    }

    it('credits a c_local before a later reset', () => {
        for (const my_reset of [
            'token "x y"', 'tokenize "x y"', 'macro shift',
            'local 1 x', 'local `n\' x', 'gettoken 1 : 0',
        ]) {
            expect(numbered(['    c_local `1\' 1', `    ${my_reset}`]))
                .toEqual([1]);
        }
    });

    it('credits a c_local before a reset later in the same loop body', () => {
        expect(numbered([
            '    forvalues i = 1/2 {',
            '        c_local `1\' 1',
            '        tokenize "x y"',
            '    }',
        ])).toEqual([1]);
    });

    it('does not credit a c_local after a reset earlier in a loop body', () => {
        expect(numbered([
            '    forvalues i = 1/2 {',
            '        tokenize "x y"',
            '        c_local `1\' 1',
            '    }',
        ])).toBeUndefined();
    });

    it('does not credit a c_local after a reset in an earlier branch', () => {
        expect(numbered([
            '    if "`2\'" != "" {',
            '        tokenize "x y"',
            '    }',
            '    c_local `1\' 1',
        ])).toBeUndefined();
        expect(numbered([
            '    if 1 {',
            '    }',
            '    else {',
            '        macro shift',
            '    }',
            '    c_local `1\' 1',
        ])).toBeUndefined();
    });

    it('starts each branch of an if/else chain from the state before it', () => {
        expect(numbered([
            '    if "`2\'" != "" {',
            '        tokenize "x y"',
            '    }',
            '    else if "`3\'" != "" {',
            '        macro shift',
            '    }',
            '    else {',
            '        c_local `1\' 1',
            '    }',
        ])).toEqual([1]);
    });

    it('credits the caller in the laterToken case', () => {
        const code = [
            'program define setter',
            '    c_local `1\' 1',
            '    token "x y"',
            'end',
            'capture setter result',
            'display "`result\'"',
        ].join('\n');
        expect(undefined_macros(analyze(code))).toEqual([]);
    });
});

describe('c_local argument positions: abbreviated tokenize', () => {
    // StataMP 18: `token alpha beta` then `` c_local `1' 1 `` sets the
    // caller's `alpha`, not the name the caller passed.
    for (const my_spelling of ['token', 'tokeni', 'tokeniz', 'tokenize']) {
        it(`treats ${my_spelling} as a change to numbered locals`, () => {
            const code = [
                'program define p',
                `    ${my_spelling} alpha beta`,
                '    c_local `1\' 1',
                'end',
                'p result',
                'display "[`result\']"',
            ].join('\n');
            expect(positions_of(code, 'p')).toBeUndefined();
            expect(undefined_macros(analyze(code))).toContain('result');
        });
    }

    it('does not treat a shorter or differently cased word as tokenize', () => {
        for (const my_spelling of ['toke', 'Token']) {
            expect(positions_of([
                'program define p',
                `    ${my_spelling} alpha beta`,
                '    c_local `1\' 1',
                'end',
            ].join('\n'), 'p')).toEqual([1]);
        }
    });

    it('matches the command database minimum abbreviation', () => {
        const cache = JSON.parse(readFileSync(join(
            import.meta.dir, '../../src/command-database/caches/v18.json'
        ), 'utf8')) as {
            commands: Record<string, { min_abbreviation: number }>;
        };
        expect(cache.commands['tokenize']?.min_abbreviation)
            .toBe(TOKENIZE_MIN_ABBREVIATION);
    });
});

describe('c_local argument positions: which programs a call can reach', () => {
    const SETTER = [
        'program define review_setter',
        '    args name',
        '    c_local `name\' 1',
        'end',
    ].join('\n');

    function workspace_from(code: string, uri: string): SymbolTable {
        const setter = analyze(code, undefined, uri);
        const workspace_symbols = create_empty_symbol_table();
        for (const [my_name, my_program] of setter.symbols.programs) {
            workspace_symbols.programs.set(my_name, my_program);
        }
        return workspace_symbols;
    }

    const CALL = [
        'capture review_setter result',
        'display "`result\'"',
    ].join('\n');

    it('ignores a program from an unrelated workspace .do file', () => {
        const workspace_symbols = workspace_from(
            SETTER, 'file:///work/library.do'
        );
        const result = analyze(CALL, workspace_symbols, 'file:///work/main.do');
        expect(undefined_macros(result)).toEqual(['result']);
    });

    it('ignores a workspace .ado file named after another program', () => {
        const workspace_symbols = workspace_from(
            SETTER, 'file:///work/other.ado'
        );
        const result = analyze(CALL, workspace_symbols, 'file:///work/main.do');
        expect(undefined_macros(result)).toEqual(['result']);
    });

    it('uses a workspace .ado file named after the program', () => {
        const workspace_symbols = workspace_from(
            SETTER, 'file:///work/review_setter.ado'
        );
        const result = analyze(CALL, workspace_symbols, 'file:///work/main.do');
        expect(undefined_macros(result)).toEqual([]);
    });

    it('ignores a program defined later in the same file', () => {
        const code = [CALL, SETTER].join('\n');
        // The workspace index holds this file's own programs too.
        const workspace_symbols = workspace_from(code, 'file:///work/main.do');
        const result = analyze(code, workspace_symbols, 'file:///work/main.do');
        expect(undefined_macros(result)).toEqual(['result']);
    });

    it('uses a program defined earlier in the same file', () => {
        const code = [SETTER, CALL].join('\n');
        expect(undefined_macros(analyze(code))).toEqual([]);
    });

    it('uses a later same-file program from inside a program body', () => {
        // The body runs only when the program is called, after the
        // whole file (an ado with helper subprograms) has loaded.
        const code = [
            'program define caller',
            '    review_setter result',
            '    display "`result\'"',
            'end',
            SETTER,
        ].join('\n');
        const workspace_symbols = workspace_from(code, 'file:///work/caller.ado');
        const result = analyze(code, workspace_symbols, 'file:///work/caller.ado');
        expect(undefined_macros(result)).toEqual([]);
    });

    it('leaves a program from a file called earlier to the resolved scope', () => {
        // Which file `run library.do` runs is a path question: the
        // diagnostics provider answers it from the resolved execution
        // scope (see tests/integration/c-local-arg-reachability-cli),
        // not the analyzer from a file name.
        const workspace_symbols = workspace_from(
            SETTER, 'file:///work/sub/library.do'
        );
        const result = analyze(
            ['run sub/library.do', CALL].join('\n'),
            workspace_symbols,
            'file:///work/main.do'
        );
        expect(undefined_macros(result)).toEqual(['result']);
    });

    it('ignores a same-file program after a top-level program drop', () => {
        const dropped = [SETTER, 'program drop review_setter', CALL].join('\n');
        expect(undefined_macros(analyze(dropped))).toEqual(['result']);
        const dropped_all = [SETTER, 'program drop _all', CALL].join('\n');
        expect(undefined_macros(analyze(dropped_all))).toEqual(['result']);
        // Dropped, then defined again: the usual idiom.
        const redefined = [
            'capture program drop review_setter', SETTER, CALL,
        ].join('\n');
        expect(undefined_macros(analyze(redefined))).toEqual([]);
        const dropped_then_redefined = [
            SETTER, 'program drop review_setter', SETTER, CALL,
        ].join('\n');
        expect(undefined_macros(analyze(dropped_then_redefined))).toEqual([]);
    });

    it('ignores another file\'s program from inside a program body', () => {
        const workspace_symbols = workspace_from(
            SETTER, 'file:///work/library.do'
        );
        const result = analyze([
            'program define caller',
            '    review_setter result',
            '    display "`result\'"',
            'end',
        ].join('\n'), workspace_symbols, 'file:///work/caller.ado');
        expect(undefined_macros(result)).toEqual(['result']);
    });
});

describe('c_local argument positions: work per call', () => {
    // Before, each call compared its name against every earlier
    // `do`/`run`/`include`: 160,000 path splits for 400 loads and 400
    // calls. Counted, not timed: every read of a loaded file's
    // program map is a visit.
    class CountingMap<K, V> extends Map<K, V> {
        static visits = 0;
        override get(key: K): V | undefined {
            CountingMap.visits++;
            return super.get(key);
        }
        override [Symbol.iterator](): MapIterator<[K, V]> {
            CountingMap.visits++;
            return super[Symbol.iterator]();
        }
    }

    function visits(count: number): { visits: number; calls: number } {
        const code = 'run empty.do\n'.repeat(count)
            + 'run lib.do\n'
            + 'setter dest\n'.repeat(count)
            + 'display "`dest\'"\n';
        const tokens = new StataLexer().tokenize(code).tokens;
        const ast = new StataParser().parse(tokens).ast;
        const the_loads = [];
        for (let i = 0; i <= count; i++) {
            const programs = new CountingMap<string, { c_local_arg_positions?: number[] }>();
            if (i === count) programs.set('setter', { c_local_arg_positions: [1] });
            the_loads.push({ end: { line: i, character: 12 }, programs });
        }
        CountingMap.visits = 0;
        const result = collect_c_local_arg_calls(ast.nodes, tokens, {
            own_programs: new Map(),
            loaded_before: new Map(),
            loads: the_loads,
        });
        return {
            visits: CountingMap.visits,
            calls: result.calls.get('dest')?.length ?? 0,
        };
    }

    it('reads each loaded file a bounded number of times', () => {
        const small = visits(200);
        const large = visits(400);
        expect(small.calls).toBe(200);
        expect(large.calls).toBe(400);
        // Two passes over each load: linear, about 2x for 2x the input.
        expect(large.visits).toBeLessThanOrEqual(2 * (400 + 1));
        expect(large.visits).toBeLessThan(small.visits * 2.1);
    });
});
