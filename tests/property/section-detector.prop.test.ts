/**
 * Section Detector Property Tests for Stata Outline Improvements
 *
 * Property-based tests for the section detector enhancements including:
 * - Asterisk delimiter validation for block comment headings
 *
 * Feature: stata-outline-improvements
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
    is_asterisk_delimiter,
    is_standalone_heading,
    count_delimiter_chars,
    extract_sections,
    extract_block_comment_heading,
    DelimiterKind,
} from '../../src/providers/section-detector';

// ---------------------------------------------------------------------------
// Generators for asterisk delimiter testing
// ---------------------------------------------------------------------------

/**
 * Generate a valid asterisk delimiter line with 4+ asterisks.
 * Optionally includes leading/trailing whitespace.
 */
function arbitrary_valid_asterisk_delimiter(): fc.Arbitrary<string> {
    const my_asterisk_count = fc.integer({ min: 4, max: 20 });
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_asterisk_count, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_leading, my_trailing]) => {
            const my_asterisks = '*'.repeat(my_count);
            return `${my_leading}${my_asterisks}${my_trailing}`;
        });
}

/**
 * Generate a valid asterisk delimiter line with comment prefix (/**** form).
 */
function arbitrary_comment_prefixed_asterisk_delimiter(): fc.Arbitrary<string> {
    const my_asterisk_count = fc.integer({ min: 4, max: 20 });
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_asterisk_count, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_leading, my_trailing]) => {
            const my_asterisks = '*'.repeat(my_count);
            return `${my_leading}/${my_asterisks}${my_trailing}`;
        });
}

/**
 * Generate a valid asterisk delimiter line with comment suffix (asterisks followed by slash).
 */
function arbitrary_comment_suffixed_asterisk_delimiter(): fc.Arbitrary<string> {
    const my_asterisk_count = fc.integer({ min: 4, max: 20 });
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_asterisk_count, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_leading, my_trailing]) => {
            const my_asterisks = '*'.repeat(my_count);
            return `${my_leading}${my_asterisks}/${my_trailing}`;
        });
}

/**
 * Generate a line with fewer than 4 asterisks (invalid delimiter).
 */
function arbitrary_too_few_asterisks(): fc.Arbitrary<string> {
    const my_asterisk_count = fc.integer({ min: 0, max: 3 });
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_asterisk_count, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_leading, my_trailing]) => {
            const my_asterisks = '*'.repeat(my_count);
            return `${my_leading}${my_asterisks}${my_trailing}`;
        });
}

/**
 * Generate a line with asterisks mixed with non-asterisk characters (invalid delimiter).
 */
function arbitrary_mixed_content_line(): fc.Arbitrary<string> {
    const my_asterisk_count = fc.integer({ min: 4, max: 10 });
    const my_non_asterisk_char = fc.constantFrom('a', 'b', 'x', '1', '2', '-', '=', '+');
    const my_position = fc.constantFrom('start', 'middle', 'end');

    return fc
        .tuple(my_asterisk_count, my_non_asterisk_char, my_position)
        .map(([my_count, my_char, my_pos]) => {
            const my_asterisks = '*'.repeat(my_count);
            if (my_pos === 'start') {
                return `${my_char}${my_asterisks}`;
            } else if (my_pos === 'middle') {
                const my_half = Math.floor(my_count / 2);
                return `${'*'.repeat(my_half)}${my_char}${'*'.repeat(my_count - my_half)}`;
            } else {
                return `${my_asterisks}${my_char}`;
            }
        });
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Section Detector Property Tests - Stata Outline Improvements', () => {
    /**
     * Feature: stata-outline-improvements, Property 2: Asterisk Delimiter Validation
     *
     * *For any* line consisting of 4 or more asterisks with optional leading/trailing
     * whitespace, the delimiter validation function should recognize it as a valid
     * block comment delimiter.
     *
     * **Validates: Requirements 1.2, 1.3**
     */
    describe('Property 2: Asterisk Delimiter Validation', () => {
        /**
         * Subproperty A: Pure asterisk lines with 4+ asterisks are valid delimiters.
         */
        it('should recognize pure asterisk lines with 4+ asterisks as valid delimiters', () => {
            fc.assert(
                fc.property(
                    arbitrary_valid_asterisk_delimiter(),
                    (my_line) => {
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty B: Comment-prefixed asterisk lines (/****...) are valid delimiters.
         */
        it('should recognize comment-prefixed asterisk lines as valid delimiters', () => {
            fc.assert(
                fc.property(
                    arbitrary_comment_prefixed_asterisk_delimiter(),
                    (my_line) => {
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty C: Comment-suffixed asterisk lines (asterisks followed by slash) are valid delimiters.
         */
        it('should recognize comment-suffixed asterisk lines as valid delimiters', () => {
            fc.assert(
                fc.property(
                    arbitrary_comment_suffixed_asterisk_delimiter(),
                    (my_line) => {
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty D: Lines with fewer than 4 asterisks are NOT valid delimiters.
         */
        it('should reject lines with fewer than 4 asterisks', () => {
            fc.assert(
                fc.property(
                    arbitrary_too_few_asterisks(),
                    (my_line) => {
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty E: Lines with non-asterisk characters (other than / prefix/suffix)
         * are NOT valid delimiters.
         */
        it('should reject lines with non-asterisk characters mixed in', () => {
            fc.assert(
                fc.property(
                    arbitrary_mixed_content_line(),
                    (my_line) => {
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty F: Exact boundary test - exactly 4 asterisks is valid.
         */
        it('should recognize exactly 4 asterisks as valid delimiter', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                    (my_leading, my_trailing) => {
                        const my_line = `${my_leading}****${my_trailing}`;
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty G: Exact boundary test - exactly 3 asterisks is invalid.
         */
        it('should reject exactly 3 asterisks as invalid delimiter', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                    (my_leading, my_trailing) => {
                        const my_line = `${my_leading}***${my_trailing}`;
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty H: Empty and whitespace-only lines are NOT valid delimiters.
         */
        it('should reject empty and whitespace-only lines', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 10 }),
                    (my_whitespace) => {
                        const my_result = is_asterisk_delimiter(my_whitespace);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty I: Combined comment prefix and suffix (slash-asterisks-slash) is valid.
         */
        it('should recognize combined comment prefix and suffix as valid delimiter', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 4, max: 20 }),
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                    (my_count, my_leading, my_trailing) => {
                        const my_asterisks = '*'.repeat(my_count);
                        const my_line = `${my_leading}/${my_asterisks}/${my_trailing}`;
                        const my_result = is_asterisk_delimiter(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ---------------------------------------------------------------------------
    // Property 1: Block Comment Heading Detection
    // ---------------------------------------------------------------------------

    /**
     * Feature: stata-outline-improvements, Property 1: Block Comment Heading Detection
     *
     * *For any* valid three-line block comment pattern with asterisk borders on
     * lines i-1 and i+1, and heading text on line i, the Section_Detector should
     * identify it as a section with the extracted heading text as the name.
     *
     * **Validates: Requirements 1.1, 1.4**
     */
    describe('Property 1: Block Comment Heading Detection', () => {
        /**
         * Generate random heading text content.
         * Includes alphanumeric characters, spaces, and some special characters.
         * Excludes asterisks to avoid confusion with delimiters.
         */
        function arbitrary_heading_text(): fc.Arbitrary<string> {
            const my_char = fc.constantFrom(
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
                'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
                'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
                '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                ' ', '_', '-', '(', ')', '[', ']', ':', ';', ',', '.'
            );
            return fc.stringOf(my_char, { minLength: 3, maxLength: 50 })
                .filter((s) => s.trim().length >= 3); // Ensure non-trivial content
        }

        /**
         * Generate a valid asterisk delimiter line.
         * Supports various forms: pure asterisks, prefix slash, suffix slash, or both.
         */
        function arbitrary_asterisk_delimiter_line(): fc.Arbitrary<string> {
            const my_asterisk_count = fc.integer({ min: 4, max: 30 });
            const my_form = fc.constantFrom('pure', 'prefix', 'suffix', 'both');
            const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 3 });
            const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 3 });

            return fc
                .tuple(my_asterisk_count, my_form, my_leading_spaces, my_trailing_spaces)
                .map(([my_count, my_form, my_leading, my_trailing]) => {
                    const my_asterisks = '*'.repeat(my_count);
                    switch (my_form) {
                        case 'pure':
                            return `${my_leading}${my_asterisks}${my_trailing}`;
                        case 'prefix':
                            return `${my_leading}/${my_asterisks}${my_trailing}`;
                        case 'suffix':
                            return `${my_leading}${my_asterisks}/${my_trailing}`;
                        case 'both':
                            return `${my_leading}/${my_asterisks}/${my_trailing}`;
                        default:
                            return my_asterisks;
                    }
                });
        }

        /**
         * Generate a middle line for block comment heading.
         * Can have leading space, asterisk, or both.
         */
        function arbitrary_middle_line(heading_text: string): fc.Arbitrary<string> {
            const my_prefix_style = fc.constantFrom('space', 'asterisk', 'space_asterisk');
            const my_suffix_style = fc.constantFrom('none', 'asterisk');

            return fc
                .tuple(my_prefix_style, my_suffix_style)
                .map(([my_prefix, my_suffix]) => {
                    let my_line = '';
                    switch (my_prefix) {
                        case 'space':
                            my_line = ` ${heading_text}`;
                            break;
                        case 'asterisk':
                            my_line = `* ${heading_text}`;
                            break;
                        case 'space_asterisk':
                            my_line = ` * ${heading_text}`;
                            break;
                    }
                    if (my_suffix === 'asterisk') {
                        my_line = `${my_line} *`;
                    }
                    return my_line;
                });
        }

        /**
         * Generate a complete three-line block comment pattern.
         * Returns the document content and expected heading text.
         */
        function arbitrary_block_comment_document(): fc.Arbitrary<{
            content: string;
            expected_name: string;
            line_offsets: number[];
        }> {
            return fc
                .tuple(
                    arbitrary_heading_text(),
                    arbitrary_asterisk_delimiter_line(),
                    arbitrary_asterisk_delimiter_line()
                )
                .chain(([my_heading, my_top_delim, my_bottom_delim]) => {
                    return arbitrary_middle_line(my_heading).map((my_middle) => {
                        const my_lines = [my_top_delim, my_middle, my_bottom_delim];
                        const my_content = my_lines.join('\n');
                        const my_line_offsets = compute_line_offsets(my_content);
                        return {
                            content: my_content,
                            expected_name: my_heading.trim(),
                            line_offsets: my_line_offsets,
                        };
                    });
                });
        }

        /**
         * Compute line offsets for a document content string.
         */
        function compute_line_offsets(content: string): number[] {
            const my_offsets: number[] = [0];
            for (let my_i = 0; my_i < content.length; my_i++) {
                if (content[my_i] === '\n') {
                    my_offsets.push(my_i + 1);
                }
            }
            return my_offsets;
        }

        /**
         * Subproperty A: Block comment headings are detected as sections.
         */
        it('should detect block comment headings as sections', () => {
            fc.assert(
                fc.property(
                    arbitrary_block_comment_document(),
                    ({ content, expected_name, line_offsets }) => {
                        const my_sections = extract_sections(content, line_offsets);
                        // Should detect exactly one section
                        if (my_sections.length !== 1) {
                            return false;
                        }
                        // Section should be detected as banner type
                        return my_sections[0].detection_type === 'banner';
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty B: Extracted section name matches the heading text.
         */
        it('should extract correct section name from block comment heading', () => {
            fc.assert(
                fc.property(
                    arbitrary_block_comment_document(),
                    ({ content, expected_name, line_offsets }) => {
                        const my_sections = extract_sections(content, line_offsets);
                        if (my_sections.length !== 1) {
                            return false;
                        }
                        // The extracted name should match the expected heading text
                        return my_sections[0].name === expected_name;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty C: Block comment with pure asterisk delimiters (****).
         */
        it('should detect block comments with pure asterisk delimiters', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 30 }),
                    fc.integer({ min: 4, max: 30 }),
                    (my_heading, my_top_count, my_bottom_count) => {
                        const my_top_delim = '*'.repeat(my_top_count);
                        const my_bottom_delim = '*'.repeat(my_bottom_count);
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        return my_sections.length === 1 &&
                            my_sections[0].detection_type === 'banner' &&
                            my_sections[0].name === my_heading.trim();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty D: Block comment with comment-prefixed delimiters (slash followed by asterisks).
         */
        it('should detect block comments with comment-prefixed delimiters', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 30 }),
                    fc.integer({ min: 4, max: 30 }),
                    (my_heading, my_top_count, my_bottom_count) => {
                        const my_top_delim = '/' + '*'.repeat(my_top_count);
                        const my_bottom_delim = '*'.repeat(my_bottom_count) + '/';
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        return my_sections.length === 1 &&
                            my_sections[0].detection_type === 'banner' &&
                            my_sections[0].name === my_heading.trim();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty E: Block comment with wrapped delimiters (slash-asterisks-slash).
         */
        it('should detect block comments with wrapped delimiters', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 30 }),
                    fc.integer({ min: 4, max: 30 }),
                    (my_heading, my_top_count, my_bottom_count) => {
                        const my_top_delim = '/' + '*'.repeat(my_top_count) + '/';
                        const my_bottom_delim = '/' + '*'.repeat(my_bottom_count) + '/';
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        return my_sections.length === 1 &&
                            my_sections[0].detection_type === 'banner' &&
                            my_sections[0].name === my_heading.trim();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty F: Block comment with mixed delimiter forms.
         * Top line uses one form, bottom line uses another.
         */
        it('should detect block comments with mixed delimiter forms', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 30 }),
                    fc.integer({ min: 4, max: 30 }),
                    fc.constantFrom('pure', 'prefix', 'suffix', 'both'),
                    fc.constantFrom('pure', 'prefix', 'suffix', 'both'),
                    (my_heading, my_top_count, my_bottom_count, my_top_form, my_bottom_form) => {
                        const my_top_asterisks = '*'.repeat(my_top_count);
                        const my_bottom_asterisks = '*'.repeat(my_bottom_count);

                        let my_top_delim: string;
                        switch (my_top_form) {
                            case 'pure': my_top_delim = my_top_asterisks; break;
                            case 'prefix': my_top_delim = '/' + my_top_asterisks; break;
                            case 'suffix': my_top_delim = my_top_asterisks + '/'; break;
                            case 'both': my_top_delim = '/' + my_top_asterisks + '/'; break;
                        }

                        let my_bottom_delim: string;
                        switch (my_bottom_form) {
                            case 'pure': my_bottom_delim = my_bottom_asterisks; break;
                            case 'prefix': my_bottom_delim = '/' + my_bottom_asterisks; break;
                            case 'suffix': my_bottom_delim = my_bottom_asterisks + '/'; break;
                            case 'both': my_bottom_delim = '/' + my_bottom_asterisks + '/'; break;
                        }

                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        return my_sections.length === 1 &&
                            my_sections[0].detection_type === 'banner' &&
                            my_sections[0].name === my_heading.trim();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty G: Heading text with special characters is preserved.
         */
        it('should preserve special characters in heading text', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        'Section (Part 1)',
                        'Data: Round IV-VIII',
                        'Variables [v307_01-v307_21]',
                        'Step 1.2.3: Initialize',
                        'Current contraceptive methods for Rounds IV-VIII'
                    ),
                    fc.integer({ min: 4, max: 20 }),
                    (my_heading, my_asterisk_count) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_delim}\n${my_middle}\n${my_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        return my_sections.length === 1 &&
                            my_sections[0].name === my_heading;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty H: Block comment in middle of document is detected.
         */
        it('should detect block comment heading in middle of document', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 20 }),
                    fc.integer({ min: 1, max: 5 }),
                    fc.integer({ min: 1, max: 5 }),
                    (my_heading, my_asterisk_count, my_lines_before, my_lines_after) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;

                        // Add some code lines before and after
                        const my_before_lines = Array(my_lines_before).fill('display "hello"').join('\n');
                        const my_after_lines = Array(my_lines_after).fill('gen x = 1').join('\n');

                        const my_content = `${my_before_lines}\n${my_delim}\n${my_middle}\n${my_delim}\n${my_after_lines}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        // Should detect exactly one section (the block comment)
                        if (my_sections.length !== 1) {
                            return false;
                        }
                        // Section should start at the correct line
                        const my_expected_start_line = my_lines_before;
                        return my_sections[0].range.start.line === my_expected_start_line &&
                            my_sections[0].name === my_heading.trim();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty I: extract_block_comment_heading strips leading/trailing asterisks.
         */
        it('should strip leading and trailing asterisks from heading text', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 0, max: 3 }),
                    fc.integer({ min: 0, max: 3 }),
                    (my_heading, my_leading_asterisks, my_trailing_asterisks) => {
                        const my_leading = '*'.repeat(my_leading_asterisks);
                        const my_trailing = '*'.repeat(my_trailing_asterisks);
                        const my_line = ` ${my_leading} ${my_heading} ${my_trailing} `;

                        const my_result = extract_block_comment_heading(my_line);
                        return my_result === my_heading.trim();
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty J: Section range spans all three lines.
         */
        it('should set section range to span all three lines', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 20 }),
                    (my_heading, my_asterisk_count) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_delim}\n${my_middle}\n${my_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        if (my_sections.length !== 1) {
                            return false;
                        }
                        // Range should start at line 0 and end at line 2
                        return my_sections[0].range.start.line === 0 &&
                            my_sections[0].range.end.line === 2;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty K: Selection range is the middle line only.
         */
        it('should set selection range to middle line only', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 20 }),
                    (my_heading, my_asterisk_count) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_delim}\n${my_middle}\n${my_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);
                        if (my_sections.length !== 1) {
                            return false;
                        }
                        // Selection range should be line 1 only
                        return my_sections[0].selection_range.start.line === 1 &&
                            my_sections[0].selection_range.end.line === 1;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ---------------------------------------------------------------------------
    // Property 3: Block Comment Line Consumption
    // ---------------------------------------------------------------------------

    /**
     * Feature: stata-outline-improvements, Property 3: Block Comment Line Consumption
     *
     * *For any* detected block comment heading spanning lines i-1, i, and i+1,
     * all three line numbers should appear in the consumed lines set after
     * detection completes.
     *
     * **Validates: Requirements 1.5**
     *
     * Since the consumed lines set is internal to extract_sections(), we verify
     * this property indirectly by checking:
     * 1. No duplicate sections are detected for the same lines
     * 2. Subsequent detection phases skip consumed lines
     * 3. The section range spans all three lines correctly
     */
    describe('Property 3: Block Comment Line Consumption', () => {
        /**
         * Generate random heading text content.
         * Includes alphanumeric characters, spaces, and some special characters.
         * Excludes asterisks to avoid confusion with delimiters.
         */
        function arbitrary_heading_text(): fc.Arbitrary<string> {
            const my_char = fc.constantFrom(
                'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
                'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
                'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
                '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                ' ', '_', '-', '(', ')', '[', ']', ':', ';', ',', '.'
            );
            return fc.stringOf(my_char, { minLength: 3, maxLength: 50 })
                .filter((s) => s.trim().length >= 3); // Ensure non-trivial content
        }

        /**
         * Compute line offsets for a document content string.
         */
        function compute_line_offsets(content: string): number[] {
            const my_offsets: number[] = [0];
            for (let my_i = 0; my_i < content.length; my_i++) {
                if (content[my_i] === '\n') {
                    my_offsets.push(my_i + 1);
                }
            }
            return my_offsets;
        }

        /**
         * Generate a block comment heading at a specific position in a document.
         * Returns the document content, line offsets, and the line numbers of the
         * three-line block comment.
         */
        function arbitrary_block_comment_at_position(): fc.Arbitrary<{
            content: string;
            line_offsets: number[];
            block_start_line: number;
            heading_line: number;
            block_end_line: number;
            expected_name: string;
        }> {
            const my_heading = arbitrary_heading_text();
            const my_asterisk_count = fc.integer({ min: 4, max: 20 });
            const my_lines_before = fc.integer({ min: 0, max: 5 });
            const my_lines_after = fc.integer({ min: 0, max: 5 });

            return fc
                .tuple(my_heading, my_asterisk_count, my_lines_before, my_lines_after)
                .map(([my_heading_text, my_count, my_before, my_after]) => {
                    const my_delim = '*'.repeat(my_count);
                    const my_middle = ` ${my_heading_text}`;

                    // Build document with code lines before and after
                    const my_before_lines = my_before > 0
                        ? Array(my_before).fill('display "hello"').join('\n') + '\n'
                        : '';
                    const my_after_lines = my_after > 0
                        ? '\n' + Array(my_after).fill('gen x = 1').join('\n')
                        : '';

                    const my_content = `${my_before_lines}${my_delim}\n${my_middle}\n${my_delim}${my_after_lines}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    return {
                        content: my_content,
                        line_offsets: my_line_offsets,
                        block_start_line: my_before,
                        heading_line: my_before + 1,
                        block_end_line: my_before + 2,
                        expected_name: my_heading_text.trim(),
                    };
                });
        }

        /**
         * Generate a document with multiple block comment headings.
         * Each heading is separated by code lines to ensure they don't overlap.
         */
        function arbitrary_multiple_block_comments(): fc.Arbitrary<{
            content: string;
            line_offsets: number[];
            block_positions: Array<{
                start_line: number;
                heading_line: number;
                end_line: number;
                expected_name: string;
            }>;
        }> {
            const my_heading_count = fc.integer({ min: 2, max: 4 });
            const my_headings = fc.array(arbitrary_heading_text(), { minLength: 2, maxLength: 4 });
            const my_asterisk_count = fc.integer({ min: 4, max: 15 });

            return fc
                .tuple(my_heading_count, my_headings, my_asterisk_count)
                .map(([my_count, my_heading_texts, my_asterisks]) => {
                    const my_delim = '*'.repeat(my_asterisks);
                    const my_lines: string[] = [];
                    const my_positions: Array<{
                        start_line: number;
                        heading_line: number;
                        end_line: number;
                        expected_name: string;
                    }> = [];

                    // Add initial code line
                    my_lines.push('display "start"');

                    for (let my_i = 0; my_i < Math.min(my_count, my_heading_texts.length); my_i++) {
                        const my_start_line = my_lines.length;
                        my_lines.push(my_delim);
                        my_lines.push(` ${my_heading_texts[my_i]}`);
                        my_lines.push(my_delim);

                        my_positions.push({
                            start_line: my_start_line,
                            heading_line: my_start_line + 1,
                            end_line: my_start_line + 2,
                            expected_name: my_heading_texts[my_i].trim(),
                        });

                        // Add separator code lines between block comments
                        if (my_i < my_count - 1) {
                            my_lines.push('gen y = 2');
                            my_lines.push('display "separator"');
                        }
                    }

                    // Add final code line
                    my_lines.push('display "end"');

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    return {
                        content: my_content,
                        line_offsets: my_line_offsets,
                        block_positions: my_positions,
                    };
                });
        }

        /**
         * Subproperty A: All three lines of a block comment are consumed (verified via range).
         * The section range should span from the top delimiter line to the bottom delimiter line.
         */
        it('should consume all three lines of block comment (verified via section range)', () => {
            fc.assert(
                fc.property(
                    arbitrary_block_comment_at_position(),
                    ({ content, line_offsets, block_start_line, block_end_line }) => {
                        const my_sections = extract_sections(content, line_offsets);

                        // Should detect exactly one section
                        if (my_sections.length !== 1) {
                            return false;
                        }

                        const my_section = my_sections[0];

                        // Section range should start at block_start_line (top delimiter)
                        // and end at block_end_line (bottom delimiter)
                        return my_section.range.start.line === block_start_line &&
                            my_section.range.end.line === block_end_line;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty B: No duplicate sections are detected for consumed lines.
         * When a block comment is detected, no other detection phase should create
         * a section starting on any of the three consumed lines.
         */
        it('should not detect duplicate sections for consumed lines', () => {
            fc.assert(
                fc.property(
                    arbitrary_block_comment_at_position(),
                    ({ content, line_offsets, block_start_line, heading_line, block_end_line }) => {
                        const my_sections = extract_sections(content, line_offsets);

                        // Collect all start lines from detected sections
                        const my_start_lines = my_sections.map((s) => s.range.start.line);

                        // Check that no start line appears more than once
                        const my_unique_start_lines = new Set(my_start_lines);
                        if (my_unique_start_lines.size !== my_start_lines.length) {
                            return false;
                        }

                        // Check that none of the three block comment lines appear as
                        // start lines of multiple sections
                        const my_block_lines = [block_start_line, heading_line, block_end_line];
                        for (const my_line of my_block_lines) {
                            const my_sections_starting_at_line = my_sections.filter(
                                (s) => s.range.start.line === my_line
                            );
                            if (my_sections_starting_at_line.length > 1) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty C: Multiple block comments in same document are all detected.
         * Each block comment should be detected exactly once, with no overlapping.
         */
        it('should detect multiple block comments without overlap', () => {
            fc.assert(
                fc.property(
                    arbitrary_multiple_block_comments(),
                    ({ content, line_offsets, block_positions }) => {
                        const my_sections = extract_sections(content, line_offsets);

                        // Filter to only banner-type sections (block comments)
                        const my_banner_sections = my_sections.filter(
                            (s) => s.detection_type === 'banner'
                        );

                        // Should detect exactly as many banner sections as block positions
                        if (my_banner_sections.length !== block_positions.length) {
                            return false;
                        }

                        // Each block position should have exactly one corresponding section
                        for (const my_pos of block_positions) {
                            const my_matching_sections = my_banner_sections.filter(
                                (s) => s.range.start.line === my_pos.start_line
                            );
                            if (my_matching_sections.length !== 1) {
                                return false;
                            }

                            // Verify the section spans all three lines
                            const my_section = my_matching_sections[0];
                            if (my_section.range.end.line !== my_pos.end_line) {
                                return false;
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty D: Consumed lines are skipped by subsequent detection phases.
         * If a block comment is detected, the middle line (which might match other
         * patterns) should not be detected as a separate section.
         */
        it('should skip consumed lines in subsequent detection phases', () => {
            fc.assert(
                fc.property(
                    arbitrary_block_comment_at_position(),
                    ({ content, line_offsets, heading_line }) => {
                        const my_sections = extract_sections(content, line_offsets);

                        // The heading line should not appear as the start line of any
                        // section other than the block comment itself
                        const my_sections_at_heading_line = my_sections.filter(
                            (s) => s.range.start.line === heading_line
                        );

                        // Should be at most 0 sections starting at the heading line
                        // (the block comment starts at the delimiter line, not the heading line)
                        return my_sections_at_heading_line.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty E: Block comment at start of file (line 0) is handled correctly.
         * The consumed lines set should include lines 0, 1, and 2.
         */
        it('should consume lines 0, 1, 2 for block comment at start of file', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 20 }),
                    (my_heading, my_asterisk_count) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_delim}\n${my_middle}\n${my_delim}\ndisplay "after"`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);

                        // Should detect exactly one banner section
                        const my_banner_sections = my_sections.filter(
                            (s) => s.detection_type === 'banner'
                        );
                        if (my_banner_sections.length !== 1) {
                            return false;
                        }

                        // Section should span lines 0-2
                        const my_section = my_banner_sections[0];
                        return my_section.range.start.line === 0 &&
                            my_section.range.end.line === 2;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty F: Block comment at end of file is handled correctly.
         * The consumed lines set should include the last three lines.
         */
        it('should consume last three lines for block comment at end of file', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 20 }),
                    fc.integer({ min: 1, max: 5 }),
                    (my_heading, my_asterisk_count, my_lines_before) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;

                        // Build document with code lines before the block comment
                        const my_before_lines = Array(my_lines_before).fill('display "before"').join('\n');
                        const my_content = `${my_before_lines}\n${my_delim}\n${my_middle}\n${my_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);

                        // Should detect exactly one banner section
                        const my_banner_sections = my_sections.filter(
                            (s) => s.detection_type === 'banner'
                        );
                        if (my_banner_sections.length !== 1) {
                            return false;
                        }

                        // Section should start at my_lines_before and end at my_lines_before + 2
                        const my_section = my_banner_sections[0];
                        const my_expected_start = my_lines_before;
                        const my_expected_end = my_lines_before + 2;

                        return my_section.range.start.line === my_expected_start &&
                            my_section.range.end.line === my_expected_end;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty G: Selection range is the middle line only (heading line).
         * This verifies that the selection range correctly identifies the heading line.
         */
        it('should set selection range to heading line only', () => {
            fc.assert(
                fc.property(
                    arbitrary_block_comment_at_position(),
                    ({ content, line_offsets, heading_line }) => {
                        const my_sections = extract_sections(content, line_offsets);

                        if (my_sections.length !== 1) {
                            return false;
                        }

                        const my_section = my_sections[0];

                        // Selection range should be the heading line only
                        return my_section.selection_range.start.line === heading_line &&
                            my_section.selection_range.end.line === heading_line;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty H: Consumed lines prevent overlapping pattern detection.
         * A block comment's delimiter lines should not be detected as part of
         * another banner section.
         */
        it('should prevent delimiter lines from being detected as other patterns', () => {
            fc.assert(
                fc.property(
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 20 }),
                    (my_heading, my_asterisk_count) => {
                        const my_delim = '*'.repeat(my_asterisk_count);
                        const my_middle = ` ${my_heading}`;
                        const my_content = `${my_delim}\n${my_middle}\n${my_delim}`;
                        const my_line_offsets = compute_line_offsets(my_content);

                        const my_sections = extract_sections(my_content, my_line_offsets);

                        // Should detect exactly one section
                        if (my_sections.length !== 1) {
                            return false;
                        }

                        // No section should start at line 1 (the heading line)
                        // or line 2 (the bottom delimiter)
                        const my_sections_at_line_1 = my_sections.filter(
                            (s) => s.range.start.line === 1
                        );
                        const my_sections_at_line_2 = my_sections.filter(
                            (s) => s.range.start.line === 2
                        );

                        return my_sections_at_line_1.length === 0 &&
                            my_sections_at_line_2.length === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ---------------------------------------------------------------------------
    // Property 6: Pure Heading Line Validation
    // ---------------------------------------------------------------------------

    /**
     * Feature: stata-outline-improvements, Property 6: Pure Heading Line Validation
     *
     * *For any* line with 4 or more spaces of leading whitespace or starting with
     * a tab character, if it matches a numbered section pattern, it should not be
     * detected as a section.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     */
    describe('Property 6: Pure Heading Line Validation', () => {
        /**
         * Generate a numbered section pattern (e.g., "* 1.1 Section Name").
         * This represents the content portion without leading indentation.
         */
        function arbitrary_numbered_section_content(): fc.Arbitrary<string> {
            const my_comment_marker = fc.constantFrom('*', '//');
            const my_section_number = fc.tuple(
                fc.integer({ min: 1, max: 99 }),
                fc.option(fc.integer({ min: 1, max: 99 }), { nil: undefined })
            ).map(([my_major, my_minor]) => {
                if (my_minor !== undefined) {
                    return `${my_major}.${my_minor}`;
                }
                return `${my_major}`;
            });
            const my_section_name = fc.stringOf(
                fc.constantFrom('a', 'b', 'c', 'd', 'e', 'A', 'B', 'C', ' ', '_'),
                { minLength: 1, maxLength: 20 }
            ).filter((s) => s.trim().length > 0);

            return fc
                .tuple(my_comment_marker, my_section_number, my_section_name)
                .map(([my_marker, my_number, my_name]) => {
                    return `${my_marker} ${my_number} ${my_name.trim()}`;
                });
        }

        /**
         * Generate a line with 4+ spaces of leading whitespace (should NOT be a heading).
         */
        function arbitrary_indented_line_4_plus_spaces(): fc.Arbitrary<string> {
            const my_space_count = fc.integer({ min: 4, max: 10 });
            const my_content = arbitrary_numbered_section_content();

            return fc
                .tuple(my_space_count, my_content)
                .map(([my_count, my_content]) => {
                    const my_spaces = ' '.repeat(my_count);
                    return `${my_spaces}${my_content}`;
                });
        }

        /**
         * Generate a line starting with a tab character (should NOT be a heading).
         */
        function arbitrary_tab_indented_line(): fc.Arbitrary<string> {
            const my_tab_count = fc.integer({ min: 1, max: 3 });
            const my_content = arbitrary_numbered_section_content();

            return fc
                .tuple(my_tab_count, my_content)
                .map(([my_count, my_content]) => {
                    const my_tabs = '\t'.repeat(my_count);
                    return `${my_tabs}${my_content}`;
                });
        }

        /**
         * Generate a line with 0-3 spaces of leading whitespace (SHOULD be a heading).
         */
        function arbitrary_minimal_indent_line(): fc.Arbitrary<string> {
            const my_space_count = fc.integer({ min: 0, max: 3 });
            const my_content = arbitrary_numbered_section_content();

            return fc
                .tuple(my_space_count, my_content)
                .map(([my_count, my_content]) => {
                    const my_spaces = ' '.repeat(my_count);
                    return `${my_spaces}${my_content}`;
                });
        }

        /**
         * Subproperty A: Lines with 4+ spaces of leading whitespace are NOT standalone headings.
         */
        it('should reject lines with 4+ spaces of leading whitespace', () => {
            fc.assert(
                fc.property(
                    arbitrary_indented_line_4_plus_spaces(),
                    (my_line) => {
                        const my_result = is_standalone_heading(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty B: Lines starting with a tab character are NOT standalone headings.
         */
        it('should reject lines starting with a tab character', () => {
            fc.assert(
                fc.property(
                    arbitrary_tab_indented_line(),
                    (my_line) => {
                        const my_result = is_standalone_heading(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty C: Lines with 0-3 spaces of leading whitespace ARE standalone headings.
         */
        it('should accept lines with 0-3 spaces of leading whitespace', () => {
            fc.assert(
                fc.property(
                    arbitrary_minimal_indent_line(),
                    (my_line) => {
                        const my_result = is_standalone_heading(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty D: Exact boundary test - exactly 4 spaces is NOT a standalone heading.
         */
        it('should reject lines with exactly 4 spaces of leading whitespace', () => {
            fc.assert(
                fc.property(
                    arbitrary_numbered_section_content(),
                    (my_content) => {
                        const my_line = `    ${my_content}`; // exactly 4 spaces
                        const my_result = is_standalone_heading(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty E: Exact boundary test - exactly 3 spaces IS a standalone heading.
         */
        it('should accept lines with exactly 3 spaces of leading whitespace', () => {
            fc.assert(
                fc.property(
                    arbitrary_numbered_section_content(),
                    (my_content) => {
                        const my_line = `   ${my_content}`; // exactly 3 spaces
                        const my_result = is_standalone_heading(my_line);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty F: Lines at column 0 (no indentation) ARE standalone headings.
         */
        it('should accept lines at column 0 (no indentation)', () => {
            fc.assert(
                fc.property(
                    arbitrary_numbered_section_content(),
                    (my_content) => {
                        const my_result = is_standalone_heading(my_content);
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty G: Mixed indentation - tab followed by spaces is NOT a standalone heading.
         */
        it('should reject lines with tab followed by spaces', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 5 }),
                    arbitrary_numbered_section_content(),
                    (my_space_count, my_content) => {
                        const my_spaces = ' '.repeat(my_space_count);
                        const my_line = `\t${my_spaces}${my_content}`;
                        const my_result = is_standalone_heading(my_line);
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty H: Spaces followed by tab - any tab in leading whitespace rejects.
         */
        it('should handle spaces followed by tab based on position and whitespace count', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    arbitrary_numbered_section_content(),
                    (my_space_count, my_content) => {
                        const my_spaces = ' '.repeat(my_space_count);
                        const my_line = `${my_spaces}\t${my_content}`;
                        const my_result = is_standalone_heading(my_line);

                        // Any tab in leading whitespace means indented → always rejected
                        return my_result === false;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Subproperty I: Empty lines and whitespace-only lines behavior.
         * Empty lines have 0 leading whitespace, so they pass the check.
         * Whitespace-only lines depend on the whitespace count.
         */
        it('should handle empty and whitespace-only lines based on whitespace count', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 10 }),
                    (my_whitespace) => {
                        const my_result = is_standalone_heading(my_whitespace);
                        // Empty string or < 4 spaces should return true
                        // 4+ spaces should return false
                        if (my_whitespace.length >= 4) {
                            return my_result === false;
                        }
                        return my_result === true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});


// ---------------------------------------------------------------------------
// Generators for delimiter character counting
// ---------------------------------------------------------------------------

/**
 * All supported delimiter kinds for banner sections.
 */
const ALL_DELIMITER_KINDS: DelimiterKind[] = ['asterisk', 'dash', 'slash', 'equals', 'plus'];

/**
 * Map delimiter kind to its character.
 */
function delimiter_kind_to_char(kind: DelimiterKind): string {
    switch (kind) {
        case 'dash': return '-';
        case 'asterisk': return '*';
        case 'slash': return '/';
        case 'equals': return '=';
        case 'plus': return '+';
    }
}

/**
 * Calculate expected level from delimiter count according to the formula:
 * - 4 chars → level 1
 * - 5-7 chars → level 2
 * - 8-11 chars → level 3
 * - 12+ chars → level 4
 */
function expected_level_from_count(count: number): number {
    if (count <= 4) return 1;
    if (count <= 7) return 2;
    if (count <= 11) return 3;
    return 4;
}

/**
 * Generate a pure delimiter line (e.g., `****`, `//////`).
 */
function arbitrary_pure_delimiter_line(
    kind: DelimiterKind,
    min_count: number = 4,
    max_count: number = 20
): fc.Arbitrary<{ line: string; count: number }> {
    const my_char = delimiter_kind_to_char(kind);
    const my_count = fc.integer({ min: min_count, max: max_count });
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_count, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_leading, my_trailing]) => {
            const my_delimiters = my_char.repeat(my_count);
            return {
                line: `${my_leading}${my_delimiters}${my_trailing}`,
                count: my_count,
            };
        });
}

/**
 * Generate a comment-prefixed delimiter line (e.g., `// ====`, `* ----`).
 */
function arbitrary_comment_prefixed_delimiter_line(
    kind: DelimiterKind,
    min_count: number = 4,
    max_count: number = 20
): fc.Arbitrary<{ line: string; count: number }> {
    const my_char = delimiter_kind_to_char(kind);
    const my_count = fc.integer({ min: min_count, max: max_count });
    const my_prefix_type = fc.constantFrom('slash', 'star');
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_count, my_prefix_type, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_prefix_type, my_leading, my_trailing]) => {
            const my_delimiters = my_char.repeat(my_count);
            const my_prefix = my_prefix_type === 'slash' ? '// ' : '* ';
            return {
                line: `${my_leading}${my_prefix}${my_delimiters}${my_trailing}`,
                count: my_count,
            };
        });
}

/**
 * Generate an asterisk delimiter line with comment prefix/suffix.
 * Examples: slash followed by asterisks, or asterisks followed by slash.
 */
function arbitrary_asterisk_comment_form(): fc.Arbitrary<{ line: string; count: number }> {
    const my_count = fc.integer({ min: 4, max: 20 });
    const my_form = fc.constantFrom('prefix', 'suffix', 'both');
    const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });
    const my_trailing_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 });

    return fc
        .tuple(my_count, my_form, my_leading_spaces, my_trailing_spaces)
        .map(([my_count, my_form, my_leading, my_trailing]) => {
            const my_asterisks = '*'.repeat(my_count);
            let my_line: string;
            if (my_form === 'prefix') {
                my_line = `${my_leading}/${my_asterisks}${my_trailing}`;
            } else if (my_form === 'suffix') {
                my_line = `${my_leading}${my_asterisks}/${my_trailing}`;
            } else {
                my_line = `${my_leading}/${my_asterisks}/${my_trailing}`;
            }
            return {
                line: my_line,
                count: my_count,
            };
        });
}

// ---------------------------------------------------------------------------
// Property 4: Banner Section Level Derivation
// ---------------------------------------------------------------------------

describe('Property 4: Banner Section Level Derivation', () => {
    /**
     * Feature: stata-outline-improvements, Property 4: Banner Section Level Derivation
     *
     * *For any* banner section with delimiter lines containing N delimiter characters,
     * the assigned nesting level should be correctly derived from N according to the
     * level calculation formula (4 chars → level 1, 5-7 → level 2, 8-11 → level 3, 12+ → level 4).
     *
     * **Validates: Requirements 2.4**
     */

    /**
     * Subproperty A: Pure delimiter lines - count matches actual delimiter characters.
     * Tests all delimiter kinds (asterisk, dash, slash, equals, plus).
     */
    it('should correctly count delimiter characters in pure delimiter lines', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.integer({ min: 4, max: 20 }),
                (my_kind, my_count) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(my_count);
                    const my_result = count_delimiter_chars(my_line, my_kind);
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty B: Pure delimiter lines with whitespace - count ignores whitespace.
     */
    it('should correctly count delimiter characters ignoring leading/trailing whitespace', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.integer({ min: 4, max: 20 }),
                fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 5 }),
                (my_kind, my_count, my_leading, my_trailing) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_delimiters = my_char.repeat(my_count);
                    const my_line = `${my_leading}${my_delimiters}${my_trailing}`;
                    const my_result = count_delimiter_chars(my_line, my_kind);
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty C: Comment-prefixed delimiter lines (// ====, * ----).
     * Count should match the delimiter characters after the prefix.
     */
    it('should correctly count delimiter characters in comment-prefixed lines', () => {
        // Test with slash prefix: // ====
        fc.assert(
            fc.property(
                fc.constantFrom('dash', 'equals', 'plus') as fc.Arbitrary<DelimiterKind>,
                fc.integer({ min: 4, max: 20 }),
                (my_kind, my_count) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_delimiters = my_char.repeat(my_count);
                    const my_line = `// ${my_delimiters}`;
                    const my_result = count_delimiter_chars(my_line, my_kind);
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty D: Star-prefixed delimiter lines (* ----).
     * Count should match the delimiter characters after the prefix.
     */
    it('should correctly count delimiter characters in star-prefixed lines', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('dash', 'equals', 'plus') as fc.Arbitrary<DelimiterKind>,
                fc.integer({ min: 4, max: 20 }),
                (my_kind, my_count) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_delimiters = my_char.repeat(my_count);
                    const my_line = `* ${my_delimiters}`;
                    const my_result = count_delimiter_chars(my_line, my_kind);
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty E: Asterisk delimiter with comment prefix (/****).
     */
    it('should correctly count asterisks in comment-prefixed asterisk lines', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 4, max: 20 }),
                (my_count) => {
                    const my_asterisks = '*'.repeat(my_count);
                    const my_line = `/${my_asterisks}`;
                    const my_result = count_delimiter_chars(my_line, 'asterisk');
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty F: Asterisk delimiter with comment suffix (asterisks followed by slash).
     */
    it('should correctly count asterisks in comment-suffixed asterisk lines', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 4, max: 20 }),
                (my_count) => {
                    const my_asterisks = '*'.repeat(my_count);
                    const my_line = `${my_asterisks}/`;
                    const my_result = count_delimiter_chars(my_line, 'asterisk');
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty G: Asterisk delimiter with both prefix and suffix (slash-asterisks-slash).
     */
    it('should correctly count asterisks in comment-wrapped asterisk lines', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 4, max: 20 }),
                (my_count) => {
                    const my_asterisks = '*'.repeat(my_count);
                    const my_line = `/${my_asterisks}/`;
                    const my_result = count_delimiter_chars(my_line, 'asterisk');
                    return my_result === my_count;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty H: Level derivation formula - 4 chars → level 1.
     */
    it('should derive level 1 for exactly 4 delimiter characters', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                (my_kind) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(4);
                    const my_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_count);
                    return my_count === 4 && my_level === 1;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty I: Level derivation formula - 5-7 chars → level 2.
     */
    it('should derive level 2 for 5-7 delimiter characters', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.integer({ min: 5, max: 7 }),
                (my_kind, my_count) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(my_count);
                    const my_actual_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_actual_count);
                    return my_actual_count === my_count && my_level === 2;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty J: Level derivation formula - 8-11 chars → level 3.
     */
    it('should derive level 3 for 8-11 delimiter characters', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.integer({ min: 8, max: 11 }),
                (my_kind, my_count) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(my_count);
                    const my_actual_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_actual_count);
                    return my_actual_count === my_count && my_level === 3;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty K: Level derivation formula - 12+ chars → level 4.
     */
    it('should derive level 4 for 12+ delimiter characters', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.integer({ min: 12, max: 20 }),
                (my_kind, my_count) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(my_count);
                    const my_actual_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_actual_count);
                    return my_actual_count === my_count && my_level === 4;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty L: Level derivation at boundary - exactly 5 chars → level 2.
     */
    it('should derive level 2 for exactly 5 delimiter characters (boundary)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                (my_kind) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(5);
                    const my_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_count);
                    return my_count === 5 && my_level === 2;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty M: Level derivation at boundary - exactly 8 chars → level 3.
     */
    it('should derive level 3 for exactly 8 delimiter characters (boundary)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                (my_kind) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(8);
                    const my_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_count);
                    return my_count === 8 && my_level === 3;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty N: Level derivation at boundary - exactly 12 chars → level 4.
     */
    it('should derive level 4 for exactly 12 delimiter characters (boundary)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                (my_kind) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_line = my_char.repeat(12);
                    const my_count = count_delimiter_chars(my_line, my_kind);
                    const my_level = expected_level_from_count(my_count);
                    return my_count === 12 && my_level === 4;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty O: Empty lines return count 0.
     */
    it('should return 0 for empty lines', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                (my_kind) => {
                    const my_result = count_delimiter_chars('', my_kind);
                    return my_result === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty P: Whitespace-only lines return count 0.
     */
    it('should return 0 for whitespace-only lines', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 10 }),
                (my_kind, my_whitespace) => {
                    const my_result = count_delimiter_chars(my_whitespace, my_kind);
                    return my_result === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty Q: Mismatched delimiter kind returns 0.
     * E.g., counting dashes in a line of asterisks should return 0.
     */
    it('should return 0 when counting wrong delimiter kind', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.constantFrom(...ALL_DELIMITER_KINDS),
                fc.integer({ min: 4, max: 20 }),
                (my_line_kind, my_count_kind, my_count) => {
                    // Skip if kinds match (that's tested elsewhere)
                    if (my_line_kind === my_count_kind) return true;
                    
                    const my_char = delimiter_kind_to_char(my_line_kind);
                    const my_line = my_char.repeat(my_count);
                    const my_result = count_delimiter_chars(my_line, my_count_kind);
                    return my_result === 0;
                }
            ),
            { numRuns: 100 }
        );
    });
});


// ---------------------------------------------------------------------------
// Property 5: Minimum Level for Mismatched Delimiters
// ---------------------------------------------------------------------------

describe('Property 5: Minimum Level for Mismatched Delimiters', () => {
    /**
     * Feature: stata-outline-improvements, Property 5: Minimum Level for Mismatched Delimiters
     *
     * *For any* banner section where the top delimiter has N characters and the
     * bottom delimiter has M characters (where N ≠ M), the assigned nesting level
     * should be derived from min(N, M).
     *
     * **Validates: Requirements 2.5**
     */

    /**
     * Generate random heading text content.
     * Includes alphanumeric characters, spaces, and some special characters.
     * Excludes asterisks to avoid confusion with delimiters.
     */
    function arbitrary_heading_text(): fc.Arbitrary<string> {
        const my_char = fc.constantFrom(
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
            'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
            'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            ' ', '_', '-', '(', ')', '[', ']', ':', ';', ',', '.'
        );
        return fc.stringOf(my_char, { minLength: 3, maxLength: 50 })
            .filter((s) => s.trim().length >= 3); // Ensure non-trivial content
    }

    /**
     * Compute line offsets for a document content string.
     */
    function compute_line_offsets(content: string): number[] {
        const my_offsets: number[] = [0];
        for (let my_i = 0; my_i < content.length; my_i++) {
            if (content[my_i] === '\n') {
                my_offsets.push(my_i + 1);
            }
        }
        return my_offsets;
    }

    /**
     * Calculate expected level from delimiter count according to the formula:
     * - 4 chars → level 1
     * - 5-7 chars → level 2
     * - 8-11 chars → level 3
     * - 12+ chars → level 4
     */
    function expected_level_from_count(count: number): number {
        if (count <= 4) return 1;
        if (count <= 7) return 2;
        if (count <= 11) return 3;
        return 4;
    }

    /**
     * Generate two different delimiter counts for mismatched delimiters.
     * Ensures top_count !== bottom_count.
     */
    function arbitrary_mismatched_counts(): fc.Arbitrary<{ top_count: number; bottom_count: number }> {
        return fc
            .tuple(
                fc.integer({ min: 4, max: 20 }),
                fc.integer({ min: 4, max: 20 })
            )
            .filter(([my_top, my_bottom]) => my_top !== my_bottom)
            .map(([my_top, my_bottom]) => ({
                top_count: my_top,
                bottom_count: my_bottom,
            }));
    }

    /**
     * Subproperty A: Block comment headings with mismatched asterisk delimiters
     * use minimum count for level derivation.
     */
    it('should derive level from minimum count for block comment headings with mismatched asterisks', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                (my_heading, { top_count, bottom_count }) => {
                    const my_top_delim = '*'.repeat(top_count);
                    const my_bottom_delim = '*'.repeat(bottom_count);
                    const my_middle = ` ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty B: Standard banner sections with mismatched dash delimiters
     * use minimum count for level derivation.
     */
    it('should derive level from minimum count for banner sections with mismatched dashes', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                (my_heading, { top_count, bottom_count }) => {
                    const my_top_delim = '// ' + '-'.repeat(top_count);
                    const my_bottom_delim = '// ' + '-'.repeat(bottom_count);
                    const my_middle = `// ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty C: Standard banner sections with mismatched equals delimiters
     * use minimum count for level derivation.
     */
    it('should derive level from minimum count for banner sections with mismatched equals', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                (my_heading, { top_count, bottom_count }) => {
                    const my_top_delim = '// ' + '='.repeat(top_count);
                    const my_bottom_delim = '// ' + '='.repeat(bottom_count);
                    const my_middle = `// ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty D: Standard banner sections with mismatched plus delimiters
     * use minimum count for level derivation.
     */
    it('should derive level from minimum count for banner sections with mismatched plus', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                (my_heading, { top_count, bottom_count }) => {
                    const my_top_delim = '// ' + '+'.repeat(top_count);
                    const my_bottom_delim = '// ' + '+'.repeat(bottom_count);
                    const my_middle = `// ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty E: Block comment with comment-prefixed/suffixed asterisk delimiters
     * with mismatched counts uses minimum for level derivation.
     */
    it('should derive level from minimum count for block comments with comment-wrapped asterisks', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                fc.constantFrom('prefix', 'suffix', 'both'),
                fc.constantFrom('prefix', 'suffix', 'both'),
                (my_heading, { top_count, bottom_count }, my_top_form, my_bottom_form) => {
                    // Build top delimiter
                    const my_top_asterisks = '*'.repeat(top_count);
                    let my_top_delim: string;
                    switch (my_top_form) {
                        case 'prefix': my_top_delim = '/' + my_top_asterisks; break;
                        case 'suffix': my_top_delim = my_top_asterisks + '/'; break;
                        case 'both': my_top_delim = '/' + my_top_asterisks + '/'; break;
                    }

                    // Build bottom delimiter
                    const my_bottom_asterisks = '*'.repeat(bottom_count);
                    let my_bottom_delim: string;
                    switch (my_bottom_form) {
                        case 'prefix': my_bottom_delim = '/' + my_bottom_asterisks; break;
                        case 'suffix': my_bottom_delim = my_bottom_asterisks + '/'; break;
                        case 'both': my_bottom_delim = '/' + my_bottom_asterisks + '/'; break;
                    }

                    const my_middle = ` ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty F: Level derivation with mismatched counts crossing level boundaries.
     * Tests cases where top and bottom counts would individually produce different levels.
     */
    it('should use minimum count when top and bottom would produce different levels', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                // Generate counts that cross level boundaries
                fc.constantFrom(
                    { top: 4, bottom: 5 },   // level 1 vs level 2 → min=4 → level 1
                    { top: 5, bottom: 4 },   // level 2 vs level 1 → min=4 → level 1
                    { top: 7, bottom: 8 },   // level 2 vs level 3 → min=7 → level 2
                    { top: 8, bottom: 7 },   // level 3 vs level 2 → min=7 → level 2
                    { top: 11, bottom: 12 }, // level 3 vs level 4 → min=11 → level 3
                    { top: 12, bottom: 11 }, // level 4 vs level 3 → min=11 → level 3
                    { top: 4, bottom: 12 },  // level 1 vs level 4 → min=4 → level 1
                    { top: 12, bottom: 4 },  // level 4 vs level 1 → min=4 → level 1
                    { top: 5, bottom: 11 },  // level 2 vs level 3 → min=5 → level 2
                    { top: 11, bottom: 5 },  // level 3 vs level 2 → min=5 → level 2
                ),
                (my_heading, { top, bottom }) => {
                    const my_top_delim = '*'.repeat(top);
                    const my_bottom_delim = '*'.repeat(bottom);
                    const my_middle = ` ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top, bottom);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty G: Star-prefixed banner sections with mismatched delimiters.
     * Tests `* ----` style delimiters with different counts.
     */
    it('should derive level from minimum count for star-prefixed banner sections', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                fc.constantFrom('dash', 'equals', 'plus') as fc.Arbitrary<DelimiterKind>,
                (my_heading, { top_count, bottom_count }, my_kind) => {
                    const my_char = delimiter_kind_to_char(my_kind);
                    const my_top_delim = '* ' + my_char.repeat(top_count);
                    const my_bottom_delim = '* ' + my_char.repeat(bottom_count);
                    const my_middle = `* ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty H: Pure slash delimiter lines with mismatched counts.
     * Tests `//////` style delimiters with different counts.
     */
    it('should derive level from minimum count for pure slash delimiter banner sections', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                (my_heading, { top_count, bottom_count }) => {
                    const my_top_delim = '/'.repeat(top_count);
                    const my_bottom_delim = '/'.repeat(bottom_count);
                    const my_middle = `// ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty I: Verify minimum is used regardless of which delimiter is larger.
     * Tests both top > bottom and top < bottom cases explicitly.
     */
    it('should use minimum regardless of which delimiter is larger', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 10 }),
                fc.integer({ min: 11, max: 20 }),
                fc.boolean(),
                (my_heading, my_small_count, my_large_count, my_top_is_larger) => {
                    const my_top_count = my_top_is_larger ? my_large_count : my_small_count;
                    const my_bottom_count = my_top_is_larger ? my_small_count : my_large_count;

                    const my_top_delim = '*'.repeat(my_top_count);
                    const my_bottom_delim = '*'.repeat(my_bottom_count);
                    const my_middle = ` ${my_heading}`;
                    const my_content = `${my_top_delim}\n${my_middle}\n${my_bottom_delim}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // The minimum should always be my_small_count
                    const my_expected_level = expected_level_from_count(my_small_count);

                    return my_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty J: Mismatched delimiters in document with surrounding code.
     * Verifies level calculation works correctly when block comment is not at file boundaries.
     */
    it('should derive level from minimum count for block comments in middle of document', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_mismatched_counts(),
                fc.integer({ min: 1, max: 5 }),
                fc.integer({ min: 1, max: 5 }),
                (my_heading, { top_count, bottom_count }, my_lines_before, my_lines_after) => {
                    const my_top_delim = '*'.repeat(top_count);
                    const my_bottom_delim = '*'.repeat(bottom_count);
                    const my_middle = ` ${my_heading}`;

                    // Add code lines before and after
                    const my_before_lines = Array(my_lines_before).fill('display "hello"').join('\n');
                    const my_after_lines = Array(my_lines_after).fill('gen x = 1').join('\n');

                    const my_content = `${my_before_lines}\n${my_top_delim}\n${my_middle}\n${my_bottom_delim}\n${my_after_lines}`;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one banner section
                    const my_banner_sections = my_sections.filter(
                        (s) => s.detection_type === 'banner'
                    );

                    if (my_banner_sections.length !== 1) {
                        return false;
                    }

                    const my_min_count = Math.min(top_count, bottom_count);
                    const my_expected_level = expected_level_from_count(my_min_count);

                    return my_banner_sections[0].level === my_expected_level;
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 7: Backward Compatibility for Mixed Patterns
// ---------------------------------------------------------------------------

describe('Property 7: Backward Compatibility for Mixed Patterns', () => {
    /**
     * Feature: stata-outline-improvements, Property 7: Backward Compatibility for Mixed Patterns
     *
     * *For any* document containing multiple section pattern types (single-line,
     * banner, starred inline, numbered), all valid patterns should be detected
     * according to their respective detection rules and priority ordering.
     *
     * **Validates: Requirements 4.5**
     */

    /**
     * Generate random heading text content.
     * Includes alphanumeric characters, spaces, and some special characters.
     * Excludes asterisks and dashes to avoid confusion with delimiters.
     */
    function arbitrary_heading_text(): fc.Arbitrary<string> {
        const my_char = fc.constantFrom(
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
            'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
            'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            ' ', '_', '(', ')', '[', ']', ':', ';', ','
        );
        return fc.stringOf(my_char, { minLength: 3, maxLength: 30 })
            .filter((s) => s.trim().length >= 3); // Ensure non-trivial content
    }

    /**
     * Compute line offsets for a document content string.
     */
    function compute_line_offsets(content: string): number[] {
        const my_offsets: number[] = [0];
        for (let my_i = 0; my_i < content.length; my_i++) {
            if (content[my_i] === '\n') {
                my_offsets.push(my_i + 1);
            }
        }
        return my_offsets;
    }

    /**
     * Generate a single-line section pattern.
     * Format: `// Section Name ----` or `* Section Name ----`
     */
    function arbitrary_single_line_section(): fc.Arbitrary<{
        lines: string[];
        expected_name: string;
        expected_type: 'single_line';
    }> {
        const my_prefix = fc.constantFrom('//', '*');
        const my_delimiter = fc.constantFrom('-', '=', '+');
        const my_delimiter_count = fc.integer({ min: 4, max: 10 });

        return fc
            .tuple(arbitrary_heading_text(), my_prefix, my_delimiter, my_delimiter_count)
            .map(([my_heading, my_prefix, my_delim, my_count]) => {
                const my_delimiters = my_delim.repeat(my_count);
                const my_line = `${my_prefix} ${my_heading.trim()} ${my_delimiters}`;
                return {
                    lines: [my_line],
                    expected_name: my_heading.trim(),
                    expected_type: 'single_line' as const,
                };
            });
    }

    /**
     * Generate a banner section pattern.
     * Format: 3-line delimiter/name/delimiter block.
     */
    function arbitrary_banner_section(): fc.Arbitrary<{
        lines: string[];
        expected_name: string;
        expected_type: 'banner';
    }> {
        const my_delimiter = fc.constantFrom('-', '=', '+');
        const my_delimiter_count = fc.integer({ min: 4, max: 15 });

        return fc
            .tuple(arbitrary_heading_text(), my_delimiter, my_delimiter_count)
            .map(([my_heading, my_delim, my_count]) => {
                const my_delimiters = my_delim.repeat(my_count);
                const my_top = `// ${my_delimiters}`;
                const my_middle = `// ${my_heading.trim()}`;
                const my_bottom = `// ${my_delimiters}`;
                return {
                    lines: [my_top, my_middle, my_bottom],
                    expected_name: my_heading.trim(),
                    expected_type: 'banner' as const,
                };
            });
    }

    /**
     * Generate a starred inline section pattern.
     * Format: `*** Section Name ***`
     */
    function arbitrary_starred_inline_section(): fc.Arbitrary<{
        lines: string[];
        expected_name: string;
        expected_type: 'starred_inline';
    }> {
        const my_asterisk_count = fc.integer({ min: 2, max: 5 });

        return fc
            .tuple(arbitrary_heading_text(), my_asterisk_count)
            .map(([my_heading, my_count]) => {
                const my_asterisks = '*'.repeat(my_count);
                const my_line = `${my_asterisks} ${my_heading.trim()} ${my_asterisks}`;
                return {
                    lines: [my_line],
                    expected_name: my_heading.trim(),
                    expected_type: 'starred_inline' as const,
                };
            });
    }

    /**
     * Generate a numbered section pattern.
     * Format: `* 1.1 Section Name`
     * Note: The detected name includes the number prefix (e.g., "1.1 Section Name")
     */
    function arbitrary_numbered_section(): fc.Arbitrary<{
        lines: string[];
        expected_name: string;
        expected_type: 'numbered';
        expected_number: string;
    }> {
        const my_prefix = fc.constantFrom('*', '//');
        const my_major = fc.integer({ min: 1, max: 9 });
        const my_minor = fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined });

        return fc
            .tuple(arbitrary_heading_text(), my_prefix, my_major, my_minor)
            .map(([my_heading, my_prefix, my_major, my_minor]) => {
                const my_number = my_minor !== undefined
                    ? `${my_major}.${my_minor}`
                    : `${my_major}`;
                const my_line = `${my_prefix} ${my_number} ${my_heading.trim()}`;
                // The detected name includes the number prefix
                const my_expected_name = `${my_number} ${my_heading.trim()}`;
                return {
                    lines: [my_line],
                    expected_name: my_expected_name,
                    expected_type: 'numbered' as const,
                    expected_number: my_number,
                };
            });
    }

    /**
     * Generate a block comment heading pattern.
     * Format: 3-line asterisk delimiter/heading/delimiter block.
     */
    function arbitrary_block_comment_section(): fc.Arbitrary<{
        lines: string[];
        expected_name: string;
        expected_type: 'banner';
    }> {
        const my_asterisk_count = fc.integer({ min: 4, max: 15 });

        return fc
            .tuple(arbitrary_heading_text(), my_asterisk_count)
            .map(([my_heading, my_count]) => {
                const my_asterisks = '*'.repeat(my_count);
                const my_top = `/${my_asterisks}`;
                const my_middle = ` ${my_heading.trim()}`;
                const my_bottom = `${my_asterisks}/`;
                return {
                    lines: [my_top, my_middle, my_bottom],
                    expected_name: my_heading.trim(),
                    expected_type: 'banner' as const,
                };
            });
    }

    /**
     * Generate a document with multiple pattern types.
     * Returns the document content, line offsets, and expected sections.
     */
    function arbitrary_mixed_pattern_document(): fc.Arbitrary<{
        content: string;
        line_offsets: number[];
        expected_sections: Array<{
            name: string;
            type: 'single_line' | 'banner' | 'starred_inline' | 'numbered';
            start_line: number;
        }>;
    }> {
        // Generate 2-4 sections of different types
        const my_section_count = fc.integer({ min: 2, max: 4 });

        return my_section_count.chain((my_count) => {
            // Generate a mix of section types
            const my_section_generators = fc.array(
                fc.oneof(
                    arbitrary_single_line_section(),
                    arbitrary_banner_section(),
                    arbitrary_starred_inline_section(),
                    arbitrary_numbered_section().map((s) => ({
                        lines: s.lines,
                        expected_name: s.expected_name,
                        expected_type: s.expected_type,
                    }))
                ),
                { minLength: my_count, maxLength: my_count }
            );

            return my_section_generators.map((my_sections) => {
                const my_all_lines: string[] = [];
                const my_expected_sections: Array<{
                    name: string;
                    type: 'single_line' | 'banner' | 'starred_inline' | 'numbered';
                    start_line: number;
                }> = [];

                // Add initial code line
                my_all_lines.push('display "start"');

                for (const my_section of my_sections) {
                    const my_start_line = my_all_lines.length;
                    my_all_lines.push(...my_section.lines);
                    my_expected_sections.push({
                        name: my_section.expected_name,
                        type: my_section.expected_type,
                        start_line: my_start_line,
                    });

                    // Add separator code line
                    my_all_lines.push('gen x = 1');
                }

                const my_content = my_all_lines.join('\n');
                const my_line_offsets = compute_line_offsets(my_content);

                return {
                    content: my_content,
                    line_offsets: my_line_offsets,
                    expected_sections: my_expected_sections,
                };
            });
        });
    }

    /**
     * Subproperty A: All pattern types in a mixed document are detected.
     * Each section should be detected with the correct detection type.
     */
    it('should detect all pattern types in a mixed document', () => {
        fc.assert(
            fc.property(
                arbitrary_mixed_pattern_document(),
                ({ content, line_offsets, expected_sections }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Should detect at least as many sections as expected
                    if (my_sections.length < expected_sections.length) {
                        return false;
                    }

                    // Each expected section should have a corresponding detected section
                    for (const my_expected of expected_sections) {
                        const my_matching = my_sections.find(
                            (s) => s.name === my_expected.name &&
                                s.detection_type === my_expected.type
                        );
                        if (!my_matching) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty B: Single-line sections are detected correctly.
     * Tests backward compatibility for single-line section patterns.
     */
    it('should detect single-line sections with various delimiters', () => {
        fc.assert(
            fc.property(
                arbitrary_single_line_section(),
                ({ lines, expected_name }) => {
                    const my_content = lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // Should be detected as single_line type
                    return my_sections[0].detection_type === 'single_line' &&
                        my_sections[0].name === expected_name;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty C: Banner sections are detected correctly.
     * Tests backward compatibility for banner section patterns.
     */
    it('should detect banner sections with matching delimiters', () => {
        fc.assert(
            fc.property(
                arbitrary_banner_section(),
                ({ lines, expected_name }) => {
                    const my_content = lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // Should be detected as banner type
                    return my_sections[0].detection_type === 'banner' &&
                        my_sections[0].name === expected_name;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty D: Starred inline sections are detected correctly.
     * Tests backward compatibility for starred inline section patterns.
     */
    it('should detect starred inline sections', () => {
        fc.assert(
            fc.property(
                arbitrary_starred_inline_section(),
                ({ lines, expected_name }) => {
                    const my_content = lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // Should be detected as starred_inline type
                    return my_sections[0].detection_type === 'starred_inline' &&
                        my_sections[0].name === expected_name;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty E: Numbered sections are detected correctly.
     * Tests backward compatibility for numbered section patterns.
     */
    it('should detect numbered sections at column 0', () => {
        fc.assert(
            fc.property(
                arbitrary_numbered_section(),
                ({ lines, expected_name }) => {
                    const my_content = lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // Should be detected as numbered type
                    return my_sections[0].detection_type === 'numbered' &&
                        my_sections[0].name === expected_name;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty F: Block comment headings are detected correctly.
     * Tests the new block comment heading feature.
     */
    it('should detect block comment headings as banner type', () => {
        fc.assert(
            fc.property(
                arbitrary_block_comment_section(),
                ({ lines, expected_name }) => {
                    const my_content = lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // Should be detected as banner type
                    return my_sections[0].detection_type === 'banner' &&
                        my_sections[0].name === expected_name;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty G: Priority ordering - single-line sections have highest priority.
     * When a line could match multiple patterns, single-line should win.
     */
    it('should prioritize single-line sections over other patterns', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 10 }),
                (my_heading, my_delim_count) => {
                    // Create a single-line section that could potentially be part of a banner
                    const my_delimiters = '-'.repeat(my_delim_count);
                    const my_line = `// ${my_heading.trim()} ${my_delimiters}`;
                    const my_content = my_line;
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect as single_line, not banner
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    return my_sections[0].detection_type === 'single_line';
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty H: Document with all four pattern types detects all sections.
     * Comprehensive test with one of each pattern type.
     */
    it('should detect all four pattern types in a single document', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_heading_text(),
                    arbitrary_heading_text(),
                    arbitrary_heading_text(),
                    arbitrary_heading_text()
                ),
                ([my_single_name, my_banner_name, my_starred_name, my_numbered_name]) => {
                    // Build document with all four pattern types
                    const my_lines = [
                        'display "start"',
                        // Single-line section
                        `// ${my_single_name.trim()} ----`,
                        'gen x = 1',
                        // Banner section
                        '// ========',
                        `// ${my_banner_name.trim()}`,
                        '// ========',
                        'gen y = 2',
                        // Starred inline section
                        `*** ${my_starred_name.trim()} ***`,
                        'gen z = 3',
                        // Numbered section
                        `* 1 ${my_numbered_name.trim()}`,
                        'display "end"',
                    ];

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly 4 sections
                    if (my_sections.length !== 4) {
                        return false;
                    }

                    // Check each detection type is present
                    const my_types = new Set(my_sections.map((s) => s.detection_type));
                    return my_types.has('single_line') &&
                        my_types.has('banner') &&
                        my_types.has('starred_inline') &&
                        my_types.has('numbered');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty I: Sections are detected in document order.
     * The start line of each section should be in ascending order.
     */
    it('should detect sections in document order', () => {
        fc.assert(
            fc.property(
                arbitrary_mixed_pattern_document(),
                ({ content, line_offsets }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Check that sections are in ascending order by start line
                    for (let my_i = 1; my_i < my_sections.length; my_i++) {
                        if (my_sections[my_i].range.start.line <= my_sections[my_i - 1].range.start.line) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty J: Section names are preserved correctly.
     * The extracted name should match the original heading text.
     */
    it('should preserve section names correctly', () => {
        fc.assert(
            fc.property(
                arbitrary_mixed_pattern_document(),
                ({ content, line_offsets, expected_sections }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Each expected section name should appear in detected sections
                    for (const my_expected of expected_sections) {
                        const my_found = my_sections.some((s) => s.name === my_expected.name);
                        if (!my_found) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty K: Mixed document with block comments and standard banners.
     * Both block comment headings and standard banner sections should be detected.
     */
    it('should detect both block comments and standard banners in same document', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 15 }),
                fc.integer({ min: 4, max: 15 }),
                (my_block_name, my_banner_name, my_asterisk_count, my_dash_count) => {
                    const my_asterisks = '*'.repeat(my_asterisk_count);
                    const my_dashes = '-'.repeat(my_dash_count);

                    const my_lines = [
                        'display "start"',
                        // Block comment heading
                        `/${my_asterisks}`,
                        ` ${my_block_name.trim()}`,
                        `${my_asterisks}/`,
                        'gen x = 1',
                        // Standard banner section
                        `// ${my_dashes}`,
                        `// ${my_banner_name.trim()}`,
                        `// ${my_dashes}`,
                        'display "end"',
                    ];

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly 2 banner sections
                    const my_banner_sections = my_sections.filter(
                        (s) => s.detection_type === 'banner'
                    );

                    if (my_banner_sections.length !== 2) {
                        return false;
                    }

                    // Both names should be present
                    const my_names = new Set(my_banner_sections.map((s) => s.name));
                    return my_names.has(my_block_name.trim()) &&
                        my_names.has(my_banner_name.trim());
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty L: Existing patterns continue to work after new features.
     * Regression test to ensure new block comment detection doesn't break existing patterns.
     */
    it('should not break existing patterns when new features are added', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_heading_text(),
                    arbitrary_heading_text(),
                    arbitrary_heading_text(),
                    arbitrary_heading_text(),
                    arbitrary_heading_text()
                ),
                ([my_single, my_banner, my_starred, my_numbered, my_block]) => {
                    // Build document with all pattern types including new block comment
                    const my_lines = [
                        // Single-line section (existing)
                        `// ${my_single.trim()} ====`,
                        'gen a = 1',
                        // Banner section (existing)
                        '// ++++',
                        `// ${my_banner.trim()}`,
                        '// ++++',
                        'gen b = 2',
                        // Starred inline section (existing)
                        `** ${my_starred.trim()} **`,
                        'gen c = 3',
                        // Numbered section (existing)
                        `* 2.1 ${my_numbered.trim()}`,
                        'gen d = 4',
                        // Block comment heading (new)
                        '/********',
                        ` ${my_block.trim()}`,
                        '********/',
                        'gen e = 5',
                    ];

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly 5 sections
                    if (my_sections.length !== 5) {
                        return false;
                    }

                    // Verify each pattern type is detected
                    const my_single_sections = my_sections.filter(
                        (s) => s.detection_type === 'single_line'
                    );
                    const my_banner_sections = my_sections.filter(
                        (s) => s.detection_type === 'banner'
                    );
                    const my_starred_sections = my_sections.filter(
                        (s) => s.detection_type === 'starred_inline'
                    );
                    const my_numbered_sections = my_sections.filter(
                        (s) => s.detection_type === 'numbered'
                    );

                    // Should have 1 single-line, 2 banners (standard + block), 1 starred, 1 numbered
                    return my_single_sections.length === 1 &&
                        my_banner_sections.length === 2 &&
                        my_starred_sections.length === 1 &&
                        my_numbered_sections.length === 1;
                }
            ),
            { numRuns: 100 }
        );
    });
});



// ---------------------------------------------------------------------------
// Property 8: No Duplicate Line Detection
// ---------------------------------------------------------------------------

describe('Property 8: No Duplicate Line Detection', () => {
    /**
     * Feature: stata-outline-improvements, Property 8: No Duplicate Line Detection
     *
     * *For any* document, no line number should appear as the start line of more
     * than one detected section.
     *
     * **Validates: Requirements 5.4**
     */

    /**
     * Generate random heading text content.
     * Includes alphanumeric characters, spaces, and some special characters.
     * Excludes asterisks and dashes to avoid confusion with delimiters.
     */
    function arbitrary_heading_text(): fc.Arbitrary<string> {
        const my_char = fc.constantFrom(
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
            'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
            'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
            'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
            ' ', '_', '(', ')', '[', ']', ':', ';', ','
        );
        return fc.stringOf(my_char, { minLength: 3, maxLength: 30 })
            .filter((s) => s.trim().length >= 3); // Ensure non-trivial content
    }

    /**
     * Compute line offsets for a document content string.
     */
    function compute_line_offsets(content: string): number[] {
        const my_offsets: number[] = [0];
        for (let my_i = 0; my_i < content.length; my_i++) {
            if (content[my_i] === '\n') {
                my_offsets.push(my_i + 1);
            }
        }
        return my_offsets;
    }

    /**
     * Generate a document with overlapping pattern candidates.
     * Creates patterns that could potentially match multiple detection phases.
     */
    function arbitrary_overlapping_pattern_document(): fc.Arbitrary<{
        content: string;
        line_offsets: number[];
    }> {
        return fc
            .tuple(
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 15 }),
                fc.integer({ min: 4, max: 15 })
            )
            .map(([my_heading1, my_heading2, my_heading3, my_asterisk_count, my_dash_count]) => {
                const my_asterisks = '*'.repeat(my_asterisk_count);
                const my_dashes = '-'.repeat(my_dash_count);

                // Create a document with patterns that could potentially overlap:
                // - Block comment heading (3 lines)
                // - Single-line section on same line as potential banner middle
                // - Banner section (3 lines)
                // - Starred inline that could be confused with asterisk delimiter
                const my_lines = [
                    // Block comment heading
                    `/${my_asterisks}`,
                    ` ${my_heading1.trim()}`,
                    `${my_asterisks}/`,
                    'gen x = 1',
                    // Single-line section
                    `// ${my_heading2.trim()} ${my_dashes}`,
                    'gen y = 2',
                    // Banner section
                    `// ${my_dashes}`,
                    `// ${my_heading3.trim()}`,
                    `// ${my_dashes}`,
                    'gen z = 3',
                ];

                const my_content = my_lines.join('\n');
                const my_line_offsets = compute_line_offsets(my_content);

                return {
                    content: my_content,
                    line_offsets: my_line_offsets,
                };
            });
    }

    /**
     * Generate a document with multiple block comment headings.
     * Tests that consumed lines are properly tracked across multiple detections.
     */
    function arbitrary_multiple_block_comments_document(): fc.Arbitrary<{
        content: string;
        line_offsets: number[];
        block_count: number;
    }> {
        const my_block_count = fc.integer({ min: 2, max: 5 });
        const my_headings = fc.array(arbitrary_heading_text(), { minLength: 2, maxLength: 5 });
        const my_asterisk_count = fc.integer({ min: 4, max: 15 });

        return fc
            .tuple(my_block_count, my_headings, my_asterisk_count)
            .map(([my_count, my_heading_texts, my_asterisks_count]) => {
                const my_asterisks = '*'.repeat(my_asterisks_count);
                const my_lines: string[] = [];

                // Add initial code line
                my_lines.push('display "start"');

                for (let my_i = 0; my_i < Math.min(my_count, my_heading_texts.length); my_i++) {
                    // Block comment heading
                    my_lines.push(`/${my_asterisks}`);
                    my_lines.push(` ${my_heading_texts[my_i].trim()}`);
                    my_lines.push(`${my_asterisks}/`);

                    // Separator code line
                    my_lines.push(`gen var${my_i} = ${my_i}`);
                }

                // Add final code line
                my_lines.push('display "end"');

                const my_content = my_lines.join('\n');
                const my_line_offsets = compute_line_offsets(my_content);

                return {
                    content: my_content,
                    line_offsets: my_line_offsets,
                    block_count: Math.min(my_count, my_heading_texts.length),
                };
            });
    }

    /**
     * Generate a document with all pattern types that could potentially overlap.
     * This is a comprehensive test for consumed line tracking.
     */
    function arbitrary_comprehensive_overlap_document(): fc.Arbitrary<{
        content: string;
        line_offsets: number[];
    }> {
        return fc
            .tuple(
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 12 }),
                fc.integer({ min: 4, max: 12 }),
                fc.integer({ min: 2, max: 4 })
            )
            .map(([
                my_block_heading,
                my_single_heading,
                my_banner_heading,
                my_starred_heading,
                my_numbered_heading,
                my_asterisk_count,
                my_dash_count,
                my_star_count
            ]) => {
                const my_asterisks = '*'.repeat(my_asterisk_count);
                const my_dashes = '-'.repeat(my_dash_count);
                const my_stars = '*'.repeat(my_star_count);

                const my_lines = [
                    'display "start"',
                    // Block comment heading (lines 1-3)
                    `/${my_asterisks}`,
                    ` ${my_block_heading.trim()}`,
                    `${my_asterisks}/`,
                    'gen a = 1',
                    // Single-line section (line 5)
                    `// ${my_single_heading.trim()} ${my_dashes}`,
                    'gen b = 2',
                    // Banner section (lines 7-9)
                    `// ${my_dashes}`,
                    `// ${my_banner_heading.trim()}`,
                    `// ${my_dashes}`,
                    'gen c = 3',
                    // Starred inline section (line 11)
                    `${my_stars} ${my_starred_heading.trim()} ${my_stars}`,
                    'gen d = 4',
                    // Numbered section (line 13)
                    `* 1 ${my_numbered_heading.trim()}`,
                    'display "end"',
                ];

                const my_content = my_lines.join('\n');
                const my_line_offsets = compute_line_offsets(my_content);

                return {
                    content: my_content,
                    line_offsets: my_line_offsets,
                };
            });
    }

    /**
     * Generate a document with adjacent patterns that share boundary lines.
     * Tests edge cases where patterns are immediately adjacent.
     */
    function arbitrary_adjacent_patterns_document(): fc.Arbitrary<{
        content: string;
        line_offsets: number[];
    }> {
        return fc
            .tuple(
                arbitrary_heading_text(),
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 12 }),
                fc.integer({ min: 4, max: 12 })
            )
            .map(([my_heading1, my_heading2, my_asterisk_count, my_dash_count]) => {
                const my_asterisks = '*'.repeat(my_asterisk_count);
                const my_dashes = '-'.repeat(my_dash_count);

                // Create adjacent patterns with no separator lines
                const my_lines = [
                    // Block comment heading (lines 0-2)
                    `/${my_asterisks}`,
                    ` ${my_heading1.trim()}`,
                    `${my_asterisks}/`,
                    // Immediately followed by banner section (lines 3-5)
                    `// ${my_dashes}`,
                    `// ${my_heading2.trim()}`,
                    `// ${my_dashes}`,
                ];

                const my_content = my_lines.join('\n');
                const my_line_offsets = compute_line_offsets(my_content);

                return {
                    content: my_content,
                    line_offsets: my_line_offsets,
                };
            });
    }

    /**
     * Subproperty A: No line appears as start line of multiple sections.
     * This is the core property - no duplicate start lines.
     */
    it('should not have any line appear as start line of multiple sections', () => {
        fc.assert(
            fc.property(
                arbitrary_overlapping_pattern_document(),
                ({ content, line_offsets }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Collect all start lines
                    const my_start_lines = my_sections.map((s) => s.range.start.line);

                    // Check for duplicates using Set
                    const my_unique_start_lines = new Set(my_start_lines);

                    return my_unique_start_lines.size === my_start_lines.length;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty B: Multiple block comments have unique start lines.
     * Tests consumed line tracking for multiple block comment headings.
     */
    it('should have unique start lines for multiple block comments', () => {
        fc.assert(
            fc.property(
                arbitrary_multiple_block_comments_document(),
                ({ content, line_offsets, block_count }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Filter to banner sections (block comments are detected as banner type)
                    const my_banner_sections = my_sections.filter(
                        (s) => s.detection_type === 'banner'
                    );

                    // Should detect exactly block_count banner sections
                    if (my_banner_sections.length !== block_count) {
                        return false;
                    }

                    // All start lines should be unique
                    const my_start_lines = my_banner_sections.map((s) => s.range.start.line);
                    const my_unique_start_lines = new Set(my_start_lines);

                    return my_unique_start_lines.size === my_start_lines.length;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty C: Comprehensive document with all pattern types has unique start lines.
     * Tests that consumed lines are properly tracked across all detection phases.
     */
    it('should have unique start lines in comprehensive document with all pattern types', () => {
        fc.assert(
            fc.property(
                arbitrary_comprehensive_overlap_document(),
                ({ content, line_offsets }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Collect all start lines
                    const my_start_lines = my_sections.map((s) => s.range.start.line);

                    // Check for duplicates
                    const my_unique_start_lines = new Set(my_start_lines);

                    return my_unique_start_lines.size === my_start_lines.length;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty D: Adjacent patterns have unique start lines.
     * Tests edge case where patterns are immediately adjacent.
     */
    it('should have unique start lines for adjacent patterns', () => {
        fc.assert(
            fc.property(
                arbitrary_adjacent_patterns_document(),
                ({ content, line_offsets }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Collect all start lines
                    const my_start_lines = my_sections.map((s) => s.range.start.line);

                    // Check for duplicates
                    const my_unique_start_lines = new Set(my_start_lines);

                    return my_unique_start_lines.size === my_start_lines.length;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty E: Consumed lines from block comments are not detected by other phases.
     * Tests that the middle line of a block comment is not detected as a separate section.
     */
    it('should not detect consumed middle lines as separate sections', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 15 }),
                (my_heading, my_asterisk_count) => {
                    const my_asterisks = '*'.repeat(my_asterisk_count);

                    // Create a block comment where the middle line could potentially
                    // match other patterns (e.g., if it had a number prefix)
                    const my_lines = [
                        `/${my_asterisks}`,
                        ` ${my_heading.trim()}`,
                        `${my_asterisks}/`,
                    ];

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section (the block comment)
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // The section should start at line 0 (the top delimiter)
                    // Line 1 (the middle line) should NOT be a start line
                    return my_sections[0].range.start.line === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty F: Consumed lines from banner sections are not detected by other phases.
     * Tests that the delimiter lines of a banner section are not detected separately.
     */
    it('should not detect consumed delimiter lines as separate sections', () => {
        fc.assert(
            fc.property(
                arbitrary_heading_text(),
                fc.integer({ min: 4, max: 15 }),
                (my_heading, my_dash_count) => {
                    const my_dashes = '-'.repeat(my_dash_count);

                    // Create a banner section
                    const my_lines = [
                        `// ${my_dashes}`,
                        `// ${my_heading.trim()}`,
                        `// ${my_dashes}`,
                    ];

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly one section (the banner)
                    if (my_sections.length !== 1) {
                        return false;
                    }

                    // The section should start at line 0 (the top delimiter)
                    // Lines 1 and 2 should NOT be start lines of other sections
                    return my_sections[0].range.start.line === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty G: No line appears in multiple section ranges.
     * Extended property - no line should be the start of multiple sections.
     */
    it('should not have any line as start of multiple sections in random documents', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.oneof(
                        // Single-line section
                        arbitrary_heading_text().map((h) => `// ${h.trim()} ----`),
                        // Starred inline
                        arbitrary_heading_text().map((h) => `** ${h.trim()} **`),
                        // Numbered section
                        fc.tuple(
                            fc.integer({ min: 1, max: 9 }),
                            arbitrary_heading_text()
                        ).map(([n, h]) => `* ${n} ${h.trim()}`),
                        // Code line (separator)
                        fc.constantFrom('gen x = 1', 'display "hello"', 'local y = 2')
                    ),
                    { minLength: 5, maxLength: 20 }
                ),
                (my_lines) => {
                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Collect all start lines
                    const my_start_lines = my_sections.map((s) => s.range.start.line);

                    // Check for duplicates
                    const my_unique_start_lines = new Set(my_start_lines);

                    return my_unique_start_lines.size === my_start_lines.length;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty H: Empty document has no duplicate lines (trivially true).
     */
    it('should handle empty document without duplicates', () => {
        fc.assert(
            fc.property(
                fc.constant(''),
                (my_content) => {
                    const my_line_offsets = compute_line_offsets(my_content);
                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Empty document should have no sections
                    return my_sections.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty I: Single-line document has at most one section.
     */
    it('should have at most one section for single-line documents', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    arbitrary_heading_text().map((h) => `// ${h.trim()} ----`),
                    arbitrary_heading_text().map((h) => `** ${h.trim()} **`),
                    fc.tuple(
                        fc.integer({ min: 1, max: 9 }),
                        arbitrary_heading_text()
                    ).map(([n, h]) => `* ${n} ${h.trim()}`),
                    fc.constant('gen x = 1')
                ),
                (my_line) => {
                    const my_line_offsets = compute_line_offsets(my_line);
                    const my_sections = extract_sections(my_line, my_line_offsets);

                    // Single-line document can have at most one section
                    // (and that section can only start at line 0)
                    if (my_sections.length > 1) {
                        return false;
                    }

                    if (my_sections.length === 1) {
                        return my_sections[0].range.start.line === 0;
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty J: Documents with only code lines have no sections.
     */
    it('should have no sections for documents with only code lines', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.constantFrom(
                        'gen x = 1',
                        'display "hello"',
                        'local y = 2',
                        'regress y x',
                        'summarize x',
                        'tab x y'
                    ),
                    { minLength: 1, maxLength: 10 }
                ),
                (my_code_lines) => {
                    const my_content = my_code_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Code-only document should have no sections
                    return my_sections.length === 0;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty K: Sections are sorted by start line (no out-of-order duplicates).
     * This verifies that sections are returned in document order.
     */
    it('should return sections sorted by start line', () => {
        fc.assert(
            fc.property(
                arbitrary_comprehensive_overlap_document(),
                ({ content, line_offsets }) => {
                    const my_sections = extract_sections(content, line_offsets);

                    // Check that sections are in ascending order by start line
                    for (let my_i = 1; my_i < my_sections.length; my_i++) {
                        if (my_sections[my_i].range.start.line <= my_sections[my_i - 1].range.start.line) {
                            return false;
                        }
                    }

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Subproperty L: Consumed lines are properly tracked across detection phases.
     * Tests that lines consumed by earlier phases are skipped by later phases.
     */
    it('should properly track consumed lines across detection phases', () => {
        fc.assert(
            fc.property(
                fc.tuple(
                    arbitrary_heading_text(),
                    arbitrary_heading_text(),
                    fc.integer({ min: 4, max: 12 })
                ),
                ([my_block_heading, my_numbered_heading, my_asterisk_count]) => {
                    const my_asterisks = '*'.repeat(my_asterisk_count);

                    // Create a document where the block comment middle line
                    // could potentially match a numbered section pattern
                    // (if it weren't consumed by the block comment detection)
                    const my_lines = [
                        `/${my_asterisks}`,
                        ` 1 ${my_block_heading.trim()}`, // Could match numbered pattern
                        `${my_asterisks}/`,
                        'gen x = 1',
                        `* 2 ${my_numbered_heading.trim()}`, // Actual numbered section
                    ];

                    const my_content = my_lines.join('\n');
                    const my_line_offsets = compute_line_offsets(my_content);

                    const my_sections = extract_sections(my_content, my_line_offsets);

                    // Should detect exactly 2 sections:
                    // 1. Block comment (banner type) starting at line 0
                    // 2. Numbered section starting at line 4
                    if (my_sections.length !== 2) {
                        return false;
                    }

                    // Verify no duplicate start lines
                    const my_start_lines = my_sections.map((s) => s.range.start.line);
                    const my_unique_start_lines = new Set(my_start_lines);

                    return my_unique_start_lines.size === my_start_lines.length;
                }
            ),
            { numRuns: 100 }
        );
    });
});
