import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Range } from 'vscode-languageserver-textdocument';
import {
  classify_comment_style,
  extract_comment_content,
  analyze_comment,
  is_in_embedded_context,
  get_language_context,
  contains_markdown,
  is_multiline_comment,
} from '../../src/comment-processor';
import { Token, LanguageContext, ContextRange } from '../../src/types';

// Generators for creating test data
const generate_comment_token = (style: 'star' | 'slash' | 'block' | 'continuation'): Token => {
  const line = 0;
  const start_char = 0;
  const end_char = 20;

  const range: Range = {
    start: { line, character: start_char },
    end: { line, character: end_char },
  };

  let value = '';
  let type: any = 'COMMENT_LINE';

  switch (style) {
    case 'star':
      value = '* This is a star comment';
      type = 'COMMENT_LINE';
      break;
    case 'slash':
      value = '// This is a slash comment';
      type = 'COMMENT_LINE';
      break;
    case 'continuation':
      value = '/// This is a continuation comment';
      type = 'CONTINUATION';
      break;
    case 'block':
      value = '/* This is a block comment */';
      type = 'COMMENT_BLOCK';
      break;
  }

  return { type, value, range };
};

const generate_multiline_block_comment = (): Token => {
  const range: Range = {
    start: { line: 0, character: 0 },
    end: { line: 2, character: 10 },
  };

  return {
    type: 'COMMENT_BLOCK',
    value: '/* Line 1\n   Line 2\n   Line 3 */',
    range,
  };
};

const generate_context_range = (start_line: number, end_line: number, context: LanguageContext): ContextRange => {
  return {
    context,
    range: {
      start: { line: start_line, character: 0 },
      end: { line: end_line, character: 100 },
    },
    start_delimiter: {
      command: context === LanguageContext.MATA ? 'mata' : 'python',
      range: {
        start: { line: start_line - 1, character: 0 },
        end: { line: start_line - 1, character: 4 },
      },
    },
    is_single_line: false,
  };
};

describe('Comment Detection Property Tests', () => {
  // Property 4: Comprehensive comment detection
  // For any valid Stata comment (star, slash, block, or continuation),
  // the formatter should correctly identify it as a comment and not confuse
  // comment-like text inside strings as actual comments
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should correctly classify all comment styles', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block'),
          fc.constant('continuation')
        ) as fc.Arbitrary<'star' | 'slash' | 'block' | 'continuation'>,
        (my_style) => {
          const my_token = generate_comment_token(my_style);
          const my_classified = classify_comment_style(my_token);

          expect(my_classified).toBe(my_style);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Comment content extraction preserves text
  // For any comment, extracting the content should remove delimiters
  // but preserve the actual comment text
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should extract comment content correctly', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block'),
          fc.constant('continuation')
        ) as fc.Arbitrary<'star' | 'slash' | 'block' | 'continuation'>,
        (my_style) => {
          const my_token = generate_comment_token(my_style);
          const my_content = extract_comment_content(my_token, my_style);

          // Content should not be empty for non-empty comments
          expect(my_content.length).toBeGreaterThan(0);

          // Content should not contain delimiters
          expect(my_content).not.toContain('*');
          expect(my_content).not.toContain('//');
          expect(my_content).not.toContain('///');
          expect(my_content).not.toContain('/*');
          expect(my_content).not.toContain('*/');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Comment analysis produces valid results
  // For any comment token, analyzing it should produce a valid CommentAnalysis
  // with all fields properly populated
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should analyze comments with all fields populated', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block'),
          fc.constant('continuation')
        ) as fc.Arbitrary<'star' | 'slash' | 'block' | 'continuation'>,
        (my_style) => {
          const my_token = generate_comment_token(my_style);
          const my_analysis = analyze_comment(my_token, []);

          // All fields should be populated
          expect(my_analysis.token).toBe(my_token);
          expect(my_analysis.style).toBe(my_style);
          expect(my_analysis.content).toBeDefined();
          expect(typeof my_analysis.indent_level).toBe('number');
          expect(typeof my_analysis.is_in_embedded_context).toBe('boolean');
          expect(my_analysis.language_context).toBeDefined();
          expect(typeof my_analysis.line_number).toBe('number');
          expect(typeof my_analysis.is_multiline).toBe('boolean');
          expect(typeof my_analysis.contains_markdown).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Embedded context detection works correctly
  // For any comment and context range, the detector should correctly
  // identify if the comment is within an embedded language block
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should detect embedded context correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (my_comment_line, my_context_start) => {
          const my_context_end = my_context_start + 5;
          const my_token: Token = {
            type: 'COMMENT_LINE',
            value: '// test',
            range: {
              start: { line: my_comment_line, character: 0 },
              end: { line: my_comment_line, character: 7 },
            },
          };

          const my_context_range = generate_context_range(
            my_context_start,
            my_context_end,
            LanguageContext.MATA
          );

          const my_is_embedded = is_in_embedded_context(my_token, [my_context_range]);

          // Check if the comment line is within the context range
          const my_expected = my_comment_line >= my_context_start && my_comment_line <= my_context_end;
          expect(my_is_embedded).toBe(my_expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Language context detection works correctly
  // For any comment and context range, the detector should return the
  // correct language context (STATA, MATA, or PYTHON)
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should detect language context correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.oneof(
          fc.constant(LanguageContext.MATA),
          fc.constant(LanguageContext.PYTHON)
        ),
        (my_comment_line, my_context_type) => {
          const my_token: Token = {
            type: 'COMMENT_LINE',
            value: '// test',
            range: {
              start: { line: my_comment_line, character: 0 },
              end: { line: my_comment_line, character: 7 },
            },
          };

          const my_context_range = generate_context_range(0, 10, my_context_type);

          const my_detected_context = get_language_context(my_token, [my_context_range]);

          // If comment is within context range, should return that context
          if (my_comment_line >= 0 && my_comment_line <= 10) {
            expect(my_detected_context).toBe(my_context_type);
          } else {
            // Otherwise should return STATA
            expect(my_detected_context).toBe(LanguageContext.STATA);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Multiline detection works correctly
  // For any comment, the multiline detector should correctly identify
  // if the comment spans multiple lines
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should detect multiline comments correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (my_start_line, my_end_line) => {
          const my_token: Token = {
            type: 'COMMENT_BLOCK',
            value: '/* test */',
            range: {
              start: { line: my_start_line, character: 0 },
              end: { line: my_end_line, character: 10 },
            },
          };

          const my_is_multiline = is_multiline_comment(my_token);

          // Should be multiline if start and end lines differ
          const my_expected = my_start_line !== my_end_line;
          expect(my_is_multiline).toBe(my_expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown detection works correctly
  // For any comment content, the Markdown detector should correctly
  // identify if it contains Markdown syntax
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should detect Markdown in comments', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('# Header'),
          fc.constant('- List item'),
          fc.constant('1. Numbered item'),
          fc.constant('`code`'),
          fc.constant('**bold**'),
          fc.constant('_italic_'),
          fc.constant('[link](url)'),
          fc.constant('Plain text without markdown')
        ),
        (my_content) => {
          const my_has_markdown = contains_markdown(my_content);

          // Check if content has markdown patterns
          const my_has_header = /^#+\s/.test(my_content);
          const my_has_list = /^\s*[-*+]\s/.test(my_content);
          const my_has_numbered = /^\s*\d+\.\s/.test(my_content);
          const my_has_code = /`[^`]+`/.test(my_content);
          const my_has_bold = /\*\*[^\*]+\*\*/.test(my_content);
          const my_has_italic = /_[^_]+_/.test(my_content);
          const my_has_link = /\[.+\]\(.+\)/.test(my_content);

          const my_expected =
            my_has_header ||
            my_has_list ||
            my_has_numbered ||
            my_has_code ||
            my_has_bold ||
            my_has_italic ||
            my_has_link;

          expect(my_has_markdown).toBe(my_expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments are never multiline
  // For any continuation comment, it should never be detected as multiline
  // Feature: comment-style-normalization, Property 4: Comprehensive comment detection
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
  it('should never detect continuation comments as multiline', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (my_line) => {
          const my_token: Token = {
            type: 'CONTINUATION',
            value: '/// continuation',
            range: {
              start: { line: my_line, character: 0 },
              end: { line: my_line, character: 16 },
            },
          };

          const my_is_multiline = is_multiline_comment(my_token);

          // Continuation comments should never be multiline
          expect(my_is_multiline).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
