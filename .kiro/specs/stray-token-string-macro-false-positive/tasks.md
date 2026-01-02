# Implementation Plan: Stray Token String Macro False Positive Fix

## Overview

This implementation fixes false positive diagnostics where macro references inside string literals are incorrectly flagged as stray tokens. The fix adds string context tracking to the parser's stray token detection state machine.

## Tasks

- [x] 1. Add string delimiter detection helper
  - [x] 1.1 Add `isStringDelimiterOnly()` method to parser
    - Detect double-quote delimiters: `"`
    - Detect compound string delimiters: `` `" `` and `"'`
    - Detect nested compound delimiters using regex patterns
    - _Requirements: 1.1, 1.4_

- [x] 2. Add string context tracking to stray token detection
  - [x] 2.1 Add `in_string_context` flag to `parseQualifierExpressionWithStrayDetection`
    - Initialize to false at start of expression parsing
    - Toggle when encountering delimiter-only STRING tokens
    - _Requirements: 1.1, 1.4_
  - [x] 2.2 Skip stray token check when in string context
    - Modify the stray token detection condition to check `!in_string_context`
    - _Requirements: 1.2, 1.3_

- [x] 3. Checkpoint - Verify basic functionality
  - Ensure all existing tests pass
  - Manually verify the bug report case works

- [x] 4. Write property test for string literal macro suppression
  - **Property 1: String Literal Macro Suppression**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

- [x] 5. Write unit tests for specific cases
  - [x] 5.1 Test double-quoted string with local macro: `x == 1 & y == "\`macro'"`
    - _Requirements: 2.1_
  - [x] 5.2 Test double-quoted string with global macro: `x == 1 & y == "$macro"`
    - _Requirements: 2.2_
  - [x] 5.3 Test compound string with macro: `x == \`"\`macro'"'`
    - _Requirements: 2.5_
  - [x] 5.4 Test the exact bug report case: `x == 1 & program == "\`program'" & level == "births"`
    - _Requirements: 2.4_
  - [x] 5.5 Regression test: genuine stray tokens still detected
    - _Requirements: 3.1, 3.2_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- The fix is localized to `src/parser/index.ts`
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
