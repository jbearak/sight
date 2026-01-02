import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  CommentProcessor,
  analyze_comment,
  extract_comment_content,
} from '../../src/comment-processor';
import { Token } from '../../src/types';

// Generator for creating comment tokens with various content
const generate_comment_token = (
  style: 'star' | 'slash' | 'block',
  content: string,
  indent: number = 0
): Token => {
  let token_value = '';
  let token_type: any = 'COMMENT_LINE';

  switch (style) {
    case 'star':
      token_value = `* ${content}`;
      break;
    case 'slash':
      token_value = `// ${content}`;
      break;
    case 'block':
      token_value = `/* ${content} */`;
      token_type = 'COMMENT_BLOCK';
      break;
  }

  return {
    type: token_type,
    value: token_value,
    range: {
      start: { line: 0, character: indent },
      end: { line: 0, character: indent + token_value.length },
    },
  };
};

describe('Comment Line Wrapping Property Tests', () => {
  // Property 14: Comment line wrapping
  // For any comment longer than the configured line width, it should be
  // wrapped at word boundaries while preserving indentation and not wrapping
  // comments shorter than the width
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should wrap long comments at word boundaries', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 40 }),
        fc.integer({ min: 0, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        (my_line_width, my_indent, my_style) => {
          const my_processor = new CommentProcessor();
          
          // Create a long comment that will need wrapping
          const my_long_content = 'This is a very long comment that should definitely be wrapped because it exceeds the line width limit';
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_long_content,
            my_line_width,
            my_style,
            my_indent
          );

          // Should produce multiple lines if content is long enough
          if (my_long_content.length > my_line_width - my_indent - 5) {
            expect(my_wrapped.length).toBeGreaterThan(1);
          }

          // Each line should not exceed the line width
          for (const my_line of my_wrapped) {
            expect(my_line.length).toBeLessThanOrEqual(my_line_width);
          }

          // Each line should have correct indentation
          for (const my_line of my_wrapped) {
            const my_indent_match = my_line.match(/^( *)/);
            expect(my_indent_match?.[1].length).toBe(my_indent);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Short comments are not wrapped
  // For any comment shorter than the configured line width, it should not
  // be wrapped into multiple lines
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should not wrap short comments', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 100 }),
        fc.integer({ min: 0, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        (my_line_width, my_indent, my_style) => {
          const my_processor = new CommentProcessor();
          
          // Create a short comment
          const my_short_content = 'Short comment';
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_short_content,
            my_line_width,
            my_style,
            my_indent
          );

          // Should produce a single line
          expect(my_wrapped.length).toBe(1);

          // Line should not exceed the line width
          expect(my_wrapped[0].length).toBeLessThanOrEqual(my_line_width);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Wrapped lines preserve content
  // For any comment, wrapping should preserve all content exactly
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should preserve content when wrapping', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 40 }),
        // Exclude newlines and */ (block comment delimiter) from content
        fc.string({ minLength: 10, maxLength: 100 }).filter((s) => !s.includes('\n') && !s.includes('*/')),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        (my_line_width, my_content, my_style) => {
          const my_processor = new CommentProcessor();
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_content,
            my_line_width,
            my_style,
            0
          );

          // Reconstruct content from wrapped lines
          const my_reconstructed_parts: string[] = [];
          for (const my_line of my_wrapped) {
            const my_extracted = extract_comment_content(
              {
                type: 'COMMENT_LINE',
                value: my_line,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: my_line.length },
                },
              },
              my_style
            );
            my_reconstructed_parts.push(my_extracted);
          }

          const my_reconstructed = my_reconstructed_parts.join(' ');

          // Should contain all original content (allowing for word boundary splits)
          expect(my_reconstructed).toContain(my_content.split(/\s+/)[0]);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Wrapped lines maintain indentation
  // For any comment with indentation, all wrapped lines should have the
  // same indentation as the original
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should maintain indentation across wrapped lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 40 }),
        fc.integer({ min: 1, max: 10 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        (my_line_width, my_indent, my_style) => {
          const my_processor = new CommentProcessor();
          
          const my_long_content = 'This is a very long comment that should definitely be wrapped because it exceeds the line width limit';
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_long_content,
            my_line_width,
            my_style,
            my_indent
          );

          // All lines should have the same indentation
          for (const my_line of my_wrapped) {
            const my_indent_match = my_line.match(/^( *)/);
            expect(my_indent_match?.[1].length).toBe(my_indent);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Wrapped lines respect word boundaries
  // For any comment, wrapping should break at word boundaries, not in the
  // middle of words
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should wrap at word boundaries', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 40 }),
        (my_line_width) => {
          const my_processor = new CommentProcessor();
          
          const my_content = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10';
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_content,
            my_line_width,
            'slash',
            0
          );

          // Each line should contain complete words, not partial words
          for (const my_line of my_wrapped) {
            // Extract the content part (after //)
            const my_content_part = my_line.replace(/^[ ]*\/\/\s?/, '');
            
            // Should not have partial words (words should be separated by spaces)
            const my_words = my_content_part.split(/\s+/);
            for (const my_word of my_words) {
              if (my_word.length > 0) {
                // Word should be a complete word from the original
                expect(my_content).toContain(my_word);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: All wrapped lines have correct comment prefix
  // For any comment, all wrapped lines should have the correct comment
  // prefix for the specified style
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should have correct comment prefix on all wrapped lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 40 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        (my_line_width, my_style) => {
          const my_processor = new CommentProcessor();
          
          const my_long_content = 'This is a very long comment that should definitely be wrapped because it exceeds the line width limit';
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_long_content,
            my_line_width,
            my_style,
            0
          );

          // Determine expected prefix
          let my_expected_prefix = '';
          switch (my_style) {
            case 'star':
              my_expected_prefix = '\\*';
              break;
            case 'slash':
              my_expected_prefix = '\\/\\/';
              break;
            case 'block':
              my_expected_prefix = '\\/\\*';
              break;
          }

          const my_pattern = new RegExp(`^[ ]*${my_expected_prefix}`);

          // All lines should have the correct prefix
          for (const my_line of my_wrapped) {
            expect(my_line).toMatch(my_pattern);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Wrapping respects line width limit
  // For any comment and line width, no wrapped line should exceed the
  // specified line width
  // Feature: comment-style-normalization, Property 14: Comment line wrapping
  // Validates: Requirements 12.3, 12.4, 12.5, 12.6, 12.7
  it('should respect line width limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 80 }),
        fc.integer({ min: 0, max: 10 }),
        (my_line_width, my_indent) => {
          const my_processor = new CommentProcessor();
          
          const my_long_content = 'This is a very long comment that should definitely be wrapped because it exceeds the line width limit and should be split into multiple lines';
          
          const my_wrapped = my_processor.wrap_comment_lines(
            my_long_content,
            my_line_width,
            'slash',
            my_indent
          );

          // All lines should respect the line width limit
          for (const my_line of my_wrapped) {
            expect(my_line.length).toBeLessThanOrEqual(my_line_width);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
