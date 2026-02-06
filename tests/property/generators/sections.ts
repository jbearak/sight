import * as fc from 'fast-check';
import { RawSection, SectionDetectionType } from '../../../src/providers/section-detector';

/**
 * Section generators for property-based testing.
 * These generators produce valid Stata section comments and section metadata
 * for testing the section detector and hierarchy integration.
 */

// ---------------------------------------------------------------------------
// Primitive section generators
// ---------------------------------------------------------------------------

/**
 * Generate a valid section name that is NOT delimiter-only.
 * Uses letters and digits to ensure at least one non-delimiter character.
 */
export function arbitrary_section_name(): fc.Arbitrary<string> {
  const my_alpha_chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const my_alnum_chars = my_alpha_chars + '0123456789';

  const my_first_char = fc.constantFrom(...my_alpha_chars.split(''));
  const my_rest_chars = fc.stringOf(
    fc.constantFrom(...my_alnum_chars.split(''), ' '),
    { minLength: 0, maxLength: 20 }
  );

  return fc
    .tuple(my_first_char, my_rest_chars)
    .map(([my_first, my_rest]) => (my_first + my_rest).trim())
    .filter((my_name) => my_name.length > 0);
}

/**
 * Generate one of the recognized delimiter characters.
 */
export function arbitrary_delimiter_char(): fc.Arbitrary<string> {
  return fc.constantFrom('*', '-', '=', '+', '/', '#');
}

/**
 * Generate a string consisting ONLY of delimiter chars and whitespace.
 * Guaranteed to have at least one character.
 */
export function arbitrary_delimiter_only_string(): fc.Arbitrary<string> {
  return fc
    .stringOf(
      fc.constantFrom('*', '-', '=', '+', '/', '#', ' ', '\t'),
      { minLength: 1, maxLength: 30 }
    );
}

// ---------------------------------------------------------------------------
// Section comment generators
// ---------------------------------------------------------------------------

/**
 * Generate a valid single-line section comment.
 * Randomly chooses slash-style or star-style, adds a name and trailing delimiter (4+).
 * Returns the line string and the expected extracted name.
 */
export function arbitrary_single_line_section(): fc.Arbitrary<{
  line: string;
  expected_name: string;
}> {
  const my_style = fc.constantFrom('slash', 'star');
  const my_name = arbitrary_section_name();
  // Slash-style can use - = * +; star-style can use - = + (NOT * to avoid starred inline ambiguity)
  const my_slash_delim = fc.constantFrom('-', '=', '*', '+');
  const my_star_delim = fc.constantFrom('-', '=', '+');
  const my_repeat_count = fc.integer({ min: 4, max: 20 });
  const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 3 });

  return fc
    .tuple(my_style, my_name, my_slash_delim, my_star_delim, my_repeat_count, my_leading_spaces)
    .map(([my_s, my_n, my_sd, my_std, my_rc, my_ls]) => {
      if (my_s === 'slash') {
        const my_delimiter = my_sd.repeat(my_rc);
        const my_line = `${my_ls}// ${my_n} ${my_delimiter}`;
        return { line: my_line, expected_name: my_n };
      } else {
        const my_delimiter = my_std.repeat(my_rc);
        const my_line = `${my_ls}* ${my_n} ${my_delimiter}`;
        return { line: my_line, expected_name: my_n };
      }
    });
}

/**
 * Generate a valid 3-line banner section.
 * Top and bottom lines are matching delimiter lines; middle line has the section name.
 * Returns the 3 lines joined by newline and the expected extracted name.
 */
export function arbitrary_banner_section(): fc.Arbitrary<{
  lines: string;
  expected_name: string;
}> {
  const my_name = arbitrary_section_name();
  const my_delim_style = fc.constantFrom('asterisk', 'slash', 'slash_dash', 'star_dash');
  const my_repeat_count = fc.integer({ min: 4, max: 30 });
  const my_comment_prefix = fc.constantFrom('//', '*');

  return fc
    .tuple(my_name, my_delim_style, my_repeat_count, my_comment_prefix)
    .map(([my_n, my_ds, my_rc, my_cp]) => {
      let my_top_line: string;
      let my_bottom_line: string;

      if (my_ds === 'asterisk') {
        my_top_line = '*'.repeat(Math.max(4, my_rc));
        my_bottom_line = '*'.repeat(Math.max(4, my_rc));
      } else if (my_ds === 'slash') {
        my_top_line = '/'.repeat(Math.max(4, my_rc));
        my_bottom_line = '/'.repeat(Math.max(4, my_rc));
      } else if (my_ds === 'slash_dash') {
        my_top_line = '// ' + '-'.repeat(Math.max(4, my_rc));
        my_bottom_line = '// ' + '-'.repeat(Math.max(4, my_rc));
      } else {
        // star_dash
        my_top_line = '* ' + '-'.repeat(Math.max(4, my_rc));
        my_bottom_line = '* ' + '-'.repeat(Math.max(4, my_rc));
      }

      const my_middle_line = `${my_cp} ${my_n}`;
      const my_lines = `${my_top_line}\n${my_middle_line}\n${my_bottom_line}`;

      return { lines: my_lines, expected_name: my_n };
    });
}

/**
 * Generate a valid starred inline section comment.
 * Format: ** Section Name ** or *** Section Name ***
 * Returns the line and the expected extracted name.
 */
export function arbitrary_starred_inline_section(): fc.Arbitrary<{
  line: string;
  expected_name: string;
}> {
  const my_name = arbitrary_section_name();
  const my_star_count = fc.integer({ min: 2, max: 5 });
  const my_leading_spaces = fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 3 });

  return fc
    .tuple(my_name, my_star_count, my_leading_spaces)
    .map(([my_n, my_sc, my_ls]) => {
      const my_stars = '*'.repeat(my_sc);
      const my_line = `${my_ls}${my_stars} ${my_n} ${my_stars}`;
      return { line: my_line, expected_name: my_n };
    });
}

/**
 * Generate a numbered section comment with a given depth (1-3).
 * Format: * 1. Name, // 1.1 Name, * 1.1.1 Name
 * Returns the line, expected name, and expected level.
 */
export function arbitrary_numbered_section(
  depth?: number
): fc.Arbitrary<{
  line: string;
  expected_name: string;
  expected_level: number;
}> {
  const my_depth = depth !== undefined
    ? fc.constant(depth)
    : fc.integer({ min: 1, max: 3 });

  const my_name = arbitrary_section_name();
  const my_comment_prefix = fc.constantFrom('*', '//');
  const my_trailing_dot = fc.boolean();

  return fc
    .tuple(my_depth, my_name, my_comment_prefix, my_trailing_dot,
      fc.integer({ min: 1, max: 9 }),
      fc.integer({ min: 1, max: 9 }),
      fc.integer({ min: 1, max: 9 })
    )
    .map(([my_d, my_n, my_cp, my_td, my_n1, my_n2, my_n3]) => {
      let my_number_prefix: string;
      if (my_d === 1) {
        my_number_prefix = my_td ? `${my_n1}.` : `${my_n1}`;
      } else if (my_d === 2) {
        my_number_prefix = my_td ? `${my_n1}.${my_n2}.` : `${my_n1}.${my_n2}`;
      } else {
        my_number_prefix = my_td ? `${my_n1}.${my_n2}.${my_n3}.` : `${my_n1}.${my_n2}.${my_n3}`;
      }

      const my_line = `${my_cp} ${my_number_prefix} ${my_n}`;
      const my_expected_name = `${my_number_prefix} ${my_n}`;

      return {
        line: my_line,
        expected_name: my_expected_name,
        expected_level: my_d,
      };
    });
}

// ---------------------------------------------------------------------------
// Composite document generators
// ---------------------------------------------------------------------------

/**
 * Generate a document with section comments mixed with Stata code.
 * Returns the full document string and the expected number of sections.
 */
export function arbitrary_document_with_sections(
  min_sections?: number
): fc.Arbitrary<{
  document: string;
  section_count: number;
}> {
  const my_min = min_sections !== undefined ? min_sections : 1;
  const my_section_gen = fc.oneof(
    arbitrary_single_line_section().map((my_s) => my_s.line),
    arbitrary_starred_inline_section().map((my_s) => my_s.line),
    arbitrary_numbered_section().map((my_s) => my_s.line)
  );

  const my_code_line = fc.constantFrom(
    'display "hello"',
    'gen x = 1',
    'summarize y',
    'regress y x',
    'local a = 1',
    'global b = 2',
    'sort x',
    'list'
  );

  const my_section_count = fc.integer({ min: my_min, max: 5 });

  return fc
    .tuple(my_section_count, fc.array(my_section_gen, { minLength: my_min, maxLength: 5 }),
      fc.array(my_code_line, { minLength: 1, maxLength: 8 }))
    .chain(([my_count, my_sections, my_code_lines]) => {
      // Ensure we have exactly my_count sections
      const my_used_sections = my_sections.slice(0, my_count);
      if (my_used_sections.length === 0) {
        return fc.constant({ document: my_code_lines.join('\n'), section_count: 0 });
      }

      // Interleave sections with code lines
      const my_lines: string[] = [];
      let my_code_idx = 0;

      for (let my_i = 0; my_i < my_used_sections.length; my_i++) {
        // Add some code lines before each section
        const my_code_before = Math.min(2, my_code_lines.length - my_code_idx);
        for (let my_j = 0; my_j < my_code_before && my_code_idx < my_code_lines.length; my_j++) {
          my_lines.push(my_code_lines[my_code_idx++]);
        }
        my_lines.push(my_used_sections[my_i]);
      }

      // Add remaining code lines
      while (my_code_idx < my_code_lines.length) {
        my_lines.push(my_code_lines[my_code_idx++]);
      }

      return fc.constant({
        document: my_lines.join('\n'),
        section_count: my_used_sections.length,
      });
    });
}

/**
 * Generate a list of RawSection entries with varying levels for testing hierarchy.
 * Sections are generated with ascending start lines and levels between 1 and 3.
 */
export function arbitrary_section_list(): fc.Arbitrary<RawSection[]> {
  const my_section_count = fc.integer({ min: 2, max: 8 });

  return my_section_count.chain((my_count) => {
    const my_section_gens: fc.Arbitrary<{
      name: string;
      level: number;
      detection_type: SectionDetectionType;
    }>[] = [];

    for (let my_i = 0; my_i < my_count; my_i++) {
      my_section_gens.push(
        fc.tuple(
          arbitrary_section_name(),
          fc.integer({ min: 1, max: 3 }),
          fc.constantFrom('single_line' as SectionDetectionType, 'banner' as SectionDetectionType,
            'starred_inline' as SectionDetectionType, 'numbered' as SectionDetectionType)
        ).map(([my_name, my_level, my_dt]) => ({
          name: my_name,
          level: my_level,
          detection_type: my_dt,
        }))
      );
    }

    return fc.tuple(...my_section_gens).map((my_entries) => {
      const my_sections: RawSection[] = [];
      let my_current_line = 0;

      for (const my_entry of my_entries) {
        const my_line_length = 40 + my_entry.name.length;
        my_sections.push({
          name: my_entry.name,
          level: my_entry.level,
          range: {
            start: { line: my_current_line, character: 0 },
            end: { line: my_current_line, character: my_line_length },
          },
          selection_range: {
            start: { line: my_current_line, character: 0 },
            end: { line: my_current_line, character: my_line_length },
          },
          detection_type: my_entry.detection_type,
        });
        // Leave some lines between sections for code
        my_current_line += fc.sample(fc.integer({ min: 3, max: 10 }), 1)[0];
      }

      return my_sections;
    });
  });
}
