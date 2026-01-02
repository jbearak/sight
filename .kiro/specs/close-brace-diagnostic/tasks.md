# Implementation Plan: Close Brace Diagnostic

## Overview

This implementation adds brace placement validation to the Stata parser. The work is organized into: adding new error codes, implementing validation helpers, integrating validation into block parsing, and adding tests.

## Tasks

- [x] 1. Add new error codes to types
  - Add `OPEN_BRACE_ALONE = 3004` to `ParseErrorCode` enum
  - Add `CODE_AFTER_OPEN_BRACE = 3006` to `ParseErrorCode` enum
  - Add corresponding entries to `StataDiagnosticCode` enum
  - _Requirements: 4.1, 5.1_

- [x] 2. Implement brace validation helper methods in parser
  - [x] 2.1 Add `are_on_same_line(token1, token2)` helper method
    - Compare line numbers from token ranges
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_
  - [x] 2.2 Add `find_code_after_on_same_line(start_pos, line)` helper method
    - Scan forward from position, return first non-trivia token on same line
    - Skip WHITESPACE, COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens
    - Return null if no code found on same line
    - _Requirements: 1.1, 5.1_
  - [x] 2.3 Add `find_code_before_on_same_line(end_pos, line)` helper method
    - Scan backward from position, return last non-trivia token on same line
    - Skip WHITESPACE, COMMENT_LINE, COMMENT_BLOCK, CONTINUATION tokens
    - Return null if no code found on same line
    - _Requirements: 2.1_

- [x] 3. Implement close brace validation
  - [x] 3.1 Add `validate_close_brace(brace_token)` method
    - Check for code after brace on same line → emit BRACE_NOT_ALONE
    - Check for code before brace on same line → emit BRACE_NOT_ALONE
    - Check for `else` after brace on same line → emit BRACE_ELSE_SAME_LINE
    - Compute accurate diagnostic ranges
    - _Requirements: 1.1, 1.4, 2.1, 2.3, 3.1, 3.3, 6.1, 6.2, 6.3_
  - [x] 3.2 Write property test for close brace not alone detection
    - **Property 1: Close Brace Not Alone Detection**
    - **Validates: Requirements 1.1, 2.1**
  - [x] 3.3 Write property test for valid close brace placement
    - **Property 2: Valid Close Brace Placement**
    - **Validates: Requirements 1.2, 1.3, 2.2**
  - [x] 3.4 Write property test for else same line detection
    - **Property 3: Else Same Line Detection**
    - **Validates: Requirements 3.1**
  - [x] 3.5 Write property test for valid else placement
    - **Property 4: Valid Else Placement**
    - **Validates: Requirements 3.2**

- [x] 4. Implement open brace validation
  - [x] 4.1 Add `validate_open_brace(brace_token, has_condition_before)` method
    - Check if brace is alone on line (no condition before) → emit OPEN_BRACE_ALONE
    - Check for code after brace on same line → emit CODE_AFTER_OPEN_BRACE (warning)
    - Compute accurate diagnostic ranges
    - _Requirements: 4.1, 4.3, 5.1, 5.3, 5.4, 6.4, 6.5_
  - [x] 4.2 Write property test for open brace alone detection
    - **Property 5: Open Brace Alone Detection**
    - **Validates: Requirements 4.1**
  - [x] 4.3 Write property test for valid open brace placement
    - **Property 6: Valid Open Brace Placement**
    - **Validates: Requirements 4.2**
  - [x] 4.4 Write property test for code after open brace detection
    - **Property 7: Code After Open Brace Detection**
    - **Validates: Requirements 5.1, 5.4**

- [x] 5. Integrate validation into block parsing methods
  - [x] 5.1 Update `parseIfStatement()` to call brace validation
    - Call `validate_open_brace` when consuming LBRACE
    - Call `validate_close_brace` when consuming RBRACE
    - _Requirements: 1.1, 2.1, 4.1, 5.1_
  - [x] 5.2 Update `parseElseStatement()` to call brace validation
    - Call `validate_open_brace` when consuming LBRACE
    - Call `validate_close_brace` when consuming RBRACE
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_
  - [x] 5.3 Update `parseLoopStatement()` to call brace validation
    - Call `validate_open_brace` when consuming LBRACE
    - Call `validate_close_brace` when consuming RBRACE
    - _Requirements: 1.1, 2.1, 4.1, 5.1_
  - [x] 5.4 Update `parseWhileStatement()` to call brace validation
    - Call `validate_open_brace` when consuming LBRACE
    - Call `validate_close_brace` when consuming RBRACE
    - _Requirements: 1.1, 2.1, 4.1, 5.1_
  - [x] 5.5 Update `parseCommand()` prefix block handling to call brace validation
    - For blocks like `quietly { ... }`
    - _Requirements: 1.1, 2.1, 4.1, 5.1_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write property test for diagnostic range accuracy
  - **Property 8: Diagnostic Range Accuracy**
  - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

- [x] 8. Update diagnostics provider severity handling
  - Ensure CODE_AFTER_OPEN_BRACE is treated as Warning severity
  - Other brace errors remain Error severity
  - _Requirements: 5.4_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
