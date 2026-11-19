import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import type * as vscode from 'vscode';
import {
    find_code_to_send,
} from '../../client/src/send-to-stata/statement-detector';
import {
    compute_cursor_advance_context,
    compute_cursor_position,
} from '../../client/src/send-to-stata/cursor-advance-core';
import { StataLexer } from '../../src/lexer';

/**
 * Stepping through a document with Send Statement, moving the cursor
 * as the command does (cursor-advance-core), must run every statement
 * exactly once and in order, and each send must hold whole statements.
 *
 * The oracles:
 * - Tokens: lex each send on its own (dropping the `#delimit ;` line
 *   put before it) and put the tokens of all sends together; they
 *   must be the document's tokens. A statement sent twice or skipped
 *   adds or drops tokens, and a comment or string cut in two lexes
 *   differently. Each statement holds a marker `mN`, which must appear
 *   in order.
 * - Integrity: markers of one compound statement (an `if` and its
 *   `else`, a block, an if/else-if/else chain, a program, a Mata or
 *   Python block) arrive in one send; and each send closes every block
 *   it opens: its braces balance, and so do `program`, `mata:`,
 *   `python:`, and `input` with their `end` lines.
 *
 * At the end of the file the command leaves the cursor where it is, so
 * pressing again would send the last statement again (existing
 * behavior); the walk stops there.
 *
 * SIGHT_STEP_THROUGH_RUNS and SIGHT_STEP_THROUGH_SEED override the run
 * count and seed, for longer runs by hand.
 */

const PREFIX = '#delimit ;\n';

const RUNS_OVERRIDE = Number(process.env.SIGHT_STEP_THROUGH_RUNS ?? '');
const SEED_OVERRIDE = Number(process.env.SIGHT_STEP_THROUGH_SEED ?? '');

function run_options(runs: number): fc.Parameters<unknown> {
    return {
        numRuns: RUNS_OVERRIDE > 0 ? RUNS_OVERRIDE : runs,
        ...(Number.isInteger(SEED_OVERRIDE) &&
            process.env.SIGHT_STEP_THROUGH_SEED !== undefined &&
            { seed: SEED_OVERRIDE }),
    };
}

// One piece of a generated document.
type Item =
    | { kind: 'statement'; form: StatementForm }
    | { kind: 'if'; has_else: boolean; is_else_on_new_line: boolean }
    | { kind: 'block'; body: Item[]; seps: boolean[] }
    | { kind: 'block_comment'; is_one_line: boolean }
    | { kind: 'star_comment'; is_split: boolean }
    | { kind: 'input' }
    // `#delimit cr` only:
    | { kind: 'blank' }
    | { kind: 'if_chain'; branches: Item[][]; is_else_on_new_line: boolean[] }
    // `#delimit cr`, at the top level only:
    | { kind: 'program'; body: Item[] }
    | { kind: 'mata'; line_count: number }
    | { kind: 'python' };

type StatementForm =
    | 'plain' | 'split' | 'note' | 'string' | 'trailing' | 'lead'
    // A `/* */` comment that joins two lines (`#delimit cr` only)
    | 'joined';

const STATEMENT_FORMS: StatementForm[] =
    ['plain', 'split', 'note', 'string', 'trailing', 'lead'];

const CR_STATEMENT_FORMS: StatementForm[] = [...STATEMENT_FORMS, 'joined'];

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

/**
 * Items for `#delimit cr` code, inside a block or not. Without
 * `input`, for a program's body: the first `end` line ends a program
 * definition, so `input`'s `end` would end the program.
 */
function cr_item(has_input: boolean): fc.Arbitrary<Item> {
    const { item } = fc.letrec<{ item: Item }>(tie => ({
        item: fc.oneof(
            { depthSize: 'small', withCrossShrink: true },
            fc.record({
                kind: fc.constant('statement' as const),
                form: fc.constantFrom(...CR_STATEMENT_FORMS),
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
                kind: fc.constant('if_chain' as const),
                branches: fc.array(
                    fc.array(tie('item'), { maxLength: 2 }),
                    { minLength: 1, maxLength: 3 }),
                is_else_on_new_line: fc.array(
                    fc.boolean(), { minLength: 3, maxLength: 3 }),
            }),
            fc.record({
                kind: fc.constant('block_comment' as const),
                is_one_line: fc.boolean(),
            }),
            fc.record({
                kind: fc.constant('star_comment' as const),
                is_split: fc.boolean(),
            }),
            fc.record({ kind: fc.constant('blank' as const) }),
            fc.record({
                kind: fc.constant(has_input ? 'input' as const : 'blank' as const),
            }),
        ),
    }));
    return item;
}

const CR_ITEM = cr_item(true);

/** `#delimit cr` items at the top level: also programs, Mata, Python. */
const CR_TOP_ITEM: fc.Arbitrary<Item> = fc.oneof(
    { weight: 6, arbitrary: CR_ITEM },
    {
        weight: 1,
        arbitrary: fc.record({
            kind: fc.constant('program' as const),
            body: fc.array(cr_item(false), { maxLength: 4 }),
        }),
    },
    {
        weight: 1,
        arbitrary: fc.record({
            kind: fc.constant('mata' as const),
            line_count: fc.integer({ min: 1, max: 3 }),
        }),
    },
    {
        weight: 1,
        arbitrary: fc.record({ kind: fc.constant('python' as const) }),
    },
);

type Placed = { item: Item; is_new_line: boolean };

// Items and whether each is followed by a line break (else a space).
const ITEMS = fc.array(
    fc.record({ item: ITEM, is_new_line: fc.boolean() }),
    { minLength: 1, maxLength: 8 });

const CR_ITEMS = fc.array(
    fc.record({ item: CR_ITEM, is_new_line: fc.constant(true) }),
    { minLength: 1, maxLength: 8 });

const CR_TOP_ITEMS = fc.array(
    fc.record({ item: CR_TOP_ITEM, is_new_line: fc.constant(true) }),
    { minLength: 1, maxLength: 8 });

/** Builds document text, numbering markers as it goes. */
class Writer {
    private the_parts: string[] = [];
    private marker_count = 0;
    // Must the next piece start a line (after a `//` or `*` comment)?
    private is_line_needed = false;
    // Markers of the compound statements being written, innermost last
    private the_open_groups: string[][] = [];
    private the_groups: string[][] = [];

    constructor(private is_semicolon: boolean) {}

    get count(): number {
        return this.marker_count;
    }

    /** Markers that must arrive in one send, one list per statement. */
    get groups(): string[][] {
        return this.the_groups;
    }

    text(): string {
        return this.the_parts.join('');
    }

    private marker(): string {
        const my_marker = `m${this.marker_count++}`;
        for (const my_group of this.the_open_groups) {
            my_group.push(my_marker);
        }
        return my_marker;
    }

    private open_group(): void {
        this.the_open_groups.push([]);
    }

    private close_group(): void {
        const my_group = this.the_open_groups.pop();
        if (my_group && my_group.length > 1) {
            this.the_groups.push(my_group);
        }
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
                    lead: `  // e;f\ndi ${my_marker}${my_end}`,
                    joined: `di /* g;h\n*/ ${my_marker}${my_end}`,
                };
                // A `//` comment before a statement starts a line,
                // indented: after a comment, Stata reads `//` at
                // column 0 as code.
                this.is_line_needed ||= item.form === 'lead';
                this.put(the_forms[item.form], separator);
                this.is_line_needed = item.form === 'trailing';
                return;
            }
            case 'if': {
                this.open_group();
                this.put(`if 1 di ${this.marker()}${my_end}`, separator);
                if (item.has_else) {
                    this.put(`else di ${this.marker()}${my_end}`,
                        item.is_else_on_new_line ? '\n' : ' ');
                }
                this.close_group();
                return;
            }
            case 'block': {
                this.open_group();
                this.put(`foreach v in ${this.marker()} {${my_end}`,
                    separator);
                item.body.forEach((my_item, i) => {
                    this.write(my_item, item.seps[i] ? '\n' : ' ');
                });
                this.put(`}${my_end}`, item.seps[5] ? '\n' : ' ');
                this.close_group();
                return;
            }
            case 'if_chain': {
                // `#delimit cr` only: a brace ends its line.
                this.open_group();
                item.branches.forEach((my_body, i) => {
                    const my_is_last = i === item.branches.length - 1;
                    const my_has_else = item.branches.length > 1;
                    let my_header: string;
                    if (i === 0) {
                        my_header = `if ${this.marker()} {`;
                    } else if (my_is_last) {
                        my_header = 'else {';
                    } else {
                        my_header = `else if ${this.marker()} {`;
                    }
                    if (i === 0) {
                        this.put(my_header, separator);
                    } else if (item.is_else_on_new_line[i]) {
                        this.put('}', '\n');
                        this.put(my_header, '\n');
                    } else {
                        this.put(`} ${my_header}`, '\n');
                    }
                    for (const my_item of my_body) {
                        this.write(my_item, '\n');
                    }
                    // The final `else` has no marker in its header,
                    // and its body may hold only blanks or comments:
                    // give it one, so a branch sent alone shows.
                    if (my_has_else && (my_is_last || my_body.length === 0)) {
                        this.put(`di ${this.marker()}`, '\n');
                    }
                });
                this.put('}', '\n');
                this.close_group();
                return;
            }
            case 'program': {
                this.open_group();
                this.is_line_needed = true;
                this.put(`program define ${this.marker()}`, '\n');
                for (const my_item of item.body) {
                    this.write(my_item, '\n');
                }
                this.is_line_needed = true;
                this.put('end', '\n');
                this.close_group();
                return;
            }
            case 'mata': {
                this.open_group();
                this.is_line_needed = true;
                this.put('mata:', '\n');
                for (let i = 0; i < item.line_count; i++) {
                    this.put(`x = "${this.marker()}"`, '\n');
                }
                this.put('end', '\n');
                this.close_group();
                return;
            }
            case 'python': {
                this.open_group();
                this.is_line_needed = true;
                this.put('python:', '\n');
                this.put(`print("${this.marker()}")`, '\n');
                this.put(`print("${this.marker()}")`, '\n');
                this.put('end', '\n');
                this.close_group();
                return;
            }
            case 'blank':
                this.is_line_needed = true;
                this.put('', '\n');
                this.is_line_needed = true;
                return;
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

/**
 * A document as VS Code gives it: lines without their line break
 * (`\n` or `\r\n`), and the text as it is on disk.
 */
function make_document(text: string): vscode.TextDocument {
    const the_lines = text.split(/\r?\n/);
    const my_document = {
        lineCount: the_lines.length,
        lineAt: (line: number) => ({ text: the_lines[line] ?? '' }),
        getText: () => text,
    };
    return my_document as unknown as vscode.TextDocument;
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
 * Press Send statement from the first line, moving the cursor as the
 * command does, until the command would leave it in place (the end of
 * the file); the code of each send.
 */
function step_through(text: string): string[] {
    const my_document = make_document(text);
    const the_sent: string[] = [];
    let my_line = 0;
    for (;;) {
        const my_send = find_code_to_send(
            my_document, 'statement', my_line, null);
        the_sent.push(my_send.code);
        const my_context = compute_cursor_advance_context(
            'statement', false, my_send.statement_end_line);
        expect(my_context.should_advance).toBe(true);
        const my_position = compute_cursor_position(
            my_context.next_line ?? my_line, my_document.lineCount, true);
        // The cursor stays: pressing again resends this statement.
        if (my_position === null) break;
        expect(my_position.line).toBeGreaterThan(my_line);
        my_line = my_position.line;
    }
    return the_sent;
}

const OPENER = /^(program define \S+|mata:|python:|input\b.*)$/;

/** Lines of a send that open and close blocks ended by `end`. */
function count_end_blocks(code: string): { opened: number; ended: number } {
    let opened = 0;
    let ended = 0;
    for (const my_raw of code.split('\n')) {
        const my_line = my_raw.trim().replace(/;$/, '');
        if (OPENER.test(my_line)) opened++;
        if (my_line === 'end') ended++;
    }
    return { opened, ended };
}

function count_of(text: string, char: string): number {
    return text.split(char).length - 1;
}

/** Check stepping through `text`; see the oracles above. */
function check_step_through(
    text: string,
    marker_count: number,
    the_groups: string[][] = []
): void {
    const the_sent = step_through(text);
    // Sends join lines with `\n` (VS Code's lines have no line break).
    const my_lf_text = text.replace(/\r\n/g, '\n');
    const the_tokens = the_sent.flatMap(my_code => {
        const the_code_tokens = tokens_of(my_code);
        // The `#delimit ;` line put before code from a `;` region
        return my_code.startsWith(PREFIX)
            ? the_code_tokens.slice(1)
            : the_code_tokens;
    });
    expect(the_tokens).toEqual(tokens_of(my_lf_text));
    const the_markers = the_sent.join('\n').match(/\bm\d+\b/g) ?? [];
    expect(the_markers).toEqual(
        Array.from({ length: marker_count }, (_, i) => `m${i}`));

    // Which send each marker arrived in
    const my_send_of = new Map<string, number>();
    the_sent.forEach((my_code, i) => {
        for (const my_marker of my_code.match(/\bm\d+\b/g) ?? []) {
            my_send_of.set(my_marker, i);
        }
    });
    for (const my_group of the_groups) {
        const the_sends = my_group.map(my_marker => my_send_of.get(my_marker));
        expect({ group: my_group, sends: new Set(the_sends).size })
            .toEqual({ group: my_group, sends: 1 });
    }
    for (const my_code of the_sent) {
        const my_body = my_code.startsWith(PREFIX)
            ? my_code.slice(PREFIX.length)
            : my_code;
        expect({ code: my_body, braces: count_of(my_body, '{') })
            .toEqual({ code: my_body, braces: count_of(my_body, '}') });
        const { opened, ended } = count_end_blocks(my_body);
        expect({ code: my_body, opened }).toEqual({ code: my_body, opened: ended });
    }
}

function write_items(writer: Writer, the_items: Placed[]): void {
    for (const { item, is_new_line } of the_items) {
        writer.write(item, is_new_line ? '\n' : ' ');
    }
}

/** A `#delimit ;` document of `the_items`. */
function semicolon_document(the_items: Placed[]): Writer {
    const my_writer = new Writer(true);
    my_writer.directive('#delimit ;');
    write_items(my_writer, the_items);
    return my_writer;
}

/** The text with `\r\n` line breaks, if `is_crlf`. */
function with_line_breaks(text: string, is_crlf: boolean): string {
    return is_crlf ? text.replace(/\n/g, '\r\n') : text;
}

describe('stepping through a document with Send statement', () => {
    test('under #delimit ;, runs each statement once, in order', () => {
        fc.assert(fc.property(ITEMS, fc.boolean(), fc.boolean(),
            (the_items, is_crlf, has_final_break) => {
                const my_writer = semicolon_document(the_items);
                const my_text = my_writer.text()
                    + (has_final_break ? '\n' : '');
                check_step_through(with_line_breaks(my_text, is_crlf),
                    my_writer.count, my_writer.groups);
            }), run_options(500));
    });

    test('under #delimit cr, runs each statement once, in order', () => {
        fc.assert(fc.property(CR_TOP_ITEMS, fc.boolean(), fc.boolean(),
            (the_items, is_crlf, has_final_break) => {
                const my_writer = new Writer(false);
                write_items(my_writer, the_items);
                const my_text = my_writer.text()
                    + (has_final_break ? '\n' : '');
                check_step_through(with_line_breaks(my_text, is_crlf),
                    my_writer.count, my_writer.groups);
            }), run_options(500));
    });

    test('across #delimit ; and back, runs each statement once', () => {
        fc.assert(fc.property(CR_ITEMS, ITEMS, CR_ITEMS, fc.boolean(),
            (the_before, the_semicolon, the_after, is_crlf) => {
                const my_writer = new Writer(false);
                write_items(my_writer, the_before);
                my_writer.switch_mode(true);
                my_writer.directive('#d ;');
                write_items(my_writer, the_semicolon);
                my_writer.switch_mode(false);
                my_writer.directive('#delimit cr');
                write_items(my_writer, the_after);
                check_step_through(
                    with_line_breaks(my_writer.text(), is_crlf),
                    my_writer.count, my_writer.groups);
            }), run_options(200));
    });
});

describe('documents the property found', () => {
    const THE_CASES: [string, string, number, string[][]][] = [
        // A `*` comment ended on the next line, then a statement
        ['* comment then a statement',
            '#delimit ;\ndi m0; * sA\nsB; di m1;', 2, []],
        // A block comment after a `;`, ending before a statement
        ['block comment after ;',
            '#delimit ;\ndi m0; /* cA;\ncB */ di m1;', 2, []],
        // A closer whose line goes on to the next (sent `di` alone)
        ['closer line joined to the next',
            '#delimit ;\nforeach v in m0 {;\n}; di /// a;b\nm1;', 2, []],
        // A closer and an if/else chain's header on one line (sent
        // the `if` without its `else`)
        ['closer and if header on one line',
            '#delimit ;\nforeach v in m0 {;\ndi m1; }; if 1 di m2;\n' +
                'else di m3;', 4, [['m0', 'm1'], ['m2', 'm3']]],
        // A cr program whose body switches to `#delimit ;`
        ['program with a #delimit ; body',
            'program define p\n#delimit ;\ndi m0; di\nm1; di m2;\n' +
                'end;\ndi m3;', 4, []],
    ];
    for (const [my_name, my_text, my_count, the_groups] of THE_CASES) {
        test(my_name, () => {
            check_step_through(my_text, my_count, the_groups);
        });
    }
});

describe('the end of the file', () => {
    // The last press leaves the cursor in place; the walk ends there.
    const THE_CASES: [string, string, number][] = [
        ['cr, no final line break', 'di m0\ndi m1', 2],
        ['cr, a final line break', 'di m0\ndi m1\n', 2],
        ['cr, blank lines at the end', 'di m0\n\ndi m1\n\n\n', 2],
        ['cr, CRLF and a final line break', 'di m0\r\ndi m1\r\n', 2],
        ['cr, a block last, no final line break',
            'foreach v in m0 {\ndi m1\n}', 2],
        ['; , no final line break', '#delimit ;\ndi m0;\ndi m1;', 2],
        ['; , a final line break', '#delimit ;\ndi m0;\ndi m1;\n', 2],
    ];
    for (const [my_name, my_text, my_count] of THE_CASES) {
        test(my_name, () => {
            check_step_through(my_text, my_count);
            const the_sent = step_through(my_text);
            expect(the_sent.join('\n').match(/\bm\d+\b/g))
                .toEqual(['m0', 'm1']);
        });
    }
});
