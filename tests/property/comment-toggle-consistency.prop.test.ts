import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Range } from 'vscode-languageserver-textdocument';
import { CommentToggle } from '../../src/comment-processor/comment-toggle';
import { Token, LanguageContext, ContextRange } from '../../src/types';

// Generators for creating test data
const generate_code_line = (): string => {
  const my_statements = [
    'generate x = 1',
    'replace y = 2',
    'summarize z',
    'regress y x',
    'list in 1/10',
    'keep if x > 0',
    'drop if missing(y)',
    'sort x',
    'merge 1:1 id using data',
    'append using other',
  ];
  return my_statements[Math.floor(Math.random() * my_statements.length)];
};

const generate_comment_token = (
  my_style: 'star' | 'slash' | 'block' | 'continuation',
  my_line: number
): Token => {
  const my_range: Range = {
    start: { line: my_line, character: 0 },
    end: { line: my_line, character: 20 },
  };

  let my_value = '';
  let my_type: any = 'COMMENT_LINE';

  switch (my_style) {
    case 'star':
      my_value = '* This is a comment';
      my_type = 'COMMENT_LINE';
      break;
    case 'slash':
      my_value = '// This is a comment';
      my_type = 'COMMENT_LINE';
      break;
    case 'continuation':
      my_value = '/// This is a continuation';
      my_type = 'CONTINUATION';
      break;
    case 'block':
      my_value = '/* This is a comment */';
      my_type = 'COMMENT_BLOCK';
      break;
  }

  return { type: my_type, value: my_value, range: my_range };
};

const generate_context_range = (
  my_start_line: number,
  my_end_line: number,
  my_context: LanguageContext
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
        start: { line: my_start_line - 1, character: 0 },
        end: { line: my_start_line - 1, character: 4 },
      },
    },
    is_single_line: false,
  };
};

describe('Comment Toggle Consistency Property Tests', () => {
  // Property 9: Comment toggle style consistency
  // For any line being commented or uncommented, the toggle operation should
  // use the configured preferred style for commenting and correctly remove
  // comments regardless of original style
  // Feature: comment-style-normalization, Property 9: Comment toggle style consistency
  // Validates: Requirements 6.1, 6.5
  it('should toggle comments using preferred style', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('//'),
          fc.constant('*'),
          fc.constant('/* */')
        ) as fc.Arbitrary<'//' | '*' | '/* */'>,
        (my_preferred_style) => {
          const my_toggle = new CommentToggle();
          const my_code_line = generate_code_line();
          const my_lines = [my_code_line];
          const my_line_numbers = [0];
          const my_tokens: Token[] = [];
          const my_context_ranges: ContextRange[] = [];

          // Toggle to comment
          const my_comment_ops = my_toggle.toggle_lines(
            my_lines,
            my_line_numbers,
            my_preferred_style,
            my_tokens,
            my_context_ranges
          );

          expect(my_comment_ops.length).toBe(1);
          const my_comment_op = my_comment_ops[0];

          // Verify the comment uses the preferred style
          expect(my_comment_op.is_comment_operation).toBe(true);
          
          // Verify the comment style is correct
          // For block comments, check for /* and */ separately since content is between them
          if (my_preferred_style === '/* */') {
            expect(my_comment_op.new_text).toContain('/*');
            expect(my_comment_op.new_text).toContain('*/');
          } else {
            expect(my_comment_op.new_text).toContain(my_preferred_style);
          }

          // Verify the original code is preserved in the comment
          expect(my_comment_op.new_text).toContain(my_code_line.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 9: Comment toggle style consistency (uncomment)
  // For any commented line, toggling should correctly remove the comment
  // regardless of the original comment style
  // Feature: comment-style-normalization, Property 9: Comment toggle style consistency
  // Validates: Requirements 6.1, 6.5
  it('should correctly uncomment lines regardless of original style', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('star'),
          fc.constant('slash'),
          fc.constant('block')
        ) as fc.Arbitrary<'star' | 'slash' | 'block'>,
        (my_original_style) => {
          const my_toggle = new CommentToggle();
          const my_code_line = generate_code_line();

          // Create a commented line
          let my_commented_line = '';
          switch (my_original_style) {
            case 'star':
              my_commented_line = `* ${my_code_line}`;
              break;
            case 'slash':
              my_commented_line = `// ${my_code_line}`;
              break;
            case 'block':
              my_commented_line = `/* ${my_code_line} */`;
              break;
          }

          const my_lines = [my_commented_line];
          const my_line_numbers = [0];

          // Create a token for the comment that matches the actual commented line
          const my_token_type = my_original_style === 'block' ? 'COMMENT_BLOCK' : 'COMMENT_LINE';
          const my_comment_token: Token = {
            type: my_token_type as any,
            value: my_commented_line,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: my_commented_line.length },
            },
          };
          const my_tokens = [my_comment_token];
          const my_context_ranges: ContextRange[] = [];

          // Toggle to uncomment
          const my_uncomment_ops = my_toggle.toggle_lines(
            my_lines,
            my_line_numbers,
            '//',
            my_tokens,
            my_context_ranges
          );

          expect(my_uncomment_ops.length).toBe(1);
          const my_uncomment_op = my_uncomment_ops[0];

          // Verify the comment is removed
          expect(my_uncomment_op.is_comment_operation).toBe(false);
          expect(my_uncomment_op.new_text).toContain(my_code_line.trim());
          
          // Verify comment markers are removed from the start
          // The result should not start with comment markers
          const my_trimmed_result = my_uncomment_op.new_text.trimStart();
          expect(my_trimmed_result.startsWith('//')).toBe(false);
          expect(my_trimmed_result.startsWith('/*')).toBe(false);
          // For star comments, check it doesn't start with "* " (star followed by space)
          // but allow * in the middle of code (like multiplication)
          if (my_original_style === 'star') {
            expect(my_trimmed_result.startsWith('* ')).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 9: Comment toggle style consistency (embedded context)
  // For any line in an embedded language context, toggling should not
  // modify the line
  // Feature: comment-style-normalization, Property 9: Comment toggle style consistency
  // Validates: Requirements 6.1, 6.5
  it('should not toggle comments in embedded language contexts', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(LanguageContext.MATA),
          fc.constant(LanguageContext.PYTHON)
        ) as fc.Arbitrary<LanguageContext>,
        (my_context) => {
          const my_toggle = new CommentToggle();
          const my_code_line = generate_code_line();
          const my_lines = [my_code_line];
          const my_line_numbers = [0];
          const my_tokens: Token[] = [];

          // Create a context range that includes line 0
          const my_context_ranges = [
            generate_context_range(0, 10, my_context),
          ];

          // Try to toggle
          const my_ops = my_toggle.toggle_lines(
            my_lines,
            my_line_numbers,
            '//',
            my_tokens,
            my_context_ranges
          );

          // Should return no operations for embedded context
          expect(my_ops.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 9: Comment toggle style consistency (round trip)
  // For any line, toggling to comment and then back to uncomment should
  // restore the original line
  // Feature: comment-style-normalization, Property 9: Comment toggle style consistency
  // Validates: Requirements 6.1, 6.5
  it('should restore original line after toggle round trip', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('//'),
          fc.constant('*'),
          fc.constant('/* */')
        ) as fc.Arbitrary<'//' | '*' | '/* */'>,
        (my_preferred_style) => {
          const my_toggle = new CommentToggle();
          const my_original_line = generate_code_line();
          let my_lines = [my_original_line];
          const my_line_numbers = [0];
          const my_tokens: Token[] = [];
          const my_context_ranges: ContextRange[] = [];

          // Toggle to comment
          const my_comment_ops = my_toggle.toggle_lines(
            my_lines,
            my_line_numbers,
            my_preferred_style,
            my_tokens,
            my_context_ranges
          );

          expect(my_comment_ops.length).toBe(1);
          const my_commented_line = my_comment_ops[0].new_text;

          // Update lines with commented version
          my_lines = [my_commented_line];

          // Create a token for the comment that matches the actual commented line
          const my_token_type = my_preferred_style === '/* */' ? 'COMMENT_BLOCK' : 'COMMENT_LINE';
          const my_comment_token: Token = {
            type: my_token_type as any,
            value: my_commented_line.trim(),
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: my_commented_line.length },
            },
          };
          const my_new_tokens = [my_comment_token];

          // Toggle back to uncomment
          const my_uncomment_ops = my_toggle.toggle_lines(
            my_lines,
            my_line_numbers,
            my_preferred_style,
            my_new_tokens,
            my_context_ranges
          );

          expect(my_uncomment_ops.length).toBe(1);
          const my_restored_line = my_uncomment_ops[0].new_text;

          // Verify the line is restored (trimmed comparison due to whitespace)
          expect(my_restored_line.trim()).toBe(my_original_line.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});
