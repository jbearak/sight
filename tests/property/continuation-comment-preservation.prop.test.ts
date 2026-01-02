import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Range } from 'vscode-languageserver-textdocument';
import {
  CommentProcessor,
  analyze_comment,
  classify_comment_style,
} from '../../src/comment-processor';
import { Token } from '../../src/types';

// Generator for creating continuation comment tokens
const generate_continuation_comment = (content: string, indent: number = 0): Token => {
  const value = `/// ${content}`;
  return {
    type: 'CONTINUATION',
    value,
    range: {
      start: { line: 0, character: indent },
      end: { line: 0, character: indent + value.length },
    },
  };
};

describe('Continuation Comment Preservation Property Tests', () => {
  // Property 6: Continuation comment preservation
  // For any continuation comment (///), it should never be normalized
  // regardless of the target style
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should never normalize continuation comments to slash style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_continuation_comment(my_content);
          const my_analysis = analyze_comment(my_token, []);

          const my_normalized = my_processor.normalize_comment_style(my_analysis, 'slash');

          // Should return unchanged
          expect(my_normalized).toBe(my_token.value);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments never normalized to star style
  // For any continuation comment, converting to star style should return unchanged
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should never normalize continuation comments to star style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_continuation_comment(my_content);
          const my_analysis = analyze_comment(my_token, []);

          const my_normalized = my_processor.normalize_comment_style(my_analysis, 'star');

          // Should return unchanged
          expect(my_normalized).toBe(my_token.value);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments never normalized to block style
  // For any continuation comment, converting to block style should return unchanged
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should never normalize continuation comments to block style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_continuation_comment(my_content);
          const my_analysis = analyze_comment(my_token, []);

          const my_normalized = my_processor.normalize_comment_style(my_analysis, 'block');

          // Should return unchanged
          expect(my_normalized).toBe(my_token.value);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments are correctly classified
  // For any continuation comment token, it should be classified as 'continuation'
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should correctly classify continuation comments', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_token = generate_continuation_comment(my_content);
          const my_style = classify_comment_style(my_token);

          expect(my_style).toBe('continuation');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Process comments skips continuation comments
  // For any set of comments including continuation comments, processing
  // should skip continuation comments and not generate transformations for them
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should skip continuation comments during processing', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            is_continuation: fc.boolean(),
            content: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('\n')),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (my_comments_data) => {
          const my_processor = new CommentProcessor();
          const my_tokens: Token[] = [];

          for (let i = 0; i < my_comments_data.length; i++) {
            const my_data = my_comments_data[i];
            let my_value = '';
            let my_type: any = 'COMMENT_LINE';

            if (my_data.is_continuation) {
              my_value = `/// ${my_data.content}`;
              my_type = 'CONTINUATION';
            } else {
              my_value = `// ${my_data.content}`;
            }

            my_tokens.push({
              type: my_type,
              value: my_value,
              range: {
                start: { line: i, character: 0 },
                end: { line: i, character: my_value.length },
              },
            });
          }

          const my_transformations = my_processor.process_comments(my_tokens, 'star', []);

          // Should only have transformations for non-continuation comments
          const my_non_continuation_count = my_comments_data.filter(
            (c) => !c.is_continuation
          ).length;
          expect(my_transformations.length).toBe(my_non_continuation_count);

          // No transformation should be for a continuation comment
          for (const my_transformation of my_transformations) {
            expect(my_transformation.original_style).not.toBe('continuation');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments preserve indentation
  // For any continuation comment with indentation, the indentation should
  // be preserved even when processing
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should preserve continuation comment indentation', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n') && s.trim().length > 0),
        fc.integer({ min: 0, max: 20 }),
        (my_content, my_indent) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_continuation_comment(my_content, my_indent);
          const my_analysis = analyze_comment(my_token, []);

          // Indentation should be preserved in the analysis
          expect(my_analysis.indent_level).toBe(my_indent);

          // Try to normalize to each style
          const my_styles: Array<'star' | 'slash' | 'block'> = ['star', 'slash', 'block'];
          for (const my_style of my_styles) {
            const my_normalized = my_processor.normalize_comment_style(my_analysis, my_style);

            // Should be unchanged
            expect(my_normalized).toBe(my_token.value);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments are never multiline
  // For any continuation comment, it should never be detected as multiline
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should never detect continuation comments as multiline', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_token = generate_continuation_comment(my_content);
          const my_analysis = analyze_comment(my_token, []);

          // Should never be multiline
          expect(my_analysis.is_multiline).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments are always in Stata context
  // For any continuation comment, it should always be in Stata context
  // (never in embedded language contexts)
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should always detect continuation comments in Stata context', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_token = generate_continuation_comment(my_content);
          const my_analysis = analyze_comment(my_token, []);

          // Should be in Stata context
          expect(my_analysis.language_context).toBe('stata');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Continuation comments preserve content exactly
  // For any continuation comment, the content should be preserved exactly
  // when attempting normalization
  // Feature: comment-style-normalization, Property 6: Continuation comment preservation
  // Validates: Requirements 4.8
  it('should preserve continuation comment content exactly', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_content) => {
          const my_processor = new CommentProcessor();
          const my_token = generate_continuation_comment(my_content);
          const my_analysis = analyze_comment(my_token, []);

          // Try to normalize to each style
          const my_styles: Array<'star' | 'slash' | 'block'> = ['star', 'slash', 'block'];
          for (const my_style of my_styles) {
            const my_normalized = my_processor.normalize_comment_style(my_analysis, my_style);

            // Should contain the original content
            expect(my_normalized).toContain(my_content);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
