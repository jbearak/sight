import * as vscode from 'vscode';
import { StatementBounds } from './index';

export function ends_with_continuation(line: string): boolean {
    return line.trimEnd().endsWith('///');
}

export function detect_statement(
    document: vscode.TextDocument, 
    line: number
): StatementBounds {
    let start_line = line;
    let end_line = line;
    
    // Search backwards for statement start
    while (start_line > 0) {
        const prev_line = document.lineAt(start_line - 1).text;
        if (!ends_with_continuation(prev_line)) {
            break;
        }
        start_line--;
    }
    
    // Search forwards for statement end
    while (end_line < document.lineCount - 1) {
        const current_line = document.lineAt(end_line).text;
        if (!ends_with_continuation(current_line)) {
            break;
        }
        end_line++;
    }
    
    return { start_line, end_line };
}

export function get_upward_bounds(
    document: vscode.TextDocument, 
    line: number
): StatementBounds {
    let end_line = line;
    
    // If cursor line has continuation, extend to include complete statement
    while (end_line < document.lineCount - 1) {
        const current_line = document.lineAt(end_line).text;
        if (!ends_with_continuation(current_line)) {
            break;
        }
        end_line++;
    }
    
    return { start_line: 0, end_line };
}

export function get_downward_bounds(
    document: vscode.TextDocument, 
    line: number
): StatementBounds {
    let start_line = line;
    
    // If cursor is on a continuation line, find statement start
    while (start_line > 0) {
        const prev_line = document.lineAt(start_line - 1).text;
        if (!ends_with_continuation(prev_line)) {
            break;
        }
        start_line--;
    }
    
    return { start_line, end_line: document.lineCount - 1 };
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