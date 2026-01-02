import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    get_line_start_offset,
    get_line_text,
    get_char_at_position,
    compute_line_offsets,
    DocumentLike,
} from '../../src/utils/line-utils';

describe('Line Utils Property Tests', () => {
    /**
     * Property 1: Graceful Fallback
     * For any document content and line number, when line_offsets is unavailable,
     * the utility functions SHALL compute the correct offset and return the same
     * result as if line_offsets were present.
     * Feature: line-offset-optimization, Property 1: Graceful Fallback
     * Validates: Requirements 1.2, 3.3
     */
    it('should return same results with and without line_offsets', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    { minLength: 1, maxLength: 50 }
                ),
                (the_lines) => {
                    const content = the_lines.join('\n');
                    const line_offsets = compute_line_offsets(content);

                    // Create documents with and without line_offsets
                    const doc_with_offsets: DocumentLike = {
                        content,
                        line_offsets,
                    };
                    const doc_without_offsets: DocumentLike = {
                        content,
                    };

                    // Test get_line_start_offset for all valid line numbers
                    for (
                        let my_line = 0;
                        my_line < the_lines.length;
                        my_line++
                    ) {
                        const offset_with = get_line_start_offset(
                            doc_with_offsets,
                            my_line
                        );
                        const offset_without = get_line_start_offset(
                            doc_without_offsets,
                            my_line
                        );
                        expect(offset_with).toBe(offset_without);
                    }

                    // Test get_line_text for all valid line numbers
                    for (
                        let my_line = 0;
                        my_line < the_lines.length;
                        my_line++
                    ) {
                        const text_with = get_line_text(
                            doc_with_offsets,
                            my_line
                        );
                        const text_without = get_line_text(
                            doc_without_offsets,
                            my_line
                        );
                        expect(text_with).toBe(text_without);
                    }

                    // Test get_char_at_position for various positions
                    for (
                        let my_line = 0;
                        my_line < the_lines.length;
                        my_line++
                    ) {
                        const my_line_text = the_lines[my_line];
                        for (
                            let my_char = 0;
                            my_char < my_line_text.length;
                            my_char++
                        ) {
                            const char_with = get_char_at_position(
                                doc_with_offsets,
                                { line: my_line, character: my_char }
                            );
                            const char_without = get_char_at_position(
                                doc_without_offsets,
                                { line: my_line, character: my_char }
                            );
                            expect(char_with).toBe(char_without);
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 2: Behavior Preservation
     * For any document content and position, the optimized line/character access
     * SHALL return exactly the same result as the original split('\n') approach,
     * including edge cases (empty lines, last line without newline, special
     * characters, whitespace).
     * Feature: line-offset-optimization, Property 2: Behavior Preservation
     * Validates: Requirements 1.3, 2.2, 2.3
     */
    it('should match split-based approach for all inputs', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    { minLength: 1, maxLength: 50 }
                ),
                (the_lines) => {
                    const content = the_lines.join('\n');
                    const line_offsets = compute_line_offsets(content);
                    const doc: DocumentLike = { content, line_offsets };

                    // Reference implementation using split
                    const split_lines = content.split('\n');

                    // Test get_line_text matches split approach
                    for (
                        let my_line = 0;
                        my_line < the_lines.length;
                        my_line++
                    ) {
                        const optimized_text = get_line_text(doc, my_line);
                        const split_text = split_lines[my_line];
                        expect(optimized_text).toBe(split_text);
                    }

                    // Test get_char_at_position matches split approach
                    // Note: We only test characters within the line (not at
                    // line length), because get_char_at_position returns the
                    // actual character at that offset (which could be '\n'),
                    // while split approach returns undefined for out-of-bounds.
                    for (
                        let my_line = 0;
                        my_line < the_lines.length;
                        my_line++
                    ) {
                        const my_line_text = the_lines[my_line];
                        for (
                            let my_char = 0;
                            my_char < my_line_text.length;
                            my_char++
                        ) {
                            const optimized_char = get_char_at_position(doc, {
                                line: my_line,
                                character: my_char,
                            });
                            const split_char =
                                split_lines[my_line]?.[my_char] ?? null;
                            expect(optimized_char).toBe(split_char);
                        }
                    }

                    // Test out-of-bounds line access
                    const out_of_bounds_line = get_line_text(
                        doc,
                        the_lines.length + 10
                    );
                    expect(out_of_bounds_line).toBe('');

                    // Test out-of-bounds character access
                    const out_of_bounds_char = get_char_at_position(doc, {
                        line: the_lines.length + 10,
                        character: 0,
                    });
                    expect(out_of_bounds_char).toBeNull();
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: compute_line_offsets correctness
     * For any content, compute_line_offsets should produce an array where
     * each entry points to the start of the corresponding line.
     */
    it('should compute correct line offsets for any content', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    { minLength: 1, maxLength: 50 }
                ),
                (the_lines) => {
                    const content = the_lines.join('\n');
                    const line_offsets = compute_line_offsets(content);

                    // First offset should always be 0
                    expect(line_offsets[0]).toBe(0);

                    // Number of offsets should match number of lines
                    expect(line_offsets.length).toBe(the_lines.length);

                    // Each offset should point to the start of its line
                    for (
                        let my_line = 0;
                        my_line < the_lines.length;
                        my_line++
                    ) {
                        const my_offset = line_offsets[my_line];
                        const my_expected_line = the_lines[my_line];

                        // Extract line from content using offset
                        const my_end = content.indexOf('\n', my_offset);
                        const my_extracted =
                            my_end === -1
                                ? content.substring(my_offset)
                                : content.substring(my_offset, my_end);

                        expect(my_extracted).toBe(my_expected_line);
                    }

                    // Offsets should be strictly increasing (except for empty
                    // content edge case)
                    for (let my_i = 1; my_i < line_offsets.length; my_i++) {
                        expect(line_offsets[my_i]).toBeGreaterThan(
                            line_offsets[my_i - 1]
                        );
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Edge case: Empty content
     */
    it('should handle empty content', () => {
        const doc: DocumentLike = { content: '' };
        const doc_with_offsets: DocumentLike = {
            content: '',
            line_offsets: compute_line_offsets(''),
        };

        // Line 0 should return empty string
        expect(get_line_text(doc, 0)).toBe('');
        expect(get_line_text(doc_with_offsets, 0)).toBe('');

        // Character access should return null
        expect(get_char_at_position(doc, { line: 0, character: 0 })).toBeNull();
        expect(
            get_char_at_position(doc_with_offsets, { line: 0, character: 0 })
        ).toBeNull();

        // Line start offset for line 0 should be 0
        expect(get_line_start_offset(doc, 0)).toBe(0);
        expect(get_line_start_offset(doc_with_offsets, 0)).toBe(0);
    });

    /**
     * Edge case: Single line without newline
     */
    it('should handle single line without newline', () => {
        const content = 'local x = 5';
        const doc: DocumentLike = {
            content,
            line_offsets: compute_line_offsets(content),
        };

        expect(get_line_text(doc, 0)).toBe('local x = 5');
        expect(get_char_at_position(doc, { line: 0, character: 0 })).toBe('l');
        expect(get_char_at_position(doc, { line: 0, character: 10 })).toBe('5');
        expect(
            get_char_at_position(doc, { line: 0, character: 11 })
        ).toBeNull();
    });

    /**
     * Edge case: Multiple consecutive empty lines
     */
    it('should handle multiple consecutive empty lines', () => {
        const content = 'line1\n\n\nline4';
        const doc: DocumentLike = {
            content,
            line_offsets: compute_line_offsets(content),
        };

        expect(get_line_text(doc, 0)).toBe('line1');
        expect(get_line_text(doc, 1)).toBe('');
        expect(get_line_text(doc, 2)).toBe('');
        expect(get_line_text(doc, 3)).toBe('line4');
    });

    /**
     * Edge case: Content ending with newline
     */
    it('should handle content ending with newline', () => {
        const content = 'line1\nline2\n';
        const doc: DocumentLike = {
            content,
            line_offsets: compute_line_offsets(content),
        };

        expect(get_line_text(doc, 0)).toBe('line1');
        expect(get_line_text(doc, 1)).toBe('line2');
        expect(get_line_text(doc, 2)).toBe('');
    });

    /**
     * Edge case: Special characters and whitespace
     */
    it('should handle special characters and whitespace', () => {
        const content = '  \t  \nαβγ\n!@#$%\n';
        const doc: DocumentLike = {
            content,
            line_offsets: compute_line_offsets(content),
        };

        expect(get_line_text(doc, 0)).toBe('  \t  ');
        expect(get_line_text(doc, 1)).toBe('αβγ');
        expect(get_line_text(doc, 2)).toBe('!@#$%');
        expect(get_line_text(doc, 3)).toBe('');
    });
});
