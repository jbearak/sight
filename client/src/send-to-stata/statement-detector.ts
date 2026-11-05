import * as vscode from 'vscode';
import { StataLexer } from '../../../src/lexer/index.js';
import { StataParser } from '../../../src/parser/index.js';
import {
    SemicolonStatementTracker,
    delimit_directive_mode,
} from '../../../src/utils/semicolon-statement.js';
import type {
    StataNode,
    Token,
    TokenType,
} from '../../../src/types/index.js';
import type { Position } from 'vscode-languageserver-textdocument';

export interface StatementBounds {
    start_line: number;  // 0-indexed, inclusive
    end_line: number;    // 0-indexed, inclusive
}

export type DelimiterMode = 'cr' | 'semicolon';

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
    block_by_line: Map<number, StatementBounds>;
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
        block_by_line: find_blocks(the_tokens),
    };
}

/**
 * The lines of each closed block in the parsed document, keyed by the
 * lines of its headers and closers: `foreach`, `forvalues`, `while`,
 * `if`, `else`, and `frame` blocks, a prefix's brace block
 * (`capture {`), a program, and a `mata` or `python` block.
 *
 * An `if` and the `else` nodes right after it are one chain: Stata runs
 * an `else` sent on its own even after a true `if`, so they are sent
 * together. That holds for `if x di "a"` / `else di "b"` too.
 */
function find_blocks(the_tokens: Token[]): Map<number, StatementBounds> {
    const block_by_line = new Map<number, StatementBounds>();
    let the_nodes: StataNode[];
    try {
        the_nodes = new StataParser().parse(the_tokens).ast.nodes;
    } catch {
        // Without blocks, Send statement sends the header's lines.
        return block_by_line;
    }
    collect_blocks(the_nodes, find_closers(the_tokens), block_by_line);
    return block_by_line;
}

/** A `{` token, and where its matching `}` ends, if it has one. */
interface BraceOpen {
    start: Position;
    close_end: Position | null;
}

/** The tokens that close blocks, from the lexer. */
interface BlockClosers {
    /** Each `{` outside a mata or python block, in order. */
    the_opens: BraceOpen[];
    /** Where each `end` that starts a statement ends. */
    end_word_ends: Set<string>;
}

function position_key(position: Position): string {
    return `${position.line}:${position.character}`;
}

function is_before(a: Position, b: Position): boolean {
    return a.line < b.line || (a.line === b.line && a.character < b.character);
}

function find_closers(the_tokens: Token[]): BlockClosers {
    const the_opens: BraceOpen[] = [];
    const end_word_ends = new Set<string>();
    const the_open_stack: BraceOpen[] = [];
    let is_in_embedded_block = false;
    let previous: Token | undefined;
    for (const my_token of the_tokens) {
        switch (my_token.type) {
            case 'MATA_START':
            case 'PYTHON_START':
                is_in_embedded_block = true;
                break;
            case 'END_MATA':
            case 'END_PYTHON':
                is_in_embedded_block = false;
                break;
            case 'LBRACE':
                if (!is_in_embedded_block) {
                    const my_open = {
                        start: my_token.range.start, close_end: null,
                    };
                    the_opens.push(my_open);
                    the_open_stack.push(my_open);
                }
                break;
            case 'RBRACE': {
                const my_open = is_in_embedded_block
                    ? undefined
                    : the_open_stack.pop();
                if (my_open !== undefined) {
                    my_open.close_end = my_token.range.end;
                }
                break;
            }
            case 'WORD':
                if (my_token.value === 'end' &&
                    (previous === undefined ||
                        previous.type === 'STATEMENT_TERMINATOR')) {
                    end_word_ends.add(position_key(my_token.range.end));
                }
                break;
        }
        if (my_token.type !== 'WHITESPACE' &&
            my_token.type !== 'COMMENT_BLOCK') {
            previous = my_token;
        }
    }
    return { the_opens, end_word_ends };
}

/** The first `{` at or after `position`. */
function find_open_after(
    closers: BlockClosers,
    position: Position
): BraceOpen | undefined {
    const the_opens = closers.the_opens;
    let low = 0;
    let high = the_opens.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (is_before(the_opens[middle].start, position)) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return the_opens[low];
}

function collect_blocks(
    the_nodes: StataNode[],
    closers: BlockClosers,
    block_by_line: Map<number, StatementBounds>
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
            is_closed_block(the_chain[0], closers);
        if (is_block && the_chain.every((my_node) =>
            is_complete(my_node, closers))) {
            const my_bounds = {
                start_line: the_chain[0].range.start.line,
                end_line: the_chain[the_chain.length - 1].range.end.line,
            };
            for (const my_node of the_chain) {
                add_block(block_by_line, my_node.range.start.line, my_bounds);
                add_block(block_by_line, my_node.range.end.line, my_bounds);
            }
        }
        for (const my_node of the_chain) {
            collect_blocks(node_body(my_node), closers, block_by_line);
        }
    }
}

/** Key `bounds` by `line`, keeping the outer of two blocks there. */
function add_block(
    block_by_line: Map<number, StatementBounds>,
    line: number,
    bounds: StatementBounds
): void {
    const my_old = block_by_line.get(line);
    if (my_old === undefined ||
        bounds.end_line - bounds.start_line >
            my_old.end_line - my_old.start_line) {
        block_by_line.set(line, bounds);
    }
}

function node_body(node: StataNode): StataNode[] {
    switch (node.type) {
        case 'program':
        case 'if':
        case 'else':
        case 'foreach':
        case 'forvalues':
        case 'while':
        case 'frame':
            return node.body;
        case 'command':
            return node.body ?? [];
        default:
            return [];
    }
}

/**
 * Is `node`, a member of an `if`/`else` chain, complete: closed with
 * its `}`, or a single command with no braces (`if x di "a"`,
 * `else di "b"`, maybe continued onto the next line)?
 */
function is_complete(node: StataNode, closers: BlockClosers): boolean {
    if (node.type === 'if' && node.is_single_statement === true) {
        return true;
    }
    if (node.type === 'else') {
        // A brace `else` has its `{` before its body.
        const my_first = node.body[0];
        const my_open = find_open_after(closers, node.range.start);
        const is_brace_else = my_open !== undefined &&
            is_before(my_open.start, node.range.end) &&
            (my_first === undefined ||
                is_before(my_open.start, my_first.range.start));
        if (!is_brace_else) {
            // `else if ...` is as complete as its `if`.
            return my_first?.type === 'if'
                ? is_complete(my_first, closers)
                : my_first !== undefined;
        }
    }
    return is_closed_block(node, closers);
}

/**
 * Is `node` a block closed by its own `}` or `end`? The parser ends an
 * unclosed block at the end of the file, or at the `}` of a closed
 * block inside it.
 */
function is_closed_block(node: StataNode, closers: BlockClosers): boolean {
    switch (node.type) {
        case 'embedded_block':
            return !node.is_single_line && node.end_command !== undefined;
        case 'program':
            return node.ends_at_embedded_block === true ||
                closers.end_word_ends.has(position_key(node.range.end));
        case 'if':
        case 'else':
        case 'foreach':
        case 'forvalues':
        case 'while':
        case 'frame':
            return node.is_single_statement !== true &&
                node.closed_by_program_end !== true &&
                is_closed_by_own_brace(node.range, closers);
        case 'command':
            return node.body !== undefined &&
                node.closed_by_program_end !== true &&
                is_closed_by_own_brace(node.range, closers);
        default:
            return false;
    }
}

/** Does the block's first `{` have its `}` at the end of the block? */
function is_closed_by_own_brace(
    range: { start: Position; end: Position },
    closers: BlockClosers
): boolean {
    const my_open = find_open_after(closers, range.start);
    return my_open !== undefined && my_open.close_end !== null &&
        position_key(my_open.close_end) === position_key(range.end);
}

/**
 * Is `token` a comment on the line where the last `;` statement ended,
 * as in `di "a"; // note`?
 */
function is_trailing_comment(token: Token, closed_line: number): boolean {
    return COMMENT_TOKEN_TYPES.has(token.type) &&
        token.range.start.line === closed_line;
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

/** From the top to the end of the cursor's statement. */
export function upward_bounds(
    reading: DocumentReading,
    line: number,
    line_count: number
): StatementBounds {
    return {
        start_line: 0,
        end_line: find_statement_end(reading.joined_lines, line, line_count),
    };
}

/** From the start of the cursor's statement to the end. */
export function downward_bounds(
    reading: DocumentReading,
    line: number,
    line_count: number
): StatementBounds {
    return {
        start_line: find_statement_start(reading.joined_lines, line),
        end_line: line_count - 1,
    };
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

/**
 * The code to send for the cursor's statement (or `selection`), the
 * lines up to the end of the statement, or the lines from its start.
 * Code that starts in a `#delimit ;` region gets a `#delimit ;` line
 * first, so Stata reads it as the document does.
 */
export function find_code_to_send(
    document: vscode.TextDocument,
    mode: 'statement' | 'upward' | 'downward',
    cursor_line: number,
    selection: SelectedText | null
): CodeToSend {
    const reading = read_document(document.getText());
    if (mode === 'statement' && selection !== null) {
        return {
            code: code_for_delimiter(selection.text, delimiter_mode_at(
                reading, selection.line, selection.character)),
            statement_end_line: null,
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
        read_document(document.getText()), line, document.lineCount);
}

export function get_upward_bounds(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    return upward_bounds(
        read_document(document.getText()), line, document.lineCount);
}

export function get_downward_bounds(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    return downward_bounds(
        read_document(document.getText()), line, document.lineCount);
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
