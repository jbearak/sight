/**
 * `end` lines that close nothing, read from the parsed statements.
 * Each case was run in StataMP 18, where a stray `end` stops with
 * "command end is unrecognized" (r(199)).
 */

import { describe, it, expect } from 'bun:test';
import { ContextErrorCode } from '../../src/types';
import { context_diagnostics } from '../test-context-helper';

/** The (line, code) of each end diagnostic, in line order. */
function end_codes(source: string): Array<[number, string]> {
    return context_diagnostics(source)
        .map((my_diag): [number, string] => [my_diag.range.start.line, my_diag.code])
        .sort((a, b) => a[0] - b[0]);
}

describe('end diagnostics', () => {
    it('reports an end with something after it', () => {
        expect(end_codes('di 1\nend foo\n'))
            .toEqual([[1, ContextErrorCode.UNEXPECTED_END]]);
    });

    it('reports a second end; under #delimit ;', () => {
        expect(end_codes('#delimit ;\nprogram define q;\ndi 1;\nend;\nend;\n'))
            .toEqual([[4, ContextErrorCode.UNEXPECTED_END]]);
    });

    it('reports the program end after input data inside a program', () => {
        // The data's `end` ends the definition, so the program's own
        // `end` closes nothing.
        expect(end_codes('program define p\n    input z\n    7\n    end\nend\n'))
            .toEqual([[4, ContextErrorCode.UNEXPECTED_END]]);
    });

    it('does not report the end of input data', () => {
        expect(end_codes('input x\n1\nend\nlist\n')).toEqual([]);
    });

    it('reports end python once, with its own advice', () => {
        expect(end_codes('di 1\nend python\n'))
            .toEqual([[1, ContextErrorCode.MISMATCHED_END_PYTHON]]);
    });

    it('reports a mata block end that ends the program, then the program end', () => {
        expect(end_codes('program define p\n    mata\n    x = 1\n    end\nend\n'))
            .toEqual([
                [3, ContextErrorCode.EMBEDDED_BLOCK_ENDS_PROGRAM],
                [4, ContextErrorCode.UNEXPECTED_END],
            ]);
    });
});

describe('end diagnostics: what Stata does not read', () => {
    it('stops at an exit outside any block', () => {
        // Notes after `exit` at the end of ado-files are not code.
        expect(end_codes('program p\nend\nexit\n\nend of file\n<end>\n'))
            .toEqual([]);
    });

    it('does not read an end with code before it on its line', () => {
        expect(end_codes('di 1\n<end>\n')).toEqual([]);
    });

    it('does not end a program at an end after a } on its line', () => {
        // `}  end while` in old ado-files: Stata ends the program only
        // at a line whose first word is `end`.
        expect(end_codes(
            'program p\n    while 1 {\n        continue, break\n    }  end while\nend\n'
        )).toEqual([]);
    });
});
