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
 * Expect the cursor on each of `the_cursors` to send `bounds`.
 */
function expect_bounds(
    the_lines: string[],
    the_cursors: number[],
    bounds: { start_line: number; end_line: number }
): void {
    const document = as_document(the_lines);
    for (const cursor of the_cursors) {
        expect({ cursor, ...detect_statement(document, cursor) })
            .toEqual({ cursor, ...bounds });
    }
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
        expect_statement(the_lines, 1, 2);
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

describe('Send to Stata: statements under #delimit ;', () => {
    test('a statement runs to its ;, across lines', () => {
        const the_lines = [
            '#delimit ;',
            'reg price',
            '    mpg /// note',
            '    weight, robust;',
            'di "after";',
        ];
        expect_statement(the_lines, 0, 0);
        expect_statement(the_lines, 1, 3);
        expect_statement(the_lines, 4, 4);
    });

    test('a blank line inside a statement is part of it', () => {
        expect_statement(['#delimit ;', 'reg price', '', '  mpg;'], 1, 3);
    });

    test('a tight /// does not end a ; statement', () => {
        // Stata stores `b/// c`.
        expect_statement(['#delimit ;', 'local a b///', 'c;'], 1, 2);
    });

    test('a comment after the ; does not join the next statement', () => {
        const the_lines = ['#delimit ;', 'di "A"; // note', 'di "B";'];
        expect_statement(the_lines, 1, 1);
        expect_statement(the_lines, 2, 2);
    });

    test('comment lines before a statement are sent with it', () => {
        const the_lines = [
            '#delimit ;', 'di "A";', '', '// note', 'summarize', '  price;',
        ];
        expect_statement(the_lines, 2, 2);
        expect_statement(the_lines, 3, 5);
    });

    test('column-0 slashes in the middle of a statement are code', () => {
        // Stata stores `b /// x c`.
        expect_statement(['#delimit ;', 'local a b', '/// x', 'c;'], 1, 3);
        // `// d` is code here: Stata fails with r(199), and so does
        // the sent statement.
        expect_statement(['#delimit ;', '// c', '// d', 'di "x";'], 1, 3);
    });

    test('a block runs from its header to its };', () => {
        const the_lines = [
            '#delimit ;',
            'foreach v in a b {;',
            '    di "`v\'";',
            '};',
        ];
        expect_bounds(the_lines, [1, 3], { start_line: 1, end_line: 3 });
        expect_statement(the_lines, 2, 2);
    });

    test('a statement that starts after another on its line', () => {
        expect_statement(
            ['#delimit ;', 'di "one"; di "two"', '  "three";'], 1, 2);
    });

    test('a * comment runs to its ;', () => {
        expect_statement(
            ['#delimit ;', '* a star', '  comment;', 'di 1;'], 1, 2);
    });

    test('lines after #delimit cr follow cr rules', () => {
        const the_lines = [
            '#delimit ;', 'di "A";', '#delimit cr', 'di "B"', 'di "C"',
        ];
        expect_statement(the_lines, 2, 2);
        expect_statement(the_lines, 3, 3);
        expect_statement(the_lines, 4, 4);
    });
});

describe('Send to Stata: a block header or closer sends the block', () => {
    // A header alone fails in Stata 18 (r(612) unexpected end of
    // file), and so does a closer alone (r(199)).

    test('a loop from its header or its closer', () => {
        const the_lines = [
            'di "before"',
            'foreach v in a b {',
            '    di "`v\'"',
            '}',
            'di "after"',
        ];
        expect_bounds(the_lines, [1, 3], { start_line: 1, end_line: 3 });
        expect_statement(the_lines, 2, 2);
        expect_statement(the_lines, 0, 0);
        expect_statement(the_lines, 4, 4);
        expect_bounds(
            ['forvalues i = 1/3 {', '    di `i\'', '}'], [0, 2],
            { start_line: 0, end_line: 2 });
        expect_bounds(
            ['while 0 {', '}'], [0, 1], { start_line: 0, end_line: 1 });
    });

    test('nested blocks: the cursor\'s own block', () => {
        const the_lines = [
            'foreach v in a b {',          // 0
            '    forvalues i = 1/2 {',     // 1
            '        di "`v\'`i\'"',       // 2
            '    }',                       // 3
            '    di "`v\'"',               // 4
            '}',                           // 5
        ];
        expect_bounds(the_lines, [0, 5], { start_line: 0, end_line: 5 });
        expect_bounds(the_lines, [1, 3], { start_line: 1, end_line: 3 });
        expect_statement(the_lines, 2, 2);
        expect_statement(the_lines, 4, 4);
    });

    test('an if and its else chain go together', () => {
        // Sent on its own, an `else` runs even after a true `if`.
        const the_lines = [
            'if `x\' == 1 {',             // 0
            '    di "one"',                // 1
            '}',                           // 2
            'else if `x\' == 2 {',        // 3
            '    di "two"',                // 4
            '}',                           // 5
            'else {',                      // 6
            '    di "other"',              // 7
            '}',                           // 8
            'di "after"',                  // 9
        ];
        expect_bounds(
            the_lines, [0, 2, 3, 5, 6, 8], { start_line: 0, end_line: 8 });
        expect_statement(the_lines, 1, 1);
        expect_statement(the_lines, 4, 4);
        expect_statement(the_lines, 7, 7);
        expect_statement(the_lines, 9, 9);
    });

    test('an if without an else is its own block', () => {
        const the_lines = ['if 1 {', '    di "y"', '}', 'di "after"'];
        expect_bounds(the_lines, [0, 2], { start_line: 0, end_line: 2 });
    });

    test('an inline if and its inline else go together', () => {
        const the_lines = ['if `x\' di "a"', 'else di "b"', 'di "c"'];
        expect_bounds(the_lines, [0, 1], { start_line: 0, end_line: 1 });
        expect_statement(the_lines, 2, 2);
        // An inline if alone is one line, as before.
        expect_statement(['if `x\' di "a"', 'di "c"'], 0, 0);
    });

    test('a program from define to end', () => {
        const the_lines = [
            'capture program drop foo',
            'program define foo',
            '    syntax varlist',
            '    di "`varlist\'"',
            'end',
            'foo price',
        ];
        expect_statement(the_lines, 0, 0);
        expect_bounds(the_lines, [1, 4], { start_line: 1, end_line: 4 });
        expect_statement(the_lines, 2, 2);
        expect_statement(the_lines, 5, 5);
        expect_bounds(
            ['program foo, rclass', '    return local a 1', 'end'], [0, 2],
            { start_line: 0, end_line: 2 });
    });

    test('a prefix brace block', () => {
        expect_bounds(
            ['capture {', '    di 1', '}'], [0, 2],
            { start_line: 0, end_line: 2 });
        expect_bounds(
            ['quietly {', '    di 1', '}'], [0, 2],
            { start_line: 0, end_line: 2 });
        expect_bounds(
            ['capture noisily {', '    di 1', '}'], [0, 2],
            { start_line: 0, end_line: 2 });
    });

    test('mata and python blocks', () => {
        const the_mata = ['mata:', 'x = 1', 'x', 'end', 'di "after"'];
        expect_bounds(the_mata, [0, 3], { start_line: 0, end_line: 3 });
        expect_statement(the_mata, 1, 1);
        expect_statement(the_mata, 4, 4);
        expect_bounds(
            ['python:', 'print(1)', 'end'], [0, 2],
            { start_line: 0, end_line: 2 });
        // A one-line `mata:` statement is not a block.
        expect_statement(['mata: x = 1', 'di 1'], 0, 0);
    });

    test('a header continued with ///', () => {
        const the_lines = [
            'foreach v in ///', '    a b {', '    di "`v\'"', '}',
        ];
        expect_bounds(the_lines, [0, 1, 3], { start_line: 0, end_line: 3 });
        expect_statement(the_lines, 2, 2);
    });

    test('braces in strings and comments don\'t count', () => {
        const the_lines = [
            'foreach v in a {',            // 0
            '    di "} {"  // }',          // 1
            '    /* { */',                 // 2
            '}',                           // 3
            'di "after"',                  // 4
        ];
        expect_bounds(the_lines, [0, 3], { start_line: 0, end_line: 3 });
        expect_statement(the_lines, 1, 1);
        expect_statement(the_lines, 4, 4);
    });

    test('an unclosed block sends only its header', () => {
        expect_statement(['foreach v in a {', '    di "x"'], 0, 0);
        expect_statement(['mata:', 'x = 1'], 0, 0);
        // The chain's `else` is unclosed.
        expect_statement(
            ['if 1 {', '    di "y"', '}', 'else {', '    di "n"'], 0, 0);
    });

    test('an unclosed block around a closed one', () => {
        // Both end at the inner `}`; only the inner block is closed.
        const the_lines = [
            'foreach a in x {',            // 0
            '    foreach b in y {',        // 1
            '        di 1',                // 2
            '    }',                       // 3
        ];
        expect_statement(the_lines, 0, 0);
        expect_bounds(the_lines, [1, 3], { start_line: 1, end_line: 3 });
        // A program with no `end`, though its last line ends in one.
        expect_statement(['program define p', '    local x end'], 0, 0);
    });

    test('an inline else continued onto the next line', () => {
        expect_bounds(
            ['if 1 di 1', 'else ///', '    di 2', 'di 3'], [0, 1, 2],
            { start_line: 0, end_line: 2 });
        expect_bounds(
            ['#delimit ;', 'if 1 di 1;', 'else', '    di 2;', 'di 3;'],
            [1, 2, 3], { start_line: 1, end_line: 3 });
    });

    test('an inline else if chain goes together', () => {
        const the_lines = [
            'if `x\' == 1 di "one"',
            'else if `x\' == 2 di "two"',
            'else di "other"',
            'di "after"',
        ];
        expect_bounds(the_lines, [0, 1, 2], { start_line: 0, end_line: 2 });
        expect_statement(the_lines, 3, 3);
    });

    test('an if and else chain under #delimit ;', () => {
        const the_lines = [
            '#delimit ;',                  // 0
            'if 1 {;',                     // 1
            '    di "y";',                 // 2
            '};',                          // 3
            'else {;',                     // 4
            '    di "n";',                 // 5
            '};',                          // 6
            'program define bar;',         // 7
            '    di "bar";',               // 8
            'end;',                        // 9
        ];
        expect_bounds(the_lines, [1, 3, 4, 6], { start_line: 1, end_line: 6 });
        expect_statement(the_lines, 2, 2);
        expect_bounds(the_lines, [7, 9], { start_line: 7, end_line: 9 });
    });

    test('a block after a mata { } block', () => {
        // From Stata's _bmapredict_mean_std.ado. A `mata {` block ends
        // with `}`, not `end`, so the blocks after it are still found.
        const the_lines = [
            'mata {',              // 0
            '    x = 1',           // 1
            '}',                   // 2
            'if 1 {',              // 3
            '    di "a"',          // 4
            '}',                   // 5
        ];
        expect_bounds(the_lines, [3, 5], { start_line: 3, end_line: 5 });
    });

    test('a loop whose body has a { in a local value', () => {
        // From Stata's expoisson.ado: the `{` is text in the local's
        // value, so it opens no block and the loop keeps its `}`.
        const the_lines = [
            'foreach x in a b {',              // 0
            '    local w : word 1 of a b {',   // 1
            '    di "`w\'"',                    // 2
            '}',                               // 3
        ];
        expect_bounds(the_lines, [0, 3], { start_line: 0, end_line: 3 });
    });
});
