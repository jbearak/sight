# Implementation Plan: Mata Brace-Style Blocks in Context Tracker

## Overview

This implementation updates the ContextTracker's `initialize_from_tokens()` method to recognize brace-style embedded blocks (`mata { ... }` and `python { ... }`). The lexer and parser already handle these blocks correctly (commit cd6ab1b), but the ContextTracker still only recognizes `END_MATA`/`END_PYTHON` tokens as block closers, causing false "Unclosed mata block" diagnostics.

## Tasks

- [x] 1. Update initialize_from_tokens to detect brace-style blocks
  - [x] 1.1 Add state variables for brace-style block tracking
    - Add `my_is_brace_style` boolean to track if current block uses brace syntax
    - Add `my_brace_depth` counter for nested brace tracking
    - Add `my_block_start_line` to record where the block started
    - _Requirements: 1.1, 1.2, 3.1, 3.2_

  - [x] 1.2 Implement LBRACE detection after MATA_START/PYTHON_START
    - After encountering MATA_START or PYTHON_START (not inline), look ahead for LBRACE on same line
    - If LBRACE found on same line, mark block as brace-style and initialize brace_depth to 1
    - If no LBRACE on same line, treat as traditional block (closed by END_MATA/END_PYTHON)
    - _Requirements: 3.1, 3.2_

  - [x] 1.3 Implement brace depth tracking for nested braces
    - When in brace-style block, increment depth on LBRACE tokens
    - Decrement depth on RBRACE tokens
    - _Requirements: 2.1, 2.2_

  - [x] 1.4 Implement block closure on matching RBRACE
    - When brace_depth returns to 0, close the block using RBRACE as end delimiter
    - Set end_delimiter.command to `}` for brace-style blocks
    - Reset brace-style state variables after closing
    - Pop context from stack
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.5 Skip END_MATA/END_PYTHON tokens in brace-style blocks
    - When in brace-style block, do not close on END_MATA/END_PYTHON tokens
    - These tokens should be treated as content within the brace-style block
    - _Requirements: 3.1, 3.2_

- [x] 2. Checkpoint - Verify core implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Write unit tests for brace-style block handling
  - [x] 3.1 Add unit tests for brace-style mata block detection
    - Test `mata { 1234 }` is recognized as properly closed
    - Test end_delimiter.command is `}`
    - Test no "Unclosed mata block" diagnostic is emitted
    - _Requirements: 1.1, 1.3_

  - [x] 3.2 Add unit tests for brace-style python block detection
    - Test `python { print("hello") }` is recognized as properly closed
    - Test end_delimiter.command is `}`
    - Test no "Unclosed python block" diagnostic is emitted
    - _Requirements: 1.2, 1.3_

  - [x] 3.3 Add unit tests for nested braces in brace-style blocks
    - Test `mata { for (i=1; i<=10; i++) { x[i] = i } }` is correctly closed
    - Verify outermost `}` is identified as block terminator
    - _Requirements: 2.1, 2.2_

  - [x] 3.4 Add unit tests for traditional block handling (regression)
    - Verify `mata\n...\nend` still works correctly
    - Verify `python\n...\nend` still works correctly
    - _Requirements: 1.4, 3.3_

  - [x] 3.5 Add unit tests for brace-style blocks inside programs
    - Test `program define my_prog\nmata { ... }\nend` produces no diagnostics
    - Verify mata block closed by `}` and program closed by `end`
    - _Requirements: 4.1, 4.2_

  - [x] 3.6 Add unit tests for distinguishing brace-style from traditional
    - Test `mata {` on same line is brace-style
    - Test `mata\n{` (brace on next line) is traditional
    - _Requirements: 3.1, 3.2_

- [x] 4. Checkpoint - Verify all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write property-based tests for brace-style blocks
  - [x] 5.1 Write property test for brace-style block closure
    - **Property 1: Brace-style block closure**
    - *For any* brace-style embedded block where opening `{` appears on same line as keyword and matching `}` exists, the Context_Tracker SHALL recognize block as properly closed
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 5.2 Write property test for traditional block closure
    - **Property 2: Traditional block closure**
    - *For any* traditional embedded block closed with `end` command, the Context_Tracker SHALL continue to recognize block as properly closed
    - **Validates: Requirements 1.4**

  - [x] 5.3 Write property test for nested brace handling
    - **Property 3: Nested brace handling**
    - *For any* brace-style block containing nested braces, the Context_Tracker SHALL correctly identify outermost closing brace as block terminator
    - **Validates: Requirements 2.1**

  - [x] 5.4 Write property test for brace-style vs traditional detection
    - **Property 4: Brace-style vs traditional detection**
    - *For any* embedded block, IF keyword followed by `{` on same line THEN brace-style, ELSE traditional
    - **Validates: Requirements 3.1, 3.2**

  - [x] 5.5 Write property test for unclosed traditional block detection
    - **Property 5: Unclosed traditional block detection**
    - *For any* traditional embedded block missing `end` command, the Context_Tracker SHALL emit "Unclosed mata/python block" diagnostic
    - **Validates: Requirements 3.3**

  - [x] 5.6 Write property test for brace-style blocks inside programs
    - **Property 6: Brace-style blocks inside programs**
    - *For any* program definition containing brace-style mata block, Context_Tracker SHALL correctly identify mata block closed by `}` and program closed by `end`
    - **Validates: Requirements 4.1, 4.2**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- The lexer already tracks `embedded_brace_depth` in its state - the ContextTracker needs to use token information to replicate this logic
- The parser already handles brace-style blocks correctly - this change only affects the ContextTracker
- Property tests should run minimum 100 iterations using fast-check
