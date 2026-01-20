import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { format_cd_command } from '../../client/src/send-to-stata/cd-commands';

/**
 * Property-based tests for CD command format.
 * 
 * Feature: conditional-cd-menu-items
 * Property 2: CD command path correctness
 * Validates: Requirements 2.1, 3.1
 */

// Generator for path segments with optional special characters
const arbitrary_path_segment = fc.stringOf(
    fc.oneof(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_- '.split('')),
        fc.constant('"')
    ),
    { minLength: 1, maxLength: 10 }
);

// Generator for Unix-style paths
const arbitrary_unix_path = fc.array(arbitrary_path_segment, { minLength: 1, maxLength: 5 })
    .map(segments => '/' + segments.join('/'));

// Generator for Windows-style paths
const arbitrary_windows_path = fc.array(arbitrary_path_segment, { minLength: 1, maxLength: 5 })
    .map(segments => 'C:\\' + segments.join('\\'));

// Combined path generator
const arbitrary_path = fc.oneof(arbitrary_unix_path, arbitrary_windows_path);

describe('Feature: conditional-cd-menu-items', () => {
    describe('Property 2: CD command path correctness', () => {
        test('should format cd command correctly for any path', () => {
            fc.assert(
                fc.property(arbitrary_path, (my_path) => {
                    const my_command = format_cd_command(my_path);
                    
                    // Command starts with 'cd '
                    expect(my_command).toMatch(/^cd /);
                    
                    // Path is properly quoted
                    const my_has_quotes = my_path.includes('"');
                    if (my_has_quotes) {
                        // Should use compound syntax
                        expect(my_command).toMatch(/^cd `".*"'$/);
                    } else {
                        // Should use simple syntax
                        expect(my_command).toMatch(/^cd ".*"$/);
                    }
                    
                    // Backslashes are doubled
                    const my_escaped_path = my_path.replace(/\\/g, '\\\\');
                    expect(my_command).toContain(my_escaped_path);
                }),
                { numRuns: 100 }
            );
        });
        
        test('should handle specific edge cases', () => {
            const the_test_cases = [
                '/Users/test/Documents',
                'C:\\Users\\test\\Documents',
                '/path/with spaces/folder',
                'C:\\path with spaces\\folder',
                '/path/with"quotes/folder',
                'C:\\path\\with"quotes\\folder',
                '/simple/path',
                'C:\\simple\\path',
                '/path/with/multiple"quotes"here/folder',
                'C:\\path\\with\\multiple"quotes"here\\folder'
            ];
            
            for (const my_path of the_test_cases) {
                const my_command = format_cd_command(my_path);
                
                expect(my_command).toMatch(/^cd /);
                
                const my_has_quotes = my_path.includes('"');
                if (my_has_quotes) {
                    expect(my_command).toMatch(/^cd `".*"'$/);
                } else {
                    expect(my_command).toMatch(/^cd ".*"$/);
                }
            }
        });
    });
});
