/**
 * What a `mata` or `python` keyword opens is decided by what follows
 * it on its logical line. Checked in StataMP 18:
 *
 *     mata : x = 1        one line (`mata :` is `mata:`)
 *     mata x = 1          one line, without a colon
 *     mata: ///           one line: `///` joins the code on the next
 *         x = 1           line to the opener
 *     mata :              block, up to `end`
 *     mata // note        block
 *     python : print(1)   one line
 *     python query        a Stata subcommand of `python`, one line
 *
 * A one-line form inside a program leaves the program open; a block
 * would end it at its `end`.
 */

import { describe, it, expect } from 'bun:test';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { CodeFormatter } from '../../src/providers/formatter';
import { StataDiagnosticCode } from '../../src/types';
import {
    create_formatter_config,
    for_each_formatter_mode,
    FormatterMode,
} from '../property/helpers/formatter-test-utils';
import { create_document_state } from '../property/helpers/document-utils';
import { context_diagnostics } from '../test-context-helper';

/** `type value` for each token that opens or names an embedded unit. */
function openers(source: string): string[] {
    const OPENER_TYPES = new Set([
        'MATA_START', 'MATA_INLINE', 'PYTHON_START', 'PYTHON_INLINE',
        'END_MATA', 'END_PYTHON',
    ]);
    return new StataLexer().tokenize(source).tokens
        .filter((my_token) => OPENER_TYPES.has(my_token.type))
        .map((my_token) => `${my_token.type} ${my_token.value}`);
}

function undefined_macros(source: string): string[] {
    const lex_result = new StataLexer().tokenize(source);
    const ast = new StataParser().parse(lex_result.tokens).ast;
    return new SemanticAnalyzer()
        .analyze(ast, 'file:///t.do', undefined,
            { undefined_macro_enabled: true }, lex_result.tokens)
        .diagnostics
        .filter((my_diag) => my_diag.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((my_diag) => my_diag.message);
}

function format_source(source: string, mode: FormatterMode): string {
    const edits = new CodeFormatter().format(
        create_document_state(source),
        { tabSize: 4, insertSpaces: true },
        create_formatter_config(mode));
    return edits[0]?.newText ?? source;
}

describe('embedded language openers', () => {
    describe('a colon after blanks', () => {
        it('reads mata : with code as one line', () => {
            expect(openers('mata : x = 1\n')).toEqual(['MATA_INLINE mata :']);
            expect(openers('mata\t: x = 1\n')).toEqual(['MATA_INLINE mata\t:']);
            expect(openers('capture mata : x = 1\n'))
                .toEqual(['MATA_INLINE mata :']);
        });

        it('opens a block at mata : with nothing after it', () => {
            expect(openers('mata :\nx = 1\nend\n'))
                .toEqual(['MATA_START mata :', 'END_MATA end']);
            expect(openers('mata : // note\nx = 1\nend\n'))
                .toEqual(['MATA_START mata :', 'END_MATA end']);
        });

        it('reads python : the same way', () => {
            expect(openers('python : print(1)\n'))
                .toEqual(['PYTHON_INLINE python :']);
            expect(openers('python :\nprint(1)\nend\n'))
                .toEqual(['PYTHON_START python :', 'END_PYTHON end']);
        });
    });

    describe('no colon', () => {
        it('reads mata with code after it as one line', () => {
            expect(openers('mata x = 1\ndisplay 1\n'))
                .toEqual(['MATA_INLINE mata']);
        });

        it('still opens a block at mata alone, with a comment, or with {', () => {
            expect(openers('mata\nx = 1\nend\n'))
                .toEqual(['MATA_START mata', 'END_MATA end']);
            expect(openers('mata // note\nx = 1\nend\n'))
                .toEqual(['MATA_START mata', 'END_MATA end']);
            expect(openers('mata {\nx = 1\n}\n')).toEqual(['MATA_START mata']);
        });

        it('reads python with words after it as a Stata subcommand', () => {
            expect(openers('python query\ndisplay 1\n')).toEqual([]);
            expect(openers('python set exec "/usr/bin/python3"\n'))
                .toEqual([]);
        });
    });

    describe('a /// continuation after the opener', () => {
        it('joins the code on the next line to the opener', () => {
            expect(openers('capture mata: ///\n    x = 1\ndisplay 1\n'))
                .toEqual(['MATA_INLINE mata:']);
            expect(openers('mata ///\n    x = 1\ndisplay 1\n'))
                .toEqual(['MATA_INLINE mata']);
        });

        it('keeps a brace on the continued line as a brace block', () => {
            expect(openers('mata ///\n{\nx = 1\n}\n'))
                .toEqual(['MATA_START mata']);
        });
    });

    describe('inside a program', () => {
        const PROGRAM = [
            'program define p',
            '    mata : st_local("a", "1")',
            '    mata st_local("b", "1")',
            '    capture mata: ///',
            '        st_local("c", "1")',
            '    python query',
            '    display "`a\' `b\' `c\' `z\'"',
            'end',
        ].join('\n');

        it('keeps the program open past each one-line form', () => {
            const the_codes = context_diagnostics(PROGRAM)
                .map((my_diag) => my_diag.code);
            expect(the_codes).not.toContain('EMBEDDED_BLOCK_ENDS_PROGRAM');
            expect(the_codes).not.toContain('UNEXPECTED_END');
        });

        it('checks the Stata code after them', () => {
            // Each st_local defines its macro; only `z' is undefined,
            // which the analyzer sees only if it reads that line as
            // Stata.
            expect(undefined_macros(PROGRAM)).toEqual(["`z' is not defined"]);
        });
    });

    for_each_formatter_mode('keeps the opener as written', (mode) => {
        const source = [
            'program define p',
            '    mata : x = 1',
            '    mata x = 2',
            'end',
            '',
        ].join('\n');
        expect(format_source(source, mode)).toBe(source);
    });
});
