# Implementation Plan: Block Comment Indentation False Positive Fix

## Overview

This implementation adds block comment region tracking to the `IndentationDiagnosticAnalyzer` to prevent false positive diagnostics for lines inside block comments.

## Tasks

- [x] 1. Add block comment line computation method
  - Add `compute_block_comment_lines(lines: string[]): Set<number>` method to `IndentationDiagnosticAnalyzer`
  - Track `/*` and `*/` delimiters to identify lines inside block comments
  - Return Set of line numbers that are inside block comments
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2. Update analyze() method to use block comment tracking
  - Call `compute_block_comment_lines()` before diagnostic methods
  - Pass the Set to both `find_comment_indentation_issues()` and `find_block_indentation_issues()`
  - _Requirements: 1.1_

- [x] 3. Update find_comment_indentation_issues() to skip block comment lines
  - Add `block_comment_lines: Set<number>` parameter
  - Skip iteration when current line or next line is in block comment
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 4. Update find_block_indentation_issues() to skip block comment lines
  - Add `block_comment_lines: Set<number>` parameter
  - Skip lines that are inside block comments
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 5. Add unit test for the specific reproduction case
  - Create test with multi-line block comment where some lines don't start with `*`
  - Verify no diagnostics are produced for lines inside the block comment
  - _Requirements: 1.1, 1.3_

- [x] 6. Write property test for block comment line exclusion
  - **Property 1: Block comment line exclusion**
  - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 7. Write property test for post-block-comment diagnostic resumption
  - **Property 2: Post-block-comment diagnostic resumption**
  - **Validates: Requirements 1.4**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- The fix is localized to `src/providers/indentation-diagnostics.ts`
