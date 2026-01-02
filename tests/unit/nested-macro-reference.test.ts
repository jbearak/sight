import { describe, test, expect, beforeEach } from 'bun:test';
import { StataLexer } from '../../src/lexer';

describe('StataLexer - Nested Macro References', () => {
  let lexer: StataLexer;

  beforeEach(() => {
    lexer = new StataLexer();
  });

  describe('simple macro references (regression)', () => {
    test('should tokenize basic local macro reference', () => {
      const source = 'display `name\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`name\'');
    });

    test('should tokenize macro with underscore', () => {
      const source = 'display `my_var\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`my_var\'');
    });

    test('should tokenize macro with number', () => {
      const source = 'display `var1\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`var1\'');
    });
  });

  describe('single-level nesting', () => {
    test('should tokenize nested macro reference', () => {
      const source = 'display `path`i\'\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`path`i\'\'');
    });
  });

  describe('multi-level nesting', () => {
    test('should tokenize deeply nested macro reference', () => {
      const source = 'display `a`b`c\'\'\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`a`b`c\'\'\'');
    });
  });

  describe('content after inner macro', () => {
    test('should tokenize macro with suffix after nested reference', () => {
      const source = 'display `var`j\'_suffix\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`var`j\'_suffix\'');
    });
  });

  describe('incomplete macros', () => {
    test('should handle macro missing one quote', () => {
      const source = 'display `path`i\'';
      const result = lexer.tokenize(source);

      expect(result.errors.length).toBeGreaterThan(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`path`i\'');
    });

    test('should handle macro with no closing quote', () => {
      const source = 'display `name';
      const result = lexer.tokenize(source);

      expect(result.errors.length).toBeGreaterThan(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`name');
    });
  });

  describe('empty macro name', () => {
    test('should handle empty macro reference', () => {
      const source = 'display `\'';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`\'');
    });
  });

  describe('macro at end of line', () => {
    test('should handle macro reference at line end', () => {
      const source = 'display `name\'\nlocal x = 1';
      const result = lexer.tokenize(source);

      expect(result.errors).toHaveLength(0);
      const macro_token = result.tokens.find(t => t.type === 'MACRO_REF_LOCAL');
      expect(macro_token).toBeDefined();
      expect(macro_token?.value).toBe('`name\'');
    });
  });
});