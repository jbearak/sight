import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { compute_cd_menu_visible } from '../../client/src/send-to-stata/cd-commands';
import { WorkingDirectoryOption } from '../../client/src/send-to-stata/commands';

/**
 * Property-based tests for CD menu context variable computation.
 * 
 * Feature: conditional-cd-menu-items
 * Property 1: Context variable correctness
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3
 */

describe('Feature: conditional-cd-menu-items', () => {
    describe('Property 1: Context variable correctness', () => {
        test('should return true when working_directory is "none" or "lsp"', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom<WorkingDirectoryOption>(
                        'none', 'file', 'workspace', 'lsp'
                    ),
                    (my_working_directory) => {
                        const my_result = compute_cd_menu_visible(my_working_directory);
                        
                        // Result should be boolean
                        expect(typeof my_result).toBe('boolean');
                        
                        // Result should be true for 'none' or 'lsp'
                        if (my_working_directory === 'none' || my_working_directory === 'lsp') {
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
            expect(compute_cd_menu_visible('lsp')).toBe(true);
        });
    });
});
