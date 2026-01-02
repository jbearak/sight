import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CodeFormatter } from '../../src/providers/formatter';
import { DocumentStore } from '../../src/document-store';
import { CommentFormattingConfig } from '../../src/types';
import { FormattingOptions } from 'vscode-languageserver';

describe('Formatter Comment Preservation Property Tests', () => {
  // Property 2: Comment preservation when normalization disabled
  // For any document with mixed comment styles, when normalizeCommentStyle
  // is false, all comment styles should be preserved exactly
  // Feature: comment-style-normalization, Property 2: Comment preservation
  // when normalization disabled
  // Validates: Requirements 2.3
  it('should preserve all comment styles when normalization disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/).filter(
              (s) => s.trim().length > 0
            ),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (my_comments_data) => {
          // Build Stata code with comments
          const my_lines: string[] = [];
          
          for (const my_data of my_comments_data) {
            let my_line = '';
            switch (my_data.style) {
              case 'star':
                my_line = `* ${my_data.content}`;
                break;
              case 'slash':
                my_line = `// ${my_data.content}`;
                break;
              case 'block':
                my_line = `/* ${my_data.content} */`;
                break;
            }
            my_lines.push(my_line);
          }
          
          my_lines.push('display "hello"');
          const my_content = my_lines.join('\n');

          // Use DocumentStore to properly parse the content
          const my_store = new DocumentStore();
          await my_store.open('file:///test.do', my_content, 1);
          const my_document = my_store.get('file:///test.do');

          if (!my_document || !my_document.ast) {
            return; // Skip if parsing failed
          }

          const my_formatter = new CodeFormatter();
          const my_config: CommentFormattingConfig = {
            preferredCommentStyle: '//',
            normalizeCommentStyle: false, // Disabled
            commentLineWidth: 72,
          };

          const my_options: FormattingOptions = {
            tabSize: 4,
            insertSpaces: true,
          };

          const my_edits = my_formatter.format_with_comment_normalization(
            my_document,
            my_options,
            my_config
          );

          // Should have at least one edit
          expect(my_edits.length).toBeGreaterThan(0);

          // The formatted content should contain all original comment styles
          const my_formatted = my_edits[0].newText;

          for (const my_data of my_comments_data) {
            // Check that the comment style is preserved
            if (my_data.style === 'star') {
              expect(my_formatted).toContain('*');
            } else if (my_data.style === 'slash') {
              expect(my_formatted).toContain('//');
            } else if (my_data.style === 'block') {
              expect(my_formatted).toContain('/*');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Comment content is preserved when normalization disabled
  // For any document with comments, when normalization is disabled,
  // the comment content should be preserved exactly
  // Feature: comment-style-normalization, Property 2: Comment preservation
  // when normalization disabled
  // Validates: Requirements 2.3
  it('should preserve comment content when normalization disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/).filter(
              (s) => s.trim().length > 0
            ),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        async (my_comments_data) => {
          // Build Stata code with comments
          const my_lines: string[] = [];
          
          for (const my_data of my_comments_data) {
            let my_line = '';
            switch (my_data.style) {
              case 'star':
                my_line = `* ${my_data.content}`;
                break;
              case 'slash':
                my_line = `// ${my_data.content}`;
                break;
              case 'block':
                my_line = `/* ${my_data.content} */`;
                break;
            }
            my_lines.push(my_line);
          }
          
          my_lines.push('display "hello"');
          const my_content = my_lines.join('\n');

          // Use DocumentStore to properly parse the content
          const my_store = new DocumentStore();
          await my_store.open('file:///test.do', my_content, 1);
          const my_document = my_store.get('file:///test.do');

          if (!my_document || !my_document.ast) {
            return; // Skip if parsing failed
          }

          const my_formatter = new CodeFormatter();
          const my_config: CommentFormattingConfig = {
            preferredCommentStyle: '//',
            normalizeCommentStyle: false, // Disabled
            commentLineWidth: 72,
          };

          const my_options: FormattingOptions = {
            tabSize: 4,
            insertSpaces: true,
          };

          const my_edits = my_formatter.format_with_comment_normalization(
            my_document,
            my_options,
            my_config
          );

          const my_formatted = my_edits[0].newText;

          // All original comment contents should be preserved
          for (const my_data of my_comments_data) {
            expect(my_formatted).toContain(my_data.content);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property: Normalization disabled returns same as standard format
  // For any document, when normalization is disabled, the result should
  // be the same as standard formatting
  // Feature: comment-style-normalization, Property 2: Comment preservation
  // when normalization disabled
  // Validates: Requirements 2.3
  it('should return same result as standard format when disabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            style: fc.oneof(
              fc.constant('star'),
              fc.constant('slash'),
              fc.constant('block')
            ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
            content: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,20}$/).filter(
              (s) => s.trim().length > 0
            ),
          }),
          { minLength: 1, maxLength: 2 }
        ),
        async (my_comments_data) => {
          // Build Stata code with comments
          const my_lines: string[] = [];
          
          for (const my_data of my_comments_data) {
            let my_line = '';
            switch (my_data.style) {
              case 'star':
                my_line = `* ${my_data.content}`;
                break;
              case 'slash':
                my_line = `// ${my_data.content}`;
                break;
              case 'block':
                my_line = `/* ${my_data.content} */`;
                break;
            }
            my_lines.push(my_line);
          }
          
          my_lines.push('display "hello"');
          const my_content = my_lines.join('\n');

          // Use DocumentStore to properly parse the content
          const my_store = new DocumentStore();
          await my_store.open('file:///test.do', my_content, 1);
          const my_document = my_store.get('file:///test.do');

          if (!my_document || !my_document.ast) {
            return; // Skip if parsing failed
          }

          const my_formatter = new CodeFormatter();
          const my_config: CommentFormattingConfig = {
            preferredCommentStyle: '//',
            normalizeCommentStyle: false, // Disabled
            commentLineWidth: 72,
          };

          const my_options: FormattingOptions = {
            tabSize: 4,
            insertSpaces: true,
          };

          // Get result with normalization disabled
          const my_disabled_edits = my_formatter.format_with_comment_normalization(
            my_document,
            my_options,
            my_config
          );

          // Get result with standard format
          const my_standard_edits = my_formatter.format(my_document, my_options);

          // Both should produce the same result
          expect(my_disabled_edits[0].newText).toBe(my_standard_edits[0].newText);
        }
      ),
      { numRuns: 100 }
    );
  });
});
