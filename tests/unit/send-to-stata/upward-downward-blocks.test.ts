import { describe, test, expect } from 'bun:test';
import type * as vscode from 'vscode';
import {
    find_code_to_send,
    get_downward_bounds,
    get_upward_bounds,
} from '../../../client/src/send-to-stata/statement-detector';
import { create_mock_document } from '../../property/helpers';

/**
 * Send Upward and Send Downward Lines widen to whole blocks. Stata 18
 * can't run a header without its closer (r(612)) or a closer without
 * its header (r(199)).
 */

function as_document(the_lines: string[]): vscode.TextDocument {
    // The detector reads only lineCount, lineAt, and getText.
    return create_mock_document(the_lines.join('\n')) as
        unknown as vscode.TextDocument;
}

function expect_upward(
    the_lines: string[],
    the_cursors: number[],
    end_line: number
): void {
    for (const cursor of the_cursors) {
        expect({ cursor, ...get_upward_bounds(as_document(the_lines), cursor) })
            .toEqual({ cursor, start_line: 0, end_line });
    }
}

function expect_downward(
    the_lines: string[],
    the_cursors: number[],
    start_line: number
): void {
    for (const cursor of the_cursors) {
        expect({
            cursor, ...get_downward_bounds(as_document(the_lines), cursor),
        }).toEqual({ cursor, start_line, end_line: the_lines.length - 1 });
    }
}

const LOOP = [
    'local total 0',                   // 0
    'foreach v in 1 2 3 {',            // 1
    '    local total = `total\' + `v\'', // 2
    '    di "`v\'"',                   // 3
    '}',                               // 4
    'di "total=`total\'"',             // 5
];

const NESTED = [
    'foreach a in x y {',              // 0
    '    di "`a\'"',                   // 1
    '    forvalues i = 1/2 {',         // 2
    '        di `i\'',                 // 3
    '    }',                           // 4
    '}',                               // 5
    'di "after"',                      // 6
];

const CHAIN = [
    'local x 2',                       // 0
    'if `x\' == 1 {',                 // 1
    '    di "one"',                    // 2
    '}',                               // 3
    'else if `x\' == 2 {',            // 4
    '    di "two"',                    // 5
    '}',                               // 6
    'else {',                          // 7
    '    di "other"',                  // 8
    '}',                               // 9
    'di "after"',                      // 10
];

describe('Send Upward Lines widens to whole blocks', () => {
    test('from a header or a body line, through the closer', () => {
        expect_upward(LOOP, [1, 2, 3, 4], 4);
        expect_upward(LOOP, [0], 0);
        expect_upward(LOOP, [5], 5);
    });

    test('from inside a nested block, through the outer closer', () => {
        expect_upward(NESTED, [0, 1, 2, 3, 4, 5], 5);
        expect_upward(NESTED, [6], 6);
    });

    test('from an if, through the end of its else chain', () => {
        expect_upward(CHAIN, [1, 2, 3, 4, 5, 6, 7, 8, 9], 9);
        expect_upward(
            ['if `x\' di "a"', 'else di "b"', 'di "c"'], [0], 1);
    });

    test('from a program or mata header, through its end', () => {
        const the_lines = [
            'program define foo', '    di "foo"', 'end',
            'mata:', 'x = 1', 'end',
        ];
        expect_upward(the_lines, [0, 1], 2);
        expect_upward(the_lines, [3, 4], 5);
    });

    test('under #delimit ;', () => {
        const the_lines = [
            '#delimit ;', 'foreach v in a b {;', '    di "`v\'";', '};',
            'di "after";',
        ];
        expect_upward(the_lines, [1, 2, 3], 3);
        expect_upward(the_lines, [4], 4);
    });

    test('an unclosed block is not widened', () => {
        expect_upward(['foreach v in a {', '    di "x"'], [0], 0);
    });
});

describe('Send Downward Lines widens to whole blocks', () => {
    test('from a closer or a body line, from the header', () => {
        expect_downward(LOOP, [1, 2, 3, 4], 1);
        expect_downward(LOOP, [5], 5);
    });

    test('from inside a nested block, from the outer header', () => {
        expect_downward(NESTED, [0, 1, 2, 3, 4, 5], 0);
        expect_downward(NESTED, [6], 6);
    });

    test('from an else, from its if', () => {
        expect_downward(CHAIN, [1, 2, 3, 4, 5, 6, 7, 8, 9], 1);
        expect_downward(CHAIN, [10], 10);
        expect_downward(
            ['if `x\' di "a"', 'else di "b"', 'di "c"'], [1], 0);
    });

    test('from a program or mata end, from its header', () => {
        const the_lines = [
            'program define foo', '    di "foo"', 'end',
            'mata:', 'x = 1', 'end',
        ];
        expect_downward(the_lines, [1, 2], 0);
        expect_downward(the_lines, [4, 5], 3);
    });

    test('under #delimit ;, with the #delimit ; line first', () => {
        const the_lines = [
            '#delimit ;', 'foreach v in a b {;', '    di "`v\'";', '};',
            'di "after";',
        ];
        expect_downward(the_lines, [2, 3], 1);
        expect(find_code_to_send(
            as_document(the_lines), 'downward', 3, null
        ).code).toBe('#delimit ;\n' + the_lines.slice(1).join('\n'));
    });

    test('an unclosed block is not widened', () => {
        expect_downward(['foreach v in a {', '    di "x"'], [1], 1);
    });
});

describe('A bare { } block', () => {
    const the_lines = ['{', '    di "bare"', '}', 'di "after"'];

    test('is widened to whole, like the others', () => {
        expect_upward(the_lines, [0, 1], 2);
        expect_downward(the_lines, [1, 2], 0);
        for (const my_line of [0, 2]) {
            expect(find_code_to_send(
                as_document(the_lines), 'statement', my_line, null
            ).code).toBe(the_lines.slice(0, 3).join('\n'));
        }
    });
});

describe('Send selection', () => {
    test('a selection that cuts a block is sent as it is', () => {
        const my_text = LOOP.slice(2, 5).join('\n');
        expect(find_code_to_send(
            as_document(LOOP), 'statement', 4,
            { text: my_text, line: 2, character: 0 }
        ).code).toBe(my_text);
    });
});
