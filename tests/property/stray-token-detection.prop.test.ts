/**
 * Property-based tests for stray token detection in if/in qualifier conditions.
 * 
 * Tests the following properties:
 * 1. Stray Token Detection After Comparison
 * 2. Valid Expression Acceptance
 * 3. Diagnostic Message Quality
 * 4. Split Literal Detection
 * 5. Continuation Line Handling
 * 
 * Feature: stray-token-in-condition
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { ParseErrorCode } from '../../src/types';
import {
  arbitrary_identifier,
  arbitrary_number,
  arbitrary_variable_name,
} from './generators/primitives';
import { create_document_state } from './helpers/document-utils';

// Helper to get errors by code
function get_errors_by_code(source: string, code: ParseErrorCode) {
  const doc_state = create_document_state(source);
  return doc_state.diagnostics.filter(d => d.code === code);
}

// Generator for comparison operators
function arbitrary_comparison_operator(): fc.Arbitrary<string> {
  return fc.constantFrom('==', '!=', '~=', '<', '>', '<=', '>=');
}

// Generator for logical operators
function arbitrary_logical_operator(): fc.Arbitrary<string> {
  return fc.constantFrom('&', '|');
}

// Generator for arithmetic operators
function arbitrary_arithmetic_operator(): fc.Arbitrary<string> {
  return fc.constantFrom('+', '-', '*', '/', '^');
}

// Generator for simple operands (identifiers or numbers)
function arbitrary_operand(): fc.Arbitrary<string> {
  return fc.oneof(
    arbitrary_variable_name(),
    arbitrary_number()
  );
}

describe('Stray Token Detection Property Tests', () => {
  /**
   * Property 1: Stray Token Detection After Comparison
   * For any condition expression containing a comparison followed by an identifier
   * that is not a logical operator, the parser SHALL emit a STRAY_TOKEN_IN_CONDITION diagnostic.
   * 
   * Feature: stray-token-in-condition, Property 1: Stray Token Detection After Comparison
   * Validates: Requirements 1.1, 1.2, 2.1, 2.2, 6.1, 6.2, 6.3, 6.4
   */
  it('should detect stray tokens after comparison expressions', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_identifier(),
        async (my_lhs, my_op, my_rhs, my_stray) => {
          // Skip if stray token is a logical operator (valid continuation)
          if (my_stray === '&' || my_stray === '|') {
            return true;
          }
          
          // Skip if stray token is 'in' (valid for if-qualifiers)
          if (my_stray === 'in') {
            return true;
          }
          
          // Test unparenthesized form
          const source_unparens = `gen x = 1 if ${my_lhs} ${my_op} ${my_rhs} ${my_stray}`;
          const errors_unparens = get_errors_by_code(source_unparens, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          if (errors_unparens.length === 0) {
            console.log('Expected STRAY_TOKEN_IN_CONDITION for:', source_unparens);
            return false;
          }
          
          // Test parenthesized form
          const source_parens = `gen x = 1 if (${my_lhs} ${my_op} ${my_rhs} ${my_stray})`;
          const errors_parens = get_errors_by_code(source_parens, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          if (errors_parens.length === 0) {
            console.log('Expected STRAY_TOKEN_IN_CONDITION for:', source_parens);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Valid Expression Acceptance
   * For any syntactically valid condition expression, the parser SHALL NOT emit
   * a stray token diagnostic.
   * 
   * Feature: stray-token-in-condition, Property 2: Valid Expression Acceptance
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3
   */
  it('should not flag valid compound expressions', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_logical_operator(),
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        async (my_lhs1, my_op1, my_rhs1, my_logical, my_lhs2, my_op2, my_rhs2) => {
          // Test compound expression with logical operator
          const source = `gen x = 1 if (${my_lhs1} ${my_op1} ${my_rhs1} ${my_logical} ${my_lhs2} ${my_op2} ${my_rhs2})`;
          const errors = get_errors_by_code(source, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          if (errors.length > 0) {
            console.log('Unexpected STRAY_TOKEN_IN_CONDITION for valid expression:', source);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2b: Valid Arithmetic Expressions (LHS)
   * Arithmetic operators in comparisons should not trigger stray token detection.
   * 
   * Feature: stray-token-in-condition, Property 2b: Valid Arithmetic Expressions
   * Validates: Requirements 3.4
   */
  it('should not flag arithmetic in comparisons', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_arithmetic_operator(),
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        async (my_lhs, my_arith_op, my_arith_rhs, my_comp_op, my_rhs) => {
          const source = `gen x = 1 if (${my_lhs} ${my_arith_op} ${my_arith_rhs} ${my_comp_op} ${my_rhs})`;
          const errors = get_errors_by_code(source, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          if (errors.length > 0) {
            console.log('Unexpected STRAY_TOKEN_IN_CONDITION for arithmetic expression:', source);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2c: Valid Arithmetic Expressions (RHS)
   * Arithmetic operators on the right-hand side of comparisons should not trigger stray token detection.
   * 
   * Feature: stray-token-in-condition, Property 2c: Valid Arithmetic Expressions (RHS)
   * Validates: Requirements 3.4
   */
  it('should not flag arithmetic on RHS of comparisons', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_arithmetic_operator(),
        arbitrary_operand(),
        async (my_lhs, my_comp_op, my_rhs, my_arith_op, my_arith_rhs) => {
          const source = `gen x = 1 if (${my_lhs} ${my_comp_op} ${my_rhs} ${my_arith_op} ${my_arith_rhs})`;
          const errors = get_errors_by_code(source, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          if (errors.length > 0) {
            console.log('Unexpected STRAY_TOKEN_IN_CONDITION for RHS arithmetic expression:', source);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Diagnostic Message Quality
   * For any detected stray token, the diagnostic message SHALL include the token text
   * and suggest possible fixes.
   * 
   * Feature: stray-token-in-condition, Property 3: Diagnostic Message Quality
   * Validates: Requirements 5.1, 5.2, 5.3
   */
  it('should include token text and suggestion in diagnostic message', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_identifier().filter(id => id !== '&' && id !== '|' && id !== 'in'),
        async (my_lhs, my_op, my_rhs, my_stray) => {
          const source = `gen x = 1 if ${my_lhs} ${my_op} ${my_rhs} ${my_stray}`;
          const errors = get_errors_by_code(source, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          // Ensure at least one stray token error is detected
          expect(errors.length).toBeGreaterThan(0);
          
          const my_error = errors[0];
          
          // Check that message contains the stray token text
          expect(my_error.message).toContain(my_stray);
          
          // Check that message suggests & or |
          expect(my_error.message.includes("'&'") || my_error.message.includes("'|'")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4: Split Literal Detection
   * For condition expressions where tokens that could form a single literal are
   * separated by whitespace, the parser SHALL emit a diagnostic.
   * 
   * Feature: stray-token-in-condition, Property 4: Split Literal Detection
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
   */
  it('should detect split literal patterns (. N)', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_variable_name(),
        fc.integer({ min: 0, max: 999 }),
        async (my_var, my_num) => {
          // Test `. N` pattern (dot space number)
          const source = `gen x = 1 if ${my_var} != . ${my_num}`;
          const errors = get_errors_by_code(source, ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
          
          if (errors.length === 0) {
            console.log('Expected SPLIT_LITERAL_IN_CONDITION for:', source);
            return false;
          }
          
          // Check that message suggests the combined form
          const my_error = errors[0];
          if (!my_error.message.includes(`.${my_num}`)) {
            console.log(`Message should suggest '.${my_num}':`, my_error.message);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4b: Split Literal Detection for Extended Missing Values
   * For `. a` through `. z` patterns, the parser should suggest extended missing values.
   * 
   * Feature: stray-token-in-condition, Property 4b: Split Literal Detection (Extended Missing)
   * Validates: Requirements 7.2
   */
  it('should detect split literal patterns (. a) for extended missing values', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_variable_name(),
        fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
                        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'),
        async (my_var, my_letter) => {
          const source = `gen x = 1 if ${my_var} != . ${my_letter}`;
          const errors = get_errors_by_code(source, ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
          
          if (errors.length === 0) {
            console.log('Expected SPLIT_LITERAL_IN_CONDITION for:', source);
            return false;
          }
          
          // Check that message mentions extended missing value
          const my_error = errors[0];
          if (!my_error.message.includes('extended missing')) {
            console.log('Message should mention extended missing value:', my_error.message);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5: Continuation Line Handling
   * For condition expressions spanning multiple lines via `///` continuation,
   * the parser SHALL correctly analyze the complete expression.
   * 
   * Feature: stray-token-in-condition, Property 5: Continuation Line Handling
   * Validates: Requirements 8.1, 8.2, 8.3
   */
  it('should detect stray tokens across continuation lines', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_operand(),
        arbitrary_comparison_operator(),
        arbitrary_operand(),
        arbitrary_identifier().filter(id => id !== '&' && id !== '|' && id !== 'in'),
        async (my_lhs, my_op, my_rhs, my_stray) => {
          // Test with continuation before stray token
          const source = `gen x = 1 if ${my_lhs} ${my_op} /// comment
${my_rhs} ${my_stray}`;
          const errors = get_errors_by_code(source, ParseErrorCode.STRAY_TOKEN_IN_CONDITION);
          
          if (errors.length === 0) {
            console.log('Expected STRAY_TOKEN_IN_CONDITION across continuation:', source);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5b: Split Literal Detection Across Continuation Lines
   * Split literals should be detected even when they span continuation lines.
   * 
   * Feature: stray-token-in-condition, Property 5b: Split Literal Across Continuation
   * Validates: Requirements 7.5, 8.1, 8.2, 8.3
   */
  it('should detect split literals across continuation lines', async () => {
    fc.assert(
      fc.asyncProperty(
        arbitrary_variable_name(),
        fc.integer({ min: 0, max: 999 }),
        async (my_var, my_num) => {
          // Test with continuation between . and number
          const source = `gen x = 1 if ${my_var} != . /// comment
${my_num}`;
          const errors = get_errors_by_code(source, ParseErrorCode.SPLIT_LITERAL_IN_CONDITION);
          
          if (errors.length === 0) {
            console.log('Expected SPLIT_LITERAL_IN_CONDITION across continuation:', source);
            return false;
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
