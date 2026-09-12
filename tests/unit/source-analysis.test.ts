import { describe, expect, it, spyOn } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import {
    analyze_source,
    prepare_forward_calls,
} from '../../src/source-analysis';
import { type RichResolveFs } from '../../src/utils/file-path-utils';

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

describe('forward call preparation', () => {
    const uri = 'file:///workspace/main.do';
    const source = [
        '// sight: do "declared.do"',
        'do "before.do"',
        'cd "next"',
        'include "after.do"',
    ].join('\n');
    const missing_fs: RichResolveFs = {
        existsSync: () => false,
        readdirSync: () => [],
        statSync: () => ({
            isFile: () => false,
            isDirectory: () => false,
        }),
    };

    it('projects commands by position and directives with the file-wide WD', () => {
        const result = analyze_source(source, uri);
        const visited_paths: string[] = [];

        const calls = prepare_forward_calls({
            uri,
            command_calls: result.analysis.forward_calls,
            directive_calls: result.directives.forward_calls ?? [],
            cd_commands: result.analysis.cd_commands,
            working_directory: '/initial',
            workspace_roots: [],
            fs: {
                ...missing_fs,
                existsSync: candidate => {
                    visited_paths.push(candidate);
                    return false;
                },
            },
        });

        expect(visited_paths).toContain('/initial/next');
        expect(calls.map(call => ({
            path: call.raw_path,
            wd: call.working_directory,
            line: call.call_site_line,
            source: call.source,
        }))).toEqual([
            { path: 'before.do', wd: '/initial', line: 1, source: 'command' },
            {
                path: 'after.do',
                wd: '/initial/next',
                line: 3,
                source: 'command',
            },
            { path: 'declared.do', wd: '/initial', line: 0, source: 'directive' },
        ]);
        expect(calls.every(call => call.caller_uri === uri)).toBe(true);
        expect(calls[2].is_static).toBe(true);
        expect(result.analysis.forward_calls.every(call =>
            call.working_directory === undefined
        )).toBe(true);
    });

    it('propagates command projection failures for closed-file callers', () => {
        const result = analyze_source(source, uri);
        const failure = new Error('injected path projection failure');

        expect(() => prepare_forward_calls({
            uri,
            command_calls: result.analysis.forward_calls,
            directive_calls: result.directives.forward_calls ?? [],
            cd_commands: result.analysis.cd_commands,
            workspace_roots: [],
            fs: {
                ...missing_fs,
                existsSync: () => { throw failure; },
            },
        })).toThrow(failure);
    });

    it('recovers command calls while still preparing directive calls', () => {
        const result = analyze_source(source, uri);

        const calls = prepare_forward_calls({
            uri,
            command_calls: result.analysis.forward_calls,
            directive_calls: result.directives.forward_calls ?? [],
            cd_commands: result.analysis.cd_commands,
            working_directory: '/initial',
            workspace_roots: [],
            fs: {
                ...missing_fs,
                existsSync: () => { throw new Error('projection failed'); },
            },
            recover_command_projection: true,
        });

        expect(calls).toHaveLength(3);
        expect(calls[0]).toBe(result.analysis.forward_calls[0]);
        expect(calls[1]).toBe(result.analysis.forward_calls[1]);
        expect(calls[0].working_directory).toBeUndefined();
        expect(calls[2].source).toBe('directive');
        expect(calls[2].working_directory).toBe('/initial');
        expect(calls[2].caller_uri).toBe(uri);
    });
});
