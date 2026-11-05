import { describe, test, expect } from 'bun:test';
import type * as vscode from 'vscode';
import {
    detect_statement,
    get_downward_bounds,
    get_statement_text,
    get_upward_bounds,
} from '../../../client/src/send-to-stata/statement-detector';
import { create_mock_document } from '../../property/helpers';

/**
 * Which lines Send to Stata sends for a cursor on each line. Each case
 * was run in StataMP 18 (the readings in the comments are its output).
 */

function as_document(the_lines: string[]): vscode.TextDocument {
    // The detector reads only lineCount, lineAt, and getText.
    return create_mock_document(the_lines.join('\n')) as
        unknown as vscode.TextDocument;
}

/**
 * Expect the cursor on any line from `start_line` to `end_line` to
 * send exactly those lines.
 */
function expect_statement(
    the_lines: string[],
    start_line: number,
    end_line: number
): void {
    const document = as_document(the_lines);
    for (let cursor = start_line; cursor <= end_line; cursor++) {
        expect({ cursor, ...detect_statement(document, cursor) })
            .toEqual({ cursor, start_line, end_line });
    }
}

describe('Send to Stata: statements continued with ///', () => {
    test('a note after /// continues the statement', () => {
        // Stata runs `reg price mpg weight, robust`.
        const the_lines = ['reg y x /// note', '    z, robust'];
        expect_statement(the_lines, 0, 1);
        expect(get_statement_text(
            as_document(the_lines), detect_statement(as_document(the_lines), 0)
        )).toBe('reg y x /// note\n    z, robust');
    });

    test('a note with no space after /// continues the statement', () => {
        expect_statement(['reg y x ///note', '    z'], 0, 1);
    });

    test('a bare /// continues the statement', () => {
        expect_statement(['reg y x ///', '    z, robust'], 0, 1);
        expect_statement(['reg y x\t///  ', '    z'], 0, 1);
    });

    test('a chain of /// lines with notes is one statement', () => {
        const the_lines = [
            'display "before"',
            'reg price ///',
            '    mpg /// first',
            '    weight /// second',
            '    , robust',
            'display "after"',
        ];
        expect_statement(the_lines, 0, 0);
        expect_statement(the_lines, 1, 4);
        expect_statement(the_lines, 5, 5);
    });

    test('/// then a blank line ends at the blank line', () => {
        // Stata joins the blank line and runs `di "A"`, then `di "B"`.
        const the_lines = ['di "A" ///', '', 'di "B"'];
        expect_statement(the_lines, 0, 1);
        expect_statement(the_lines, 2, 2);
    });

    test('/// inside a string does not continue', () => {
        // `local a "b ///` is r(198) in Stata: the next line is its own.
        expect_statement(['di "a ///', 'di "b"'], 0, 0);
        expect_statement(['di "a ///"', 'di "b"'], 0, 0);
        expect_statement(['di `"a ///"\'', 'di "b"'], 0, 0);
        // A /// after the string still does.
        expect_statement(['di `"a ///"\' ///', '  "b"'], 0, 1);
    });

    test('a tight /// is text, so the next line is its own', () => {
        expect_statement(['local a b///', 'c'], 0, 0);
        expect_statement(['local a b///note', 'c'], 0, 0);
        expect_statement(['local a (x)///', 'c'], 0, 0);
        expect_statement(['local a b////', 'c'], 0, 0);
    });

    test('/// after a block comment', () => {
        expect_statement(['reg y x /* c */ ///', '  z'], 0, 1);
        expect_statement(['reg y x /* c */ /// note', '  z'], 0, 1);
        // `*/` right before the slashes makes them text: Stata stores
        // `local a b /* c *////` as `b ///` and runs `d` alone.
        expect_statement(['local a b /* c *////', 'd'], 0, 0);
    });

    test('/// inside a // comment does not continue', () => {
        // Stata runs `di 1`, then `di 2`.
        expect_statement(['di 1 // note ///', 'di 2'], 0, 0);
        expect_statement(['// note ///', 'di 2'], 0, 0);
    });

    test('a * comment continued with /// swallows the next line', () => {
        // Stata reads `di "swallowed"` as part of the comment.
        const the_lines = ['* note /// x', 'di "swallowed"', 'di "after"'];
        expect_statement(the_lines, 0, 1);
        expect_statement(the_lines, 2, 2);
    });

    test('a /// line that starts a statement joins the next line', () => {
        expect_statement(['/// x', 'di "J"'], 0, 1);
        expect_statement(['    ///', 'di "J"'], 0, 1);
        expect_statement(['/// x', '/// y', 'di "J"'], 0, 2);
        // After a tight `b///`, a `///` line starts a statement.
        expect_statement(['local a b///', '///', 'c'], 0, 0);
        expect_statement(['local a b///', '///', 'c'], 1, 2);
    });

    test('a block comment that spans lines keeps them together', () => {
        // Stata displays `P6 joined`.
        expect_statement(['di "P6" /* note', '  */ " joined"'], 0, 1);
        expect_statement(
            ['di "P6" /* note ///', 'more', '  */ " joined"', 'di 2'], 0, 2);
    });

    test('/// inside a Mata block continues', () => {
        // Stata reads `x = 1 + 2`.
        const the_lines = ['mata:', 'x = 1 /// note', '  + 2', 'end'];
        expect_statement(the_lines, 0, 0);
        expect_statement(the_lines, 1, 2);
        expect_statement(the_lines, 3, 3);
    });

    test('a spaced /// with a note under #delimit ;', () => {
        const the_lines = [
            '#delimit ;', 'reg y x /// note', '  z, robust;', '#delimit cr',
        ];
        expect_statement(the_lines, 1, 2);
    });

    test('CRLF line endings', () => {
        const document = create_mock_document(
            'reg y x /// note\r\n    z\r\ndi 1'
        ) as unknown as vscode.TextDocument;
        expect(detect_statement(document, 1))
            .toEqual({ start_line: 0, end_line: 1 });
        expect(detect_statement(document, 2))
            .toEqual({ start_line: 2, end_line: 2 });
    });
});

describe('Send upward and downward lines with a noted ///', () => {
    const the_lines = [
        'display "before"',
        'reg price ///',
        '    mpg /// first',
        '    weight /// second',
        '    , robust',
        'display "after"',
    ];

    test('upward lines end at the end of the cursor\'s statement', () => {
        for (let cursor = 1; cursor <= 4; cursor++) {
            expect(get_upward_bounds(as_document(the_lines), cursor))
                .toEqual({ start_line: 0, end_line: 4 });
        }
    });

    test('downward lines start at the start of the cursor\'s statement', () => {
        for (let cursor = 1; cursor <= 4; cursor++) {
            expect(get_downward_bounds(as_document(the_lines), cursor))
                .toEqual({ start_line: 1, end_line: 5 });
        }
    });
});
