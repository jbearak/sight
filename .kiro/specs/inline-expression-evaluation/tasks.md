# Implementation Plan: Inline Expression Evaluation

## Overview

This implementation adds support for inline colon-expression syntax (`` `:function' ``) to complement the existing inline equals-expression support (`` `=expr' ``). The changes are minimal, focused on the analyzer's macro reference validation.

## Tasks

- [x] 1. Add inline extended function detection to analyzer
  - [x] 1.1 Add `is_inline_extended_function` method to SemanticAnalyzer
    - Add method that checks if content starts with `:`
    - Mirror the existing `is_expression_evaluation` pattern
    - _Requirements: 3.1, 3.2_

  - [x] 1.2 Update `check_token_macro_references` to skip inline extended functions
    - Add check for `is_inline_extended_function` after `is_expression_evaluation` check
    - Skip tokens that start with `:` (inline extended functions)
    - _Requirements: 3.2_

  - [x] 1.3 Write property test for inline expression no warning (Property 1)
    - **Property 1: Inline Expression No Warning**
    - **Validates: Requirements 1.2, 3.2**

- [x] 2. Verify existing behavior and add regression tests
  - [x] 2.1 Verify `is_expression_evaluation` works correctly for equals-expressions
    - Test that `` `=2+2' `` does not emit warning
    - Test that `` `=string(varname)' `` does not emit warning
    - _Requirements: 1.2_

  - [x] 2.2 Write property test for regular macro reference warning (Property 2)
    - **Property 2: Regular Macro Reference Warning Preserved**
    - **Validates: Requirements 2.2**

  - [x] 2.3 Write property test for nested macro validation (Property 3)
    - **Property 3: Nested Macro Validation in Inline Expressions**
    - **Validates: Requirements 1.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Verify formatter spacing behavior
  - [x] 4.1 Verify extended macro function spacing in pretty-printer
    - Confirm `local x : type mpg` produces space before colon
    - _Requirements: 4.1_

  - [x] 4.2 Verify prefix command spacing is preserved
    - Confirm `quietly: display` does NOT add space before colon
    - _Requirements: 4.2_

  - [x] 4.3 Write property test for extended macro function spacing (Property 4)
    - **Property 4: Extended Macro Function Spacing**
    - **Validates: Requirements 4.1, 4.3**

  - [x] 4.4 Write property test for prefix command spacing (Property 5)
    - **Property 5: Prefix Command Spacing Preserved**
    - **Validates: Requirements 4.2**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The implementation is minimal - only adding one method and one check
