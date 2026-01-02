/**
 * Property-based tests for string literal macro suppression in stray token detection.
 *
 * Tests the following property:
 * 1. String Literal Macro Suppression - Macro references inside string literals
 *    should NOT trigger stray token diagnostics.
 *
 * Feature: stray-token-string-macro-false-positive
 */

import { describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { ParseErrorCode } from '../../src/types';
import {
  arbitrary_identifier,
  arbitrary_macro_name,
  arbitrary_variable_name,
} from './generators/primitives';
import { create_document_state } from './helpers/document-utils';

// Helper to get errors by code
function get_errors_by_code(source: string, code: ParseErrorCode) {
  const doc_state = create_document_state(source);
  return doc_state.diagnostics.filter((d) => d.code === code);
}

// Generator for comparison operators
function arbitrary_comparison_operator(): fc.Arbitrary<string> {
  return fc.constantFrom('==', '!=', '~=', '<', '>', '<=', '>=');
}

// Generator for logical operators
function arbitrary_logical_operator(): fc.Arbitrary<string> {
  return fc.constantFrom('&', '|');
}

// Generator for local macro references embedded in strings: `name'
function arbitrary_local_macro_in_string(): fc.Arbitrary<string> {
  return arbitrary_macro_name().map((my_name) => `\`${my_name}'`);
}

// Generator for global macro references embedded in strings: $name
function arbitrary_global_macro_in_string(): fc.Arbitrary<string> {
  return arbitrary_macro_name().map((my_name) => `$${my_name}`);
}

// Generator for double-quoted strings with embedded local macro: "`macro'"
function arbitrary_double_quoted_string_with_local_macro(): fc.Arbitrary<string> {
  return arbitrary_local_macro_in_string().map(
    (my_macro) => `"${my_macro}"`
  );
}

// Generator for double-quoted strings with embedded global macro: "$macro"
function arbitrary_double_quoted_string_with_global_macro(): fc.Arbitrary<string> {
  return arbitrary_global_macro_in_string().map(
    (my_macro) => `"${my_macro}"`
  );
}

// Generator for compound strings with embedded local macro: `"`macro'"'
function arbitrary_compound_string_with_local_macro(): fc.Arbitrary<string> {
  return arbitrary_local_macro_in_string().map(
    (my_macro) => `\`"${my_macro}"'`
  );
}

// Generator for compound strings with embedded global macro: `"$macro"'
function arbitrary_compound_string_with_global_macro(): fc.Arbitrary<string> {
  return arbitrary_global_macro_in_string().map(
    (my_macro) => `\`"${my_macro}"'`
  );
}

// Generator for any string with embedded macro
function arbitrary_string_with_embedded_macro(): fc.Arbitrary<string> {
  return fc.oneof(
    arbitrary_double_quoted_string_with_local_macro(),
    arbitrary_double_quoted_string_with_global_macro(),
    arbitrary_compound_string_with_local_macro(),
    arbitrary_compound_string_with_global_macro()
  );
}

// Generator for simple operands (identifiers or numbers)
function arbitrary_operand(): fc.Arbitrary<string> {
  return fc.oneof(
    arbitrary_variable_name(),
    fc.integer({ min: 0, max: 999 }).map((n) => n.toString())
  );
}

describe('String Literal Macro Suppression Property Tests', () => {
  /**
   * Property 1: String Literal Macro Suppression
   * For any valid condition expression containing a string literal with embedded
   * macro references (local or global), the parser SHALL NOT emit any
   * STRAY_TOKEN_IN_CONDITION diagnostics for tokens within the string literal.
   *
   * Feature: stray-token-string-macro-false-positive, Property 1: String Literal Macro Suppression
   * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
   */
  it('should not flag macro references inside string literals as stray tokens', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        arbitrary_string_with_embedded_macro(),
        async (my_var, my_op, my_string_with_macro) => {
          // Test simple string comparison with embedded macro
          const source = `gen x = 1 if ${my_var} ${my_op} ${my_string_with_macro}`;
          const errors = get_errors_by_code(
            source,
            ParseErrorCode.STRAY_TOKEN_IN_CONDITION
          );

          if (errors.length > 0) {
            return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1b: Compound Condition with String Macro Suppression
   * For any compound condition expression with string comparisons containing
   * embedded macros, the parser SHALL NOT emit stray token diagnostics.
   *
   * Feature: stray-token-string-macro-false-positive, Property 1b: Compound Condition Suppression
   * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
   */
  it('should not flag macro references in compound conditions with strings', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_logical_operator(),
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        arbitrary_string_with_embedded_macro(),
        async (
          my_lhs1,
          my_op1,
          my_rhs1,
          my_logical,
          my_lhs2,
          my_op2,
          my_string_with_macro
        ) => {
          // Test compound condition: x == 1 & y == "`macro'"
          const source = `gen x = 1 if ${my_lhs1} ${my_op1} ${my_rhs1} ${my_logical} ${my_lhs2} ${my_op2} ${my_string_with_macro}`;
          const errors = get_errors_by_code(
            source,
            ParseErrorCode.STRAY_TOKEN_IN_CONDITION
          );

          if (errors.length > 0) {
            return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1c: Multiple String Comparisons with Macros
   * For any condition with multiple string comparisons containing embedded macros,
   * the parser SHALL NOT emit stray token diagnostics.
   *
   * Feature: stray-token-string-macro-false-positive, Property 1c: Multiple String Comparisons
   * Validates: Requirements 2.3
   */
  it('should not flag macro references in multiple string comparisons', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        arbitrary_string_with_embedded_macro(),
        arbitrary_logical_operator(),
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        arbitrary_string_with_embedded_macro(),
        async (
          my_var1,
          my_op1,
          my_string1,
          my_logical,
          my_var2,
          my_op2,
          my_string2
        ) => {
          // Test: x == "`a'" & y == "`b'"
          const source = `gen x = 1 if ${my_var1} ${my_op1} ${my_string1} ${my_logical} ${my_var2} ${my_op2} ${my_string2}`;
          const errors = get_errors_by_code(
            source,
            ParseErrorCode.STRAY_TOKEN_IN_CONDITION
          );

          if (errors.length > 0) {
            return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 1d: Triple Condition with String and Numeric Comparisons
   * For any condition with mixed string (with macros) and numeric comparisons,
   * the parser SHALL NOT emit stray token diagnostics.
   *
   * Feature: stray-token-string-macro-false-positive, Property 1d: Triple Condition
   * Validates: Requirements 2.4
   */
  it('should not flag macro references in triple conditions', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_logical_operator(),
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        arbitrary_string_with_embedded_macro(),
        arbitrary_logical_operator(),
        arbitrary_variable_name(),
        arbitrary_comparison_operator(),
        fc.constantFrom('"births"', '"deaths"', '"test"'),
        async (
          my_var1,
          my_op1,
          my_rhs1,
          my_logical1,
          my_var2,
          my_op2,
          my_string_with_macro,
          my_logical2,
          my_var3,
          my_op3,
          my_plain_string
        ) => {
          // Test: x == 1 & program == "`program'" & level == "births"
          const source = `gen x = 1 if ${my_var1} ${my_op1} ${my_rhs1} ${my_logical1} ${my_var2} ${my_op2} ${my_string_with_macro} ${my_logical2} ${my_var3} ${my_op3} ${my_plain_string}`;
          const errors = get_errors_by_code(
            source,
            ParseErrorCode.STRAY_TOKEN_IN_CONDITION
          );

          if (errors.length > 0) {
            return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Stray Token Detection Preservation
   * For any condition expression containing a genuine stray token (an identifier
   * after a comparison that is not part of a string literal and is not a logical
   * operator), the parser SHALL emit a STRAY_TOKEN_IN_CONDITION diagnostic.
   *
   * Feature: stray-token-string-macro-false-positive, Property 2: Stray Token Detection Preservation
   * Validates: Requirements 3.1, 3.2
   */
  it('should still detect genuine stray tokens outside strings', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_identifier().filter(
          (id) => id !== '&' && id !== '|' && id !== 'in'
        ),
        async (my_lhs, my_op, my_rhs, my_stray) => {
          // Test: x == 1 oops (genuine stray token)
          const source = `gen x = 1 if ${my_lhs} ${my_op} ${my_rhs} ${my_stray}`;
          const errors = get_errors_by_code(
            source,
            ParseErrorCode.STRAY_TOKEN_IN_CONDITION
          );

          if (errors.length === 0) {
            return false;
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
