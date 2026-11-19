import { describe, test, expect } from 'bun:test';
import type * as vscode from 'vscode';
import {
    find_code_to_send,
} from '../../../client/src/send-to-stata/statement-detector';
import { create_mock_document } from '../../property/helpers';

/**
 * Send Statement must never run code twice, skip code while the user
 * steps through a file, or send half a statement or comment. Each case
 * here broke when Send Statement began cutting `#delimit ;` lines at
 * statement boundaries.
 */

function as_document(the_lines: string[]): vscode.TextDocument {
    return create_mock_document(the_lines.join('\n')) as
        unknown as vscode.TextDocument;
}

const PREFIX = '#delimit ;\n';

function send(
    the_lines: string[],
    line: number,
    mode: 'statement' | 'upward' | 'downward' = 'statement'
): { code: string; statement_end_line: number | null } {
    return find_code_to_send(as_document(the_lines), mode, line, null);
}

/**
 * Press Send Statement from `start_line` until the cursor passes the
 * end, advancing it as the command does; the code of each send.
 */
function step_through(the_lines: string[], start_line: number): string[] {
    const the_sent: string[] = [];
    let my_line = start_line;
    while (my_line < the_lines.length) {
        const my_send = send(the_lines, my_line);
        the_sent.push(my_send.code);
        const my_next = (my_send.statement_end_line ?? my_line) + 1;
        expect(my_next).toBeGreaterThan(my_line);
        my_line = my_next;
    }
    return the_sent;
}

describe('one-line if and else on lines shared with other statements', () => {
    const LINES = [
        '#delimit ;',           // 0
        'di 1; if 1 di 2;',     // 1
        'else di 3; di 4;',     // 2
    ];

    test('stepping runs all four, each once, in order', () => {
        const the_run = step_through(LINES, 1).join('\n');
        expect(the_run.match(/di \d/g)).toEqual(
            ['di 1', 'di 2', 'di 3', 'di 4']);
    });

    test('the if line sends the whole chain', () => {
        expect(send(LINES, 1)).toEqual({
            code: PREFIX + LINES.slice(1).join('\n'),
            statement_end_line: 2,
        });
    });
});

describe('a block comment that starts after a ; and ends a line later', () => {
    const LINES = [
        '#delimit ;',                       // 0
        'replace x = x + 1; /* note',       // 1
        'continued */',                     // 2
        'di 2;',                            // 3
    ];

    test('the command is sent once, with the whole comment', () => {
        expect(send(LINES, 1)).toEqual({
            code: PREFIX + LINES.slice(1, 3).join('\n'),
            statement_end_line: 2,
        });
    });

    test('stepping runs the command once', () => {
        const the_run = step_through(LINES, 1).join('\n');
        expect(the_run.match(/replace/g)).toEqual(['replace']);
        expect(the_run.match(/di 2;/g)).toEqual(['di 2;']);
    });

    test('upward and downward lines keep the comment whole', () => {
        expect(send(LINES, 1, 'upward').code)
            .toBe(LINES.slice(0, 3).join('\n'));
        expect(send(LINES, 2, 'downward').code)
            .toBe(PREFIX + LINES.slice(1).join('\n'));
    });
});

describe('a data row of input', () => {
    for (const is_semicolon of [true, false]) {
        const my_end = is_semicolon ? ';' : '';
        const LINES = [
            is_semicolon ? '#delimit ;' : 'clear',  // 0
            `input x${my_end}`,                     // 1
            `1${my_end}`,                           // 2
            `2${my_end}`,                           // 3
            `end${my_end}`,                         // 4
            `di 5${my_end}`,                        // 5
        ];
        const my_mode = is_semicolon ? '#delimit ;' : '#delimit cr';

        test(`sends input through end (${my_mode})`, () => {
            const my_block = LINES.slice(1, 5).join('\n');
            for (const my_line of [2, 3]) {
                expect(send(LINES, my_line)).toEqual({
                    code: (is_semicolon ? PREFIX : '') + my_block,
                    statement_end_line: 4,
                });
            }
        });
    }
});

describe('lines that are not input data', () => {
    test('input with no end is not widened', () => {
        const the_lines = ['input x', '1', '2'];
        expect(send(the_lines, 0).code).toBe('input x');
    });

    test('a line in a capture block sends just that line', () => {
        const the_lines = ['capture {', 'di 1', 'di 2', '}'];
        expect(send(the_lines, 2).code).toBe('di 2');
    });
});

describe('a * comment whose ; is on the next line', () => {
    test('is cut from the statement after its ;', () => {
        const the_lines = [
            '#delimit ;',                       // 0
            '* comment',                        // 1
            'ends; erase important.dta;',       // 2
        ];
        expect(send(the_lines, 1)).toEqual({
            code: PREFIX + '* comment\nends;',
            statement_end_line: 1,
        });
        expect(send(the_lines, 2).code).toBe(PREFIX + 'erase important.dta;');
    });
});

describe('a long ; block of if blocks', () => {
    function block_of_ifs(count: number): string[] {
        const the_lines = ['#delimit ;', 'quietly {;'];
        for (let i = 0; i < count; i++) {
            the_lines.push(`if ${i} {;`, `di ${i};`, '};');
        }
        the_lines.push('};');
        return the_lines;
    }

    /** Fastest of several sends from the outer header, in ms. */
    function fastest_send_ms(count: number): number {
        const my_document = as_document(block_of_ifs(count));
        let time_ms = Number.POSITIVE_INFINITY;
        for (let i = 0; i < 4; i++) {
            const start_ms = performance.now();
            // The reading is cached after the first send.
            find_code_to_send(my_document, 'statement', 1, null);
            find_code_to_send(my_document, 'upward', 3, null);
            find_code_to_send(my_document, 'downward', 3, null);
            time_ms = Math.min(time_ms, performance.now() - start_ms);
        }
        return time_ms;
    }

    test('sends the whole outer block', () => {
        const the_lines = block_of_ifs(3);
        expect(send(the_lines, 1).code)
            .toBe(PREFIX + the_lines.slice(1).join('\n'));
    });

    test('grows about linearly with the number of blocks', () => {
        fastest_send_ms(1000);
        const small_ms = fastest_send_ms(3000);
        const large_ms = fastest_send_ms(12000);
        // Linear is about 4x; quadratic about 16x.
        expect(large_ms).toBeLessThan(Math.max(small_ms, 1) * 8);
    });
});
