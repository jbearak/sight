import * as vscode from 'vscode';
import { StataLexer } from '../../../src/lexer/index.js';
import {
    SemicolonStatementTracker,
    delimit_directive_mode,
} from '../../../src/utils/semicolon-statement.js';
import type { Token, TokenType } from '../../../src/types/index.js';

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
    return { joined_lines, delimit_directives };
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

/** The statement the cursor's line is in. */
export function statement_bounds(
    reading: DocumentReading,
    line: number,
    line_count: number
): StatementBounds {
    return {
        start_line: find_statement_start(reading.joined_lines, line),
        end_line: find_statement_end(reading.joined_lines, line, line_count),
    };
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
