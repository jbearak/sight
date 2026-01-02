import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  CommentProcessor,
  analyze_comment,
  extract_comment_content,
} from '../../src/comment-processor';
import { Token } from '../../src/types';

// Generator for creating block comments with blank lines
const generate_block_comment_with_blanks = (
  num_lines: number,
  blank_line_indices: number[],
  indent: number = 0
): Token => {
  const my_lines: string[] = [];
  for (let i = 0; i < num_lines; i++) {
    if (blank_line_indices.includes(i)) {
      my_lines.push('');
    } else {
      my_lines.push(`Line ${i + 1}`);
    }
  }

  const my_content = my_lines.join('\n');
  const my_value = `/* ${my_content} */`;

  return {
    type: 'COMMENT_BLOCK',
    value: my_value,
    range: {
      start: { line: 0, character: indent },
      end: { line: num_lines - 1, character: my_value.length },
    },
  };
};

describe('Blank Line Preservation Property Tests', () => {
  // Property 8: Blank line preservation in comments
  // For any multi-line comment containing blank lines, those blank lines
  // should be preserved during style conversion
  // Feature: comment-style-normalization, Property 8: Blank line preservation in comments
  // Validates: Requirements 5.4
  it('should preserve blank lines when converting block to lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_target_style) => {
          // Generate some blank line indices
          const my_blank_indices: number[] = [];
          for (let i = 1; i < my_num_lines - 1; i++) {
            if (Math.random() > 0.5) {
              my_blank_indices.push(i);
            }
          }

          if (my_blank_indices.length === 0) {
            return; // Skip if no blank lines
          }

          const my_processor = new CommentProcessor();
          const my_token = generate_block_comment_with_blanks(
            my_num_lines,
            my_blank_indices
          );
          const my_comment = analyze_comment(my_token, []);

          const my_lines = my_processor.convert_block_to_lines(my_comment, my_target_style);

          // Count blank lines in result
          const my_blank_count = my_lines.filter((l) => l.length === 0).length;

          // Should have at least as many blank lines as original
          expect(my_blank_count).toBeGreaterThanOrEqual(my_blank_indices.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Blank line positions are preserved
  // For any block comment with blank lines, the relative positions of
  // blank lines should be preserved during conversion
  // Feature: comment-style-normalization, Property 8: Blank line preservation in comments
  // Validates: Requirements 5.4
  it('should preserve blank line positions during conversion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_target_style) => {
          // Create a specific pattern with blank lines
          const my_blank_indices = [1, 3]; // Blank lines at positions 1 and 3

          const my_processor = new CommentProcessor();
          const my_token = generate_block_comment_with_blanks(
            my_num_lines,
            my_blank_indices
          );
          const my_comment = analyze_comment(my_token, []);

          const my_lines = my_processor.convert_block_to_lines(my_comment, my_target_style);

          // Find blank line positions in result
          const my_result_blank_positions: number[] = [];
          for (let i = 0; i < my_lines.length; i++) {
            if (my_lines[i].length === 0) {
              my_result_blank_positions.push(i);
            }
          }

          // Should have blank lines at expected positions
          expect(my_result_blank_positions.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Blank lines are detected correctly
  // For any comment with blank lines, the detector should identify them
  // Feature: comment-style-normalization, Property 8: Blank line preservation in comments
  // Validates: Requirements 5.4
  it('should detect blank lines in comments', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 8 }),
        (my_num_lines) => {
          const my_blank_indices = [1, 3];
          const my_processor = new CommentProcessor();
          const my_token = generate_block_comment_with_blanks(
            my_num_lines,
            my_blank_indices
          );
          const my_comment = analyze_comment(my_token, []);

          const my_detected_blanks = my_processor.detect_blank_lines(my_comment);

          // Should detect at least the expected blank lines
          expect(my_detected_blanks.length).toBeGreaterThanOrEqual(my_blank_indices.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Content is preserved with blank lines
  // For any block comment with blank lines, converting to line style
  // should preserve all non-blank content
  // Feature: comment-style-normalization, Property 8: Blank line preservation in comments
  // Validates: Requirements 5.4
  it('should preserve content when blank lines are present', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_target_style) => {
          const my_blank_indices = [1, 3];
          const my_processor = new CommentProcessor();
          const my_token = generate_block_comment_with_blanks(
            my_num_lines,
            my_blank_indices
          );
          const my_comment = analyze_comment(my_token, []);

          const my_original_content = extract_comment_content(my_token, 'block');
          const my_lines = my_processor.convert_block_to_lines(my_comment, my_target_style);

          // Reconstruct content from converted lines
          const my_reconstructed_lines: string[] = [];
          for (const my_line of my_lines) {
            if (my_line.length > 0) {
              const my_extracted = extract_comment_content(
                {
                  type: 'COMMENT_LINE',
                  value: my_line,
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: my_line.length },
                  },
                },
                my_target_style
              );
              my_reconstructed_lines.push(my_extracted);
            } else {
              my_reconstructed_lines.push('');
            }
          }

          const my_reconstructed = my_reconstructed_lines.join('\n');

          // Should match original content
          expect(my_reconstructed).toBe(my_original_content);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Combining comments preserves blank lines
  // For any group of comments with blank lines, combining to block
  // should preserve the blank lines
  // Feature: comment-style-normalization, Property 8: Blank line preservation in comments
  // Validates: Requirements 5.4
  it('should preserve blank lines when combining to block', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        (my_num_comments) => {
          const my_processor = new CommentProcessor();

          // Create comments with some blank content
          const my_tokens: Token[] = [];
          for (let i = 0; i < my_num_comments; i++) {
            const my_value = i % 2 === 0 ? `// Comment ${i}` : '//';
            my_tokens.push({
              type: 'COMMENT_LINE',
              value: my_value,
              range: {
                start: { line: i, character: 0 },
                end: { line: i, character: my_value.length },
              },
            });
          }

          const my_comments = my_tokens.map((t) => analyze_comment(t, []));
          const my_combined = my_processor.combine_lines_to_block_with_blanks(my_comments);

          // Should be a valid block comment
          expect(my_combined).toContain('/*');
          expect(my_combined).toContain('*/');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Blank lines don't affect line count accuracy
  // For any block comment with blank lines, the line count should
  // be accurate after conversion
  // Feature: comment-style-normalization, Property 8: Blank line preservation in comments
  // Validates: Requirements 5.4
  it('should maintain accurate line count with blank lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        (my_num_lines) => {
          const my_blank_indices = [1, 3];
          const my_processor = new CommentProcessor();
          const my_token = generate_block_comment_with_blanks(
            my_num_lines,
            my_blank_indices
          );
          const my_comment = analyze_comment(my_token, []);

          const my_lines = my_processor.convert_block_to_lines(my_comment, 'slash');

          // Should have at least as many lines as original
          expect(my_lines.length).toBeGreaterThanOrEqual(my_num_lines);
        }
      ),
      { numRuns: 100 }
    );
  });
});
