import * as vscode from 'vscode';
import { StataLexer } from '../../../src/lexer/index.js';
import { StataParser } from '../../../src/parser/index.js';
import { nested_statements } from '../../../src/utils/node-body.js';
import {
    SemicolonStatementTracker,
    delimit_directive_mode,
} from '../../../src/utils/semicolon-statement.js';
import type {
    StataNode,
    Token,
    TokenType,
} from '../../../src/types/index.js';

export interface StatementBounds {
    start_line: number;  // 0-indexed, inclusive
    end_line: number;    // 0-indexed, inclusive
}

export type DelimiterMode = 'cr' | 'semicolon';

/** A place in the document, 0-indexed. */
export interface Position {
    line: number;
    character: number;
}

/**
 * A closed block (or `if`/`else` chain): its lines, and where its
 * headers start and its closers end.
 */
export interface BlockBounds extends StatementBounds {
    start: Position;
    end: Position;
    /** Where each header in it starts (one per `if`/`else` part). */
    header_starts: Position[];
    /** Where each closer in it ends (one per `if`/`else` part). */
    closer_ends: Position[];
}

/**
 * A statement read under `#delimit ;`: from its first token (a comment
 * line before it included) to the end of its `;`.
 */
export interface SemicolonStatement {
    start: Position;
    end: Position;
}

/** A `#delimit` directive: where it ends and the mode it sets. */
interface DelimitDirective {
    line: number;
    character: number;
    mode: DelimiterMode;
}

/** What the send commands need to know about a document. */
export interface DocumentReading {
    /**
     * The lines (0-indexed) that Stata reads together with the line
     * after them, so both belong to one statement.
     */
    joined_lines: Set<number>;
    /** The `#delimit` directives, in order. */
    delimit_directives: DelimitDirective[];
    /**
     * The lines of each closed block (or `if`/`else` chain), keyed by
     * the lines of its headers and closers.
     */
    block_by_line: Map<number, BlockBounds>;
    /** The lines of every closed block and `if`/`else` chain. */
    the_blocks: BlockBounds[];
    /** The statements read under `#delimit ;`, in order. */
    semicolon_statements: SemicolonStatement[];
}

const COMMENT_TOKEN_TYPES: ReadonlySet<TokenType> = new Set<TokenType>([
    'COMMENT_LINE', 'COMMENT_BLOCK', 'CONTINUATION',
]);

// A `#delimit ;` line put before code sent from a `#delimit ;` region.
// Stata goes back to `#delimit cr` when the sent do-file ends.
const DELIMIT_SEMICOLON_LINE = '#delimit ;\n';


/**
 * Read `text` with Sight's lexer, so the send commands follow the
 * language server's rules for `//`, `///`, and `#delimit`.
 *
 * Under `#delimit cr`, a line joins the next one when:
 *
 * - a `///` with a space or tab before it, or at the start of a line,
 *   ends it, with or without a note after it (`reg y x /// note`). A
 *   `///` with code right before it (`local a b///`) is text, and the
 *   next line is its own command. A `///` in a string, a block
 *   comment, or a `//` comment doesn't join anything;
 * - it is a `///` line that starts a statement: a comment, which Stata
 *   reads with the next line.
 *
 * Under `#delimit ;`, a line joins the next one while a statement is
 * open: it has begun and its `;` hasn't come yet. That follows the
 * lexer's rules for column-0 `//` and `///` in the middle of a
 * statement. A comment after the `;` that ends a line's last statement
 * (`di "a"; // note`) doesn't open the next one here, so the next line
 * isn't sent with it.
 *
 * Under either mode, a token that spans lines, such as a block comment
 * or a `*` comment continued with `///`, keeps them together.
 */
export function read_document(text: string): DocumentReading {
    const the_tokens = new StataLexer().tokenize(text).tokens;
    const joined_lines = new Set<number>();
    const delimit_directives: DelimitDirective[] = [];
    // Is a `;` statement open at the end of each line that has a token?
    const semicolon_open_by_line = new Map<number, boolean>();
    const tracker = new SemicolonStatementTracker();
    let delimiter_mode: DelimiterMode = 'cr';
    let is_open_for_send = false;
    let closed_line = -1;
    for (const my_token of the_tokens) {
        const start_line = my_token.range.start.line;
        // A `\n` terminator's range ends on the next line.
        const end_line = my_token.type === 'STATEMENT_TERMINATOR'
            ? start_line
            : my_token.range.end.line;
        for (let my_line = start_line; my_line < end_line; my_line++) {
            joined_lines.add(my_line);
        }
        if (my_token.type === 'DELIMIT_DIRECTIVE') {
            delimiter_mode = delimit_directive_mode(my_token);
            delimit_directives.push({
                line: my_token.range.end.line,
                character: my_token.range.end.character,
                mode: delimiter_mode,
            });
        }
        if (delimiter_mode === 'cr') {
            if (my_token.type === 'CONTINUATION' ||
                (my_token.type === 'COMMENT_LINE' &&
                    my_token.value.startsWith('///'))) {
                joined_lines.add(end_line);
            }
        }
        tracker.note(my_token, delimiter_mode);
        if (my_token.type === 'WHITESPACE') {
            continue;
        }
        if (!tracker.is_open) {
            is_open_for_send = false;
            closed_line = end_line;
        } else if (!is_open_for_send) {
            is_open_for_send = !is_trailing_comment(my_token, closed_line);
        }
        semicolon_open_by_line.set(
            end_line, delimiter_mode === 'semicolon' && is_open_for_send);
    }
    // A line with no token (a blank line) is open if the line above is.
    const last_line = the_tokens.length === 0
        ? 0
        : the_tokens[the_tokens.length - 1].range.end.line;
    let is_open = false;
    for (let my_line = 0; my_line <= last_line; my_line++) {
        is_open = semicolon_open_by_line.get(my_line) ?? is_open;
        if (is_open) {
            joined_lines.add(my_line);
        }
    }
    return {
        joined_lines,
        delimit_directives,
        ...find_blocks(the_tokens),
        semicolon_statements: find_semicolon_statements(the_tokens),
    };
}

/**
 * The statements read under `#delimit ;`, each from its first token to
 * the end of its `;` (or of the `end` closing a mata or python block).
 * As in read_document, a comment after the `;` that ends a line's last
 * statement starts no statement.
 */
function find_semicolon_statements(
    the_tokens: Token[]
): SemicolonStatement[] {
    const the_statements: SemicolonStatement[] = [];
    const tracker = new SemicolonStatementTracker();
    let delimiter_mode: DelimiterMode = 'cr';
    let statement_start: Position | null = null;
    let previous_end: Position | null = null;
    let closed_line = -1;
    for (const my_token of the_tokens) {
        if (my_token.type === 'DELIMIT_DIRECTIVE') {
            delimiter_mode = delimit_directive_mode(my_token);
        }
        tracker.note(my_token, delimiter_mode);
        if (my_token.type === 'WHITESPACE' || my_token.type === 'EOF') {
            continue;
        }
        // A `\n` terminator's range ends on the next line.
        const my_end = my_token.type === 'STATEMENT_TERMINATOR'
            ? my_token.range.start
            : my_token.range.end;
        if (!tracker.is_open) {
            if (statement_start !== null) {
                // A `#delimit` ends the statement before it.
                const is_directive = my_token.type === 'DELIMIT_DIRECTIVE';
                the_statements.push({
                    start: statement_start,
                    end: is_directive && previous_end !== null
                        ? previous_end
                        : my_token.range.end,
                });
            }
            statement_start = null;
            closed_line = my_end.line;
        } else if (statement_start === null &&
            delimiter_mode === 'semicolon' &&
            !is_trailing_comment(my_token, closed_line)) {
            statement_start = my_token.range.start;
        }
        previous_end = my_end;
    }
    if (statement_start !== null && previous_end !== null) {
        the_statements.push({ start: statement_start, end: previous_end });
    }
    return the_statements;
}

/**
 * The lines of each closed block in the parsed document, keyed by the
 * lines of its headers and closers: `foreach`, `forvalues`, `while`,
 * `if`, `else`, and `frame` blocks, a prefix's brace block
 * (`capture {`), a program, a `mata` or `python` block, and `input`
 * with its data.
 *
 * An `if` and the `else` nodes right after it are one chain: Stata runs
 * an `else` sent on its own even after a true `if`, so they are sent
 * together. That holds for `if x di "a"` / `else di "b"` too.
 */
function find_blocks(the_tokens: Token[]): {
    block_by_line: Map<number, BlockBounds>;
    the_blocks: BlockBounds[];
} {
    const block_by_line = new Map<number, BlockBounds>();
    const the_blocks: BlockBounds[] = [];
    let the_nodes: StataNode[];
    try {
        the_nodes = new StataParser().parse(the_tokens).ast.nodes;
    } catch {
        // Without blocks, Send statement sends the header's lines.
        return { block_by_line, the_blocks };
    }
    collect_blocks(the_nodes, block_by_line, the_blocks);
    return { block_by_line, the_blocks };
}

function collect_blocks(
    the_nodes: StataNode[],
    block_by_line: Map<number, BlockBounds>,
    the_blocks: BlockBounds[]
): void {
    for (let i = 0; i < the_nodes.length; i++) {
        const the_chain = [the_nodes[i]];
        if (the_nodes[i].type === 'if') {
            while (the_nodes[i + 1]?.type === 'else') {
                i++;
                the_chain.push(the_nodes[i]);
            }
        }
        const is_block = the_chain.length > 1 ||
            is_closed_block(the_chain[0]);
        if (is_block && the_chain.every(is_complete)) {
            const my_first = the_chain[0].range.start;
            const my_last = the_chain[the_chain.length - 1].range.end;
            const my_bounds: BlockBounds = {
                start_line: my_first.line,
                end_line: my_last.line,
                start: my_first,
                end: my_last,
                header_starts: the_chain.map(my_node => my_node.range.start),
                closer_ends: the_chain.map(my_node => my_node.range.end),
            };
            for (const my_node of the_chain) {
                add_block(block_by_line, my_node.range.start.line, my_bounds);
                add_block(block_by_line, my_node.range.end.line, my_bounds);
            }
            the_blocks.push(my_bounds);
        }
        for (const my_node of the_chain) {
            collect_blocks(
                nested_statements(my_node) ?? [], block_by_line, the_blocks);
        }
    }
}

/** Key `bounds` by `line`, keeping the outer of two blocks there. */
function add_block(
    block_by_line: Map<number, BlockBounds>,
    line: number,
    bounds: BlockBounds
): void {
    const my_old = block_by_line.get(line);
    if (my_old === undefined ||
        bounds.end_line - bounds.start_line >
            my_old.end_line - my_old.start_line) {
        block_by_line.set(line, bounds);
    }
}

/**
 * Is `node`, a member of an `if`/`else` chain, complete: closed with
 * its `}`, or a single command with no braces (`if x di "a"`,
 * `else di "b"`, maybe continued onto the next line)?
 */
function is_complete(node: StataNode): boolean {
    if (node.type === 'if' && node.is_single_statement === true) {
        return true;
    }
    if (node.type === 'else' &&
        (node.is_else_if === true || node.is_single_statement === true)) {
        // `else if ...` is as complete as its `if`.
        const my_first = node.body[0];
        return my_first?.type === 'if'
            ? is_complete(my_first)
            : my_first !== undefined;
    }
    return is_closed_block(node);
}

/**
 * Is `node` a block closed by its own `}` or `end`? The parser ends an
 * unclosed block at the end of the file, or at the `}` of a closed
 * block inside it.
 */
function is_closed_block(node: StataNode): boolean {
    switch (node.type) {
        case 'embedded_block':
            return !node.is_single_line && node.end_command !== undefined;
        case 'program':
            return node.ends_at_embedded_block === true ||
                node.closed_by_end === true;
        case 'command':
            // `input` with its data lines, closed by its `end`
            return node.closed_by_brace === true ||
                node.input_data !== undefined;
        case 'if':
        case 'else':
        case 'foreach':
        case 'forvalues':
        case 'while':
        case 'frame':
            return node.closed_by_brace === true;
        default:
            return false;
    }
}

/**
 * Is `token` a comment on the line where the last `;` statement ended,
 * as in `di "a"; // note`?
 */
function is_trailing_comment(token: Token, closed_line: number): boolean {
    return COMMENT_TOKEN_TYPES.has(token.type) &&
        token.range.start.line === closed_line;
}

// The last reading of each open document and the version it read, so
// repeated sends from an unchanged document (a selection on a long
// file) don't lex it again. VS Code keeps one TextDocument object per
// open document, and its version goes up with every edit.
const THE_READINGS = new WeakMap<
    vscode.TextDocument,
    { version: number; reading: DocumentReading }
>();

/** read_document for `document`, reused while its version holds. */
function read_text_document(document: vscode.TextDocument): DocumentReading {
    const my_version: unknown = document.version;
    if (typeof my_version !== 'number') {
        return read_document(document.getText());
    }
    const my_cached = THE_READINGS.get(document);
    if (my_cached !== undefined && my_cached.version === my_version) {
        return my_cached.reading;
    }
    const my_reading = read_document(document.getText());
    THE_READINGS.set(document, { version: my_version, reading: my_reading });
    return my_reading;
}

/** The lines Stata reads together with the line after them. */
export function find_joined_lines(text: string): Set<number> {
    return read_document(text).joined_lines;
}

/** The delimiter mode in effect at a position in the document. */
export function delimiter_mode_at(
    reading: DocumentReading,
    line: number,
    character: number
): DelimiterMode {
    let my_mode: DelimiterMode = 'cr';
    for (const my_directive of reading.delimit_directives) {
        if (my_directive.line > line ||
            (my_directive.line === line && my_directive.character > character)) {
            break;
        }
        my_mode = my_directive.mode;
    }
    return my_mode;
}

/**
 * The code to send for `code` that starts where `mode` is in effect:
 * under `#delimit ;`, a `#delimit ;` line comes first, since a sent
 * do-file starts under `#delimit cr`.
 */
export function code_for_delimiter(code: string, mode: DelimiterMode): string {
    return mode === 'semicolon' ? DELIMIT_SEMICOLON_LINE + code : code;
}

function find_statement_start(
    joined_lines: ReadonlySet<number>,
    line: number
): number {
    let start_line = line;
    while (start_line > 0 && joined_lines.has(start_line - 1)) {
        start_line--;
    }
    return start_line;
}

function find_statement_end(
    joined_lines: ReadonlySet<number>,
    line: number,
    line_count: number
): number {
    let end_line = line;
    while (end_line < line_count - 1 && joined_lines.has(end_line)) {
        end_line++;
    }
    return end_line;
}

/**
 * The statement the cursor's line is in. On a block's header or
 * closer, that is the whole block: a header alone can't run.
 */
export function statement_bounds(
    reading: DocumentReading,
    line: number,
    line_count: number
): StatementBounds {
    let start_line = find_statement_start(reading.joined_lines, line);
    let end_line = find_statement_end(reading.joined_lines, line, line_count);
    for (let my_line = start_line; my_line <= end_line; my_line++) {
        const my_block = reading.block_by_line.get(my_line);
        if (my_block !== undefined) {
            start_line = Math.min(start_line, my_block.start_line);
            end_line = Math.max(end_line, my_block.end_line);
        }
    }
    return { start_line, end_line };
}

/**
 * From the top to the end of the cursor's statement. If that would
 * leave a block open, it runs on to the block's closer, since a header
 * without its closer can't run.
 */
export function upward_bounds(
    reading: DocumentReading,
    line: number,
    line_count: number
): StatementBounds {
    let end_line = find_statement_end(reading.joined_lines, line, line_count);
    let is_widened = true;
    while (is_widened) {
        is_widened = false;
        for (const my_block of reading.the_blocks) {
            if (my_block.start_line <= end_line &&
                end_line < my_block.end_line) {
                end_line = find_statement_end(
                    reading.joined_lines, my_block.end_line, line_count);
                is_widened = true;
            }
        }
    }
    return { start_line: 0, end_line };
}

/**
 * From the start of the cursor's statement to the end. If that would
 * start inside a block, it starts at the block's header instead, since
 * a closer without its header can't run.
 */
export function downward_bounds(
    reading: DocumentReading,
    line: number,
    line_count: number
): StatementBounds {
    let start_line = find_statement_start(reading.joined_lines, line);
    let is_widened = true;
    while (is_widened) {
        is_widened = false;
        for (const my_block of reading.the_blocks) {
            if (my_block.start_line < start_line &&
                start_line <= my_block.end_line) {
                start_line = find_statement_start(
                    reading.joined_lines, my_block.start_line);
                is_widened = true;
            }
        }
    }
    return { start_line, end_line: line_count - 1 };
}

/** Text the user selected, and where it starts. */
export interface SelectedText {
    text: string;
    line: number;
    character: number;
}

/** The code a send command sends. */
export interface CodeToSend {
    code: string;
    /** The last line of the statement sent, for a statement send. */
    statement_end_line: number | null;
}

/** Negative if `a` comes before `b`, 0 if they are equal. */
function compare_positions(a: Position, b: Position): number {
    return a.line - b.line || a.character - b.character;
}

function earlier(a: Position, b: Position): Position {
    return compare_positions(a, b) <= 0 ? a : b;
}

function later(a: Position, b: Position): Position {
    return compare_positions(a, b) >= 0 ? a : b;
}

/** Is `position` within `range`, its ends included? */
function is_within(
    position: Position,
    range: { start: Position; end: Position }
): boolean {
    return compare_positions(range.start, position) <= 0 &&
        compare_positions(position, range.end) <= 0;
}

/** The `;` statement `position` is in, if any. */
function semicolon_statement_at(
    reading: DocumentReading,
    position: Position
): SemicolonStatement | undefined {
    return reading.semicolon_statements.find(
        my_statement => is_within(position, my_statement));
}

/** Does `statement` close a block (`};`, `} else {;`)? */
function is_closer(
    reading: DocumentReading,
    statement: SemicolonStatement
): boolean {
    return reading.the_blocks.some(my_block => my_block.closer_ends.some(
        my_end => is_within(my_end, statement)));
}

/** The part of the document a send covers, by character. */
interface SendRange {
    start: Position;
    end: Position;
}

/**
 * The cursor's statement under `#delimit ;`, by character, or null if
 * no `;` statement touches `line` (`#delimit cr` code, a blank line).
 *
 * A line can hold the end of one statement and the start of the next
 * (`1; clear;`). The cursor's statements are those that start on its
 * line; a line that starts none (the middle or last line of a
 * statement, or a block's closer alone) sends the statement through
 * it. A block's closer starts no statement: on `}; clear;`, the
 * cursor sends `clear;`. A header or closer in the range brings in its
 * whole block, as statement_bounds does by line.
 */
function semicolon_statement_range(
    reading: DocumentReading,
    line: number
): SendRange | null {
    const the_touching = reading.semicolon_statements.filter(
        my_statement => my_statement.start.line <= line &&
            line <= my_statement.end.line);
    if (the_touching.length === 0) {
        return null;
    }
    const the_starting = the_touching.filter(my_statement =>
        my_statement.start.line === line &&
        !is_closer(reading, my_statement));
    const the_chosen = the_starting.length > 0 ? the_starting : the_touching;
    const my_range: SendRange = {
        start: the_chosen[0].start,
        end: the_chosen[the_chosen.length - 1].end,
    };
    let is_widened = true;
    while (is_widened) {
        is_widened = false;
        for (const my_block of reading.the_blocks) {
            const is_in_range = [
                ...my_block.header_starts, ...my_block.closer_ends,
            ].some(my_edge => is_within(my_edge, my_range));
            if (!is_in_range) {
                continue;
            }
            const my_start = earlier(my_range.start,
                semicolon_statement_at(reading, my_block.start)?.start ??
                    my_block.start);
            const my_end = later(my_range.end,
                semicolon_statement_at(reading, my_block.end)?.end ??
                    my_block.end);
            if (compare_positions(my_start, my_range.start) !== 0 ||
                compare_positions(my_end, my_range.end) !== 0) {
                my_range.start = my_start;
                my_range.end = my_end;
                is_widened = true;
            }
        }
    }
    return my_range;
}

/**
 * From the top to the end of `range`. If that would leave a block
 * open, it runs on to the end of the block's closer.
 */
function upward_range(reading: DocumentReading, range: SendRange): SendRange {
    let my_end = range.end;
    let is_widened = true;
    while (is_widened) {
        is_widened = false;
        for (const my_block of reading.the_blocks) {
            if (compare_positions(my_block.start, my_end) < 0 &&
                compare_positions(my_end, my_block.end) < 0) {
                my_end = semicolon_statement_at(reading, my_block.end)?.end ??
                    my_block.end;
                is_widened = true;
            }
        }
    }
    return { start: { line: 0, character: 0 }, end: my_end };
}

/**
 * From the start of `range` to the end of the document. If that would
 * start inside a block, it starts at the block's header instead.
 */
function downward_range(
    reading: DocumentReading,
    range: SendRange,
    document: vscode.TextDocument
): SendRange {
    let my_start = range.start;
    let is_widened = true;
    while (is_widened) {
        is_widened = false;
        for (const my_block of reading.the_blocks) {
            if (compare_positions(my_block.start, my_start) < 0 &&
                compare_positions(my_start, my_block.end) <= 0) {
                my_start = semicolon_statement_at(
                    reading, my_block.start)?.start ?? my_block.start;
                is_widened = true;
            }
        }
    }
    const my_last_line = document.lineCount - 1;
    return {
        start: my_start,
        end: {
            line: my_last_line,
            character: document.lineAt(my_last_line).text.length,
        },
    };
}

/**
 * Does a `;` statement start on `range`'s last line after it ends? With
 * `is_closer_skipped`, only one Send statement would send from there.
 */
function has_statement_after(
    reading: DocumentReading,
    range: SendRange,
    is_closer_skipped = false
): boolean {
    return reading.semicolon_statements.some(my_statement =>
        my_statement.start.line === range.end.line &&
        compare_positions(my_statement.start, range.end) >= 0 &&
        !(is_closer_skipped && is_closer(reading, my_statement)));
}

/**
 * The text of `range`, widened to whole lines where that brings in no
 * other statement: indentation before its start, and a comment after
 * its last `;`, are sent with it.
 */
function get_range_text(
    document: vscode.TextDocument,
    reading: DocumentReading,
    range: SendRange
): string {
    const the_lines: string[] = [];
    for (let my_line = range.start.line; my_line <= range.end.line;
        my_line++) {
        the_lines.push(document.lineAt(my_line).text);
    }
    const my_last = the_lines.length - 1;
    if (has_statement_after(reading, range)) {
        the_lines[my_last] =
            the_lines[my_last].slice(0, range.end.character);
    }
    const my_before = the_lines[0].slice(0, range.start.character);
    if (my_before.trim() !== '') {
        the_lines[0] = the_lines[0].slice(range.start.character);
    }
    return the_lines.join('\n');
}

/**
 * The code to send for the cursor's statement (or `selection`), the
 * lines up to the end of the statement, or the lines from its start.
 * Code that starts in a `#delimit ;` region gets a `#delimit ;` line
 * first, so Stata reads it as the document does.
 *
 * Under `#delimit ;`, the cursor's statement is cut from the lines it
 * shares with other statements (see semicolon_statement_range), and
 * Send Upward and Downward Lines end and start where it does. If its
 * last line holds the next statement, the cursor stays on that line.
 */
export function find_code_to_send(
    document: vscode.TextDocument,
    mode: 'statement' | 'upward' | 'downward',
    cursor_line: number,
    selection: SelectedText | null
): CodeToSend {
    const reading = read_text_document(document);
    if (mode === 'statement' && selection !== null) {
        return {
            code: code_for_delimiter(selection.text, delimiter_mode_at(
                reading, selection.line, selection.character)),
            statement_end_line: null,
        };
    }
    const my_statement = semicolon_statement_range(reading, cursor_line);
    if (my_statement !== null) {
        let my_range = my_statement;
        if (mode === 'upward') {
            my_range = upward_range(reading, my_statement);
        } else if (mode === 'downward') {
            my_range = downward_range(reading, my_statement, document);
        }
        let my_end_line: number | null = null;
        if (mode === 'statement') {
            my_end_line = has_statement_after(reading, my_range, true)
                ? Math.max(cursor_line, my_range.end.line - 1)
                : my_range.end.line;
        }
        return {
            code: code_for_delimiter(
                get_range_text(document, reading, my_range),
                delimiter_mode_at(reading, my_range.start.line,
                    my_range.start.character)),
            statement_end_line: my_end_line,
        };
    }
    let find_bounds = statement_bounds;
    if (mode === 'upward') {
        find_bounds = upward_bounds;
    } else if (mode === 'downward') {
        find_bounds = downward_bounds;
    }
    const bounds = find_bounds(reading, cursor_line, document.lineCount);
    return {
        code: code_for_delimiter(
            get_statement_text(document, bounds),
            delimiter_mode_at(reading, bounds.start_line, 0)),
        statement_end_line: mode === 'statement' ? bounds.end_line : null,
    };
}

export function detect_statement(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    return statement_bounds(
        read_text_document(document), line, document.lineCount);
}

export function get_upward_bounds(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    return upward_bounds(
        read_text_document(document), line, document.lineCount);
}

export function get_downward_bounds(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    return downward_bounds(
        read_text_document(document), line, document.lineCount);
}

export function get_statement_text(
    document: vscode.TextDocument,
    bounds: StatementBounds
): string {
    const lines: string[] = [];
    for (let my_line = bounds.start_line; my_line <= bounds.end_line; my_line++) {
        lines.push(document.lineAt(my_line).text);
    }
    return lines.join('\n');
}
