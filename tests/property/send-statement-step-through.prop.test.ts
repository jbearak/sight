import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import type * as vscode from 'vscode';
import {
    find_code_to_send,
} from '../../client/src/send-to-stata/statement-detector';
import { StataLexer } from '../../src/lexer';
import { create_mock_document } from './helpers';

/**
 * Stepping through a document with Send Statement, as the command does
 * with cursor advancement, must run every statement exactly once and
 * in order, and no send may start or end inside a comment or string.
 *
 * The oracle: lex each send on its own (dropping the `#delimit ;` line
 * put before it) and put the tokens of all sends together; they must
 * be the document's tokens. A statement sent twice or skipped adds or
 * drops tokens, and a comment or string cut in two lexes differently.
 * Each statement also holds a marker `mN`, which must appear in order.
 */

const PREFIX = '#delimit ;\n';

// One piece of a generated document.
type Item =
    | { kind: 'statement'; form: StatementForm }
    | { kind: 'if'; has_else: boolean; is_else_on_new_line: boolean }
    | { kind: 'block'; body: Item[]; seps: boolean[] }
    | { kind: 'block_comment'; is_one_line: boolean }
    | { kind: 'star_comment'; is_split: boolean }
    | { kind: 'input' };

type StatementForm = 'plain' | 'split' | 'note' | 'string' | 'trailing';

const STATEMENT_FORMS: StatementForm[] =
    ['plain', 'split', 'note', 'string', 'trailing'];

const { item: ITEM } = fc.letrec<{ item: Item }>(tie => ({
    item: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        fc.record({
            kind: fc.constant('statement' as const),
            form: fc.constantFrom(...STATEMENT_FORMS),
        }),
        fc.record({
            kind: fc.constant('if' as const),
            has_else: fc.boolean(),
            is_else_on_new_line: fc.boolean(),
        }),
        fc.record({
            kind: fc.constant('block' as const),
            body: fc.array(tie('item'), { maxLength: 3 }),
            seps: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        }),
        fc.record({
            kind: fc.constant('block_comment' as const),
            is_one_line: fc.boolean(),
        }),
        fc.record({
            kind: fc.constant('star_comment' as const),
            is_split: fc.boolean(),
        }),
        fc.record({ kind: fc.constant('input' as const) }),
    ),
}));

// Items and whether each is followed by a line break (else a space).
const ITEMS = fc.array(
    fc.record({ item: ITEM, is_new_line: fc.boolean() }),
    { minLength: 1, maxLength: 8 });

/** Builds document text, numbering markers as it goes. */
class Writer {
    private the_parts: string[] = [];
    private marker_count = 0;
    // Must the next piece start a line (after a `//` or `*` comment)?
    private is_line_needed = false;

    constructor(private is_semicolon: boolean) {}

    get count(): number {
        return this.marker_count;
    }

    text(): string {
        return this.the_parts.join('');
    }

    private marker(): string {
        return `m${this.marker_count++}`;
    }

    private end(): string {
        return this.is_semicolon ? ';' : '';
    }

    /** Write `piece`, after `separator` unless a line must start. */
    private put(piece: string, separator: string): void {
        if (this.the_parts.length > 0) {
            this.the_parts.push(this.is_line_needed ||
                !this.is_semicolon ? '\n' : separator);
        }
        this.the_parts.push(piece);
        this.is_line_needed = false;
    }

    write(item: Item, separator: string): void {
        const my_end = this.end();
        switch (item.kind) {
            case 'statement': {
                const my_marker = this.marker();
                const my_join = this.is_semicolon ? '\n' : ' ///\n';
                const the_forms: Record<StatementForm, string> = {
                    plain: `di ${my_marker}${my_end}`,
                    split: `di${my_join}${my_marker}${my_end}`,
                    note: `di /// a;b\n${my_marker}${my_end}`,
                    string: `di "a;b" ${my_marker}${my_end}`,
                    trailing: `di ${my_marker}${my_end} // c;d`,
                };
                this.put(the_forms[item.form], separator);
                this.is_line_needed = item.form === 'trailing';
                return;
            }
            case 'if': {
                this.put(`if 1 di ${this.marker()}${my_end}`, separator);
                if (item.has_else) {
                    this.put(`else di ${this.marker()}${my_end}`,
                        item.is_else_on_new_line ? '\n' : ' ');
                }
                return;
            }
            case 'block': {
                this.put(`foreach v in ${this.marker()} {${my_end}`,
                    separator);
                item.body.forEach((my_item, i) => {
                    this.write(my_item, item.seps[i] ? '\n' : ' ');
                });
                this.put(`}${my_end}`, item.seps[5] ? '\n' : ' ');
                return;
            }
            case 'block_comment':
                this.put(item.is_one_line ? '/* cA; */' : '/* cA;\ncB */',
                    separator);
                return;
            case 'star_comment':
                // Under `#delimit ;`, a `*` comment runs to its `;`;
                // under `#delimit cr`, it starts a line.
                if (this.is_semicolon) {
                    this.put(item.is_split ? '* sA\nsB;' : '* sA;',
                        separator);
                } else {
                    this.put(item.is_split ? '* sA ///\nsB' : '* sA;b', '\n');
                }
                return;
            case 'input':
                // Data lines and `end` start lines.
                this.is_line_needed = true;
                this.put([`input ${this.marker()}`, '1', '2', 'end']
                    .join(`${my_end}\n`) + my_end, '\n');
                this.is_line_needed = true;
                return;
        }
    }

    /** A `#delimit` line, alone on its line. */
    directive(text: string): void {
        this.is_line_needed = true;
        this.put(text, '\n');
        this.is_line_needed = true;
    }

    switch_mode(is_semicolon: boolean): void {
        this.is_semicolon = is_semicolon;
    }
}

/** The tokens of `code`, as type and value, whitespace left out. */
function tokens_of(code: string): string[] {
    return new StataLexer().tokenize(code).tokens
        .filter(my_token => my_token.type !== 'WHITESPACE' &&
            my_token.type !== 'EOF' &&
            !(my_token.type === 'STATEMENT_TERMINATOR' &&
                my_token.value !== ';'))
        .map(my_token => `${my_token.type}:${my_token.value}`);
}

/**
 * Press Send statement from the first line until the cursor passes the
 * end, advancing it as the command does; the code of each send.
 */
function step_through(text: string): string[] {
    const my_document = create_mock_document(text) as
        unknown as vscode.TextDocument;
    const the_sent: string[] = [];
    let my_line = 0;
    while (my_line < my_document.lineCount) {
        const my_send = find_code_to_send(
            my_document, 'statement', my_line, null);
        the_sent.push(my_send.code);
        expect(my_send.statement_end_line).not.toBeNull();
        const my_next = (my_send.statement_end_line ?? my_line) + 1;
        expect(my_next).toBeGreaterThan(my_line);
        my_line = my_next;
    }
    return the_sent;
}

/** Check stepping through `text`, with `marker_count` markers. */
function check_step_through(text: string, marker_count: number): void {
    const the_sent = step_through(text);
    const the_tokens = the_sent.flatMap(my_code => {
        const the_code_tokens = tokens_of(my_code);
        // The `#delimit ;` line put before code from a `;` region
        return my_code.startsWith(PREFIX)
            ? the_code_tokens.slice(1)
            : the_code_tokens;
    });
    expect(the_tokens).toEqual(tokens_of(text));
    const the_markers = the_sent.join('\n').match(/\bm\d+\b/g) ?? [];
    expect(the_markers).toEqual(
        Array.from({ length: marker_count }, (_, i) => `m${i}`));
}

function write_items(
    writer: Writer,
    the_items: { item: Item; is_new_line: boolean }[]
): void {
    for (const { item, is_new_line } of the_items) {
        writer.write(item, is_new_line ? '\n' : ' ');
    }
}

/** A `#delimit ;` document of `the_items`. */
function semicolon_document(
    the_items: { item: Item; is_new_line: boolean }[]
): { text: string; count: number } {
    const my_writer = new Writer(true);
    my_writer.directive('#delimit ;');
    write_items(my_writer, the_items);
    return { text: my_writer.text(), count: my_writer.count };
}

describe('stepping through a document with Send statement', () => {
    test('under #delimit ;, runs each statement once, in order', () => {
        fc.assert(fc.property(ITEMS, the_items => {
            const { text, count } = semicolon_document(the_items);
            check_step_through(text, count);
        }), { numRuns: 500 });
    });

    test('under #delimit cr, runs each statement once, in order', () => {
        fc.assert(fc.property(ITEMS, the_items => {
            const my_writer = new Writer(false);
            write_items(my_writer, the_items);
            check_step_through(my_writer.text(), my_writer.count);
        }), { numRuns: 300 });
    });

    test('across #delimit ; and back, runs each statement once', () => {
        fc.assert(fc.property(ITEMS, ITEMS, ITEMS,
            (the_before, the_semicolon, the_after) => {
                const my_writer = new Writer(false);
                write_items(my_writer, the_before);
                my_writer.switch_mode(true);
                my_writer.directive('#d ;');
                write_items(my_writer, the_semicolon);
                my_writer.switch_mode(false);
                my_writer.directive('#delimit cr');
                write_items(my_writer, the_after);
                check_step_through(my_writer.text(), my_writer.count);
            }), { numRuns: 200 });
    });
});

describe('documents the property found', () => {
    const THE_CASES: [string, string, number][] = [
        // A `*` comment ended on the next line, then a statement
        ['* comment then a statement',
            '#delimit ;\ndi m0; * sA\nsB; di m1;', 2],
        // A block comment after a `;`, ending before a statement
        ['block comment after ;',
            '#delimit ;\ndi m0; /* cA;\ncB */ di m1;', 2],
        // A closer whose line goes on to the next (sent `di` alone)
        ['closer line joined to the next',
            '#delimit ;\nforeach v in m0 {;\n}; di /// a;b\nm1;', 2],
        // A closer and an if/else chain's header on one line (sent
        // the `if` without its `else`)
        ['closer and if header on one line',
            '#delimit ;\nforeach v in m0 {;\ndi m1; }; if 1 di m2;\n' +
                'else di m3;', 4],
    ];
    for (const [my_name, my_text, my_count] of THE_CASES) {
        test(my_name, () => {
            check_step_through(my_text, my_count);
        });
    }
});
