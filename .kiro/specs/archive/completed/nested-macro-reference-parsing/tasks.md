# Implementation Plan: Nested Macro Reference Parsing

## Overview

This implementation fixes the lexer to correctly handle nested local macro references like `` `path`i'' `` by tracking nesting depth. The change is localized to the `scanLocalMacroRef` method in `src/lexer/index.ts`.

## Tasks

- [x] 1. Modify scanLocalMacroRef to track nesting depth
  - [x] 1.1 Update the scanLocalMacroRef method in src/lexer/index.ts
    - Add `nesting_depth` counter initialized to 1
    - Increment depth when encountering backtick
    - Decrement depth when encountering single quote
    - Continue scanning until depth reaches 0 or error condition
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write property test for token completeness
    - **Property 1: Token Completeness for Nested Macro References**
    - **Validates: Requirements 1.4, 2.1, 4.1, 5.1, 5.2, 5.3**

  - [x] 1.3 Write property test for nesting depth invariant
    - **Property 2: Nesting Depth Invariant**
    - **Validates: Requirements 4.2**

- [x] 2. Implement error handling for incomplete nested macros
  - [x] 2.1 Update error handling in scanLocalMacroRef
    - Emit error when newline encountered with nesting_depth > 0
    - Emit error when EOF reached with nesting_depth > 0
    - Use existing LexerErrorCode.UNBALANCED_QUOTES
    - _Requirements: 3.1, 3.2_

  - [x] 2.2 Write property test for error detection
    - **Property 3: Error Detection for Incomplete Macros**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.3 Write property test for no false positives
    - **Property 4: No False Positives for Valid Macros**
    - **Validates: Requirements 3.3**

- [x] 3. Checkpoint - Verify implementation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify the original issue file (fertility_surveys/programs/aww_use.do line 133) no longer produces false positive

- [x] 4. Add unit tests for edge cases
  - [x] 4.1 Write unit tests for specific examples
    - Test simple macro references (regression): `` `name' ``, `` `my_var' ``
    - Test single-level nesting: `` `path`i'' ``
    - Test multi-level nesting: `` `a`b`c''' ``
    - Test content after inner macro: `` `var`j'_suffix' ``
    - Test incomplete macros with various missing quotes
    - _Requirements: 2.2, 2.3, 4.1, 5.1, 5.2, 5.3_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including tests are required for comprehensive coverage
- The fix is localized to a single method in the lexer
- No changes needed to parser, analyzer, or other components
- Property tests use fast-check library
