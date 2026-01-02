export interface QuoteAutoCloseResult {
    handled: boolean;
    // Text to insert after the cursor position (after the typed character is already inserted)
    insert_text: string;
    // Number of characters to delete before cursor (for skip-over behavior)
    delete_before: number;
    // Number of characters to delete after cursor before inserting (for transformations)
    delete_after: number;
    // Cursor offset from the insertion point (0 = cursor stays at insertion point)
    cursor_offset: number;
}

/**
 * Computes what text to insert after a character is typed for Stata quote auto-closing.
 * 
 * This function is designed for the onDidChangeTextDocument approach where the typed
 * character is ALREADY inserted into the document. We determine what closing characters
 * to insert after the cursor, and optionally how many characters to delete first.
 * 
 * @param my_typed - The character that was just typed (already in document)
 * @param my_before - Text before the cursor (includes the typed character)
 * @param my_after - Text after the cursor
 * @returns Result indicating what to insert, what to delete, and where to place cursor
 */
export function compute_quote_auto_close(
    my_typed: string,
    my_before: string,
    my_after: string
): QuoteAutoCloseResult {
    // Apostrophe handling (') - skip-over behavior for closing characters
    if (my_typed === "'") {
        // Skip-over: typing ' when cursor is before "' (compound string close)
        // State after typing: before ends with ', after starts with "'
        // We want to delete the typed ' and move cursor past the existing "'
        if (my_after.startsWith("\"'")) {
            return {
                handled: true,
                insert_text: '',
                delete_before: 1, // Delete the typed '
                delete_after: 0,
                cursor_offset: 2, // Move cursor past "'
            };
        }

        // Skip-over: typing ' when cursor is before '
        // State after typing: before ends with ', after starts with '
        // We want to delete the typed ' and move cursor past the existing '
        if (my_after.startsWith("'")) {
            return {
                handled: true,
                insert_text: '',
                delete_before: 1, // Delete the typed '
                delete_after: 0,
                cursor_offset: 1, // Move cursor past '
            };
        }

        return { handled: false, insert_text: '', delete_before: 0, delete_after: 0, cursor_offset: 0 };
    }

    // Backtick handling (`)
    if (my_typed === '`') {
        // Req 3: second backtick typed - we now have `` and need to transform `' to ''
        // Before ends with `` (the two backticks) and after starts with ' (from first backtick's close)
        if (my_before.endsWith('``') && my_after.startsWith("'")) {
            // Need to insert another ' to make ''
            return {
                handled: true,
                insert_text: "'",
                delete_before: 0,
                delete_after: 0,
                cursor_offset: 0,
            };
        }

        // Only handle complex nested cases that VS Code can't handle
        // Let VS Code handle all simple ` → `' cases (including inside strings)
        if (my_before.endsWith('`') && my_after.startsWith("'")) {
            // Nested backticks: `` → ```
            return {
                handled: true,
                insert_text: "'",
                delete_before: 0,
                delete_after: 0,
                cursor_offset: 0,
            };
        }
        
        if (my_before.endsWith('`') && my_after.startsWith("\"'")) {
            // Local macro inside compound string
            return {
                handled: true,
                insert_text: "'",
                delete_before: 0,
                delete_after: 0,
                cursor_offset: 0,
            };
        }

        if (my_before.endsWith('`') && my_after.startsWith('"')) {
            // Local macro inside double-quoted string  
            return {
                handled: true,
                insert_text: "'",
                delete_before: 0,
                delete_after: 0,
                cursor_offset: 0,
            };
        }
        
        // Let VS Code handle all other ` cases
        return { handled: false, insert_text: '', delete_before: 0, delete_after: 0, cursor_offset: 0 };
    }

    // Double quote handling (")
    if (my_typed === '"') {
        // Req 6: nested compound string
        // After typing " inside compound string, before ends with `" and after has '"' pattern
        // The state is: `"| where after is '"' (apostrophe from inner, then outer close "')
        if (my_before.endsWith('`"') && my_after.startsWith("'\"'")) {
            // Delete the ' and replace with "' for proper nesting
            return {
                handled: true,
                insert_text: "\"'",
                delete_before: 0,
                delete_after: 1, // Delete the existing '
                cursor_offset: 0,
            };
        }

        // Req 5: compound string open - before ends with `" (backtick then quote just typed)
        // and after starts with ' (from the backtick's auto-close)
        if (my_before.endsWith('`"') && my_after.startsWith("'")) {
            // Delete the ' and replace with "' for compound string close
            return {
                handled: true,
                insert_text: "\"'",
                delete_before: 0,
                delete_after: 1, // Delete the existing '
                cursor_offset: 0,
            };
        }

        // Skip-over: typing " when cursor is before " (closing a string)
        // State after typing: before ends with ", after starts with "
        // We want to delete the typed " and move cursor past the existing "
        if (my_after.startsWith('"')) {
            return {
                handled: true,
                insert_text: '',
                delete_before: 1, // Delete the typed "
                delete_after: 0,
                cursor_offset: 1, // Move cursor past "
            };
        }

        // Req 9.4: standalone double quote - insert closing quote
        return {
            handled: true,
            insert_text: '"',
            delete_before: 0,
            delete_after: 0,
            cursor_offset: 0,
        };
    }

    return { handled: false, insert_text: '', delete_before: 0, delete_after: 0, cursor_offset: 0 };
}


/**
 * Determines how many closing characters to delete after a character deletion.
 * 
 * Simplified rules:
 * - Backtick deleted + apostrophe to right → delete the apostrophe
 * - Double quote deleted + double quote to right → delete the double quote
 * - Apostrophe deleted → do nothing
 * - Any other character deleted → do nothing
 * 
 * @param my_deleted_char - The character that was just deleted
 * @param my_char_to_right - The character immediately to the right of the cursor (or empty string)
 * @returns Number of characters to delete (0 or 1)
 */
export function compute_deletion_cleanup(my_deleted_char: string, my_char_to_right: string): number {
    // Rule 1: Backtick deleted + apostrophe to right → delete the apostrophe
    if (my_deleted_char === '`' && my_char_to_right === "'") {
        return 1;
    }
    
    // Rule 2: Double quote deleted + double quote to right → delete the double quote
    if (my_deleted_char === '"' && my_char_to_right === '"') {
        return 1;
    }
    
    // All other cases: no cleanup needed
    return 0;
}
