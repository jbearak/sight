/**
 * `command_macro_writes` names the macros a command statement defines
 * other than through `local`/`global`. The analyzer registers these as
 * definitions and the loop expander poisons the same names, so this
 * one function is the contract both rely on.
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import {
    CommandMacroWrites,
    MacroWriteContext,
    command_macro_writes,
} from '../../src/analyzer/command-macro-writes';
import { CommandNode, ProgramSymbol, Token } from '../../src/types';

/**
 * The writes of the last command in `code`, with the programs `code`
 * defines (and `workspace_code` defines) visible to the call.
 */
function writes_of(code: string, workspace_code?: string): CommandMacroWrites {
    const tokens: Token[] = new StataLexer().tokenize(code).tokens;
    const ast = new StataParser().parse(tokens).ast;
    const result = new SemanticAnalyzer().analyze(ast, 'file:///test.do');
    const the_commands = ast.nodes.filter(
        (my_node): my_node is CommandNode => my_node.type === 'command'
    );
    const last = the_commands[the_commands.length - 1];
    if (!last) throw new Error(`no command in ${code}`);
    let workspace_programs: Map<string, ProgramSymbol> | undefined;
    if (workspace_code !== undefined) {
        const workspace_tokens = new StataLexer().tokenize(workspace_code).tokens;
        const workspace_ast = new StataParser().parse(workspace_tokens).ast;
        workspace_programs = new SemanticAnalyzer()
            .analyze(workspace_ast, 'file:///lib.ado').symbols.programs;
    }
    const context: MacroWriteContext = {
        file_programs: result.symbols.programs,
        workspace_programs,
        tokens,
    };
    return command_macro_writes(last, context);
}

/** `scope:name:kind` for each write, in order. */
function summary(code: string, workspace_code?: string): string[] {
    return writes_of(code, workspace_code).writes.map(
        (my_write) => `${my_write.scope}:${my_write.name}:${my_write.kind}`
    );
}

describe('command_macro_writes', () => {
    describe('positional names', () => {
        it('reads every name of tempvar, tempname and tempfile', () => {
            expect(summary('tempvar a b')).toEqual([
                'local:a:temp_name', 'local:b:temp_name',
            ]);
            expect(summary('tempname m')).toEqual(['local:m:temp_name']);
            expect(summary('tempfile f g')).toEqual([
                'local:f:temp_name', 'local:g:temp_name',
            ]);
        });

        it('reads marksample only with one name', () => {
            expect(summary('marksample touse, novarlist'))
                .toEqual(['local:touse:temp_name']);
            expect(summary('marksample a b')).toEqual([]);
        });

        it('reads args, unab, and at most two gettoken names', () => {
            expect(summary('args x y')).toEqual([
                'local:x:args', 'local:y:args',
            ]);
            expect(summary('unab vars : *')).toEqual(['local:vars:unab']);
            expect(summary('gettoken first rest : 0')).toEqual([
                'local:first:gettoken', 'local:rest:gettoken',
            ]);
        });

        it('reads file read only for the exact subcommand read', () => {
            expect(summary('file read fh line')).toEqual([
                'local:line:file_read',
            ]);
            expect(summary('file write fh line')).toEqual([]);
        });

        it('skips a name joined to a macro, known only at run time', () => {
            expect(summary('tempvar tv`i\' plain')).toEqual([
                'local:plain:temp_name',
            ]);
            expect(summary('gettoken a`i\' rest : s')).toEqual([
                'local:rest:gettoken',
            ]);
        });

        it('points each write at its name', () => {
            const the_writes = writes_of('tempvar a b').writes;
            expect(the_writes[1]?.range.start.character).toBe(10);
        });
    });

    describe('macro-creating options', () => {
        it('reads levelsof local() and global(), with abbreviations', () => {
            expect(summary('levelsof x, local(l)')).toEqual([
                'local:l:option',
            ]);
            expect(summary('levelsof x, l(l)')).toEqual(['local:l:option']);
            expect(summary('levelsof x, global(G)')).toEqual([
                'global:G:option',
            ]);
        });

        it('matches option names exactly, as Stata does', () => {
            // StataMP 18: `levelsof rep78, LOCAL(r)` is "option LOCAL()
            // not allowed".
            expect(summary('levelsof x, LOCAL(l)')).toEqual([]);
        });

        it('reports a constructed target as unknown', () => {
            const result = writes_of('levelsof x, local(`i\')');
            expect(result.writes).toEqual([]);
            expect(result.unknown_target).toBe(true);
        });

        it('reads a user program option whose local is c_local-ed', () => {
            const code = [
                'program define myprog',
                '    syntax, Cache(string)',
                '    c_local `cache\' "value"',
                'end',
                'myprog, cache(result)',
            ].join('\n');
            expect(summary(code)).toEqual(['local:result:option']);
            expect(summary(code.replace('cache(result)', 'Cache(result)')))
                .toEqual([]);
        });
    });

    describe('user program option abbreviations', () => {
        // StataMP 18: a `syntax` option's leading capitals are its
        // minimum abbreviation; with none, or all capitals, it must be
        // typed in full, and always in lowercase.
        function program_with(spec: string, call: string): string {
            const local_name = spec.toLowerCase();
            return [
                'program define p',
                `    syntax, ${spec}(string)`,
                `    c_local \`${local_name}' "v"`,
                'end',
                `p, ${call}(r)`,
            ].join('\n');
        }

        it('accepts an abbreviation as long as the leading capitals', () => {
            expect(summary(program_with('LOCal', 'loc'))).toEqual(['local:r:option']);
            expect(summary(program_with('LOCal', 'loca'))).toEqual(['local:r:option']);
            expect(summary(program_with('Cache', 'c'))).toEqual(['local:r:option']);
        });

        it('rejects a shorter, longer, or capitalized abbreviation', () => {
            expect(summary(program_with('LOCal', 'lo'))).toEqual([]);
            expect(summary(program_with('LOCal', 'locals'))).toEqual([]);
            expect(summary(program_with('LOCal', 'LOC'))).toEqual([]);
        });

        it('requires the full name for an all-lowercase or all-caps option', () => {
            expect(summary(program_with('cache', 'c'))).toEqual([]);
            expect(summary(program_with('cache', 'cache'))).toEqual(['local:r:option']);
            expect(summary(program_with('CACHE', 'cach'))).toEqual([]);
            expect(summary(program_with('CACHE', 'cache'))).toEqual(['local:r:option']);
        });

        it('reads the abbreviation of a workspace program', () => {
            const library = program_with('LOCal', 'local').split('\n')
                .slice(0, 4).join('\n');
            expect(summary('p, loc(r)', library)).toEqual(['local:r:option']);
        });
    });

    describe('c_local', () => {
        const PROGRAM = [
            'program define setter',
            '    c_local made 1',
            'end',
        ].join('\n');

        it('defines a program\'s c_local names at the call', () => {
            expect(summary(`${PROGRAM}\nsetter`)).toEqual([
                'local:made:c_local',
            ]);
        });

        it('finds the program in the workspace when the file lacks it', () => {
            expect(summary('setter', PROGRAM)).toEqual(['local:made:c_local']);
        });

        it('defines a name the call passes to c_local, at the argument', () => {
            const code = [
                'program define _getrhs',
                '    args where',
                '    c_local `where\' 1',
                'end',
                '_getrhs rhs',
            ].join('\n');
            const the_writes = writes_of(code).writes;
            expect(the_writes.map((my_write) => my_write.name)).toEqual(['rhs']);
            expect(the_writes[0]?.kind).toBe('c_local_argument');
            expect(the_writes[0]?.range.start).toEqual({ line: 4, character: 8 });
        });
    });

    describe('macro drop', () => {
        it('lists literal globals it clears', () => {
            const result = writes_of('macro drop A B');
            expect(result.dropped_globals).toEqual(['A', 'B']);
            expect(result.unknown_target).toBe(false);
        });

        it('reports _all and wildcards as unknown', () => {
            expect(writes_of('macro drop _all').unknown_target).toBe(true);
            expect(writes_of('mac dr A*').unknown_target).toBe(true);
        });
    });

    it('writes nothing for other commands', () => {
        const result = writes_of('display "hi"');
        expect(result).toEqual({
            writes: [],
            dropped_globals: [],
            unknown_target: false,
        });
    });
});
