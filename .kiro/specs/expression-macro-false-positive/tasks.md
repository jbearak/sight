# Implementation Plan: Expression Macro False Positive Fix

## Overview

This implementation adds detection logic in the analyzer to suppress the "Invalid character in macro name" diagnostic for valid Stata expression evaluation syntax (`` `=expr' ``).

## Tasks

- [x] 1. Implement expression evaluation detection
  - [x] 1.1 Add `is_expression_evaluation` method to SemanticAnalyzer
    - Add method that checks if macro content starts with `=`
    - Include JSDoc documentation with examples
    - _Requirements: 1.1_

  - [x] 1.2 Add expression evaluation check in `detect_undefined_references`
    - Add check before invalid character validation
    - Skip diagnostic generation for expression evaluation macros
    - _Requirements: 1.2_

- [x] 2. Add property-based tests
  - [x] 2.1 Write property test for expression evaluation suppression
    - **Property 1: Expression Evaluation Macros Are Not Flagged**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4**

  - [x] 2.2 Write property test for non-expression invalid character detection
    - **Property 2: Non-Expression Invalid Characters Are Flagged**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The fix is localized to `src/analyzer/index.ts`
- Existing tests for stored results, nested macros, and unbalanced macros should continue to pass
