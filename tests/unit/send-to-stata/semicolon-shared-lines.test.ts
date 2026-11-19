import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import type * as vscode from 'vscode';
import {
    find_code_to_send,
} from '../../../client/src/send-to-stata/statement-detector';
import { create_mock_document } from '../../property/helpers';

/**
 * Under `#delimit ;`, a line can hold the end of one statement and the
 * start of another. Send Statement sends only the statements the
 * cursor's line starts (or, if it starts none, the one passing through
 * it), never a neighbour that shares a line with them.
 */

function as_document(the_lines: string[]): vscode.TextDocument {
    return create_mock_document(the_lines.join('\n')) as
        unknown as vscode.TextDocument;
}

const PREFIX = '#delimit ;\n';

function send(the_lines: string[], line: number): {
    code: string;
    statement_end_line: number | null;
} {
    return find_code_to_send(as_document(the_lines), 'statement', line, null);
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
        expect(my_send.statement_end_line).not.toBeNull();
        const my_next = (my_send.statement_end_line ?? 0) + 1;
        expect(my_next).toBeGreaterThan(my_line);
        my_line = my_next;
    }
    return the_sent;
}

describe('a statement that ends on a line with another after it', () => {
    const LINES = [
        '#delimit ;',       // 0
        'display',          // 1
        '1; clear;',        // 2
        'di 2;',            // 3
    ];

    test('the cursor on its first line sends it alone', () => {
        expect(send(LINES, 1).code).toBe(PREFIX + 'display\n1;');
    });

    test('the cursor stays on the line with the next statement', () => {
        expect(send(LINES, 1).statement_end_line).toBe(1);
    });

    test('the cursor on the shared line sends the statement it starts', () => {
        expect(send(LINES, 2)).toEqual({
            code: PREFIX + 'clear;',
            statement_end_line: 2,
        });
    });

    test('stepping runs each statement once', () => {
        expect(step_through(LINES, 1)).toEqual([
            PREFIX + 'display\n1;',
            PREFIX + 'clear;',
            PREFIX + 'di 2;',
        ]);
    });
});

describe('a statement that starts on a line after another', () => {
    const LINES = [
        '#delimit ;',       // 0
        'clear; display',   // 1
        '1;',               // 2
        'di 2;',            // 3
    ];

    test('the cursor on its last line leaves the earlier one out', () => {
        expect(send(LINES, 2)).toEqual({
            code: PREFIX + 'display\n1;',
            statement_end_line: 2,
        });
    });

    test('the cursor on the shared line sends what starts there', () => {
        expect(send(LINES, 1).code).toBe(PREFIX + 'clear; display\n1;');
    });

    test('stepping runs each statement once', () => {
        expect(step_through(LINES, 1)).toEqual([
            PREFIX + 'clear; display\n1;',
            PREFIX + 'di 2;',
        ]);
    });
});

describe('a block whose closer shares a line', () => {
    const LINES = [
        '#delimit ;',               // 0
        'foreach v in a b {;',      // 1
        '    di "`v\'";',           // 2
        '}; clear;',                // 3
        'di 2;',                    // 4
    ];

    test('the cursor on the header sends the block alone', () => {
        expect(send(LINES, 1)).toEqual({
            code: PREFIX + LINES.slice(1, 3).join('\n') + '\n};',
            statement_end_line: 2,
        });
    });

    test('the cursor on the closer line sends what starts after it', () => {
        expect(send(LINES, 3).code).toBe(PREFIX + 'clear;');
    });

    test('a closer alone on its line still sends the block', () => {
        const the_lines = [...LINES.slice(0, 3), '};', 'clear;'];
        expect(send(the_lines, 3).code)
            .toBe(PREFIX + the_lines.slice(1, 4).join('\n'));
    });

    test('stepping runs each statement once', () => {
        expect(step_through(LINES, 1)).toEqual([
            PREFIX + LINES.slice(1, 3).join('\n') + '\n};',
            PREFIX + 'clear;',
            PREFIX + 'di 2;',
        ]);
    });

    test('a body statement before the closer moves the cursor past it',
        () => {
            const the_lines = [
                '#delimit ;', 'foreach v in a b {;', '    di', '    1; };',
                'di 2;',
            ];
            // Staying on line 3 would send the whole block again.
            expect(send(the_lines, 2)).toEqual({
                code: PREFIX + '    di\n    1;',
                statement_end_line: 3,
            });
        });

    test('code before the header on its line is left out', () => {
        const the_lines = [
            '#delimit ;',
            'clear; foreach v in a b {;',
            '    di "`v\'";',
            '};',
        ];
        // From the closer, the block starts after `clear;`.
        expect(send(the_lines, 3).code).toBe(
            PREFIX + 'foreach v in a b {;\n' + the_lines.slice(2).join('\n'));
        // From the header line, both statements start there.
        expect(send(the_lines, 1).code)
            .toBe(PREFIX + the_lines.slice(1).join('\n'));
    });
});

describe('what stays as it was', () => {
    test('several whole statements on the cursor line go together', () => {
        const the_lines = ['#delimit ;', 'di 1; di 2;', 'di 3;'];
        expect(send(the_lines, 1)).toEqual({
            code: PREFIX + 'di 1; di 2;',
            statement_end_line: 1,
        });
    });

    test('a comment after the last ; is sent with its line', () => {
        const the_lines = ['#delimit ;', 'display', '1; // note', 'di 2;'];
        expect(send(the_lines, 1)).toEqual({
            code: PREFIX + 'display\n1; // note',
            statement_end_line: 2,
        });
    });

    test('the cursor on a middle line sends the statement around it', () => {
        const the_lines = ['#delimit ;', 'clear; reg y', '  x', '  z; di 1;'];
        expect(send(the_lines, 2).code).toBe(PREFIX + 'reg y\n  x\n  z;');
    });

    test('indentation before the statement is kept', () => {
        const the_lines = ['#delimit ;', '    display', '    1; clear;'];
        expect(send(the_lines, 1).code).toBe(PREFIX + '    display\n    1;');
    });

    test('an abbreviated #del ; reads the same', () => {
        const the_lines = ['#del ;', 'display', '1; clear;'];
        expect(send(the_lines, 1).code).toBe(PREFIX + 'display\n1;');
    });

    test('cr mode sends whole lines', () => {
        const the_lines = ['di 1; di 2', 'di 3'];
        expect(send(the_lines, 0).code).toBe('di 1; di 2');
    });
});

describe('upward and downward lines on a shared line', () => {
    const LINES = [
        '#delimit ;',       // 0
        'clear; display',   // 1
        '1; di 2;',         // 2
        'di 3;',            // 3
    ];

    test('upward lines end with the cursor\'s statement', () => {
        // From line 1, its statements end at `1;`.
        expect(find_code_to_send(
            as_document(LINES), 'upward', 1, null
        ).code).toBe('#delimit ;\nclear; display\n1;');
    });

    test('downward lines start with the cursor\'s statement', () => {
        // Line 2 starts `di 2;`, so the tail of `display` stays out.
        expect(find_code_to_send(
            as_document(LINES), 'downward', 2, null
        ).code).toBe(PREFIX + 'di 2;\ndi 3;');
        // Line 1 starts `clear;`.
        expect(find_code_to_send(
            as_document(LINES), 'downward', 1, null
        ).code).toBe(PREFIX + LINES.slice(1).join('\n'));
    });
});

describe('any layout of di statements', () => {
    // Each statement `di N`, split onto two lines or not, and whether a
    // line break follows its `;`.
    const LAYOUT = fc.array(fc.record({
        is_split: fc.boolean(),
        is_line_end: fc.boolean(),
    }), { minLength: 1, maxLength: 8 });

    interface Layout {
        the_lines: string[];
        /** The first and last line of each `di N;`. */
        the_spans: { first: number; last: number }[];
    }

    function lay_out(the_parts: { is_split: boolean;
        is_line_end: boolean }[]): Layout {
        let my_text = '#delimit ;\n';
        let my_line = 1;
        const the_spans: { first: number; last: number }[] = [];
        the_parts.forEach((my_part, i) => {
            const my_first = my_line;
            if (my_part.is_split) {
                my_text += `di\n${i};`;
                my_line++;
            } else {
                my_text += `di ${i};`;
            }
            the_spans.push({ first: my_first, last: my_line });
            if (my_part.is_line_end && i < the_parts.length - 1) {
                my_text += '\n';
                my_line++;
            } else {
                my_text += ' ';
            }
        });
        return { the_lines: my_text.trimEnd().split('\n'), the_spans };
    }

    /** The `di N;` statements in sent code, in order. */
    function statements_in(code: string): string[] {
        return (code.match(/di\s+\d+;/g) ?? [])
            .map(my_code => my_code.replace(/\s+/, ' '));
    }

    test('a line sends the statements it starts, else the one through it',
        () => {
            fc.assert(fc.property(LAYOUT, the_parts => {
                const { the_lines, the_spans } = lay_out(the_parts);
                for (let my_line = 1; my_line < the_lines.length;
                    my_line++) {
                    let the_expected = the_spans
                        .map((my_span, i) => ({ ...my_span, i }))
                        .filter(my_span => my_span.first === my_line);
                    if (the_expected.length === 0) {
                        the_expected = the_spans
                            .map((my_span, i) => ({ ...my_span, i }))
                            .filter(my_span => my_span.first < my_line &&
                                my_line <= my_span.last);
                    }
                    expect(statements_in(send(the_lines, my_line).code))
                        .toEqual(the_expected.map(my_span =>
                            `di ${my_span.i};`));
                }
            }));
        });

    test('stepping runs each statement once, in order', () => {
        fc.assert(fc.property(LAYOUT, the_parts => {
            const { the_lines } = lay_out(the_parts);
            const the_run = step_through(the_lines, 1)
                .flatMap(statements_in);
            expect(the_run).toEqual(the_parts.map((_, i) => `di ${i};`));
        }));
    });
});
