// Feature: global-macro-execution-order, Property 1: find_match_line Returns 0-Indexed Line Numbers
// Validates: Requirements 1.2

/**
 * Property tests for find_match_line 0-indexed line number return values.
 *
 * For any content string containing a match string at line N (where N is the
 * 0-indexed position), `find_match_line` SHALL return N.
 */

import * as fc from 'fast-check';
import { describe, it } from 'bun:test';
import { DirectiveParser } from '../../src/directive-parser';

describe('find_match_line Returns 0-Indexed Line Numbers', () => {
    const parser = new DirectiveParser();

    /**
     * Property 1: find_match_line returns 0-indexed line numbers
     * When a match string is inserted at a random line position N (0-indexed),
     * find_match_line should return exactly N.
     */
    it('returns 0-indexed line number for match at any position', () => {
        fc.assert(
            fc.property(
                // Generate random number of lines before the match (0 to 20)
                fc.integer({ min: 0, max: 20 }),
                // Generate random number of lines after the match (0 to 20)
                fc.integer({ min: 0, max: 20 }),
                // Generate a unique match string that won't appear in filler lines
                fc.string({ minLength: 5, maxLength: 30 })
                    .filter(s => !s.includes('\n') && s.trim().length > 0)
                    .map(s => `UNIQUE_MATCH_${s}_END`),
                (lines_before, lines_after, match_string) => {
                    // Build content with filler lines before and after the match
                    const the_lines_before: string[] = [];
                    for (let i = 0; i < lines_before; i++) {
                        the_lines_before.push(`filler line ${i}`);
                    }

                    const the_lines_after: string[] = [];
                    for (let i = 0; i < lines_after; i++) {
                        the_lines_after.push(`trailing line ${i}`);
                    }

                    const content = [
                        ...the_lines_before,
                        match_string,
                        ...the_lines_after,
                    ].join('\n');

                    const result = parser.find_match_line(content, match_string);

                    // The match should be found at the 0-indexed position
                    const expected_line = lines_before; // 0-indexed
                    return result === expected_line;
                }
            ),
            { numRuns: 200 }
        );
    });

    /**
     * Edge case: Match on first line should return 0
     */
    it('returns 0 when match is on first line', () => {
        fc.assert(
            fc.property(
                // Generate a unique match string
                fc.string({ minLength: 3, maxLength: 20 })
                    .filter(s => !s.includes('\n') && s.trim().length > 0)
                    .map(s => `FIRST_LINE_${s}`),
                // Generate random trailing lines
                fc.integer({ min: 0, max: 10 }),
                (match_string, num_trailing_lines) => {
                    const the_trailing_lines: string[] = [];
                    for (let i = 0; i < num_trailing_lines; i++) {
                        the_trailing_lines.push(`trailing ${i}`);
                    }

                    const content = [match_string, ...the_trailing_lines].join('\n');
                    const result = parser.find_match_line(content, match_string);

                    // First line should be 0-indexed as 0
                    return result === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Edge case: Match on last line should return correct 0-indexed position
     */
    it('returns correct 0-indexed position when match is on last line', () => {
        fc.assert(
            fc.property(
                // Generate random number of preceding lines (1 to 20)
                fc.integer({ min: 1, max: 20 }),
                // Generate a unique match string
                fc.string({ minLength: 3, maxLength: 20 })
                    .filter(s => !s.includes('\n') && s.trim().length > 0)
                    .map(s => `LAST_LINE_${s}`),
                (num_preceding_lines, match_string) => {
                    const the_preceding_lines: string[] = [];
                    for (let i = 0; i < num_preceding_lines; i++) {
                        the_preceding_lines.push(`preceding ${i}`);
                    }

                    const content = [...the_preceding_lines, match_string].join('\n');
                    const result = parser.find_match_line(content, match_string);

                    // Last line should be at 0-indexed position num_preceding_lines
                    const expected_line = num_preceding_lines;
                    return result === expected_line;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: find_match_line finds first occurrence when match appears multiple times
     */
    it('returns 0-indexed line of first occurrence when match appears multiple times', () => {
        fc.assert(
            fc.property(
                // Position of first occurrence (0-indexed)
                fc.integer({ min: 0, max: 10 }),
                // Gap between first and second occurrence
                fc.integer({ min: 1, max: 10 }),
                // Generate a unique match string
                fc.string({ minLength: 3, maxLength: 15 })
                    .filter(s => !s.includes('\n') && s.trim().length > 0)
                    .map(s => `MULTI_${s}`),
                (first_occurrence_line, gap, match_string) => {
                    const the_lines: string[] = [];

                    // Add filler lines before first occurrence
                    for (let i = 0; i < first_occurrence_line; i++) {
                        the_lines.push(`before ${i}`);
                    }

                    // Add first occurrence
                    the_lines.push(match_string);

                    // Add gap lines
                    for (let i = 0; i < gap; i++) {
                        the_lines.push(`gap ${i}`);
                    }

                    // Add second occurrence
                    the_lines.push(match_string);

                    const content = the_lines.join('\n');
                    const result = parser.find_match_line(content, match_string);

                    // Should return the 0-indexed position of the first occurrence
                    return result === first_occurrence_line;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Single-line content with match returns 0
     */
    it('returns 0 for single-line content containing the match', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 3, maxLength: 30 })
                    // Exclude content whose leading text opens a block comment:
                    // find_match_line now skips block-commented lines, so such a
                    // single line is inert and correctly yields undefined (this
                    // property is about position semantics, not comment handling).
                    .filter(s => !s.includes('\n') && s.trim().length > 0
                        && !s.trimStart().startsWith('/*')),
                (match_string) => {
                    const content = match_string;
                    const result = parser.find_match_line(content, match_string);
                    return result === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Returns undefined when match is not found
     */
    it('returns undefined when match string is not in content', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10 }),
                fc.string({ minLength: 5, maxLength: 20 })
                    .filter(s => !s.includes('\n') && s.trim().length > 0)
                    .map(s => `NOT_FOUND_${s}`),
                (num_lines, match_string) => {
                    // Build content that definitely doesn't contain the match string
                    const the_lines: string[] = [];
                    for (let i = 0; i < num_lines; i++) {
                        the_lines.push(`regular line ${i}`);
                    }

                    const content = the_lines.join('\n');
                    const result = parser.find_match_line(content, match_string);

                    return result === undefined;
                }
            ),
            { numRuns: 100 }
        );
    });
});
