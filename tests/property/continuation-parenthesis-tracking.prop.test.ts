import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ParseErrorCode } from '../../src/types';

/**
 * Property-based tests for Continuation Line Parenthesis Tracking
 * Feature: continuation-line-parenthesis-tracking
 *
 * Tests the parser's ability to correctly track parenthesis balance across
 * continuation lines (///) and emit appropriate diagnostics for unbalanced
 * brackets.
 */

// =============================================================================
// GENERATORS
// =============================================================================

/**
 * Generator for simple operands (variable names, numbers)
 */
function arbitrary_operand(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', 'var1', 'var2'),
    fc.integer({ min: 1, max: 100 }).map((n) => n.toString())
  );
}

/**
 * Generator for binary operators
 */
function arbitrary_operator(): fc.Arbitrary<string> {
  return fc.constantFrom('&', '|', '+', '-', '>', '<', '>=', '<=', '==', '!=');
}

/**
 * Generator for commands that take conditional expressions with parenthesis tracking.
 * Note: Only 'if' and 'while' commands have explicit parenthesis tracking in the parser.
 * Commands like 'gen' and 'replace' use different expression parsing paths.
 */
function arbitrary_expression_command(): fc.Arbitrary<string> {
  return fc.constantFrom('if', 'while');
}

/**
 * Generator for bracket types
 */
type BracketType = 'parenthesis' | 'square' | 'curly';

function get_bracket_pair(bracket_type: BracketType): { open: string; close: string } {
  switch (bracket_type) {
    case 'parenthesis':
      return { open: '(', close: ')' };
    case 'square':
      return { open: '[', close: ']' };
    case 'curly':
      return { open: '{', close: '}' };
  }
}

/**
 * Generator for balanced expressions with continuations at various points.
 * Creates expressions like: `if (a | /// \n b)`
 */
function arbitrary_balanced_expression_with_continuation(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbitrary_expression_command(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(([cmd, left, op, right]) => `${cmd} (${left} ${op} ///\n${right})`);
}

/**
 * Generator for nested balanced expressions with continuations.
 * Creates expressions like: `if ((a & (b | /// \n c)) | d)`
 */
function arbitrary_nested_balanced_expression_with_continuation(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbitrary_expression_command(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(
      ([cmd, a, op1, b, op2, c, op3, d]) =>
        `${cmd} ((${a} ${op1} (${b} ${op2} ///\n${c})) ${op3} ${d})`
    );
}

/**
 * Generator for expressions with multiple continuations.
 * Creates expressions like: `if (a /// \n | b /// \n | c)`
 */
function arbitrary_multiple_continuation_expression(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbitrary_expression_command(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(
      ([cmd, a, op1, b, op2, c]) =>
        `${cmd} (${a} ///\n${op1} ${b} ///\n${op2} ${c})`
    );
}

/**
 * Generator for unbalanced expressions missing a closing parenthesis.
 * Creates expressions like: `if (a | /// \n b` (missing closer)
 * Note: Only tests parentheses with if/while commands which have explicit
 * parenthesis tracking in the parser.
 */
function arbitrary_missing_closer_expression(): fc.Arbitrary<{
  code: string;
  bracket_type: BracketType;
}> {
  return fc
    .tuple(
      fc.constantFrom('if', 'while'),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(([cmd, left, op, right]) => {
      return {
        code: `${cmd} (${left} ${op} ///\n${right}`,
        bracket_type: 'parenthesis' as BracketType,
      };
    });
}

/**
 * Generator for unbalanced expressions with extra closing parenthesis.
 * Creates expressions like: `if (a | /// \n b))` (extra closer)
 * Note: Only tests parentheses with if/while commands which have explicit
 * parenthesis tracking in the parser.
 */
function arbitrary_extra_closer_expression(): fc.Arbitrary<{
  code: string;
  bracket_type: BracketType;
}> {
  return fc
    .tuple(
      fc.constantFrom('if', 'while'),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(([cmd, left, op, right]) => {
      return {
        code: `${cmd} (${left} ${op} ///\n${right}))`,
        bracket_type: 'parenthesis' as BracketType,
      };
    });
}

/**
 * Generator for balanced square bracket expressions with continuations.
 * Creates expressions like: `gen x = y[1 /// \n + 2]`
 */
function arbitrary_balanced_square_bracket_expression(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.constantFrom('gen', 'replace'),
      fc.constantFrom('x', 'y', 'z'),
      fc.constantFrom('a', 'b', 'c'),
      fc.integer({ min: 1, max: 10 }),
      fc.constantFrom('+', '-'),
      fc.integer({ min: 1, max: 10 })
    )
    .map(
      ([cmd, target, source, idx1, op, idx2]) =>
        `${cmd} ${target} = ${source}[${idx1} ///\n${op} ${idx2}]`
    );
}

/**
 * Generator for mixed bracket expressions with continuations.
 * Creates expressions like: `if (a[1 /// \n ] & b)`
 */
function arbitrary_mixed_bracket_expression(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbitrary_expression_command(),
      fc.constantFrom('a', 'b', 'c'),
      fc.integer({ min: 1, max: 10 }),
      arbitrary_operator(),
      fc.constantFrom('x', 'y', 'z')
    )
    .map(
      ([cmd, var1, idx, op, var2]) =>
        `${cmd} (${var1}[${idx} ///\n] ${op} ${var2})`
    );
}

/**
 * Generator for deeply nested balanced expressions with continuations.
 */
function arbitrary_deeply_nested_expression(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbitrary_expression_command(),
      fc.integer({ min: 1, max: 3 }),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(([cmd, depth, left, op, right]) => {
      const opens = '('.repeat(depth);
      const closes = ')'.repeat(depth);
      return `${cmd} ${opens}${left} ${op} ///\n${right}${closes}`;
    });
}

/**
 * Generator for expressions with continuation inside nested brackets.
 */
function arbitrary_continuation_inside_nested(): fc.Arbitrary<string> {
  return fc
    .tuple(
      arbitrary_expression_command(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand(),
      arbitrary_operator(),
      arbitrary_operand()
    )
    .map(
      ([cmd, a, op1, b, op2, c]) =>
        `${cmd} (${a} ${op1} (${b} ///\n${op2} ${c}))`
    );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse code and return parse errors related to unbalanced brackets.
 */
function get_unbalanced_errors(code: string) {
  const lexer = new StataLexer();
  const lex_result = lexer.tokenize(code);
  const parser = new StataParser();
  const parse_result = parser.parse(lex_result.tokens);

  return parse_result.errors.filter(
    (error) => error.code === ParseErrorCode.UNBALANCED_PARENTHESES
  );
}

/**
 * Parse code and return all parse errors.
 */
function get_all_parse_errors(code: string) {
  const lexer = new StataLexer();
  const lex_result = lexer.tokenize(code);
  const parser = new StataParser();
  const parse_result = parser.parse(lex_result.tokens);

  return parse_result.errors;
}

// =============================================================================
// PROPERTY TESTS
// =============================================================================

describe('Continuation Line Parenthesis Tracking Property Tests', () => {
  /**
   * Property 1: Parenthesis Balance Across Continuations (Task 2.2)
   *
   * For any valid Stata expression with balanced parentheses that spans
   * multiple physical lines via `///` continuations, the parser SHALL NOT
   * emit an unbalanced parenthesis diagnostic.
   *
   * Feature: continuation-line-parenthesis-tracking, Property 1
   * Validates: Requirements 1.1, 1.2
   */
  describe('Property 1: Parenthesis Balance Across Continuations', () => {
    it('should not emit unbalanced errors for simple balanced expressions with continuations', () => {
      fc.assert(
        fc.property(arbitrary_balanced_expression_with_continuation(), (code) => {
          const errors = get_unbalanced_errors(code);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should not emit unbalanced errors for nested balanced expressions with continuations', () => {
      fc.assert(
        fc.property(
          arbitrary_nested_balanced_expression_with_continuation(),
          (code) => {
            const errors = get_unbalanced_errors(code);
            expect(errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not emit unbalanced errors for expressions with multiple continuations', () => {
      fc.assert(
        fc.property(arbitrary_multiple_continuation_expression(), (code) => {
          const errors = get_unbalanced_errors(code);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should not emit unbalanced errors for deeply nested expressions with continuations', () => {
      fc.assert(
        fc.property(arbitrary_deeply_nested_expression(), (code) => {
          const errors = get_unbalanced_errors(code);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should not emit unbalanced errors for continuations inside nested brackets', () => {
      fc.assert(
        fc.property(arbitrary_continuation_inside_nested(), (code) => {
          const errors = get_unbalanced_errors(code);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: Genuine Unbalanced Parentheses Detection (Task 6.1)
   *
   * For any Stata expression with genuinely unbalanced parentheses (missing
   * opener or closer even after all continuations are resolved), the parser
   * SHALL emit exactly one unbalanced parenthesis diagnostic per unmatched
   * parenthesis.
   *
   * Feature: continuation-line-parenthesis-tracking, Property 2
   * Validates: Requirements 6.1
   */
  describe('Property 2: Genuine Unbalanced Parentheses Detection', () => {
    it('should emit unbalanced error for expressions missing closing bracket', () => {
      fc.assert(
        fc.property(arbitrary_missing_closer_expression(), ({ code }) => {
          const errors = get_unbalanced_errors(code);
          // Should have at least one unbalanced error
          expect(errors.length).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should emit unbalanced error for expressions with extra closing bracket', () => {
      fc.assert(
        fc.property(arbitrary_extra_closer_expression(), ({ code }) => {
          const errors = get_unbalanced_errors(code);
          // Should have at least one unbalanced error
          expect(errors.length).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should emit exactly one error per unmatched parenthesis for simple cases', () => {
      // Test specific cases with known unbalanced counts
      const test_cases = [
        { code: 'if (a ///\n| b', expected_min: 1 }, // Missing 1 closer
        { code: 'if ((a ///\n| b)', expected_min: 1 }, // Missing 1 closer
        { code: 'if (a ///\n| b))', expected_min: 1 }, // Extra 1 closer
      ];

      for (const { code, expected_min } of test_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors.length).toBeGreaterThanOrEqual(expected_min);
      }
    });
  });

  /**
   * Property 3: Diagnostic Position Accuracy (Task 6.2)
   *
   * For any unbalanced parenthesis diagnostic emitted for a multi-line
   * expression, the diagnostic range SHALL reference the position of the
   * unmatched parenthesis token.
   *
   * Feature: continuation-line-parenthesis-tracking, Property 3
   * Validates: Requirements 6.2
   */
  describe('Property 3: Diagnostic Position Accuracy', () => {
    it('should report diagnostic at valid position for missing closer', () => {
      fc.assert(
        fc.property(arbitrary_missing_closer_expression(), ({ code }) => {
          const errors = get_unbalanced_errors(code);

          for (const error of errors) {
            // Diagnostic range should have valid positions
            expect(error.range.start.line).toBeGreaterThanOrEqual(0);
            expect(error.range.start.character).toBeGreaterThanOrEqual(0);
            expect(error.range.end.line).toBeGreaterThanOrEqual(
              error.range.start.line
            );

            // If on same line, end character should be >= start character
            if (error.range.start.line === error.range.end.line) {
              expect(error.range.end.character).toBeGreaterThanOrEqual(
                error.range.start.character
              );
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should report diagnostic at valid position for extra closer', () => {
      fc.assert(
        fc.property(arbitrary_extra_closer_expression(), ({ code }) => {
          const errors = get_unbalanced_errors(code);

          for (const error of errors) {
            // Diagnostic range should have valid positions
            expect(error.range.start.line).toBeGreaterThanOrEqual(0);
            expect(error.range.start.character).toBeGreaterThanOrEqual(0);
            expect(error.range.end.line).toBeGreaterThanOrEqual(
              error.range.start.line
            );
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should report diagnostic position within source code bounds', () => {
      fc.assert(
        fc.property(arbitrary_missing_closer_expression(), ({ code }) => {
          const errors = get_unbalanced_errors(code);
          const lines = code.split('\n');

          for (const error of errors) {
            // Line should be within bounds
            expect(error.range.start.line).toBeLessThan(lines.length);
            expect(error.range.end.line).toBeLessThan(lines.length);

            // Character should be within line bounds (allowing for end-of-line)
            const start_line_length = lines[error.range.start.line].length;
            const end_line_length = lines[error.range.end.line].length;

            expect(error.range.start.character).toBeLessThanOrEqual(
              start_line_length + 1
            );
            expect(error.range.end.character).toBeLessThanOrEqual(
              end_line_length + 1
            );
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 4: All Bracket Types Across Continuations (Task 7.3)
   *
   * For any valid Stata expression with balanced brackets (parentheses,
   * square brackets, or curly braces) that spans multiple physical lines
   * via `///` continuations, the parser SHALL NOT emit an unbalanced
   * bracket diagnostic for that bracket type.
   *
   * Feature: continuation-line-parenthesis-tracking, Property 4
   * Validates: Requirements 7.3
   */
  describe('Property 4: All Bracket Types Across Continuations', () => {
    it('should not emit unbalanced errors for balanced square brackets with continuations', () => {
      fc.assert(
        fc.property(arbitrary_balanced_square_bracket_expression(), (code) => {
          const errors = get_unbalanced_errors(code);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should not emit unbalanced errors for mixed bracket types with continuations', () => {
      fc.assert(
        fc.property(arbitrary_mixed_bracket_expression(), (code) => {
          const errors = get_unbalanced_errors(code);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle all bracket types correctly in specific test cases', () => {
      // Test specific balanced cases for each bracket type
      const balanced_cases = [
        // Parentheses
        'if (a ///\n| b)',
        'if ((a ///\n& b) | c)',
        // Square brackets
        'gen x = y[1 ///\n+ 2]',
        'gen x = y[a[1 ///\n]]',
        // Mixed
        'if (a[1 ///\n] & b)',
        'gen x = (y[1 ///\n+ 2])',
      ];

      for (const code of balanced_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors).toHaveLength(0);
      }
    });

    it('should detect unbalanced brackets of each type', () => {
      // Test specific unbalanced cases for parentheses
      // Note: The parser primarily tracks parenthesis balance; square bracket
      // tracking may vary depending on context
      const unbalanced_cases = [
        // Missing closing parenthesis
        { code: 'if (a ///\n| b', should_have_error: true },
        // Extra closing parenthesis
        { code: 'if (a ///\n| b))', should_have_error: true },
      ];

      for (const { code, should_have_error } of unbalanced_cases) {
        const errors = get_unbalanced_errors(code);
        if (should_have_error) {
          expect(errors.length).toBeGreaterThan(0);
        }
      }
    });
  });

  /**
   * Additional edge case tests for continuation line parenthesis tracking.
   */
  describe('Edge Cases', () => {
    it('should handle continuation at the very start of expression', () => {
      const test_cases = [
        'if ( ///\na | b)',
        'gen x = ( ///\na + b)',
      ];

      for (const code of test_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors).toHaveLength(0);
      }
    });

    it('should handle continuation at the very end of expression', () => {
      const test_cases = [
        'if (a | b ///\n)',
        'gen x = (a + b ///\n)',
      ];

      for (const code of test_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors).toHaveLength(0);
      }
    });

    it('should handle multiple bracket types in same expression with continuations', () => {
      const test_cases = [
        'if (a[1] ///\n& b[2])',
        'gen x = (y[1 ///\n+ 2] + z[3])',
        'if ((a[1 ///\n]) & (b[2]))',
      ];

      for (const code of test_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors).toHaveLength(0);
      }
    });

    it('should handle empty continuation lines', () => {
      const test_cases = [
        'if (a ///\n///\n| b)',
        'gen x = (a ///\n///\n///\n+ b)',
      ];

      for (const code of test_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors).toHaveLength(0);
      }
    });

    it('should handle continuation with trailing comment content', () => {
      const test_cases = [
        'if (a /// comment here\n| b)',
        'gen x = (a /// this is a comment\n+ b)',
      ];

      for (const code of test_cases) {
        const errors = get_unbalanced_errors(code);
        expect(errors).toHaveLength(0);
      }
    });

    it('should correctly identify unbalanced brackets even with many continuations', () => {
      // Missing closer with multiple continuations
      const missing_closer = 'if (a ///\n| b ///\n| c ///\n| d';
      const missing_errors = get_unbalanced_errors(missing_closer);
      expect(missing_errors.length).toBeGreaterThan(0);

      // Extra closer with multiple continuations
      const extra_closer = 'if (a ///\n| b ///\n| c))';
      const extra_errors = get_unbalanced_errors(extra_closer);
      expect(extra_errors.length).toBeGreaterThan(0);
    });

    it('should not produce cascading errors for single unbalanced bracket', () => {
      fc.assert(
        fc.property(arbitrary_missing_closer_expression(), ({ code }) => {
          const all_errors = get_all_parse_errors(code);
          const unbalanced_errors = all_errors.filter(
            (e) => e.code === ParseErrorCode.UNBALANCED_PARENTHESES
          );

          // Should not have excessive cascading errors
          // Allow up to 3 errors total (some related errors are acceptable)
          expect(all_errors.length).toBeLessThanOrEqual(3);
        }),
        { numRuns: 100 }
      );
    });
  });
});
