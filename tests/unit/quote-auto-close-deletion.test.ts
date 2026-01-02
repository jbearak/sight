import { describe, expect, it } from 'bun:test';
import { compute_deletion_cleanup } from '../../client/src/quote-auto-close-core';

/**
 * Simulates backspacing a character and applying deletion cleanup logic.
 * 
 * @param input_with_cursor - String with | marking cursor position
 * @returns String after backspace and cleanup, with | marking new cursor position
 */
function apply_backspace_to_marked(input_with_cursor: string): string {
    const cursor_index = input_with_cursor.indexOf('|');
    if (cursor_index < 0) {
        throw new Error('input must contain a single | cursor marker');
    }
    
    if (cursor_index === 0) {
        // Can't backspace at start of string
        return input_with_cursor;
    }
    
    // Get the character being deleted (before cursor)
    const deleted_char = input_with_cursor[cursor_index - 1];
    
    // Simulate backspace: remove character before cursor
    const before_deletion = input_with_cursor.slice(0, cursor_index - 1);
    const after_cursor = input_with_cursor.slice(cursor_index + 1);
    
    // Get the character to the right of cursor (first char after cursor marker)
    const char_to_right = after_cursor.length > 0 ? after_cursor[0] : '';
    
    // Apply deletion cleanup logic using the simplified function
    const chars_to_delete = compute_deletion_cleanup(deleted_char, char_to_right);
    const after_cleanup = after_cursor.slice(chars_to_delete);
    
    return before_deletion + '|' + after_cleanup;
}

describe('quote-auto-close deletion', () => {
    /**
     * These tests verify the SIMPLIFIED deletion cleanup rules:
     * 1. Backtick deleted + apostrophe to right → delete apostrophe
     * 2. Double quote deleted + double quote to right → delete double quote
     * 3. Everything else → do nothing
     */
    
    describe('basic patterns', () => {
        it('` → (empty): backspace ` should delete \'', () => {
            expect(apply_backspace_to_marked('`|\''))
                .toBe('|');
        });
        
        it('" → (empty): backspace " should delete "', () => {
            expect(apply_backspace_to_marked('"|"'))
                .toBe('|');
        });
    });
    
    describe('nested patterns', () => {
        it('`` → `: backspace second ` should delete one \'', () => {
            // Deleting ` with ' to the right → delete the '
            expect(apply_backspace_to_marked('``|\'\''))
                .toBe('`|\'');
        });
        
        it('``` → ``: backspace third ` should delete one \'', () => {
            // Deleting ` with ' to the right → delete the '
            expect(apply_backspace_to_marked('```|\'\'\''))
                .toBe('``|\'\'');
        });
    });
    
    describe('compound patterns', () => {
        it('`" → `: backspace " should delete " (quote to right)', () => {
            // Deleting " with " to the right → delete the "
            // Note: The old behavior deleted "' but new simplified behavior only deletes "
            expect(apply_backspace_to_marked('`"|"\''))
                .toBe('`|\'');
        });
        
        it('local macro inside compound string deletion - simplified', () => {
            // `"``|'"' → deleting ` with ' to right → delete '
            expect(apply_backspace_to_marked('`"``|\'"\''))
                .toBe('`"`|"\'');
        });
        
        it('local macro inside double quotes deletion - simplified', () => {
            // "``|'" → deleting ` with ' to right → delete '
            expect(apply_backspace_to_marked('"``|\'"'))
                .toBe('"`|"');
        });
    });
    
    describe('sequential deletion scenarios', () => {
        it('triple backtick full sequence: ``` → `` → ` → (empty)', () => {
            // Start: ```|'''
            let state = '```|\'\'\'';
            
            // First backspace: ``` → `` (delete ` and ')
            state = apply_backspace_to_marked(state);
            expect(state).toBe('``|\'\'');
            
            // Second backspace: `` → ` (delete ` and ')
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`|\'');
            
            // Third backspace: ` → (empty) (delete ` and ')
            state = apply_backspace_to_marked(state);
            expect(state).toBe('|');
        });
        
        it('compound string sequence: `" → ` → (empty)', () => {
            // Start: `"|"'
            let state = '`"|"\'';
            
            // First backspace: `" → ` (delete " and ")
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`|\'');
            
            // Second backspace: ` → (empty) (delete ` and ')
            state = apply_backspace_to_marked(state);
            expect(state).toBe('|');
        });
    });
    
    describe('edge cases - simplified behavior', () => {
        it('should not delete when deleting content (not delimiter)', () => {
            // Deleting 'a' (not a delimiter) → no cleanup
            expect(apply_backspace_to_marked('`ma|cro\''))
                .toBe('`m|cro\'');
        });
        
        it('should not delete when deleting content inside macro', () => {
            // di `a|' → di `|' (just delete the 'a', keep the ')
            expect(apply_backspace_to_marked('di `a|\''))
                .toBe('di `|\'');
        });
        
        it('should not delete closing marks when deleting content inside nested compound string', () => {
            // di `"`a|'"' → di `"`|'"' (just delete the 'a', keep the '"')
            expect(apply_backspace_to_marked('di `"`a|\'"\''))
                .toBe('di `"`|\'"\'');
        });
        
        it('should handle spaced content correctly: di `\' → di ', () => {
            // Start: di `|'
            let state = 'di `|\'';
            
            // First backspace: ` with ' to right → delete both
            state = apply_backspace_to_marked(state);
            expect(state).toBe('di |');
            
            // Second backspace: space → just delete space
            state = apply_backspace_to_marked(state);
            expect(state).toBe('di|');
        });
        
        it('compound string backspace should leave opener: di `"|"\' → di `\'', () => {
            // Start: di `"|"'
            let state = 'di `"|"\'';
            
            // Backspace the " with " to right → delete both "
            state = apply_backspace_to_marked(state);
            expect(state).toBe('di `|\'');
        });
        
        it('nested compound string backspace: revert to compound string', () => {
            // Start: `"`|'"'
            // Deleting ` with ' to right → delete '
            let state = '`"`|\'"\'';
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`"|"\'');
        });
        
        it('nested compound string with content: should revert properly', () => {
            // Start: di `"`|'"'
            // Deleting ` with ' to right → delete '
            let state = 'di `"`|\'"\'';
            state = apply_backspace_to_marked(state);
            expect(state).toBe('di `"|"\'');
        });
        
        it('multiple backticks with content: simplified behavior', () => {
            // Start: `a`b`c|'
            let state = '`a`b`c|\'';
            
            // First backspace: c (not a delimiter) → no cleanup
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`a`b`|\'');
            
            // Second backspace: ` with ' to right → delete '
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`a`b|');
            
            // Third backspace: b (not a delimiter) → no cleanup
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`a`|');
            
            // Fourth backspace: ` with nothing to right → no cleanup
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`a|');
            
            // Fifth backspace: a (not a delimiter) → no cleanup
            state = apply_backspace_to_marked(state);
            expect(state).toBe('`|');
        });
    });
});


describe('Requirement 4: Compound String Cleanup Example', () => {
    /**
     * This test verifies the exact example from Requirement 4:
     * 
     * User types: `"a`"b
     * Result: `"a`"b|"'"' (where | is cursor)
     * 
     * Then backspacing through:
     * 1. Delete "b" → `"a`"|"'"' (no cleanup - 'b' is not a delimiter)
     * 2. Delete " → `"a`"|'"' (delete " because " is to the right)
     * 3. Delete ` → `"a|"' (delete ' because ' is to the right)
     */
    it('should clean up compound string through repeated backspaces per Requirement 4', () => {
        // Starting state after typing `"a`"b: `"a`"b|"'"'
        let state = '`"a`"b|"\'"\'';
        
        // Step 1: Delete "b" - no cleanup (b is not a delimiter)
        state = apply_backspace_to_marked(state);
        expect(state).toBe('`"a`"|"\'"\'');
        
        // Step 2: Delete " - cleanup deletes " to the right
        state = apply_backspace_to_marked(state);
        expect(state).toBe('`"a`|\'"\'');
        
        // Step 3: Delete ` - cleanup deletes ' to the right
        state = apply_backspace_to_marked(state);
        expect(state).toBe('`"a|"\'');
    });
});


describe('Additional edge cases from manual testing', () => {
    /**
     * These tests cover edge cases discovered during manual testing.
     */
    
    it('di `"a`"b|"\'"\'  - backspace b should NOT delete quote', () => {
        // User typed: di `"a`"b
        // State: di `"a`"b|"'"'
        // Backspace 'b' (not a delimiter) → no cleanup
        expect(apply_backspace_to_marked('di `"a`"b|"\'"\''))
            .toBe('di `"a`"|"\'"\'');
    });
    
    it('di `"a`"c|"\'"\'  - backspace c should NOT delete quote', () => {
        // Same pattern with different letter
        expect(apply_backspace_to_marked('di `"a`"c|"\'"\''))
            .toBe('di `"a`"|"\'"\'');
    });
    
    it('di "a`|\'\'  - backspace ` should delete apostrophe', () => {
        // Local macro inside double quotes: "a`|''
        // Backspace ` with ' to right → delete '
        expect(apply_backspace_to_marked('di "a`|\'\'"'))
            .toBe('di "a|\'"');
    });
    
    it('"a`|\'\' - backspace ` should delete apostrophe', () => {
        // Simpler case without prefix
        expect(apply_backspace_to_marked('"a`|\'\'"'))
            .toBe('"a|\'"');
    });
    
    it('`|\'  - backspace ` should delete apostrophe (basic case)', () => {
        expect(apply_backspace_to_marked('`|\''))
            .toBe('|');
    });
    
    it('"|"  - backspace " should delete " (basic case)', () => {
        expect(apply_backspace_to_marked('"|"'))
            .toBe('|');
    });
    
    it('letter before apostrophe should not trigger cleanup', () => {
        // a|' - backspace 'a' should NOT delete '
        expect(apply_backspace_to_marked('a|\''))
            .toBe('|\'');
    });
    
    it('letter before quote should not trigger cleanup', () => {
        // a|" - backspace 'a' should NOT delete "
        expect(apply_backspace_to_marked('a|"'))
            .toBe('|"');
    });
});
