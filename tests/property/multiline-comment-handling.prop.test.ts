import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Range } from 'vscode-languageserver-textdocument';
import {
  CommentProcessor,
  CommentAnalysis,
  analyze_comment,
  extract_comment_content,
} from '../../src/comment-processor';
import { Token } from '../../src/types';

// Generator for creating multi-line block comment tokens
const generate_multiline_block_comment = (
  num_lines: number,
  indent: number = 0
): Token => {
  const my_lines: string[] = [];
  for (let i = 0; i < num_lines; i++) {
    my_lines.push(`Line ${i + 1}`);
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

// Generator for creating consecutive line comment tokens
const generate_consecutive_line_comments = (
  num_comments: number,
  style: 'star' | 'slash',
  indent: number = 0
): Token[] => {
  const my_tokens: Token[] = [];

  for (let i = 0; i < num_comments; i++) {
    const my_prefix = style === 'star' ? '*' : '//';
    const my_value = `${my_prefix} Comment line ${i + 1}`;

    my_tokens.push({
      type: 'COMMENT_LINE',
      value: my_value,
      range: {
        start: { line: i, character: indent },
        end: { line: i, character: my_value.length },
      },
    });
  }

  return my_tokens;
};

describe('Multi-line Comment Handling Property Tests', () => {
  // Property 7: Multi-line comment handling
  // For any multi-line block comment, converting to line comment style
  // should create multiple properly indented line comments, and converting
  // multiple consecutive line comments to block style should combine them
  // appropriately
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should convert block comments to multiple line comments', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 10 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_indent, my_target_style) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_multiline_block_comment(my_num_lines, my_indent);
          const my_comment = analyze_comment(my_token, []);

          const my_lines = my_processor.convert_block_to_lines(my_comment, my_target_style);

          // Should produce multiple lines
          expect(my_lines.length).toBeGreaterThanOrEqual(my_num_lines);

          // Each line should have correct prefix
          const my_prefix = my_target_style === 'star' ? '*' : '//';
          for (const my_line of my_lines) {
            if (my_line.length > 0) {
              expect(my_line).toContain(my_prefix);
            }
          }

          // Should preserve indentation
          for (const my_line of my_lines) {
            if (my_line.length > 0) {
              const my_indent_match = my_line.match(/^( *)/);
              expect(my_indent_match?.[1].length).toBe(my_indent);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Block-to-line conversion preserves content
  // For any block comment, converting to line style should preserve all content
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should preserve content when converting block to lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_target_style) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_multiline_block_comment(my_num_lines);
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

  // Property: Line-to-block combination preserves content
  // For any group of consecutive line comments, combining to block style
  // should preserve all content
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should preserve content when combining lines to block', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_comments, my_style) => {
          const my_processor = new CommentProcessor();
          const my_tokens = generate_consecutive_line_comments(my_num_comments, my_style);
          const my_comments = my_tokens.map((t) => analyze_comment(t, []));

          const my_combined = my_processor.combine_lines_to_block(my_comments);

          // Should be a block comment
          expect(my_combined).toContain('/*');
          expect(my_combined).toContain('*/');

          // Extract content and verify
          const my_extracted = extract_comment_content(
            {
              type: 'COMMENT_BLOCK',
              value: my_combined,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: my_combined.length },
              },
            },
            'block'
          );

          // Should contain all original content
          for (const my_comment of my_comments) {
            expect(my_extracted).toContain(my_comment.content);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Combined block comments have correct indentation
  // For any group of line comments, combining to block should preserve
  // the indentation of the first comment
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should preserve indentation when combining lines to block', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 10 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_comments, my_indent, my_style) => {
          const my_processor = new CommentProcessor();
          const my_tokens = generate_consecutive_line_comments(my_num_comments, my_style, my_indent);
          const my_comments = my_tokens.map((t) => analyze_comment(t, []));

          const my_combined = my_processor.combine_lines_to_block(my_comments);

          // Extract indentation from combined comment
          const my_indent_match = my_combined.match(/^( *)/);
          const my_combined_indent = my_indent_match?.[1].length || 0;

          // Should match original indentation
          expect(my_combined_indent).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Block-to-line conversion maintains line count
  // For any block comment with N lines, converting to line style should
  // produce at least N lines (may be more due to blank line handling)
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should maintain line count when converting block to lines', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_target_style) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_multiline_block_comment(my_num_lines);
          const my_comment = analyze_comment(my_token, []);

          const my_lines = my_processor.convert_block_to_lines(my_comment, my_target_style);

          // Should have at least as many lines as original
          expect(my_lines.length).toBeGreaterThanOrEqual(my_num_lines);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Consecutive comments can be combined
  // For any group of consecutive line comments, they should be combinable
  // into a block comment
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should combine consecutive line comments into block', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_comments, my_style) => {
          const my_processor = new CommentProcessor();
          const my_tokens = generate_consecutive_line_comments(my_num_comments, my_style);
          const my_comments = my_tokens.map((t) => analyze_comment(t, []));

          const my_combined = my_processor.combine_lines_to_block(my_comments);

          // Should be a valid block comment (starts with /* and ends with */)
          expect(my_combined).toContain('/*');
          expect(my_combined).toContain('*/');
          expect(my_combined).toMatch(/^[ ]*\/\*/);
          expect(my_combined).toMatch(/\*\/$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Block-to-line conversion produces valid line comments
  // For any block comment, converting to line style should produce
  // valid line comments with correct prefixes
  // Feature: comment-style-normalization, Property 7: Multi-line comment handling
  // Validates: Requirements 5.1, 5.2, 5.3, 5.5
  it('should produce valid line comments when converting block', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash')
        ) as fc.Arbitrary<'star' | 'slash'>,
        (my_num_lines, my_target_style) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_multiline_block_comment(my_num_lines);
          const my_comment = analyze_comment(my_token, []);

          const my_lines = my_processor.convert_block_to_lines(my_comment, my_target_style);

          // Each non-empty line should be a valid line comment
          const my_prefix = my_target_style === 'star' ? '\\*' : '\\/\\/';
          const my_pattern = new RegExp(`^[ ]*${my_prefix} `);

          for (const my_line of my_lines) {
            if (my_line.length > 0) {
              expect(my_line).toMatch(my_pattern);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
