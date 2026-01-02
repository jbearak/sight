import { describe, it, expect } from 'bun:test';
import { CommentToggle } from '../../src/comment-processor/comment-toggle';
import { Token, LanguageContext, ContextRange } from '../../src/types';
import { Range } from 'vscode-languageserver-textdocument';

// Helper to create a comment token
const create_comment_token = (
  my_style: 'star' | 'slash' | 'block' | 'continuation',
  my_line: number,
  my_value: string
): Token => {
  const my_range: Range = {
    start: { line: my_line, character: 0 },
    end: { line: my_line, character: my_value.length },
  };

  let my_type: any = 'COMMENT_LINE';
  switch (my_style) {
    case 'continuation':
      my_type = 'CONTINUATION';
      break;
    case 'block':
      my_type = 'COMMENT_BLOCK';
      break;
    default:
      my_type = 'COMMENT_LINE';
  }

  return { type: my_type, value: my_value, range: my_range };
};

describe('Comment Toggle Unit Tests', () => {
  describe('// style toggle behavior', () => {
    // Test "//" style toggle behavior
    // Requirements: 6.2
    it('should comment a line with // style', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['generate x = 1'];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('// generate x = 1');
      expect(my_ops[0].is_comment_operation).toBe(true);
    });

    it('should uncomment a // style comment', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['// generate x = 1'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('slash', 0, '// generate x = 1');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
      expect(my_ops[0].is_comment_operation).toBe(false);
    });

    it('should preserve indentation when commenting with //', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['    generate x = 1'];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('    // generate x = 1');
    });
  });

  describe('* style toggle behavior', () => {
    // Test "*" style toggle behavior
    // Requirements: 6.3
    it('should comment a line with * style', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['generate x = 1'];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '*',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('* generate x = 1');
      expect(my_ops[0].is_comment_operation).toBe(true);
    });

    it('should uncomment a * style comment', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['* generate x = 1'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('star', 0, '* generate x = 1');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '*',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
      expect(my_ops[0].is_comment_operation).toBe(false);
    });

    it('should preserve indentation when commenting with *', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['    generate x = 1'];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '*',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('    * generate x = 1');
    });
  });

  describe('/* */ style toggle behavior', () => {
    // Test "/* */" style toggle behavior
    // Requirements: 6.4
    it('should comment a line with /* */ style', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['generate x = 1'];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '/* */',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('/* generate x = 1 */');
      expect(my_ops[0].is_comment_operation).toBe(true);
    });

    it('should uncomment a /* */ style comment', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['/* generate x = 1 */'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('block', 0, '/* generate x = 1 */');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '/* */',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
      expect(my_ops[0].is_comment_operation).toBe(false);
    });

    it('should preserve indentation when commenting with /* */', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['    generate x = 1'];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '/* */',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('    /* generate x = 1 */');
    });
  });

  describe('uncomment all styles', () => {
    // Test that uncomment works regardless of original comment style
    // Requirements: 6.5
    it('should uncomment // style comments', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['// generate x = 1'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('slash', 0, '// generate x = 1');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
    });

    it('should uncomment * style comments', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['* generate x = 1'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('star', 0, '* generate x = 1');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
    });

    it('should uncomment /* */ style comments', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['/* generate x = 1 */'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('block', 0, '/* generate x = 1 */');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
    });

    it('should uncomment /// continuation comments', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['/// generate x = 1'];
      const my_line_numbers = [0];
      const my_comment_token = create_comment_token('continuation', 0, '/// generate x = 1');
      const my_tokens = [my_comment_token];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('generate x = 1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty lines', () => {
      const my_toggle = new CommentToggle();
      const my_lines = [''];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('// ');
    });

    it('should handle lines with only whitespace', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['    '];
      const my_line_numbers = [0];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(1);
      expect(my_ops[0].new_text).toBe('    // ');
    });

    it('should handle multiple lines', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['generate x = 1', 'replace y = 2', 'summarize z'];
      const my_line_numbers = [0, 1, 2];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      expect(my_ops.length).toBe(3);
      expect(my_ops[0].new_text).toBe('// generate x = 1');
      expect(my_ops[1].new_text).toBe('// replace y = 2');
      expect(my_ops[2].new_text).toBe('// summarize z');
    });

    it('should handle invalid line numbers', () => {
      const my_toggle = new CommentToggle();
      const my_lines = ['generate x = 1'];
      const my_line_numbers = [0, 5, -1];
      const my_tokens: Token[] = [];
      const my_context_ranges: ContextRange[] = [];

      const my_ops = my_toggle.toggle_lines(
        my_lines,
        my_line_numbers,
        '//',
        my_tokens,
        my_context_ranges
      );

      // Only line 0 should be processed
      expect(my_ops.length).toBe(1);
      expect(my_ops[0].line_number).toBe(0);
    });
  });
});
