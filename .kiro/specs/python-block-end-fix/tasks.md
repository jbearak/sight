# Implementation Plan: Python Block End Fix

## Overview

This implementation fixes the embedded language block ending behavior so that both `mata` and `python` blocks end with just `end` (not `end python` or `end mata`). The changes span the lexer, context tracker, completion provider, and hover provider.

## Tasks

- [x] 1. Fix Lexer End Delimiter Handling
  - [x] 1.1 Simplify Python context end delimiter detection
    - Remove look-ahead logic for `end python` pattern in `src/lexer/index.ts`
    - Make Python context behave like Mata context (just check for `end`)
    - Emit END_PYTHON token with value `end` (not `end python`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Remove deprecated `is_end_python_delimiter` method
    - Delete the `is_end_python_delimiter()` method from lexer
    - Remove any references to this method
    - _Requirements: 1.3_

  - [x] 1.3 Write property test for unified end delimiter tokenization
    - **Property 1: Unified End Delimiter Tokenization**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 1.4 Write property test for invalid end syntax tokenization
    - **Property 2: Invalid End Syntax Tokenization**
    - **Validates: Requirements 1.3, 1.4**

- [x] 2. Update Context Tracker
  - [x] 2.1 Update block validation logic
    - Modify `src/context-tracker/index.ts` to accept `end` for Python blocks
    - Remove special handling for `end python` as valid delimiter
    - Update `find_likely_end_position` to search for `end` not `end python`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.2 Add diagnostic for invalid `end python`/`end mata` syntax
    - Detect `end python` and `end mata` patterns
    - Emit warning diagnostic with message suggesting `end` instead
    - _Requirements: 3.4, 6.1, 6.2_

  - [x] 2.3 Update error messages for unclosed blocks
    - Change unclosed Python block message from `missing "end python"` to `missing "end"`
    - Update suggestions to recommend `end` not `end python`
    - _Requirements: 3.5, 6.3_

  - [x] 2.4 Write property test for context tracker valid block acceptance
    - **Property 4: Context Tracker Valid Block Acceptance**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 2.5 Write property test for invalid syntax diagnostic detection
    - **Property 5: Invalid Syntax Diagnostic Detection**
    - **Validates: Requirements 3.4, 6.1, 6.2**

- [x] 3. Checkpoint - Ensure lexer and context tracker tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update Completion Provider
  - [x] 4.1 Update block boundary completions
    - Modify `src/providers/completion.ts` to suggest `end` for Python blocks
    - Remove `end python` completion item
    - Update documentation string for `end` completion in Python context
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.2 Write property test for completion provider correctness
    - **Property 6: Completion Provider Correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 5. Update Hover Provider
  - [x] 5.1 Update hover documentation for `end` command
    - Modify `src/providers/hover.ts` to show correct syntax for Python blocks
    - Change documentation from `end python` to `end`
    - Update example code snippets
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.2 Write unit tests for hover provider
    - Test hover over `end` in Python context shows correct documentation
    - Test hover over `end` in Mata context shows correct documentation
    - _Requirements: 5.1, 5.2_

- [x] 6. Update Parser (if needed)
  - [x] 6.1 Verify parser handles new token values
    - Check that parser correctly handles END_PYTHON tokens with value `end`
    - Update any assertions or checks that expect `end python` value
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.2 Write property test for parser end delimiter handling
    - **Property 3: Parser End Delimiter Handling**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 7. Update Existing Tests
  - [x] 7.1 Fix failing unit tests
    - Update tests that expect `end python` behavior
    - Update test fixtures with `end python` to use `end`
    - _Requirements: All_

  - [x] 7.2 Fix failing integration tests
    - Update integration tests that use `end python`
    - Verify real file tests still pass
    - _Requirements: All_

- [x] 8. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
