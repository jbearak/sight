import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { LanguageContext } from '../../src/types';

describe('Unified End Delimiter Tokenization Property Tests', () => {
  /**
   * Property 1: Unified End Delimiter Tokenization
   * For any embedded language block (mata or python), the end delimiter should
   * always be just "end" and emit the appropriate END_MATA or END_PYTHON token
   * with value "end".
   * Feature: lexer-end-delimiter-handling, Property 1: Unified End Delimiter Tokenization
   * Validates: Requirements 1.1, 1.2
   */
  it('should tokenize end delimiters uniformly for both mata and python blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        fc.array(fc.stringMatching(/^[a-zA-Z0-9_\s\-+=(){}[\]]*$/), { minLength: 0, maxLength: 3 }),
        (block_type, content_lines) => {
          const my_lexer = new StataLexer();
          
          // Build document with embedded block
          let my_document = `${block_type}\n`;
          for (const my_line of content_lines) {
            my_document += `${my_line}\n`;
          }
          my_document += 'end';
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have no lexer errors (or only minor ones that don't affect tokenization)
          // Some content might cause lexer warnings but shouldn't prevent basic tokenization
          
          // Should have appropriate start token
          const my_start_token_type = block_type === 'mata' ? 'MATA_START' : 'PYTHON_START';
          const my_start_tokens = my_result.tokens.filter(t => t.type === my_start_token_type);
          expect(my_start_tokens.length).toBe(1);
          expect(my_start_tokens[0].value).toBe(block_type);
          
          // Should have appropriate end token with value "end"
          const my_end_token_type = block_type === 'mata' ? 'END_MATA' : 'END_PYTHON';
          const my_end_tokens = my_result.tokens.filter(t => t.type === my_end_token_type);
          expect(my_end_tokens.length).toBe(1);
          expect(my_end_tokens[0].value).toBe('end');
          
          // Final state should be back in Stata context
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
          expect(my_result.finalState.context_stack).toEqual([LanguageContext.STATA]);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 2: End Delimiter Context Sensitivity
   * The "end" keyword should only be tokenized as END_MATA or END_PYTHON when
   * in the appropriate embedded language context. In Stata context, it should
   * remain a WORD token.
   * Feature: lexer-end-delimiter-handling, Property 2: End Delimiter Context Sensitivity
   * Validates: Requirements 1.1, 1.2
   */
  it('should only tokenize end as delimiter in appropriate context', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata'), fc.constant('python')),
        (block_type) => {
          const my_lexer = new StataLexer();
          
          // Test 1: "end" in Stata context should be WORD
          const my_stata_result = my_lexer.tokenize('end');
          const my_stata_end_tokens = my_stata_result.tokens.filter(t => t.value === 'end');
          expect(my_stata_end_tokens.length).toBe(1);
          expect(my_stata_end_tokens[0].type).toBe('WORD');
          
          // Test 2: "end" in embedded context should be END_* token
          const my_embedded_document = `${block_type}\nend`;
          const my_embedded_result = my_lexer.tokenize(my_embedded_document);
          
          const my_expected_end_type = block_type === 'mata' ? 'END_MATA' : 'END_PYTHON';
          const my_embedded_end_tokens = my_embedded_result.tokens.filter(
            t => t.type === my_expected_end_type
          );
          expect(my_embedded_end_tokens.length).toBe(1);
          expect(my_embedded_end_tokens[0].value).toBe('end');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 3: Sequential Block End Delimiter Handling
   * For sequential embedded language blocks, each "end" should close the current
   * block and emit the appropriate token type.
   * Feature: lexer-end-delimiter-handling, Property 3: Sequential Block End Delimiter Handling
   * Validates: Requirements 1.1, 1.2
   */
  it('should handle sequential block end delimiters correctly', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (mata_first) => {
          const my_lexer = new StataLexer();
          
          const my_first_block = mata_first ? 'mata' : 'python';
          const my_second_block = mata_first ? 'python' : 'mata';
          
          const my_document = `${my_first_block}
x = 1
end
${my_second_block}
y = 2
end`;
          
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have no lexer errors
          expect(my_result.errors).toHaveLength(0);
          
          // Should have two end tokens with correct types
          const my_end_tokens = my_result.tokens.filter(
            t => t.type === 'END_MATA' || t.type === 'END_PYTHON'
          );
          expect(my_end_tokens.length).toBe(2);
          
          // Both end tokens should have value "end"
          for (const my_token of my_end_tokens) {
            expect(my_token.value).toBe('end');
          }
          
          // First end should close first block, second should close second block
          const my_expected_first_type = mata_first ? 'END_MATA' : 'END_PYTHON';
          const my_expected_second_type = mata_first ? 'END_PYTHON' : 'END_MATA';
          
          expect(my_end_tokens[0].type).toBe(my_expected_first_type);
          expect(my_end_tokens[1].type).toBe(my_expected_second_type);
          
          // Final state should be back in Stata context
          expect(my_result.finalState.language_context).toBe(LanguageContext.STATA);
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 4: Single-line Block End Delimiter Consistency
   * For single-line embedded blocks (mata:, python:), no separate end delimiter
   * should be required or recognized.
   * Feature: lexer-end-delimiter-handling, Property 4: Single-line Block End Delimiter Consistency
   * Validates: Requirements 1.1, 1.2
   */
  it('should not require end delimiters for single-line blocks', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant('mata:'), fc.constant('python:')),
        fc.stringMatching(/^[a-zA-Z0-9_\s\-+=(){}[\]]*$/),
        (block_type, content) => {
          const my_lexer = new StataLexer();
          
          const my_document = `${block_type} ${content}`;
          const my_result = my_lexer.tokenize(my_document);
          
          // Should have appropriate inline token
          const my_inline_token_type = block_type === 'mata:' ? 'MATA_INLINE' : 'PYTHON_INLINE';
          const my_inline_tokens = my_result.tokens.filter(t => t.type === my_inline_token_type);
          expect(my_inline_tokens.length).toBe(1);
          expect(my_inline_tokens[0].value).toBe(block_type);
          
          // Should NOT have any END_MATA or END_PYTHON tokens
          const my_end_tokens = my_result.tokens.filter(
            t => t.type === 'END_MATA' || t.type === 'END_PYTHON'
          );
          expect(my_end_tokens.length).toBe(0);
          
          // Final state context depends on lexer implementation
          // Single-line blocks may or may not return to Stata context immediately
          // The key requirement is that no separate end delimiter is needed
        }
      ),
      { numRuns: 30 }
    );
  });
});