import * as vscode from 'vscode';
import { StataLexer } from '../../../src/lexer/index.js';

export interface StatementBounds {
    start_line: number;  // 0-indexed, inclusive
    end_line: number;    // 0-indexed, inclusive
}

/**
 * The lines (0-indexed) that Stata reads together with the line after
 * them, so both belong to one statement. It reads `text` with Sight's
 * lexer, so it follows the language server's rules for `//` and `///`:
 *
 * - A `///` with a space or tab before it, or at the start of a line,
 *   joins the next line, with or without a note after it
 *   (`reg y x /// note`). A `///` with code right before it
 *   (`local a b///`) is text, and the next line is its own command.
 * - A `///` in a string, a block comment, or a `//` comment doesn't
 *   join anything.
 * - A `///` line that starts a statement is a comment, and Stata reads
 *   the next line with it.
 * - A token that spans lines, such as a block comment or a `*` comment
 *   continued with `///`, keeps those lines together.
 *
 * Statements under `#delimit ;` end at their `;`. This doesn't follow
 * that; it joins only the lines Stata would join under `#delimit cr`.
 */
export function find_joined_lines(text: string): Set<number> {
    const joined_lines = new Set<number>();
    const the_tokens = new StataLexer().tokenize(text).tokens;
    for (const my_token of the_tokens) {
        const start_line = my_token.range.start.line;
        if (my_token.type === 'CONTINUATION') {
            joined_lines.add(start_line);
        } else if (my_token.type === 'COMMENT_LINE' &&
            my_token.value.startsWith('///')) {
            joined_lines.add(my_token.range.end.line);
        }
        // A `\n` terminator's range ends on the next line; it doesn't
        // join anything.
        if (my_token.type !== 'STATEMENT_TERMINATOR') {
            for (let my_line = start_line;
                my_line < my_token.range.end.line; my_line++) {
                joined_lines.add(my_line);
            }
        }
    }
    return joined_lines;
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

export function detect_statement(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    const joined_lines = find_joined_lines(document.getText());
    return {
        start_line: find_statement_start(joined_lines, line),
        end_line: find_statement_end(joined_lines, line, document.lineCount),
    };
}

export function get_upward_bounds(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    // Extend to the end of the statement the cursor is in.
    const joined_lines = find_joined_lines(document.getText());
    return {
        start_line: 0,
        end_line: find_statement_end(joined_lines, line, document.lineCount),
    };
}

export function get_downward_bounds(
    document: vscode.TextDocument,
    line: number
): StatementBounds {
    // Start at the start of the statement the cursor is in.
    const joined_lines = find_joined_lines(document.getText());
    return {
        start_line: find_statement_start(joined_lines, line),
        end_line: document.lineCount - 1,
    };
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
