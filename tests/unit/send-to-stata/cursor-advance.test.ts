/// <reference types="bun-types" />
/**
 * Tests for cursor advancement after send-to-stata operations.
 * Feature: send-to-stata-cursor-advance
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import {
    compute_cursor_advance_context,
    compute_cursor_position
} from '../../../client/src/send-to-stata/cursor-advance-core';

describe('Cursor Advance Core', () => {
    describe('Property Tests', () => {
        /**
         * Property 1: Next Line Calculation
         * For any statement bounds, the calculated next line equals end_line + 1.
         * Feature: send-to-stata-cursor-advance, Property 1: Next Line Calculation
         * Validates: Requirements 1.1, 1.2
         */
        it('should calculate next_line as statement_end_line + 1', () => {
            fc.assert(
                fc.property(
                    fc.nat(10000),  // statement_end_line (0-indexed)
                    (statement_end_line) => {
                        const context = compute_cursor_advance_context(
                            'statement',
                            false,  // no selection
                            statement_end_line
                        );
                        
                        expect(context.should_advance).toBe(true);
                        expect(context.next_line).toBe(statement_end_line + 1);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 2: Selection Mode Prevents Advancement
         * For any send operation with an active selection, should_advance is false.
         * Feature: send-to-stata-cursor-advance, Property 2: Selection Mode Prevents Advancement
         * Validates: Requirements 1.3
         */
        it('should not advance when selection is active', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom('statement', 'upward', 'downward', 'file') as fc.Arbitrary<'statement' | 'upward' | 'downward' | 'file'>,
                    fc.nat(10000),
                    (mode, statement_end_line) => {
                        const context = compute_cursor_advance_context(
                            mode,
                            true,  // has selection
                            statement_end_line
                        );
                        
                        expect(context.should_advance).toBe(false);
                        expect(context.next_line).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 3: Disabled Setting Prevents Advancement
         * For any send context with setting=false, cursor position is null.
         * Feature: send-to-stata-cursor-advance, Property 3: Disabled Setting Prevents Advancement
         * Validates: Requirements 2.3
         */
        it('should not advance when setting is disabled', () => {
            fc.assert(
                fc.property(
                    fc.nat(10000),  // next_line
                    fc.integer({ min: 1, max: 100000 }),  // document_line_count
                    (next_line, document_line_count) => {
                        const result = compute_cursor_position(
                            next_line,
                            document_line_count,
                            false  // setting disabled
                        );
                        
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property 4: Cursor State After Advancement
         * For any advancement operation, cursor is at (line, 0) with empty selection.
         * Feature: send-to-stata-cursor-advance, Property 4: Cursor State After Advancement
         * Validates: Requirements 3.1, 3.2
         */
        it('should position cursor at column 0 after advancement', () => {
            fc.assert(
                fc.property(
                    fc.nat(9999),  // next_line (must be < document_line_count)
                    fc.integer({ min: 1, max: 100000 }),  // document_line_count
                    (next_line, extra_lines) => {
                        const document_line_count = next_line + extra_lines + 1;
                        
                        const result = compute_cursor_position(
                            next_line,
                            document_line_count,
                            true  // setting enabled
                        );
                        
                        expect(result).not.toBeNull();
                        expect(result!.line).toBe(next_line);
                        expect(result!.column).toBe(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Unit Tests - Edge Cases', () => {
        /**
         * Test cursor on last line stays in place.
         * Validates: Requirements 1.5
         */
        it('should not advance when cursor is on last line', () => {
            const document_line_count = 10;
            const next_line = 10;  // Beyond last line (0-indexed, so line 9 is last)
            
            const result = compute_cursor_position(
                next_line,
                document_line_count,
                true
            );
            
            expect(result).toBeNull();
        });

        /**
         * Test file mode does not advance.
         * Validates: Requirements 1.4
         */
        it('should not advance for file mode', () => {
            const context = compute_cursor_advance_context(
                'file',
                false,
                5
            );
            
            expect(context.should_advance).toBe(false);
            expect(context.next_line).toBeNull();
        });

        /**
         * Test upward mode does not advance.
         * Validates: Requirements 1.4
         */
        it('should not advance for upward mode', () => {
            const context = compute_cursor_advance_context(
                'upward',
                false,
                5
            );
            
            expect(context.should_advance).toBe(false);
            expect(context.next_line).toBeNull();
        });

        /**
         * Test downward mode does not advance.
         * Validates: Requirements 1.4
         */
        it('should not advance for downward mode', () => {
            const context = compute_cursor_advance_context(
                'downward',
                false,
                5
            );
            
            expect(context.should_advance).toBe(false);
            expect(context.next_line).toBeNull();
        });

        /**
         * Test statement mode without selection advances.
         * Validates: Requirements 1.1
         */
        it('should advance for statement mode without selection', () => {
            const context = compute_cursor_advance_context(
                'statement',
                false,
                5
            );
            
            expect(context.should_advance).toBe(true);
            expect(context.next_line).toBe(6);
        });

        /**
         * Test null statement_end_line does not advance.
         */
        it('should not advance when statement_end_line is null', () => {
            const context = compute_cursor_advance_context(
                'statement',
                false,
                null
            );
            
            expect(context.should_advance).toBe(false);
            expect(context.next_line).toBeNull();
        });

        /**
         * Test multi-line statement advances to line after end.
         * Validates: Requirements 1.2
         */
        it('should advance to line after multi-line statement end', () => {
            // Statement spans lines 2-5 (with /// continuations)
            const statement_end_line = 5;
            
            const context = compute_cursor_advance_context(
                'statement',
                false,
                statement_end_line
            );
            
            expect(context.should_advance).toBe(true);
            expect(context.next_line).toBe(6);
        });
    });
});
