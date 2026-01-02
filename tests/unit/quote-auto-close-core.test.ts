import { describe, expect, it } from 'bun:test';
import { compute_quote_auto_close } from '../../client/src/quote-auto-close-core';

/**
 * Simulates typing a character and applying the auto-close logic.
 * 
 * The new interface assumes the typed character is ALREADY inserted into the document
 * (as happens with onDidChangeTextDocument). So we:
 * 1. Insert the typed character at the cursor position
 * 2. Call compute_quote_auto_close with the new state
 * 3. Delete any characters specified by delete_before (from before cursor)
 * 4. Delete any characters specified by delete_after (from after cursor)
 * 5. Insert any additional text returned by the function
 * 6. Position the cursor based on cursor_offset
 */
function apply_type_to_marked(the_input_with_cursor: string, my_typed: string): string {
    const my_cursor_index = the_input_with_cursor.indexOf('|');
    if (my_cursor_index < 0) {
        throw new Error('input must contain a single | cursor marker');
    }

    const my_original_before = the_input_with_cursor.slice(0, my_cursor_index);
    const my_original_after = the_input_with_cursor.slice(my_cursor_index + 1);

    // Simulate the typed character being inserted (as VS Code does before onDidChangeTextDocument fires)
    const my_before_with_typed = my_original_before + my_typed;
    const my_after = my_original_after;

    const my_result = compute_quote_auto_close(my_typed, my_before_with_typed, my_after);
    if (!my_result.handled) {
        // No auto-close: just the typed character at cursor
        return my_before_with_typed + '|' + my_after;
    }

    // Apply delete_before: remove characters from the end of my_before_with_typed
    const my_before_trimmed = my_before_with_typed.slice(0, my_before_with_typed.length - my_result.delete_before);
    
    // Apply delete_after: remove characters from the start of my_after
    const my_after_trimmed = my_after.slice(my_result.delete_after);
    
    // Insert the additional text and position cursor
    const my_insert_text = my_result.insert_text;
    const my_cursor_offset = my_result.cursor_offset;
    
    // The cursor is at the end of my_before_trimmed, we insert insert_text there
    // cursor_offset is relative to the insertion point (0 = cursor stays at insertion point)
    const my_new_text = my_before_trimmed + my_insert_text + my_after_trimmed;
    const my_cursor_pos = my_before_trimmed.length + my_cursor_offset;
    
    return my_new_text.slice(0, my_cursor_pos) + '|' + my_new_text.slice(my_cursor_pos);
}

describe('quote-auto-close-core', () => {
    it('Req 3: nested local macro: `|\' + ` -> ``|\'\'', () => {
        expect(apply_type_to_marked('`|\'', '`')).toBe('``|\'\'');
    });

    it('Req 5: compound string: `|\' + " -> `"|"\'', () => {
        expect(apply_type_to_marked('`|\'', '"')).toBe('`"|"\'');
    });

    it('Req 6: nested compound string: `|\'"\' + " -> `"|"\'"\'', () => {
        // This is the transient state after typing backtick inside an existing compound string.
        expect(apply_type_to_marked("`|'\"'", '"')).toBe("`\"|\"'\"'");
    });

    it('Req 7: local macro inside compound string: `"`|"\' + ` -> `"``|\'"\'', () => {
        // Cursor is right before the existing compound close "'
        expect(apply_type_to_marked('`"`|"\'', '`')).toBe('`"``|\'"\'');
    });

    it('Req 8: local macro inside double quotes: "`|" + ` -> "``|\'"', () => {
        expect(apply_type_to_marked('"`|"', '`')).toBe('"``|\'"');
    });

    it('Req 9.4: standalone double quote: " -> "|"', () => {
        expect(apply_type_to_marked('|', '"')).toBe('"|"');
    });

    // Skip-over tests
    it('skip-over: typing \' when before \' skips over it', () => {
        // User types `macro_name' - the ' should skip over the auto-inserted '
        expect(apply_type_to_marked('`macro_name|\'', '\'')).toBe('`macro_name\'|');
    });

    it('skip-over: typing " when before " skips over it', () => {
        // User types "string" - the " should skip over the auto-inserted "
        expect(apply_type_to_marked('"string|"', '"')).toBe('"string"|');
    });

    it('skip-over: typing \' when before "\' skips over both', () => {
        // User types `"string"' - the ' should skip over the "'
        expect(apply_type_to_marked('`"string|"\'', '\'')).toBe('`"string"\'|');
    });
});
