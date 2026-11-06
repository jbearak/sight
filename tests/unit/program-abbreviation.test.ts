/**
 * `program define` abbreviates to `pr de`. Checked in StataMP 18:
 * `pr define`, `pro de`, `prog`, `progr defi` define programs (base ados
 * write `prog def`); `p define` is "command p is unrecognized" and
 * `program d p6` is not a definition.
 */

import { describe, it, expect } from 'bun:test';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { StataNode } from '../../src/types';
import { context_diagnostics } from '../test-context-helper';

function parse(source: string): StataNode[] {
    const the_tokens = new StataLexer().tokenize(source).tokens;
    return new StataParser().parse(the_tokens).ast.nodes;
}

function program_names(source: string): string[] {
    return parse(source).flatMap((my_node) =>
        my_node.type === 'program' ? [my_node.name] : []);
}

describe('program abbreviations', () => {
    it('defines a program with each abbreviation Stata accepts', () => {
        for (const my_header of [
            'pr define p', 'pro de p', 'prog p', 'progr defi p',
            'progra p', 'prog def p, rclass',
        ]) {
            expect(program_names(`${my_header}\n    display 1\nend\n`))
                .toEqual(['p']);
        }
    });

    it('ends each program at its own end, so none is unexpected', () => {
        const source = [
            'prog def first, rclass',
            '    display 1',
            'end',
            'prog def second',
            '    display 2',
            'end',
        ].join('\n');
        expect(program_names(source)).toEqual(['first', 'second']);
        expect(context_diagnostics(source).map((my_diag) => my_diag.code))
            .not.toContain('UNEXPECTED_END');
    });

    it('reads subcommands, p, and other cases as commands', () => {
        for (const my_line of [
            'prog drop p', 'pr dir', 'prog l p', 'p define q', 'PROG def q',
        ]) {
            expect(program_names(`${my_line}\n`)).toEqual([]);
        }
    });

    it('keeps a mata block in an abbreviated program inside it', () => {
        // The lexer tracks the open definition to end a block at the
        // program's `end`; it has to see `prog` too.
        const source = 'prog def p\n    mata: x = 1\n    display 1\nend\n';
        expect(context_diagnostics(source).map((my_diag) => my_diag.code))
            .toEqual([]);
    });
});
