/**
 * Property Tests: Formatter Embedded Context Preservation
 *
 * Feature: comment-style-normalization
 * Tests that comments within embedded language blocks (Mata, Python) are
 * preserved and not normalized.
 *
 * NOTE: These tests operate on the CommentProcessor directly, not the
 * CodeFormatter. The CommentProcessor is a lower-level component that
 * handles comment transformations regardless of formatter mode. Therefore,
 * dual-mode testing is not applicable here - the behavior is the same
 * regardless of which formatter (source-preserving or AST) is used.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CommentProcessor } from '../../src/comment-processor/comment-processor';
import { Token, LanguageContext, ContextRange } from '../../src/types';
import { Range } from 'vscode-languageserver-textdocument';

// Generator for comment tokens
const generate_comment_token = (
  my_style: 'star' | 'slash' | 'block',
  my_content: string,
  my_line: number
): Token => {
  let my_value = '';
  let my_type: any = 'COMMENT_LINE';

  switch (my_style) {
    case 'star':
      my_value = `* ${my_content}`;
      break;
    case 'slash':
      my_value = `// ${my_content}`;
      break;
    case 'block':
      my_value = `/* ${my_content} */`;
      my_type = 'COMMENT_BLOCK';
      break;
  }

  return {
    type: my_type,
    value: my_value,
    range: {
      start: { line: my_line, character: 0 },
      end: { line: my_line, character: my_value.length },
    },
  };
};

// Generator for context ranges
const generate_context_range = (
  my_context: LanguageContext,
  my_start_line: number,
  my_end_line: number
): ContextRange => {
  return {
    context: my_context,
    range: {
      start: { line: my_start_line, character: 0 },
      end: { line: my_end_line, character: 100 },
    },
    start_delimiter: {
      command: my_context === LanguageContext.MATA ? 'mata' : 'python',
      range: {
        start: { line: my_start_line, character: 0 },
        end: { line: my_start_line, character: 4 },
      },
    },
    is_single_line: false,
  };
};

describe('Formatter Embedded Context Preservation Property Tests', () => {
  // Property 11: Embedded context preservation
  // For any document containing embedded language blocks (Mata or Python),
  // comments within those blocks should never be normalized and should
  // preserve their original syntax
  // Feature: comment-style-normalization, Property 11: Embedded context
  // preservation
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4
  it('should not normalize comments in Mata blocks', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.string({ minLength: 1, maxLength: 50 }).filter(
              (s) => !s.includes('\n')
            ),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        (my_comments_data) => {
          const my_tokens: Token[] = [];

          for (let i = 0; i < my_comments_data.length; i++) {
            const my_data = my_comments_data[i];
            const my_token = generate_comment_token(my_data.style, my_data.content, i);
            my_tokens.push(my_token);
          }

          // Create a Mata context that covers all comments
          const my_context_ranges: ContextRange[] = [
            generate_context_range(LanguageContext.MATA, 0, my_comments_data.length),
          ];

          const my_processor = new CommentProcessor();
          const the_transformations = my_processor.process_comments(
            my_tokens,
            'slash', // Target style
            my_context_ranges
          );

          // Should have no transformations (all comments are in embedded context)
          expect(the_transformations.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Comments in Python blocks are not normalized
  // For any document with Python blocks, comments within those blocks
  // should not be normalized
  // Feature: comment-style-normalization, Property 11: Embedded context
  // preservation
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4
  it('should not normalize comments in Python blocks', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.string({ minLength: 1, maxLength: 50 }).filter(
              (s) => !s.includes('\n')
            ),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        (my_comments_data) => {
          const my_tokens: Token[] = [];

          for (let i = 0; i < my_comments_data.length; i++) {
            const my_data = my_comments_data[i];
            const my_token = generate_comment_token(my_data.style, my_data.content, i);
            my_tokens.push(my_token);
          }

          // Create a Python context that covers all comments
          const my_context_ranges: ContextRange[] = [
            generate_context_range(LanguageContext.PYTHON, 0, my_comments_data.length),
          ];

          const my_processor = new CommentProcessor();
          const the_transformations = my_processor.process_comments(
            my_tokens,
            'slash', // Target style
            my_context_ranges
          );

          // Should have no transformations (all comments are in embedded context)
          expect(the_transformations.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Comments outside embedded blocks are normalized
  // For any document with embedded blocks, comments outside those blocks
  // should be normalized while comments inside are preserved
  // Feature: comment-style-normalization, Property 11: Embedded context
  // preservation
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4
  it('should normalize comments outside embedded blocks', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.string({ minLength: 1, maxLength: 50 }).filter(
              (s) => !s.includes('\n')
            ),
          }),
          { minLength: 3, maxLength: 5 }
        ),
        (my_comments_data) => {
          const my_tokens: Token[] = [];

          for (let i = 0; i < my_comments_data.length; i++) {
            const my_data = my_comments_data[i];
            const my_token = generate_comment_token(my_data.style, my_data.content, i);
            my_tokens.push(my_token);
          }

          // Create a Mata context that covers only the middle comments
          const my_context_ranges: ContextRange[] = [
            generate_context_range(LanguageContext.MATA, 1, my_comments_data.length - 2),
          ];

          const my_processor = new CommentProcessor();
          const the_transformations = my_processor.process_comments(
            my_tokens,
            'slash', // Target style
            my_context_ranges
          );

          // Should have transformations for comments outside the embedded block
          // (first and last comments should be transformed if not already slash)
          const my_first_comment = my_comments_data[0];
          const my_last_comment = my_comments_data[my_comments_data.length - 1];

          let my_expected_count = 0;
          if (my_first_comment.style !== 'slash') {
            my_expected_count++;
          }
          if (my_last_comment.style !== 'slash') {
            my_expected_count++;
          }

          expect(the_transformations.length).toBe(my_expected_count);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Embedded context boundaries are respected
  // For any document with embedded blocks, the boundaries of those blocks
  // should be respected - comments at the boundary should be handled correctly
  // Feature: comment-style-normalization, Property 11: Embedded context
  // preservation
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4
  it('should respect embedded context boundaries', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (my_before_count, my_embedded_count, my_after_count) => {
          const my_tokens: Token[] = [];
          let my_line = 0;

          // Add comments before embedded block
          for (let i = 0; i < my_before_count; i++) {
            my_tokens.push(generate_comment_token('star', `before ${i}`, my_line++));
          }

          const my_embedded_start = my_line;

          // Add comments in embedded block
          for (let i = 0; i < my_embedded_count; i++) {
            my_tokens.push(generate_comment_token('slash', `embedded ${i}`, my_line++));
          }

          const my_embedded_end = my_line - 1;

          // Add comments after embedded block
          for (let i = 0; i < my_after_count; i++) {
            my_tokens.push(generate_comment_token('block', `after ${i}`, my_line++));
          }

          // Create a Mata context for the embedded section
          const my_context_ranges: ContextRange[] = [
            generate_context_range(LanguageContext.MATA, my_embedded_start, my_embedded_end),
          ];

          const my_processor = new CommentProcessor();
          const the_transformations = my_processor.process_comments(
            my_tokens,
            'slash', // Target style
            my_context_ranges
          );

          // Should have transformations for comments outside the embedded block
          // Before: star comments should be transformed to slash
          // Embedded: slash comments should not be transformed
          // After: block comments should be transformed to slash

          let my_expected_count = 0;
          my_expected_count += my_before_count; // All star comments should transform
          my_expected_count += my_after_count; // All block comments should transform

          expect(the_transformations.length).toBe(my_expected_count);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Multiple embedded blocks are handled correctly
  // For any document with multiple embedded blocks, comments in each block
  // should be preserved while comments outside should be normalized
  // Feature: comment-style-normalization, Property 11: Embedded context
  // preservation
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4
  it('should handle multiple embedded blocks correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        (my_block_count) => {
          const my_tokens: Token[] = [];
          let my_line = 0;

          // Add comments before first block
          my_tokens.push(generate_comment_token('star', 'before', my_line++));

          const my_context_ranges: ContextRange[] = [];

          // Add alternating embedded blocks and comments
          for (let i = 0; i < my_block_count; i++) {
            const my_block_start = my_line;

            // Add comments in embedded block
            my_tokens.push(generate_comment_token('slash', `embedded ${i}`, my_line++));

            const my_block_end = my_line - 1;

            my_context_ranges.push(
              generate_context_range(LanguageContext.MATA, my_block_start, my_block_end)
            );

            // Add comment between blocks
            if (i < my_block_count - 1) {
              my_tokens.push(generate_comment_token('block', `between ${i}`, my_line++));
            }
          }

          // Add comment after last block
          my_tokens.push(generate_comment_token('star', 'after', my_line++));

          const my_processor = new CommentProcessor();
          const the_transformations = my_processor.process_comments(
            my_tokens,
            'slash', // Target style
            my_context_ranges
          );

          // Should have transformations for:
          // - First comment (star -> slash)
          // - Between comments (block -> slash)
          // - Last comment (star -> slash)
          // But NOT for embedded comments (already slash)

          const my_expected_count = 2 + (my_block_count - 1); // before + between + after

          expect(the_transformations.length).toBe(my_expected_count);
        }
      ),
      { numRuns: 100 }
    );
  });
});
