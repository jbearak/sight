import { describe, expect, it, spyOn } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { analyze_source } from '../../src/source-analysis';

describe('source analysis', () => {
    const uri = 'file:///workspace/main.do';

    it('shares one lexical pass with every directive scan', () => {
        const tokenize = spyOn(StataLexer.prototype, 'tokenize');
        try {
            const source = [
                '// sight: standalone',
                '// sight: wd "/workspace"',
                '// sight: local declared',
                '// sight: include "helper.do"',
                'local own = 1',
                "display `declared' `own'",
            ].join('\n');

            const result = analyze_source(source, uri);

            expect(tokenize).toHaveBeenCalledTimes(1);
            expect(result.directives.standalone).toBeDefined();
            expect(result.directives.working_directory?.resolved_path)
                .toBe('workspace');
            expect(result.directives.working_directory?.is_workspace_relative)
                .toBe(true);
            expect(result.directives.forward_calls).toHaveLength(1);
            expect(result.analysis.symbols.localMacros.has('declared'))
                .toBe(true);
            expect(result.analysis.symbols.localMacros.has('own')).toBe(true);
            expect(result.analysis.diagnostics).toEqual([]);
        } finally {
            tokenize.mockRestore();
        }
    });

    it('keeps commented directives inert and command case exact', () => {
        const source = [
            '/*',
            '// sight: standalone',
            '// sight: include "hidden.do"',
            '*/',
            'Do "wrong_case.do"',
            'do "actual.do"',
            'local myVar = 1',
            "display `myvar'",
        ].join('\n');

        const result = analyze_source(source, uri);

        expect(result.directives.standalone).toBeUndefined();
        expect(result.directives.forward_calls).toEqual([]);
        expect(result.analysis.forward_calls.map(call => call.raw_path))
            .toEqual(['actual.do']);
        expect(result.analysis.symbols.localMacros.has('myVar')).toBe(true);
        expect(result.analysis.symbols.localMacros.has('myvar')).toBe(false);
        expect(result.analysis.diagnostics.some(diagnostic =>
            diagnostic.message.includes('myvar')
        )).toBe(true);
    });

    it('returns independently owned symbols and program signatures', () => {
        const source = [
            'program define worker',
            '    syntax varlist, A(string)',
            'end',
        ].join('\n');

        const first = analyze_source(source, uri);
        const second = analyze_source(source, uri);
        const first_program = first.analysis.symbols.programs.get('worker');
        const second_program = second.analysis.symbols.programs.get('worker');

        expect(first_program?.signature).toBeDefined();
        expect(second_program?.signature).toEqual(first_program?.signature);
        expect(second_program?.signature).not.toBe(first_program?.signature);
        expect(second.tokens).not.toBe(first.tokens);

        first.analysis.symbols.programs.clear();
        expect(second.analysis.symbols.programs.has('worker')).toBe(true);
    });
});
