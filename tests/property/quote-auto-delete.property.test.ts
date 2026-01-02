import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { compute_deletion_cleanup } from '../../client/src/quote-auto-close-core';

/**
 * Property tests for Quote Auto-Delete Simplification.
 * Tests Properties 1-4 from the design spec.
 * 
 * Feature: quote-auto-delete-simplification
 */
describe('Feature: quote-auto-delete-simplification', () => {
    // Arbitrary for any single character
    const anyCharArb = fc.string({ minLength: 1, maxLength: 1 });
    
    // Arbitrary for non-apostrophe characters
    const nonApostropheCharArb = anyCharArb.filter(c => c !== "'");
    
    // Arbitrary for non-double-quote characters
    const nonDoubleQuoteCharArb = anyCharArb.filter(c => c !== '"');

    describe('Property 1: Backtick deletion cleanup', () => {
        /**
         * Property 1: Backtick deletion cleanup
         * For any single-character deletion where the deleted character is a backtick (`),
         * the cleanup function SHALL delete exactly one character if and only if
         * the character immediately to the right of the cursor is an apostrophe (').
         * 
         * **Validates: Requirements 1.1, 1.2**
         */
        it('deletes apostrophe when backtick deleted and apostrophe to right', () => {
            // When backtick is deleted and apostrophe is to the right, delete 1 char
            const result = compute_deletion_cleanup('`', "'");
            expect(result).toBe(1);
        });

        it('does not delete when backtick deleted and non-apostrophe to right', () => {
            fc.assert(fc.property(
                nonApostropheCharArb,
                (char_to_right) => {
                    const result = compute_deletion_cleanup('`', char_to_right);
                    expect(result).toBe(0);
                }
            ), { numRuns: 100 });
        });

        it('does not delete when backtick deleted and empty string to right', () => {
            const result = compute_deletion_cleanup('`', '');
            expect(result).toBe(0);
        });
    });

    describe('Property 2: Apostrophe deletion passthrough', () => {
        /**
         * Property 2: Apostrophe deletion passthrough
         * For any single-character deletion where the deleted character is an apostrophe ('),
         * the cleanup function SHALL delete zero additional characters regardless of surrounding context.
         * 
         * **Validates: Requirements 2.1**
         */
        it('never deletes additional characters when apostrophe is deleted', () => {
            fc.assert(fc.property(
                anyCharArb,
                (char_to_right) => {
                    const result = compute_deletion_cleanup("'", char_to_right);
                    expect(result).toBe(0);
                }
            ), { numRuns: 100 });
        });

        it('does not delete when apostrophe deleted and empty string to right', () => {
            const result = compute_deletion_cleanup("'", '');
            expect(result).toBe(0);
        });
    });

    describe('Property 3: Double quote deletion cleanup', () => {
        /**
         * Property 3: Double quote deletion cleanup
         * For any single-character deletion where the deleted character is a double quote ("),
         * the cleanup function SHALL delete exactly one character if and only if
         * the character immediately to the right of the cursor is also a double quote (").
         * 
         * **Validates: Requirements 3.1, 3.2**
         */
        it('deletes double quote when double quote deleted and double quote to right', () => {
            const result = compute_deletion_cleanup('"', '"');
            expect(result).toBe(1);
        });

        it('does not delete when double quote deleted and non-double-quote to right', () => {
            fc.assert(fc.property(
                nonDoubleQuoteCharArb,
                (char_to_right) => {
                    const result = compute_deletion_cleanup('"', char_to_right);
                    expect(result).toBe(0);
                }
            ), { numRuns: 100 });
        });

        it('does not delete when double quote deleted and empty string to right', () => {
            const result = compute_deletion_cleanup('"', '');
            expect(result).toBe(0);
        });
    });

    describe('Property 4: Other character deletion passthrough', () => {
        /**
         * Property 4: Multi-character deletion passthrough
         * For any deletion of a character that is not a backtick or double quote,
         * the cleanup function SHALL delete zero additional characters.
         * 
         * Note: The actual multi-character deletion check happens at the handler level,
         * not in compute_deletion_cleanup. This property tests that non-delimiter
         * characters don't trigger cleanup.
         * 
         * **Validates: Requirements 5.1, 5.2**
         */
        const nonDelimiterCharArb = anyCharArb.filter(c => c !== '`' && c !== '"');

        it('never deletes when non-delimiter character is deleted', () => {
            fc.assert(fc.property(
                nonDelimiterCharArb,
                anyCharArb,
                (deleted_char, char_to_right) => {
                    const result = compute_deletion_cleanup(deleted_char, char_to_right);
                    expect(result).toBe(0);
                }
            ), { numRuns: 100 });
        });

        it('does not delete when letter deleted regardless of context', () => {
            // Test with common letters
            const the_letters = ['a', 'b', 'c', 'x', 'y', 'z', 'A', 'B', 'Z'];
            const the_contexts = ["'", '"', '`', 'a', '', ' '];
            
            for (const my_letter of the_letters) {
                for (const my_context of the_contexts) {
                    const result = compute_deletion_cleanup(my_letter, my_context);
                    expect(result).toBe(0);
                }
            }
        });
    });
});
