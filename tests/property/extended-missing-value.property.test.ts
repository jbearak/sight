/**
 * Property-based tests for extended missing value tokenization.
 *
 * Tests the following properties:
 * 3. Whitespace Prevents Extended Missing Value Tokenization
 * 4. Decimal Number Tokenization Preserved
 * 6. No False Positive Split Literal for Extended Missing Values
 *
 * Feature: extended-missing-value-tokenization
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';

describe('Extended Missing Value - Split Literal and Backward Compatibility', () => {
  const lexer = new StataLexer();

  /**
   * Feature: extended-missing-value-tokenization
   * Property 3: Whitespace Prevents Extended Missing Value Tokenization
   * For any letter c, when the lexer tokenizes the string ". c" (dot, whitespace, letter),
   * it SHALL produce at least two tokens: a WORD token with value "." and a WORD token with value "c".
   * Validates: Requirements 1.3
   */
  test('Property 3: whitespace separates dot from letter into separate tokens', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        (my_letter) => {
          const my_input = '. ' + my_letter;
          const my_result = lexer.tokenize(my_input);

          // Filter out whitespace and EOF tokens
          const the_non_trivial_tokens = my_result.tokens.filter(
            (my_token) =>
              my_token.type !== 'WHITESPACE' &&
              my_token.type !== 'EOF' &&
              my_token.type !== 'STATEMENT_TERMINATOR'
          );

          // Should have at least 2 non-trivial tokens (dot and letter)
          expect(the_non_trivial_tokens.length).toBeGreaterThanOrEqual(2);

          // First should be WORD with value "."
          expect(the_non_trivial_tokens[0].type).toBe('WORD');
          expect(the_non_trivial_tokens[0].value).toBe('.');

          // Second should be WORD with the letter
          expect(the_non_trivial_tokens[1].type).toBe('WORD');
          expect(the_non_trivial_tokens[1].value).toBe(my_letter);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: extended-missing-value-tokenization
   * Property 4: Decimal Number Tokenization Preserved
   * For any digit d in 0 through 9, when the lexer tokenizes the string .d,
   * it SHALL produce a single NUMBER token with value starting with .d.
   * Validates: Requirements 1.4
   */
  test('Property 4: decimal numbers .0 through .9 produce NUMBER tokens', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (my_digit) => {
        const my_input = '.' + my_digit;
        const my_result = lexer.tokenize(my_input);

        // Should produce exactly 2 tokens: NUMBER and EOF
        expect(my_result.tokens.length).toBe(2);
        expect(my_result.tokens[0].type).toBe('NUMBER');
        expect(my_result.tokens[0].value).toBe(my_input);
        expect(my_result.tokens[1].type).toBe('EOF');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: extended-missing-value-tokenization
   * Property 6: No False Positive Split Literal for Extended Missing Values
   * For any lowercase letter c in a through z, when the lexer tokenizes code
   * containing .c (without whitespace), it SHALL produce a single NUMBER token,
   * not separate tokens that would trigger split literal detection.
   * Validates: Requirements 2.2, 3.1, 3.2
   */
  test('Property 6: extended missing values in expressions produce single NUMBER tokens', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 25 }).map((my_i) => String.fromCharCode('a'.charCodeAt(0) + my_i)),
        (my_letter) => {
          // Test in a typical expression context: "if x == .a"
          const my_input = `if x == .${my_letter}`;
          const my_result = lexer.tokenize(my_input);

          // Find the token for the extended missing value
          const my_missing_value_token = my_result.tokens.find(
            (my_token) => my_token.value === '.' + my_letter
          );

          // Should exist and be a NUMBER token (not separate . and letter tokens)
          expect(my_missing_value_token).toBeDefined();
          expect(my_missing_value_token!.type).toBe('NUMBER');

          // Should NOT have a separate "." WORD token followed by a letter WORD token
          const my_dot_token_index = my_result.tokens.findIndex(
            (my_token) => my_token.value === '.' && my_token.type === 'WORD'
          );
          if (my_dot_token_index !== -1) {
            const my_next_token = my_result.tokens[my_dot_token_index + 1];
            // If there's a dot WORD token, the next token should NOT be the letter
            // (that would indicate split tokenization)
            expect(my_next_token?.value).not.toBe(my_letter);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: System missing value (standalone dot) still works
   * Validates: Requirements 3.3
   */
  test('system missing value (standalone dot) produces WORD token', () => {
    const my_input = 'if x == .';
    const my_result = lexer.tokenize(my_input);

    // Find the standalone dot token
    const my_dot_token = my_result.tokens.find((my_token) => my_token.value === '.');
    expect(my_dot_token).toBeDefined();
    expect(my_dot_token!.type).toBe('WORD');
  });

  /**
   * Additional test: Decimal numbers with multiple digits still work
   * Validates: Requirements 3.4
   */
  test('decimal numbers like .5, .123, 3.14 produce NUMBER tokens', () => {
    const the_test_cases = ['.5', '.123', '3.14', '.0', '.999'];

    for (const my_input of the_test_cases) {
      const my_result = lexer.tokenize(my_input);
      expect(my_result.tokens[0].type).toBe('NUMBER');
      expect(my_result.tokens[0].value).toBe(my_input);
    }
  });
});
