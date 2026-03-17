import { StataLexer } from '../../src/lexer';
import { LexerErrorCode } from '../../src/types';

describe('StataLexer - Block comment inside star comment', () => {
  let lexer: StataLexer;

  beforeEach(() => {
    lexer = new StataLexer();
  });

  describe('basic detection', () => {
    test('should consume multi-line block comment inside star comment', () => {
      const source = '* /* a\n     b */\ndisplay "hello"';
      const result = lexer.tokenize(source);

      const the_tokens = result.tokens.filter(t =>
        t.type !== 'WHITESPACE' && t.type !== 'STATEMENT_TERMINATOR' && t.type !== 'EOF'
      );

      // First token: the star comment spanning both lines
      expect(the_tokens[0].type).toBe('COMMENT_LINE');
      expect(the_tokens[0].value).toBe('* /* a\n     b */');

      // Next real tokens: display "hello"
      expect(the_tokens[1].type).toBe('WORD');
      expect(the_tokens[1].value).toBe('display');
    });

    test('should emit BLOCK_COMMENT_IN_STAR_COMMENT error', () => {
      const source = '* /* a\n     b */';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT);
      expect(result.errors[0].message).toContain('Block comment');
      expect(result.errors[0].message).toContain('star comment');
    });

    test('error range should cover the /* */ portion', () => {
      const source = '* /* a\n     b */';
      const result = lexer.tokenize(source);

      const my_error = result.errors[0];
      // /* starts at line 0, column 2
      expect(my_error.range.start.line).toBe(0);
      expect(my_error.range.start.character).toBe(2);
      // */ ends on line 1
      expect(my_error.range.end.line).toBe(1);
    });
  });

  describe('single-line block comment in star comment', () => {
    test('should consume single-line /* */ inside star comment', () => {
      const source = '* /* hello */ world';
      const result = lexer.tokenize(source);

      const the_tokens = result.tokens.filter(t =>
        t.type !== 'WHITESPACE' && t.type !== 'STATEMENT_TERMINATOR' && t.type !== 'EOF'
      );

      expect(the_tokens).toHaveLength(1);
      expect(the_tokens[0].type).toBe('COMMENT_LINE');
      // The entire line is consumed (block comment closes on same line)
      expect(the_tokens[0].value).toBe('* /* hello */ world');
    });

    test('should NOT emit warning for single-line case (harmless)', () => {
      const source = '* /* hello */';
      const result = lexer.tokenize(source);

      const my_block_in_star_errors = result.errors.filter(
        e => e.code === LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT
      );
      expect(my_block_in_star_errors).toHaveLength(0);
    });
  });

  describe('unclosed block comment in star comment', () => {
    test('should consume to EOF when block comment is not closed', () => {
      const source = '* /* a\n      b\n\ndisplay "Hello"';
      const result = lexer.tokenize(source);

      const the_tokens = result.tokens.filter(t =>
        t.type !== 'WHITESPACE' && t.type !== 'STATEMENT_TERMINATOR' && t.type !== 'EOF'
      );

      // Everything should be consumed as one comment token
      expect(the_tokens).toHaveLength(1);
      expect(the_tokens[0].type).toBe('COMMENT_LINE');
      expect(the_tokens[0].value).toBe(source);

      // Warning should still be emitted (unclosed spans multiple lines)
      const my_block_in_star_errors = result.errors.filter(
        e => e.code === LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT
      );
      expect(my_block_in_star_errors).toHaveLength(1);
    });
  });

  describe('does NOT apply to slash comments', () => {
    test('// comment with /* should not trigger multi-line behavior', () => {
      const source = '// /* a\n     b */';
      const result = lexer.tokenize(source);

      const the_tokens = result.tokens.filter(t =>
        t.type !== 'WHITESPACE' && t.type !== 'STATEMENT_TERMINATOR' && t.type !== 'EOF'
      );

      // First token: single-line // comment
      expect(the_tokens[0].type).toBe('COMMENT_LINE');
      expect(the_tokens[0].value).toBe('// /* a');

      // b and */ should be separate tokens (not swallowed)
      expect(the_tokens.length).toBeGreaterThan(1);

      // No block-comment-in-star-comment error
      const my_block_in_star_errors = result.errors.filter(
        e => e.code === LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT
      );
      expect(my_block_in_star_errors).toHaveLength(0);
    });
  });

  describe('indented star comment with block comment', () => {
    test('should handle indented star comment containing /* */', () => {
      const source = '    * /* a\n         b */\ndisplay "hello"';
      const result = lexer.tokenize(source);

      const the_tokens = result.tokens.filter(t =>
        t.type !== 'WHITESPACE' && t.type !== 'STATEMENT_TERMINATOR' && t.type !== 'EOF'
      );

      expect(the_tokens[0].type).toBe('COMMENT_LINE');
      expect(the_tokens[0].value).toContain('/* a');
      expect(the_tokens[0].value).toContain('b */');

      // display should still be lexed as code
      expect(the_tokens[1].type).toBe('WORD');
      expect(the_tokens[1].value).toBe('display');
    });
  });

  describe('star comment without block comment is unchanged', () => {
    test('normal star comment should not produce errors', () => {
      const source = '* This is a normal comment';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
      expect(result.tokens[0].value).toBe('* This is a normal comment');
    });

    test('star comment with * but no / should not trigger', () => {
      const source = '* multiplication is a*b';
      const result = lexer.tokenize(source);

      const my_block_in_star_errors = result.errors.filter(
        e => e.code === LexerErrorCode.BLOCK_COMMENT_IN_STAR_COMMENT
      );
      expect(my_block_in_star_errors).toHaveLength(0);
    });
  });
});
