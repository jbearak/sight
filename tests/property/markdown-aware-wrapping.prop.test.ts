import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  CommentProcessor,
  analyze_markdown,
  is_markdown_sensitive_line,
} from '../../src/comment-processor';

describe('Markdown-aware Wrapping Property Tests', () => {
  // Property 15: Markdown-aware wrapping
  // For any comment containing Markdown syntax, the formatter should preserve
  // Markdown structure (headers, lists, code blocks) and not break list items
  // or other elements across lines during wrapping
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should preserve Markdown headers during wrapping', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_header_level, my_header_text) => {
          const my_processor = new CommentProcessor();
          
          const my_header = '#'.repeat(my_header_level) + ' ' + my_header_text;
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_header,
            40,
            'slash',
            0
          );

          // Should preserve header as single line
          expect(my_wrapped.length).toBe(1);
          expect(my_wrapped[0]).toContain('#'.repeat(my_header_level));
          expect(my_wrapped[0]).toContain(my_header_text);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown list items are not broken
  // For any Markdown list item, it should not be broken across lines during
  // wrapping
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should preserve Markdown list items during wrapping', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('-'),
          fc.constant('*'),
          fc.constant('+')
        ) as fc.Arbitrary<string>,
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_bullet, my_item_text) => {
          const my_processor = new CommentProcessor();
          
          const my_list_item = my_bullet + ' ' + my_item_text;
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_list_item,
            40,
            'slash',
            0
          );

          // Should preserve list item as single line
          expect(my_wrapped.length).toBe(1);
          expect(my_wrapped[0]).toContain(my_bullet);
          expect(my_wrapped[0]).toContain(my_item_text);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Numbered list items are not broken
  // For any numbered Markdown list item, it should not be broken across
  // lines during wrapping
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should preserve numbered Markdown list items during wrapping', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_number, my_item_text) => {
          const my_processor = new CommentProcessor();
          
          const my_list_item = my_number + '. ' + my_item_text;
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_list_item,
            40,
            'slash',
            0
          );

          // Should preserve list item as single line
          expect(my_wrapped.length).toBe(1);
          expect(my_wrapped[0]).toContain(my_number.toString());
          expect(my_wrapped[0]).toContain(my_item_text);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Code blocks are preserved
  // For any code block in a comment, it should be preserved as-is without
  // wrapping
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should preserve code blocks during wrapping', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_code) => {
          const my_processor = new CommentProcessor();
          
          const my_code_block = '```\n' + my_code + '\n```';
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_code_block,
            40,
            'slash',
            0
          );

          // Should preserve code block structure
          const my_joined = my_wrapped.join('\n');
          expect(my_joined).toContain('```');
          expect(my_joined).toContain(my_code);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Blockquotes are preserved
  // For any blockquote in a comment, it should be preserved as-is without
  // wrapping
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should preserve blockquotes during wrapping', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_quote_text) => {
          const my_processor = new CommentProcessor();
          
          const my_blockquote = '> ' + my_quote_text;
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_blockquote,
            40,
            'slash',
            0
          );

          // Should preserve blockquote as single line
          expect(my_wrapped.length).toBe(1);
          expect(my_wrapped[0]).toContain('>');
          expect(my_wrapped[0]).toContain(my_quote_text);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown detection identifies headers
  // For any Markdown header, the analyzer should detect it
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should detect Markdown headers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_level, my_text) => {
          const my_header = '#'.repeat(my_level) + ' ' + my_text;
          const my_analysis = analyze_markdown(my_header);

          // Should detect header
          expect(my_analysis.has_markdown).toBe(true);
          expect(my_analysis.elements.length).toBeGreaterThan(0);
          expect(my_analysis.elements[0].type).toBe('header');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown detection identifies list items
  // For any Markdown list item, the analyzer should detect it
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should detect Markdown list items', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('-'),
          fc.constant('*'),
          fc.constant('+')
        ) as fc.Arbitrary<string>,
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_bullet, my_text) => {
          const my_list_item = my_bullet + ' ' + my_text;
          const my_analysis = analyze_markdown(my_list_item);

          // Should detect list item
          expect(my_analysis.has_markdown).toBe(true);
          expect(my_analysis.elements.length).toBeGreaterThan(0);
          expect(my_analysis.elements[0].type).toBe('list_item');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown detection identifies code blocks
  // For any code block, the analyzer should detect it
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should detect Markdown code blocks', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }).filter((s) => !s.includes('\n')),
        (my_code) => {
          const my_code_block = '```\n' + my_code + '\n```';
          const my_analysis = analyze_markdown(my_code_block);

          // Should detect code block
          expect(my_analysis.has_markdown).toBe(true);
          expect(my_analysis.elements.length).toBeGreaterThan(0);
          expect(my_analysis.elements.some((e) => e.type === 'code_block')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Line break sensitivity is marked correctly
  // For any Markdown-sensitive line, the analyzer should mark it as sensitive
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should mark Markdown-sensitive lines correctly', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('# Header'),
          fc.constant('- List item'),
          fc.constant('* List item'),
          fc.constant('+ List item'),
          fc.constant('1. Numbered item'),
          fc.constant('> Blockquote'),
          fc.constant('```')
        ) as fc.Arbitrary<string>,
        (my_line) => {
          const my_analysis = analyze_markdown(my_line);

          // Should mark as sensitive
          expect(my_analysis.line_break_sensitive[0]).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Non-Markdown lines are not marked as sensitive
  // For any plain text line without Markdown, the analyzer should not mark
  // it as sensitive
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should not mark plain text lines as sensitive', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 50 })
          .filter((s) => !s.includes('\n'))
          .filter((s) => !s.match(/^#+\s/))
          .filter((s) => !s.match(/^\s*[-*+]\s/))
          .filter((s) => !s.match(/^\s*\d+\.\s/))
          .filter((s) => !s.match(/^\s*>/))
          .filter((s) => !s.includes('```')),
        (my_text) => {
          const my_analysis = analyze_markdown(my_text);

          // Should not mark as sensitive
          expect(my_analysis.line_break_sensitive[0]).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown-aware wrapping preserves content
  // For any comment with Markdown, wrapping should preserve all content
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should preserve content in Markdown-aware wrapping', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 50 })
          .filter((s) => !s.includes('\n')),
        (my_text) => {
          const my_processor = new CommentProcessor();
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_text,
            40,
            'slash',
            0
          );

          // Reconstruct content
          const my_reconstructed = my_wrapped
            .map((line) => line.replace(/^[ ]*\/\/\s?/, ''))
            .join(' ');

          // Should contain original words
          const my_original_words = my_text.split(/\s+/);
          for (const my_word of my_original_words) {
            if (my_word.length > 0) {
              expect(my_reconstructed).toContain(my_word);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Markdown-aware wrapping respects line width
  // For any comment, Markdown-aware wrapping should respect the line width
  // limit
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should respect line width in Markdown-aware wrapping', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 60 }),
        fc.integer({ min: 0, max: 5 }),
        (my_line_width, my_indent) => {
          const my_processor = new CommentProcessor();
          
          const my_long_text = 'This is a very long comment that should definitely be wrapped because it exceeds the line width limit';
          
          const my_wrapped = my_processor.wrap_comment_lines_markdown_aware(
            my_long_text,
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

  // Property: Markdown-sensitive line detection works correctly
  // For any line, the is_markdown_sensitive_line function should correctly
  // identify Markdown-sensitive lines
  // Feature: comment-style-normalization, Property 15: Markdown-aware wrapping
  // Validates: Requirements 12.8, 12.9, 12.10, 12.11
  it('should correctly identify Markdown-sensitive lines', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('# Header'),
          fc.constant('- List item'),
          fc.constant('* List item'),
          fc.constant('+ List item'),
          fc.constant('1. Numbered item'),
          fc.constant('> Blockquote'),
          fc.constant('```')
        ) as fc.Arbitrary<string>,
        (my_line) => {
          const my_is_sensitive = is_markdown_sensitive_line(my_line);

          // Should be marked as sensitive
          expect(my_is_sensitive).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
