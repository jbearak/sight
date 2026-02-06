/**
 * Section Detection Property Tests
 *
 * Tests that verify the section detector correctly identifies and classifies
 * Stata code sections in comments:
 * - Delimiter-only validation
 * - Section detection consistency across pattern types
 * - Range containment invariant (selectionRange is a subset of range)
 * - Numbered section level derivation
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  is_delimiter_only,
  extract_sections,
  derive_numbered_level,
} from '../../src/providers/section-detector';
import { compute_line_offsets } from '../../src/utils/line-utils';
import {
  arbitrary_section_name,
  arbitrary_delimiter_only_string,
  arbitrary_single_line_section,
  arbitrary_banner_section,
  arbitrary_starred_inline_section,
  arbitrary_numbered_section,
  arbitrary_document_with_sections,
} from './generators/sections';

describe('Section Detection Property Tests', () => {
  /**
   * Property 1: Delimiter-only validation correctness
   *
   * - Strings made purely of delimiter chars and whitespace should return true
   * - Strings with at least one non-delimiter, non-whitespace char should return false
   *
   * Feature: stata-outline-sections, Property 1: Delimiter-only validation correctness
   */
  it('should correctly identify delimiter-only strings', () => {
    // Subproperty A: delimiter-only strings return true
    fc.assert(
      fc.property(
        arbitrary_delimiter_only_string(),
        (my_delim_string) => {
          const my_result = is_delimiter_only(my_delim_string);
          return my_result === true;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty B: strings with at least one non-delimiter char return false
    fc.assert(
      fc.property(
        arbitrary_section_name(),
        (my_name) => {
          // Section names contain at least one letter, which is not a delimiter char
          const my_result = is_delimiter_only(my_name);
          return my_result === false;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty C: empty string returns true
    expect(is_delimiter_only('')).toBe(true);
  });

  /**
   * Property 2: Section detection consistency
   *
   * - Valid single-line section comments should be detected by extract_sections
   * - Delimiter-only comment lines should NOT be detected as sections
   *
   * Feature: stata-outline-sections, Property 2: Section detection consistency
   */
  it('should detect valid section comments and reject delimiter-only lines', () => {
    // Subproperty A: valid single-line sections are detected
    fc.assert(
      fc.property(
        arbitrary_single_line_section(),
        ({ line, expected_name }) => {
          const my_content = line;
          const my_line_offsets = compute_line_offsets(my_content);
          const my_sections = extract_sections(my_content, my_line_offsets);

          if (my_sections.length !== 1) {
            return false;
          }

          return my_sections[0].name === expected_name;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty B: delimiter-only comment lines are not detected as sections
    fc.assert(
      fc.property(
        arbitrary_delimiter_only_string(),
        (my_delim_string) => {
          // Wrap in a star comment: * <delimiter-only>
          // This should not be detected because the name would be delimiter-only
          const my_content = `* ${my_delim_string}`;
          const my_line_offsets = compute_line_offsets(my_content);
          const my_sections = extract_sections(my_content, my_line_offsets);

          // Should detect zero sections (the name part is delimiter-only)
          return my_sections.length === 0;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty C: valid banner sections are detected
    fc.assert(
      fc.property(
        arbitrary_banner_section(),
        ({ lines, expected_name }) => {
          const my_line_offsets = compute_line_offsets(lines);
          const my_sections = extract_sections(lines, my_line_offsets);

          // Should detect at least one section with matching name
          if (my_sections.length === 0) {
            return false;
          }

          return my_sections.some(
            (my_section) => my_section.name === expected_name
          );
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty D: valid starred inline sections are detected
    fc.assert(
      fc.property(
        arbitrary_starred_inline_section(),
        ({ line, expected_name }) => {
          const my_content = line;
          const my_line_offsets = compute_line_offsets(my_content);
          const my_sections = extract_sections(my_content, my_line_offsets);

          if (my_sections.length !== 1) {
            return false;
          }

          return my_sections[0].name === expected_name;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty E: valid numbered sections are detected
    fc.assert(
      fc.property(
        arbitrary_numbered_section(),
        ({ line, expected_name }) => {
          const my_content = line;
          const my_line_offsets = compute_line_offsets(my_content);
          const my_sections = extract_sections(my_content, my_line_offsets);

          if (my_sections.length !== 1) {
            return false;
          }

          return my_sections[0].name === expected_name;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Range containment invariant
   *
   * For any detected section, selectionRange must be contained within range.
   * That is: range.start <= selectionRange.start and selectionRange.end <= range.end
   *
   * Feature: stata-outline-sections, Property 3: Range containment invariant
   */
  it('should ensure selectionRange is contained within range for all detected sections', () => {
    // Test with single-line sections
    fc.assert(
      fc.property(
        arbitrary_single_line_section(),
        ({ line }) => {
          const my_content = line;
          const my_line_offsets = compute_line_offsets(my_content);
          const my_sections = extract_sections(my_content, my_line_offsets);

          for (const my_section of my_sections) {
            const my_range = my_section.range;
            const my_sel = my_section.selection_range;

            // selectionRange.start >= range.start
            if (my_sel.start.line < my_range.start.line) return false;
            if (my_sel.start.line === my_range.start.line &&
                my_sel.start.character < my_range.start.character) return false;

            // selectionRange.end <= range.end
            if (my_sel.end.line > my_range.end.line) return false;
            if (my_sel.end.line === my_range.end.line &&
                my_sel.end.character > my_range.end.character) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );

    // Test with banner sections
    fc.assert(
      fc.property(
        arbitrary_banner_section(),
        ({ lines }) => {
          const my_line_offsets = compute_line_offsets(lines);
          const my_sections = extract_sections(lines, my_line_offsets);

          for (const my_section of my_sections) {
            const my_range = my_section.range;
            const my_sel = my_section.selection_range;

            // selectionRange.start >= range.start
            if (my_sel.start.line < my_range.start.line) return false;
            if (my_sel.start.line === my_range.start.line &&
                my_sel.start.character < my_range.start.character) return false;

            // selectionRange.end <= range.end
            if (my_sel.end.line > my_range.end.line) return false;
            if (my_sel.end.line === my_range.end.line &&
                my_sel.end.character > my_range.end.character) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );

    // Test with documents containing mixed section types
    fc.assert(
      fc.property(
        arbitrary_document_with_sections(1),
        ({ document }) => {
          const my_line_offsets = compute_line_offsets(document);
          const my_sections = extract_sections(document, my_line_offsets);

          for (const my_section of my_sections) {
            const my_range = my_section.range;
            const my_sel = my_section.selection_range;

            // selectionRange.start >= range.start
            if (my_sel.start.line < my_range.start.line) return false;
            if (my_sel.start.line === my_range.start.line &&
                my_sel.start.character < my_range.start.character) return false;

            // selectionRange.end <= range.end
            if (my_sel.end.line > my_range.end.line) return false;
            if (my_sel.end.line === my_range.end.line &&
                my_sel.end.character > my_range.end.character) return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9: Numbered section level derivation
   *
   * Generate numbered prefixes with known depth and verify derive_numbered_level()
   * returns the correct level based on the number of dot-separated groups.
   *
   * Feature: stata-outline-sections, Property 9: Numbered section level derivation
   */
  it('should derive correct level from numbered section prefixes', () => {
    // Subproperty A: depth-1 prefixes (e.g., "1" or "1.") return level 1
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.boolean(),
        (my_num, my_trailing_dot) => {
          const my_prefix = my_trailing_dot ? `${my_num}.` : `${my_num}`;
          const my_level = derive_numbered_level(my_prefix);
          return my_level === 1;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty B: depth-2 prefixes (e.g., "1.2" or "1.2.") return level 2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 99 }),
        fc.boolean(),
        (my_n1, my_n2, my_trailing_dot) => {
          const my_prefix = my_trailing_dot
            ? `${my_n1}.${my_n2}.`
            : `${my_n1}.${my_n2}`;
          const my_level = derive_numbered_level(my_prefix);
          return my_level === 2;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty C: depth-3 prefixes (e.g., "1.2.3" or "1.2.3.") return level 3
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 99 }),
        fc.boolean(),
        (my_n1, my_n2, my_n3, my_trailing_dot) => {
          const my_prefix = my_trailing_dot
            ? `${my_n1}.${my_n2}.${my_n3}.`
            : `${my_n1}.${my_n2}.${my_n3}`;
          const my_level = derive_numbered_level(my_prefix);
          return my_level === 3;
        }
      ),
      { numRuns: 100 }
    );

    // Subproperty D: generated numbered sections have consistent levels
    fc.assert(
      fc.property(
        arbitrary_numbered_section(),
        ({ line, expected_level }) => {
          const my_content = line;
          const my_line_offsets = compute_line_offsets(my_content);
          const my_sections = extract_sections(my_content, my_line_offsets);

          if (my_sections.length !== 1) return false;

          return my_sections[0].level === expected_level;
        }
      ),
      { numRuns: 100 }
    );
  });
});
