import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Range } from 'vscode-languageserver-textdocument';
import {
  CommentProcessor,
  CommentAnalysis,
  analyze_comment,
  extract_comment_content,
} from '../../src/comment-processor';
import { Token, LanguageContext } from '../../src/types';

// Generator for creating comment analysis objects
const generate_comment_analysis = (
  style: 'star' | 'slash' | 'block',
  content: string,
  indent: number = 0
): CommentAnalysis => {
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

  const token: Token = {
    type: token_type,
    value: token_value,
    range: {
      start: { line: 0, character: indent },
      end: { line: 0, character: indent + token_value.length },
    },
  };

  return analyze_comment(token, []);
};

describe('Comment Style Conversion Property Tests', () => {
  // Property 5: Style conversion correctness
  // For any comment in one style, converting it to another style should
  // preserve the comment content and proper indentation while changing
  // only the comment delimiters
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should convert star comments to slash style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        fc.integer({ min: 0, max: 10 }),
        (my_content, my_indent) => {
          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis('star', my_content, my_indent);

          const my_converted = my_processor.normalize_comment_style(my_comment, 'slash');

          // Should start with proper indentation and //
          expect(my_converted).toMatch(/^[ ]*\/\/ /);

          // Should contain the original content
          expect(my_converted).toContain(my_content);

          // Should have correct indentation
          const my_indent_match = my_converted.match(/^( *)/);
          expect(my_indent_match?.[1].length).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Convert slash comments to star style
  // For any slash comment, converting to star style should preserve content
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should convert slash comments to star style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        fc.integer({ min: 0, max: 10 }),
        (my_content, my_indent) => {
          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis('slash', my_content, my_indent);

          const my_converted = my_processor.normalize_comment_style(my_comment, 'star');

          // Should start with proper indentation and *
          expect(my_converted).toMatch(/^[ ]*\* /);

          // Should contain the original content
          expect(my_converted).toContain(my_content);

          // Should have correct indentation
          const my_indent_match = my_converted.match(/^( *)/);
          expect(my_indent_match?.[1].length).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Convert block comments to slash style
  // For any block comment, converting to slash style should preserve content
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should convert block comments to slash style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        fc.integer({ min: 0, max: 10 }),
        (my_content, my_indent) => {
          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis('block', my_content, my_indent);

          const my_converted = my_processor.normalize_comment_style(my_comment, 'slash');

          // Should start with proper indentation and //
          expect(my_converted).toMatch(/^[ ]*\/\/ /);

          // Should contain the original content
          expect(my_converted).toContain(my_content);

          // Should have correct indentation
          const my_indent_match = my_converted.match(/^( *)/);
          expect(my_indent_match?.[1].length).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Convert slash comments to block style
  // For any slash comment, converting to block style should preserve content
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should convert slash comments to block style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        fc.integer({ min: 0, max: 10 }),
        (my_content, my_indent) => {
          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis('slash', my_content, my_indent);

          const my_converted = my_processor.normalize_comment_style(my_comment, 'block');

          // Should start with proper indentation and /*
          expect(my_converted).toMatch(/^[ ]*\/\* /);

          // Should end with */
          expect(my_converted).toMatch(/\*\/$/);

          // Should contain the original content
          expect(my_converted).toContain(my_content);

          // Should have correct indentation
          const my_indent_match = my_converted.match(/^( *)/);
          expect(my_indent_match?.[1].length).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Convert star comments to block style
  // For any star comment, converting to block style should preserve content
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should convert star comments to block style', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        fc.integer({ min: 0, max: 10 }),
        (my_content, my_indent) => {
          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis('star', my_content, my_indent);

          const my_converted = my_processor.normalize_comment_style(my_comment, 'block');

          // Should start with proper indentation and /*
          expect(my_converted).toMatch(/^[ ]*\/\* /);

          // Should end with */
          expect(my_converted).toMatch(/\*\/$/);

          // Should contain the original content
          expect(my_converted).toContain(my_content);

          // Should have correct indentation
          const my_indent_match = my_converted.match(/^( *)/);
          expect(my_indent_match?.[1].length).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Same style conversion returns unchanged
  // For any comment, converting to the same style should return the original
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should return unchanged when converting to same style', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_style, my_content) => {
          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis(my_style, my_content);

          const my_converted = my_processor.normalize_comment_style(my_comment, my_style);

          // Should be unchanged
          expect(my_converted).toBe(my_comment.token.value);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Indentation is preserved during conversion
  // For any comment with indentation, the indentation should be preserved
  // during style conversion
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should preserve indentation during conversion', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        fc.integer({ min: 0, max: 20 }),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('\n')),
        (my_from_style, my_to_style, my_indent, my_content) => {
          if (my_from_style === my_to_style) {
            return; // Skip same-style conversions
          }

          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis(my_from_style, my_content, my_indent);

          const my_converted = my_processor.normalize_comment_style(my_comment, my_to_style);

          // Extract indentation from converted comment
          const my_indent_match = my_converted.match(/^( *)/);
          const my_converted_indent = my_indent_match?.[1].length || 0;

          // Should match original indentation
          expect(my_converted_indent).toBe(my_indent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Content is preserved during conversion
  // For any comment, the content should be preserved exactly during conversion
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should preserve content exactly during conversion', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\n')),
        (my_from_style, my_to_style, my_content) => {
          if (my_from_style === my_to_style) {
            return; // Skip same-style conversions
          }

          const my_processor = new CommentProcessor();
          const my_comment = generate_comment_analysis(my_from_style, my_content);

          const my_converted = my_processor.normalize_comment_style(my_comment, my_to_style);

          // Extract content from converted comment
          const my_extracted = extract_comment_content(
            {
              type: 'COMMENT_LINE',
              value: my_converted,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: my_converted.length },
              },
            },
            my_to_style
          );

          // Should match original content
          expect(my_extracted).toBe(my_content);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Process comments generates correct transformations
  // For any set of comments, processing should generate transformations
  // that preserve content and change only the delimiters
  // Feature: comment-style-normalization, Property 5: Style conversion correctness
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  it('should generate correct transformations for multiple comments', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
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

            switch (my_data.style) {
              case 'star':
                my_value = `* ${my_data.content}`;
                break;
              case 'slash':
                my_value = `// ${my_data.content}`;
                break;
              case 'block':
                my_value = `/* ${my_data.content} */`;
                my_type = 'COMMENT_BLOCK';
                break;
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

          const my_transformations = my_processor.process_comments(my_tokens, 'slash', []);

          // Should have transformations for comments not already in slash style
          const my_expected_count = my_comments_data.filter((c) => c.style !== 'slash').length;
          expect(my_transformations.length).toBe(my_expected_count);

          // All transformations should target slash style
          for (const my_transformation of my_transformations) {
            expect(my_transformation.target_style).toBe('slash');
            expect(my_transformation.new_text).toContain('//');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
