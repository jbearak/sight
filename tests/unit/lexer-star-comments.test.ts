import { StataLexer } from '../../src/lexer';
import { TokenType } from '../../src/types';

describe('StataLexer - Star Comment Detection', () => {
  let lexer: StataLexer;

  beforeEach(() => {
    lexer = new StataLexer();
  });

  describe('Star comments vs multiplication', () => {
    test('should recognize * at beginning of line as comment', () => {
      const source = '* This is a comment';
      const result = lexer.tokenize(source);
      
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
      expect(result.tokens[0].value).toBe('* This is a comment');
    });

    test('should recognize * after whitespace at line start as comment', () => {
      const source = '    * This is an indented comment';
      const result = lexer.tokenize(source);
      
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
      expect(result.tokens[0].value).toBe('* This is an indented comment');
    });

    test('should recognize * as multiplication after numbers', () => {
      const source = 'gen result = 5 * 3';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as multiplication after variables', () => {
      const source = 'gen result = age * income';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as multiplication after closing parentheses', () => {
      const source = 'gen result = (age + 1) * income';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as multiplication after macro references', () => {
      const source = 'gen result = `local_var\' * $global_var';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as comment after statement terminators', () => {
      const source = `gen x = 1
* This should be a comment`;
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* This should be a comment');
    });

    test('should recognize * as comment after opening braces', () => {
      const source = `if (age > 18) {
* Comment inside block`;
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* Comment inside block');
    });

    test('should recognize * as multiplication after control keywords that expect expressions', () => {
      const source = 'foreach var in age income * weight {';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should recognize * as comment after command keywords that expect comments', () => {
      const source = `program define myprogram
* This is a comment inside program`;
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* This is a comment inside program');
    });

    test('should handle complex expression with both * multiplication and * comments', () => {
      const source = `gen result = age * income
* Calculate adjusted result
replace result = result * 1.5`;
      
      const result = lexer.tokenize(source);
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      
      // First * should be multiplication
      const the_star_tokens = the_tokens.filter(t => t.value === '*');
      expect(the_star_tokens[0].type).toBe('OPERATOR');
      expect(the_star_tokens[1].type).toBe('OPERATOR'); // Second * is also multiplication
      
      // Comment should be recognized
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      expect(my_comment_token?.value).toBe('* Calculate adjusted result');
    });

    test('should handle * in semicolon delimiter mode', () => {
      const source = `#delimit ;
gen result = age * income ;
* This is a comment ;`;
      
      const result = lexer.tokenize(source);
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      
      // * in expression should be multiplication
      const the_star_tokens = the_tokens.filter(t => t.value === '*');
      expect(the_star_tokens[0].type).toBe('OPERATOR');
      
      // * at line start should be comment
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      expect(my_comment_token?.value).toBe('* This is a comment ;');
    });
  });

  describe('Edge cases', () => {
    test('should handle * at start of file as comment', () => {
      const source = '* File header comment';
      const result = lexer.tokenize(source);
      
      expect(result.tokens[0].type).toBe('COMMENT_LINE');
    });

    test('should handle * after assignment operators as comment by default', () => {
      const source = 'local x = \n* Comment after assignment';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_comment_token = the_tokens.find(t => t.type === 'COMMENT_LINE');
      
      expect(my_comment_token?.value).toBe('* Comment after assignment');
    });

    test('should handle * after commas as multiplication', () => {
      const source = 'summarize age, detail * income';
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF');
      const my_star_token = the_tokens.find(t => t.value === '*');
      
      expect(my_star_token?.type).toBe('OPERATOR');
    });

    test('should treat * after apostrophe as operator (single quotes are not strings in Stata)', () => {
      // In Stata, single quotes are NOT string delimiters
      // They only close local macro references opened with backtick
      const source = "local comment = '/* not a comment */'";
      const result = lexer.tokenize(source);
      
      const the_tokens = result.tokens.filter(t => t.type !== 'EOF' && t.type !== 'WHITESPACE');
      
      // Apostrophes should be OPERATOR tokens, not STRING delimiters
      const my_apostrophe_tokens = the_tokens.filter(t => t.value === "'");
      expect(my_apostrophe_tokens.length).toBeGreaterThan(0);
      expect(my_apostrophe_tokens.every(t => t.type === 'OPERATOR')).toBe(true);
      
      // The /* */ should be treated as a block comment since it's not inside a string
      const my_comment_tokens = the_tokens.filter(t => t.type === 'COMMENT_BLOCK');
      expect(my_comment_tokens).toHaveLength(1);
    });
  });
});