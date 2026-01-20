/**
 * Core logic for cursor advancement after send-to-stata operations.
 * This module contains pure functions that can be tested without VS Code dependencies.
 */

export interface CursorAdvanceContext {
    /** Whether cursor should advance after send */
    should_advance: boolean;
    /** The line to advance to (0-indexed), or null if no advancement */
    next_line: number | null;
}

export interface CursorAdvanceResult {
    /** The new cursor line (0-indexed) */
    line: number;
    /** The new cursor column (always 0) */
    column: number;
}

/**
 * Determines whether cursor should advance based on send context.
 * @param mode - The send mode ('statement', 'upward', 'downward', 'file')
 * @param has_selection - Whether the editor has an active selection
 * @param statement_end_line - The end line of the statement (0-indexed), if applicable
 * @returns Context indicating whether and where to advance
 */
export function compute_cursor_advance_context(
    mode: 'statement' | 'upward' | 'downward' | 'file',
    has_selection: boolean,
    statement_end_line: number | null
): CursorAdvanceContext {
    // Only advance for statement mode without selection
    if (mode !== 'statement' || has_selection || statement_end_line === null) {
        return { should_advance: false, next_line: null };
    }
    
    return {
        should_advance: true,
        next_line: statement_end_line + 1
    };
}

/**
 * Computes the new cursor position after advancement.
 * @param next_line - The target line (0-indexed)
 * @param document_line_count - Total lines in the document
 * @param setting_enabled - Whether advanceCursorOnSend setting is enabled
 * @returns The new cursor position, or null if no advancement should occur
 */
export function compute_cursor_position(
    next_line: number,
    document_line_count: number,
    setting_enabled: boolean
): CursorAdvanceResult | null {
    if (!setting_enabled) {
        return null;
    }
    
    if (next_line >= document_line_count) {
        return null;
    }
    
    return { line: next_line, column: 0 };
}
