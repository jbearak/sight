import { describe, it, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { LexerErrorCode } from '../../src/types';
import { arbitrary_macro_name } from './generators';

describe('Nested Macro Reference Parsing Property Tests', () => {
  let my_lexer: StataLexer;

  beforeEach(() => {
    my_lexer = new StataLexer();
  });

  /**
   * Generate valid nested local macro references at various depths (0-5)
   */
  function arbitrary_valid_nested_macro(): fc.Arbitrary<string> {
    return fc.integer({ min: 0, max: 5 }).chain((my_depth) => {
      return arbitrary_macro_name().map((my_name) => {
        const my_backticks = '`'.repeat(my_depth + 1);
        const my_quotes = "'".repeat(my_depth + 1);
        return `${my_backticks}${my_name}${my_quotes}`;
      });
    });
  }

  /**
   * Generate incomplete nested macro references (missing closing quotes)
   */
  function arbitrary_incomplete_nested_macro(): fc.Arbitrary<string> {
    return fc.integer({ min: 1, max: 5 }).chain((my_depth) => {
      return arbitrary_macro_name().map((my_name) => {
        const my_backticks = '`'.repeat(my_depth);
        const my_quotes = "'".repeat(my_depth - 1); // Missing one quote
        return `${my_backticks}${my_name}${my_quotes}`;
      });
    });
  }

  /**
   * Generate incomplete nested macro references terminated by newline
   */
  function arbitrary_newline_terminated_macro(): fc.Arbitrary<string> {
    return fc.integer({ min: 1, max: 3 }).chain((my_depth) => {
      return arbitrary_macro_name().map((my_name) => {
        const my_backticks = '`'.repeat(my_depth);
        return `${my_backticks}${my_name}\n`;
      });
    });
  }

  /**
   * Property 1: Token Completeness
   * For any valid nested local macro reference, the lexer produces exactly one 
   * MACRO_REF_LOCAL token whose value equals the complete input string.
   */
  it('should produce exactly one MACRO_REF_LOCAL token for valid nested references', () => {
    fc.assert(
      fc.property(arbitrary_valid_nested_macro(), (my_macro_ref) => {
        const my_result = my_lexer.tokenize(my_macro_ref);
        
        const my_macro_tokens = my_result.tokens.filter(
          (my_token) => my_token.type === 'MACRO_REF_LOCAL'
        );

        // Should have exactly one MACRO_REF_LOCAL token
        if (my_macro_tokens.length !== 1) {
          return false;
        }

        // Token value should equal complete input
        return my_macro_tokens[0].value === my_macro_ref;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Nesting Depth Invariant
   * For any valid nested macro reference, the number of backticks equals 
   * the number of single quotes.
   */
  it('should maintain backtick-quote balance in valid nested references', () => {
    fc.assert(
      fc.property(arbitrary_valid_nested_macro(), (my_macro_ref) => {
        const my_result = my_lexer.tokenize(my_macro_ref);
        
        const my_macro_tokens = my_result.tokens.filter(
          (my_token) => my_token.type === 'MACRO_REF_LOCAL'
        );

        if (my_macro_tokens.length !== 1) {
          return false;
        }

        const my_token_value = my_macro_tokens[0].value;
        const my_backtick_count = (my_token_value.match(/`/g) || []).length;
        const my_quote_count = (my_token_value.match(/'/g) || []).length;

        return my_backtick_count === my_quote_count;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Error Detection
   * For incomplete nested macros (newline/EOF before closure), the lexer 
   * emits exactly one error with code UNBALANCED_QUOTES.
   */
  it('should emit UNBALANCED_QUOTES error for incomplete nested references', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbitrary_incomplete_nested_macro(),
          arbitrary_newline_terminated_macro()
        ),
        (my_incomplete_macro) => {
          const my_result = my_lexer.tokenize(my_incomplete_macro);

          // Should have exactly one error
          if (my_result.errors.length !== 1) {
            return false;
          }

          // Error should have UNBALANCED_QUOTES code
          return my_result.errors[0].code === LexerErrorCode.UNBALANCED_QUOTES;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: No False Positives
   * For valid nested macro references, the lexer emits zero errors.
   */
  it('should emit no errors for valid nested references', () => {
    fc.assert(
      fc.property(arbitrary_valid_nested_macro(), (my_macro_ref) => {
        const my_result = my_lexer.tokenize(my_macro_ref);

        // Should have no errors
        return my_result.errors.length === 0;
      }),
      { numRuns: 100 }
    );
  });
});