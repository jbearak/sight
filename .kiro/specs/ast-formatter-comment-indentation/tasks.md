# Implementation Plan: AST Formatter Comment Indentation Fix

## Overview

This implementation fixes the AST formatter's `printLeadingTrivia` method to apply proper indentation to comments based on the current nesting depth. The fix is minimal and localized to a single method in `src/pretty-printer/index.ts`.

## Tasks

- [ ] 1. Fix printLeadingTrivia to apply indentation
  - [ ] 1.1 Modify printLeadingTrivia method in PrettyPrinter
    - Add `this.getIndent()` call before each trivia in the loop
    - Location: `src/pretty-printer/index.ts`, `printLeadingTrivia` method
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2_

  - [ ] 1.2 Write property test for leading comment indentation
    - **Property 1: Leading Comment Indentation Matches Scope Depth**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 4.1**

- [ ] 2. Verify trailing comment behavior is unchanged
  - [ ] 2.1 Add unit test confirming trailing comments remain inline
    - Test that trailing comments stay on same line with space separator
    - _Requirements: 3.1, 3.2_

  - [ ] 2.2 Write property test for trailing comment preservation
    - **Property 2: Trailing Comments Remain Inline**
    - **Validates: Requirements 3.1, 3.2**

- [ ] 3. Add cross-formatter consistency test
  - [ ] 3.1 Write property test for formatter mode consistency
    - **Property 3: Cross-Formatter Comment Indentation Consistency**
    - **Validates: Requirements 4.2**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The core fix is in task 1.1 - a single line addition
- Property tests use fast-check with minimum 100 iterations
- All formatter tests should use dual-mode helpers per project guidelines
