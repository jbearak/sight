# Implementation Plan: Continuation Line Parenthesis Tracking

## Overview

Fix false positive "unbalanced parentheses" diagnostics when parentheses span across `///` line continuations. The fix involves modifying parser methods to properly handle continuation tokens and only check bracket balance after the entire logical line is parsed.

## Tasks

- [x] 1. Add helper method for continuation handling
  - [x] 1.1 Add `skipContinuation()` helper method to Parser class
    - Add method that checks for `CONTINUATION` token, advances past it, and skips following `STATEMENT_TERMINATOR`
    - Returns `true` if continuation was skipped, `false` otherwise
    - _Requirements: 1.1, 1.2_

- [x] 2. Fix `parseExpression()` method
  - [x] 2.1 Update `parseExpression()` to handle continuations
    - Add continuation handling at start of while loop before other checks
    - Use `skipContinuation()` helper and `continue` to next iteration
    - Change trivia check to exclude `CONTINUATION` (check for `COMMENT_LINE` and `COMMENT_BLOCK` only)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.2 Write property test for parenthesis balance across continuations in expressions
    - **Property 1: Parenthesis Balance Across Continuations**
    - **Validates: Requirements 1.1, 1.2**

- [x] 3. Fix `parse_macro_def()` method
  - [x] 3.1 Update `parse_macro_def()` to handle continuations
    - Add continuation handling in the value collection loop
    - Use same pattern as `parseExpression()`
    - _Requirements: 1.1, 1.2_

- [x] 4. Verify `parseIfStatement()` and `parseWhileStatement()` handling
  - [x] 4.1 Review and fix `parseIfStatement()` continuation handling
    - Ensure `CONTINUATION` tokens in the condition are properly handled
    - The current code checks for continuation before `STATEMENT_TERMINATOR` but may miss continuations in other positions
    - _Requirements: 1.1, 1.2_
  - [x] 4.2 Review and fix `parseWhileStatement()` continuation handling
    - Apply same fix pattern as `parseIfStatement()`
    - _Requirements: 1.1, 1.2_

- [x] 5. Checkpoint - Verify core functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add property tests for genuine unbalanced detection
  - [x] 6.1 Write property test for genuine unbalanced parentheses detection
    - **Property 2: Genuine Unbalanced Parentheses Detection**
    - **Validates: Requirements 1.3, 1.4**
  - [x] 6.2 Write property test for diagnostic position accuracy
    - **Property 3: Diagnostic Position Accuracy**
    - **Validates: Requirements 2.1, 2.2**

- [x] 7. Extend fix to other bracket types
  - [x] 7.1 Verify square bracket tracking across continuations
    - Review existing bracket tracking code
    - Ensure square brackets are tracked with same continuation handling
    - _Requirements: 3.1_
  - [x] 7.2 Verify curly brace tracking across continuations
    - Review existing brace tracking code
    - Ensure curly braces are tracked with same continuation handling
    - _Requirements: 3.2_
  - [x] 7.3 Write property test for all bracket types across continuations
    - **Property 4: All Bracket Types Across Continuations**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- The `parseQualifierExpressionWithStrayDetection()` method already handles continuations correctly and can serve as a reference implementation
- Property tests validate universal correctness properties
