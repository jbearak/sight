# Implementation Plan: Alignment Preservation During Indent Correction

## Overview

This implementation modifies the existing formatter pipeline to apply indentation deltas to continuation lines while preserving their internal alignment relationships. The key change is moving from a binary "preserve whitespace" approach to a delta-based adjustment approach.

## Tasks

- [x] 1. Extend IndentationInfo to track indentation delta
  - [x] 1.1 Add `indent_delta` and `original_indent` fields to `IndentationInfo` interface
    - Modify `src/formatter/indentation-analyzer.ts`
    - Add `indent_delta: number` field (positive = add spaces, negative = remove)
    - Add `original_indent: number` field (original indentation in spaces)
    - Update `set_indentation()` to accept and store these values
    - _Requirements: 1.1, 2.1_

  - [x] 1.2 Modify `IndentationAnalyzer.analyze()` to accept original source
    - Add `original_source?: string` parameter
    - Store reference for delta calculation
    - _Requirements: 1.1_

  - [x] 1.3 Implement `calculate_indent_delta()` helper method
    - Extract original indentation from source line
    - Calculate target indentation from indent level and config
    - Return delta (target - original)
    - _Requirements: 2.1, 2.2_

- [x] 2. Modify IndentationAnalyzer to calculate deltas for all lines
  - [x] 2.1 Calculate delta for regular statement lines
    - In `process_regular_node()`, calculate delta using original source
    - Store delta in `IndentationInfo`
    - _Requirements: 1.1, 2.1_

  - [x] 2.2 Calculate delta for block start/end lines
    - In `process_block_node()`, calculate delta for block markers
    - _Requirements: 3.1, 3.2_

  - [x] 2.3 Propagate delta to continuation lines
    - In `process_continuations()`, use base statement's delta for continuation lines
    - Store the same delta for all lines in a continuation group
    - _Requirements: 1.4, 2.1, 2.2_

- [x] 3. Extend ContinuationGroup to track base delta
  - [x] 3.1 Add `base_delta` field to `ContinuationGroup` interface
    - Modify `src/formatter/alignment-detector.ts`
    - Add `base_delta: number` field
    - _Requirements: 1.4_

  - [x] 3.2 Populate `base_delta` during alignment detection
    - Pass indentation info to `AlignmentDetector.analyze()`
    - Or calculate delta within alignment detector using original source
    - _Requirements: 1.2, 1.4_

- [x] 4. Modify TokenReconstructor to apply deltas
  - [x] 4.1 Implement `apply_indent_delta()` helper method
    - Handle positive delta (prepend spaces)
    - Handle negative delta (remove leading spaces with bounds checking)
    - Preserve tabs/spaces based on config
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 4.2 Modify `reconstruct()` to use delta for aligned lines
    - When `preserve_whitespace` is true AND `indent_delta` is non-zero:
      - Get original whitespace
      - Apply delta using `apply_indent_delta()`
      - Use adjusted whitespace instead of original
    - _Requirements: 1.2, 1.3_

  - [x] 4.3 Handle edge case: insufficient whitespace for negative delta
    - When removing more spaces than available, remove only available spaces
    - Log debug warning
    - _Requirements: 2.4, 6.2_

- [x] 5. Update SourcePreservingFormatter to pass original source
  - [x] 5.1 Pass `original_source` to `IndentationAnalyzer.analyze()`
    - Modify `format()` method in `src/formatter/source-preserving-formatter.ts`
    - _Requirements: 1.1_

  - [x] 5.2 Ensure alignment info and indentation info are coordinated
    - Both need access to original source for delta calculation
    - Consider passing delta info from indentation analyzer to alignment detector
    - _Requirements: 1.2_

- [x] 6. Checkpoint - Ensure basic delta application works
  - All core property tests (1, 2, 3, 5) and unit tests pass

- [x] 7. Write property tests for core functionality
  - [x] 7.1 Write property test for alignment preservation with indentation correction
    - **Property 1: Alignment Preservation with Indentation Correction**
    - Generate code with aligned continuations and incorrect base indentation
    - Verify relative column positions are preserved after formatting
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 7.2 Write property test for indentation delta application
    - **Property 2: Indentation Delta Application**
    - Generate code with known incorrect indentation
    - Verify all continuation lines receive the same delta
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 7.3 Write property test for nested block indentation correction
    - **Property 3: Nested Block Indentation Correction**
    - Generate deeply nested code with incorrect indentation
    - Verify cumulative deltas are correctly applied
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [ ] 8. Write property tests for alignment types and idempotency
  - [ ] 8.1 Write property test for alignment type preservation
    - **Property 4: Alignment Type Preservation**
    - Generate code with operator, condition, and expression alignment
    - Verify each type is preserved correctly
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x] 8.2 Write property test for idempotency
    - **Property 5: Idempotency**
    - Generate random code with continuation lines
    - Verify format(format(code)) == format(code)
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ] 8.3 Write property test for mixed alignment handling
    - **Property 6: Mixed Alignment Handling**
    - Generate files with multiple statements having different alignment patterns
    - Verify each statement is handled independently
    - **Validates: Requirements 6.3**

- [x] 9. Write unit tests for specific scenarios
  - [x] 9.1 Write unit test for basic positive delta application
    - Test case: statement missing one indent level with aligned continuation
    - Verify +4 spaces applied to both base and continuation lines
    - _Requirements: 1.2, 2.1_

  - [x] 9.2 Write unit test for negative delta application
    - Test case: over-indented statement with aligned continuation
    - Verify spaces removed from both base and continuation lines
    - _Requirements: 2.3_

  - [x] 9.3 Write unit test for nested block correction
    - Test case: multiple nesting levels with incorrect indentation
    - Verify cumulative delta applied correctly
    - _Requirements: 3.1, 3.2_

  - [x] 9.4 Write unit test for edge case: no leading whitespace
    - Test case: continuation line starts at column 0
    - Verify spaces added correctly
    - _Requirements: 6.1_

  - [ ] 9.5 Write unit test for edge case: insufficient whitespace
    - Test case: continuation line has fewer spaces than delta requires
    - Verify graceful handling
    - _Requirements: 6.2_

- [x] 10. Checkpoint - Ensure all tests pass
  - All implemented tests pass

- [ ] 11. Update tests to use dual-mode testing
  - [ ] 11.1 Refactor existing tests to use `for_each_formatter_mode_async_property`
    - Use helpers from `tests/property/helpers/formatter-test-utils.ts`
    - Run all property tests against both source-preserving and AST formatters
    - _Requirements: All (applies to both formatters)_

  - [ ] 11.2 Add mode-specific assertions where behavior differs
    - AST formatter may not preserve alignment in the same way
    - Document any legitimate behavioral differences
    - _Requirements: 1.2_

- [ ] 12. Final checkpoint - All tests pass for both formatters
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks 1-7 and 9.1-9.4 are complete - core delta-based alignment preservation is implemented
- Property tests 4 and 6 (alignment types and mixed alignment) still need implementation
- Unit test 9.5 (insufficient whitespace edge case) needs implementation
- Tests currently only run against source-preserving formatter; dual-mode testing needed
- The AST formatter (PrettyPrinter) rebuilds code from scratch and doesn't use the delta-based approach - it may need different handling or the tests may need mode-specific assertions
- All formatter tests should run against both formatter implementations using dual-mode test helpers

