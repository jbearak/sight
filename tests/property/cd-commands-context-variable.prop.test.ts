import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { compute_cd_menu_visible } from '../../client/src/send-to-stata/cd-commands';

/**
 * Property-based tests for CD menu context variable computation.
 * 
 * Feature: conditional-cd-menu-items
 * Property 1: Context variable correctness
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3
 */

describe('Feature: conditional-cd-menu-items', () => {
    describe('Property 1: Context variable correctness', () => {
        test('should return true only when working_directory is "none"', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom<'none' | 'file' | 'workspace'>(
                        'none', 'file', 'workspace'
                    ),
                    (my_working_directory) => {
                        const my_result = compute_cd_menu_visible(my_working_directory);
                        
                        // Result should be boolean
                        expect(typeof my_result).toBe('boolean');
                        
                        // Result should be true iff value is 'none'
                        if (my_working_directory === 'none') {
                            expect(my_result).toBe(true);
                        } else {
                            expect(my_result).toBe(false);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
        
        test('should handle specific cases correctly', () => {
            expect(compute_cd_menu_visible('none')).toBe(true);
            expect(compute_cd_menu_visible('file')).toBe(false);
            expect(compute_cd_menu_visible('workspace')).toBe(false);
        });
    });
});
