# Implementation Plan: Continuation Line Comment Detection Fix

## Overview

This implementation fixes the false positive indentation diagnostic for continuation lines with trailing comments by using token-based detection instead of string manipulation.

## Tasks

- [x] 1. Add `compute_continuation_lines` method
  - Add new private method to `IndentationDiagnosticAnalyzer`
  - Scan tokens for `CONTINUATION` type and collect line numbers + 1
  - Return `Set<number>` for O(1) lookup
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Update `analyze` method to compute continuation lines
  - Call `compute_continuation_lines(document.tokens)` at start of analysis
  - Pass the set to methods that need it
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Update `should_skip_unnecessary_check` method
  - Add `continuation_lines: Set<number>` parameter
  - Replace string-based check with `continuation_lines.has(lineIndex)`
  - Remove the old `endsWith('///')` logic
  - _Requirements: 2.1, 2.2_

- [x] 4. Update `find_unnecessary_indentation_issues` method
  - Add `continuation_lines: Set<number>` parameter
  - Pass it to `should_skip_unnecessary_check`
  - _Requirements: 2.1, 2.2_

- [x] 5. Update `get_statement_indentation` method
  - Add `continuation_lines: Set<number>` parameter
  - Replace string-based check with `continuation_lines.has(current_index)`
  - _Requirements: 3.1, 3.2_

- [x] 6. Update `find_block_indentation_issues` method
  - Add `continuation_lines: Set<number>` parameter
  - Pass it to helper methods
  - Update `is_continuation_line` calls
  - _Requirements: 3.1, 3.2_

- [x] 7. Update `is_continuation_line` method
  - Change signature to use set lookup instead of string manipulation
  - Or remove if no longer needed
  - _Requirements: 1.1, 1.2_

- [x] 8. Checkpoint - Verify regression test passes
  - Run `bun test tests/repro_continuation_false_positive.test.ts`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Write property test for continuation line recognition
  - **Property 1: Continuation Line Recognition**
  - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 10. Write property test for no unnecessary indentation diagnostic
  - **Property 2: No Unnecessary Indentation Diagnostic for Continuation Lines**
  - **Validates: Requirements 2.1, 2.2**

- [x] 11. Write property test for trace-back through continuations
  - **Property 3: Trace-Back Through Continuations**
  - **Validates: Requirements 3.1, 3.2**

- [x] 12. Final checkpoint - Run full test suite
  - Run `bun test` to ensure no regressions
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
