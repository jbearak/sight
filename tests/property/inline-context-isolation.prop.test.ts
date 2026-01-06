import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { LanguageContext, LexerErrorCode } from '../../src/types';

/**
 * Property-based tests for inline Mata/Python context isolation.
 * 
 * Feature: diagnostic-false-positives, Property 1: Inline Mata Context Isolation
 * Validates: Requirements 1.1, 1.3, 1.5
 */
describe('Inline Context Isolation Property Tests', () => {
  /**
   * Property 1: Inline Mata Context Isolation
   * For any code containing an inline Mata command (`mata: expression`), the lexer
   * SHALL NOT change the language context for subsequent lines, and all code after
   * the inline command SHALL be tokenized using Stata rules.
   * 
   * Feature: diagnostic-false-positives, Property 1: Inline Mata Context Isolation
   * Validates: Requirements 1.1, 1.3, 1.5
   */
  it('should not change language context for subsequent lines after inline mata:', () => {
    fc.assert(
      fc.property(
        // Generate random Mata expression (simple alphanumeric content, no newlines)
        // Must contain at least one non-whitespace character to be treated as inline
        // (mata: followed by only whitespace is now treated as block start)
        fc.stringMatching(/^[a-zA-Z0-9_ +=(),]*$/).filter(s => s.length > 0 && s.length < 50 && s.trim().length > 0),
        // Generate random Stata code for subsequent lines
        fc.array(
          fc.oneof(
            // display commands with safe string content (no newlines or special chars)
            fc.stringMatching(/^[a-zA-Z0-9_ ]*$/).filter(s => s.length > 0 && s.length < 30)
              .map(my_content => `display "${my_content}"`),
            // local definitions
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/).filter(s => s.length > 0 && s.length < 20)
              .map(my_name => `local ${my_name} = 1`),
            // simple commands
            fc.constantFrom('summarize', 'describe', 'list', 'clear')
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (mata_expression, subsequent_stata_code) => {
          const my_lexer = new StataLexer();
          
          // Build document with inline mata: followed by Stata code
          const my_document = `mata: ${mata_expression}\n${subsequent_stata_code.join('\n')}`;
          
          const my_result = my_lexer.tokenize(my_document);
          
          // 1. Verify that the lexer produces a MATA_INLINE token
          const my_mata_inline_tokens = my_result.tokens.filter(t => t.type === 'MATA_INLINE');
          expect(my_mata_inline_tokens.length).toBe(1);
          expect(my_mata_inline_tokens[0].value).toBe('mata:');
          
          // 2. Verify that the final context is Stata (not Mata)
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
          
          // 3. Verify that subsequent code is tokenized as Stata (WORD, STRING tokens, not EMBEDDED_CONTENT)
          // Find tokens after the first line (after the mata: line)
          const my_mata_inline_token = my_mata_inline_tokens[0];
          const my_subsequent_tokens = my_result.tokens.filter(
            t => t.range.start.line > my_mata_inline_token.range.start.line &&
                 t.type !== 'STATEMENT_TERMINATOR' &&
                 t.type !== 'WHITESPACE' &&
                 t.type !== 'EOF'
          );
          
          // All subsequent tokens should be Stata tokens (WORD, STRING, etc.), not EMBEDDED_CONTENT
          for (const my_token of my_subsequent_tokens) {
            expect(my_token.type).not.toBe('EMBEDDED_CONTENT');
          }
          
          // Should have WORD tokens for commands like 'display', 'local', 'summarize', etc.
          const my_word_tokens = my_subsequent_tokens.filter(t => t.type === 'WORD');
          expect(my_word_tokens.length).toBeGreaterThan(0);
          
          // 4. Verify no "unclosed string literal" errors are produced
          const my_unclosed_string_errors = my_result.errors.filter(
            e => e.code === LexerErrorCode.UNBALANCED_QUOTES
          );
          expect(my_unclosed_string_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Inline Python Context Isolation
   * For any code containing an inline Python command (`python: expression`), the lexer
   * SHALL NOT change the language context for subsequent lines, and all code after
   * the inline command SHALL be tokenized using Stata rules.
   * 
   * Feature: diagnostic-false-positives, Property 2: Inline Python Context Isolation
   * Validates: Requirements 1.1, 1.3, 1.5
   */
  it('should not change language context for subsequent lines after inline python:', () => {
    fc.assert(
      fc.property(
        // Generate random Python expression (simple alphanumeric content, no newlines)
        // Must contain at least one non-whitespace character to be treated as inline
        // (python: followed by only whitespace is now treated as block start)
        fc.stringMatching(/^[a-zA-Z0-9_ +=(),]*$/).filter(s => s.length > 0 && s.length < 50 && s.trim().length > 0),
        // Generate random Stata code for subsequent lines
        fc.array(
          fc.oneof(
            // display commands with safe string content (no newlines or special chars)
            fc.stringMatching(/^[a-zA-Z0-9_ ]*$/).filter(s => s.length > 0 && s.length < 30)
              .map(my_content => `display "${my_content}"`),
            // local definitions
            fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/).filter(s => s.length > 0 && s.length < 20)
              .map(my_name => `local ${my_name} = 1`),
            // simple commands
            fc.constantFrom('summarize', 'describe', 'list', 'clear')
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (python_expression, subsequent_stata_code) => {
          const my_lexer = new StataLexer();
          
          // Build document with inline python: followed by Stata code
          const my_document = `python: ${python_expression}\n${subsequent_stata_code.join('\n')}`;
          
          const my_result = my_lexer.tokenize(my_document);
          
          // 1. Verify that the lexer produces a PYTHON_INLINE token
          const my_python_inline_tokens = my_result.tokens.filter(t => t.type === 'PYTHON_INLINE');
          expect(my_python_inline_tokens.length).toBe(1);
          expect(my_python_inline_tokens[0].value).toBe('python:');
          
          // 2. Verify that the final context is Stata (not Python)
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
          
          // 3. Verify that subsequent code is tokenized as Stata (WORD, STRING tokens, not EMBEDDED_CONTENT)
          const my_python_inline_token = my_python_inline_tokens[0];
          const my_subsequent_tokens = my_result.tokens.filter(
            t => t.range.start.line > my_python_inline_token.range.start.line &&
                 t.type !== 'STATEMENT_TERMINATOR' &&
                 t.type !== 'WHITESPACE' &&
                 t.type !== 'EOF'
          );
          
          // All subsequent tokens should be Stata tokens, not EMBEDDED_CONTENT
          for (const my_token of my_subsequent_tokens) {
            expect(my_token.type).not.toBe('EMBEDDED_CONTENT');
          }
          
          // Should have WORD tokens for commands
          const my_word_tokens = my_subsequent_tokens.filter(t => t.type === 'WORD');
          expect(my_word_tokens.length).toBeGreaterThan(0);
          
          // 4. Verify no "unclosed string literal" errors are produced
          const my_unclosed_string_errors = my_result.errors.filter(
            e => e.code === LexerErrorCode.UNBALANCED_QUOTES
          );
          expect(my_unclosed_string_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Multiple Inline Commands Context Isolation
   * For any code containing multiple inline Mata/Python commands, each inline command
   * should be isolated and not affect the context of subsequent code.
   * 
   * Feature: diagnostic-false-positives, Property 3: Multiple Inline Commands Context Isolation
   * Validates: Requirements 1.1, 1.3, 1.5
   */
  it('should maintain Stata context across multiple inline mata:/python: commands', () => {
    fc.assert(
      fc.property(
        // Generate a sequence of inline commands and Stata code
        fc.array(
          fc.oneof(
            fc.constant('mata: x = 1'),
            fc.constant('python: y = 2'),
            fc.constant('display "hello"'),
            fc.constant('local z = 3'),
            fc.constant('summarize')
          ),
          { minLength: 3, maxLength: 8 }
        ),
        (code_lines) => {
          const my_lexer = new StataLexer();
          const my_document = code_lines.join('\n');
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Count inline tokens
          const my_mata_inline_count = my_result.tokens.filter(t => t.type === 'MATA_INLINE').length;
          const my_python_inline_count = my_result.tokens.filter(t => t.type === 'PYTHON_INLINE').length;
          
          // Count expected inline commands
          const my_expected_mata_inline = code_lines.filter(l => l.startsWith('mata:')).length;
          const my_expected_python_inline = code_lines.filter(l => l.startsWith('python:')).length;
          
          expect(my_mata_inline_count).toBe(my_expected_mata_inline);
          expect(my_python_inline_count).toBe(my_expected_python_inline);
          
          // Final context should always be Stata
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
          
          // No EMBEDDED_CONTENT tokens should appear (since inline commands don't change context)
          const my_embedded_content_tokens = my_result.tokens.filter(t => t.type === 'EMBEDDED_CONTENT');
          expect(my_embedded_content_tokens.length).toBe(0);
          
          // No unclosed string literal errors
          const my_unclosed_string_errors = my_result.errors.filter(
            e => e.code === LexerErrorCode.UNBALANCED_QUOTES
          );
          expect(my_unclosed_string_errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Inline Command vs Block Command Distinction
   * The lexer should correctly distinguish between inline commands (mata:, python:)
   * and block commands (mata, python) - only block commands should change context.
   * 
   * Feature: diagnostic-false-positives, Property 4: Inline vs Block Distinction
   * Validates: Requirements 1.1, 1.3, 1.5
   */
  it('should distinguish inline commands from block commands', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        // Must contain at least one non-whitespace character to be treated as inline
        // (mata:/python: followed by only whitespace is now treated as block start)
        // Use space and tab only (not \s which includes \r and \n)
        fc.stringMatching(/^[a-zA-Z0-9_ \t]*$/).filter(s => s.length > 0 && s.length < 30 && s.trim().length > 0),
        (language, expression) => {
          const my_lexer = new StataLexer();
          
          // Test inline command (with colon)
          const my_inline_document = `${language}: ${expression}\ndisplay "after inline"`;
          const my_inline_result = my_lexer.tokenize(my_inline_document);
          
          // Should have inline token
          const my_inline_token_type = language === 'mata' ? 'MATA_INLINE' : 'PYTHON_INLINE';
          const my_inline_tokens = my_inline_result.tokens.filter(t => t.type === my_inline_token_type);
          expect(my_inline_tokens.length).toBe(1);
          
          // Should NOT have block start token
          const my_start_token_type = language === 'mata' ? 'MATA_START' : 'PYTHON_START';
          const my_start_tokens = my_inline_result.tokens.filter(t => t.type === my_start_token_type);
          expect(my_start_tokens.length).toBe(0);
          
          // Final context should be Stata
          expect(my_inline_result.finalState.language_context).toBe(LanguageContext.STATA);
          
          // "display" on second line should be tokenized as WORD (Stata context)
          const my_display_tokens = my_inline_result.tokens.filter(
            t => t.type === 'WORD' && t.value === 'display'
          );
          expect(my_display_tokens.length).toBe(1);
          
          // Test block command (without colon)
          const my_block_document = `${language}\n${expression}\nend`;
          const my_block_result = my_lexer.tokenize(my_block_document);
          
          // Should have block start token
          const my_block_start_tokens = my_block_result.tokens.filter(t => t.type === my_start_token_type);
          expect(my_block_start_tokens.length).toBe(1);
          
          // Should NOT have inline token
          const my_block_inline_tokens = my_block_result.tokens.filter(t => t.type === my_inline_token_type);
          expect(my_block_inline_tokens.length).toBe(0);
          
          // Final context should be Stata (after end)
          expect(my_block_result.finalState.language_context).toBe(LanguageContext.STATA);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: String Literals After Inline Commands
   * String literals in Stata code following inline Mata/Python commands should be
   * properly tokenized without producing "unclosed string literal" errors.
   * 
   * Feature: diagnostic-false-positives, Property 5: String Literals After Inline Commands
   * Validates: Requirements 1.1, 1.3, 1.5
   */
  it('should properly tokenize string literals after inline commands', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata:'), fc.constant('python:')),
        // Generate safe string content (no special characters that could break strings)
        // Must contain at least one non-whitespace character to be treated as inline
        // (mata:/python: followed by only whitespace is now treated as block start)
        fc.stringMatching(/^[a-zA-Z0-9 _-]*$/).filter(s => s.length > 0 && s.length < 30 && s.trim().length > 0),
        fc.array(
          fc.stringMatching(/^[a-zA-Z0-9 _-]*$/).filter(s => s.length > 0 && s.length < 20),
          { minLength: 1, maxLength: 3 }
        ),
        (inline_command, inline_content, string_contents) => {
          const my_lexer = new StataLexer();
          
          // Build document with inline command followed by display commands with strings
          const my_display_lines = string_contents.map(s => `display "${s}"`);
          const my_document = `${inline_command} ${inline_content}\n${my_display_lines.join('\n')}`;
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have the correct inline token
          const my_expected_inline_type = inline_command === 'mata:' ? 'MATA_INLINE' : 'PYTHON_INLINE';
          const my_inline_tokens = my_result.tokens.filter(t => t.type === my_expected_inline_type);
          expect(my_inline_tokens.length).toBe(1);
          
          // Should have STRING tokens for each display command
          const my_string_tokens = my_result.tokens.filter(t => t.type === 'STRING');
          expect(my_string_tokens.length).toBe(string_contents.length);
          
          // No unclosed string literal errors
          const my_unclosed_string_errors = my_result.errors.filter(
            e => e.code === LexerErrorCode.UNBALANCED_QUOTES
          );
          expect(my_unclosed_string_errors.length).toBe(0);
          
          // Final context should be Stata
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
        }
      ),
      { numRuns: 100 }
    );
  });
});
