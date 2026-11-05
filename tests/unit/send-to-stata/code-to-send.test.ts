import { describe, test, expect } from 'bun:test';
import type * as vscode from 'vscode';
import {
    find_code_to_send,
} from '../../../client/src/send-to-stata/statement-detector';
import { create_mock_document } from '../../property/helpers';

/**
 * The code each send command sends. A sent do-file starts under
 * `#delimit cr` (StataMP 18 goes back to it after `do` or `include`), so
 * code from a `#delimit ;` region needs a `#delimit ;` line first.
 */

function as_document(the_lines: string[]): vscode.TextDocument {
    // The detector reads only lineCount, lineAt, and getText.
    return create_mock_document(the_lines.join('\n')) as
        unknown as vscode.TextDocument;
}

const PROGRAM = [
    'sysuse auto, clear',               // 0
    '#delimit ;',                       // 1
    'reg price',                        // 2
    '    mpg weight, robust;',          // 3
    'foreach v in a b {;',              // 4
    '    di "`v\'";',                   // 5
    '};',                               // 6
    '#delimit cr',                      // 7
    'di "cr"',                          // 8
];

describe('Send statement', () => {
    test('a ; statement is sent under #delimit ;', () => {
        for (const my_line of [2, 3]) {
            expect(find_code_to_send(
                as_document(PROGRAM), 'statement', my_line, null
            )).toEqual({
                code: '#delimit ;\nreg price\n    mpg weight, robust;',
                statement_end_line: 3,
            });
        }
    });

    test('a block close is sent under #delimit ;', () => {
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 6, null
        ).code).toBe('#delimit ;\n};');
    });

    test('a cr statement is sent as it is', () => {
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 8, null
        )).toEqual({ code: 'di "cr"', statement_end_line: 8 });
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 0, null
        ).code).toBe('sysuse auto, clear');
    });

    test('the #delimit ; line itself is sent as it is', () => {
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 1, null
        ).code).toBe('#delimit ;');
    });
});

describe('Send selection', () => {
    test('a selection in a ; region is sent under #delimit ;', () => {
        const my_text = PROGRAM.slice(4, 7).join('\n');
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 6,
            { text: my_text, line: 4, character: 0 }
        )).toEqual({
            code: '#delimit ;\n' + my_text, statement_end_line: null,
        });
    });

    test('a selection that starts in cr mode is sent as it is', () => {
        // It has its own `#delimit ;`.
        const my_text = PROGRAM.slice(0, 4).join('\n');
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 3,
            { text: my_text, line: 0, character: 0 }
        ).code).toBe(my_text);
        // It starts on the `#delimit ;` line.
        const my_from_directive = PROGRAM.slice(1, 4).join('\n');
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 3,
            { text: my_from_directive, line: 1, character: 0 }
        ).code).toBe(my_from_directive);
    });

    test('a selection across #delimit cr starts under #delimit ;', () => {
        const my_text = PROGRAM.slice(6, 9).join('\n');
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 8,
            { text: my_text, line: 6, character: 0 }
        ).code).toBe('#delimit ;\n' + my_text);
    });

    test('a selection from the end of the #delimit ; line', () => {
        const my_text = '\n' + PROGRAM.slice(2, 4).join('\n');
        expect(find_code_to_send(
            as_document(PROGRAM), 'statement', 3,
            { text: my_text, line: 1, character: '#delimit ;'.length }
        ).code).toBe('#delimit ;\n' + my_text);
    });
});

describe('Send upward and downward lines', () => {
    test('downward lines from a ; statement start under #delimit ;', () => {
        expect(find_code_to_send(
            as_document(PROGRAM), 'downward', 3, null
        )).toEqual({
            code: '#delimit ;\n' + PROGRAM.slice(2).join('\n'),
            statement_end_line: null,
        });
    });

    test('upward lines carry the file\'s own #delimit ;', () => {
        expect(find_code_to_send(
            as_document(PROGRAM), 'upward', 2, null
        )).toEqual({
            code: PROGRAM.slice(0, 4).join('\n'),
            statement_end_line: null,
        });
    });

    test('downward lines from cr code are sent as they are', () => {
        expect(find_code_to_send(
            as_document(PROGRAM), 'downward', 8, null
        ).code).toBe('di "cr"');
    });
});
