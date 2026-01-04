# Implementation Plan: Continuation Delimiter Alignment Preservation

## Overview

Fix the formatter's tab-to-space conversion to preserve visual alignment by implementing proper tab stop expansion in the `TokenReconstructor` class.

## Tasks

- [x] 1. Implement tab expansion helper
  - [x] 1.1 Add `expand_tabs_to_spaces()` private method to `TokenReconstructor` class
    - Add method that calculates visual column for each character
    - Expand tabs to next tab stop (multiples of tab_width)
    - Return spaces to reach the same visual column
    - _Requirements: 1.1, 3.1, 3.2_

- [x] 2. Integrate tab expansion into token reconstruction
  - [x] 2.1 Replace simple tab replacement with `expand_tabs_to_spaces()` call
    - Pass `state.current_column` as the starting column
    - Pass `config.indent_size` as the tab width
    - _Requirements: 1.2, 1.3, 2.1_

- [x] 3. Checkpoint - Verify basic functionality
  - Ensure formatter compiles and basic formatting still works
  - Run existing formatter tests to verify no regressions

- [x] 4. Write property tests for tab expansion
  - [x] 4.1 Write property test for visual column preservation
    - **Property 1: Visual Column Preservation**
    - **Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2**
  - [x] 4.2 Write property test for tab stop configuration
    - **Property 2: Tab Stop Configuration Respect**
    - **Validates: Requirements 2.1**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Run full test suite including new property tests
  - Verify continuation delimiter alignment is preserved after formatting

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The `indent_size` config value serves double duty as both indentation width and tab stop interval

