# Implementation Plan: Block Start Indentation Diagnostic

## Overview

This implementation enhances the `IndentationDiagnosticAnalyzer` to detect unnecessary indentation at any depth level and ensures the `SourcePreservingFormatter` correctly normalizes mixed indentation. The approach reuses existing AST-based depth computation from `IndentationAnalyzer`.

## Tasks

- [-] 1. Enhance IndentationDiagnosticAnalyzer with depth-based analysis
  - [ ] 1.1 Add `compute_expected_depths()` method to compute expected indentation depth for each line using AST traversal
    - Reuse logic from `IndentationAnalyzer.analyze()` to walk AST and track depth
    - Return `Map<number, number>` mapping line numbers to expected depths
    - Handle control flow blocks: `if`, `foreach`, `forvalues`, `while`, `program`, `mata`, `python`, `frame`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

  - [ ] 1.2 Add `should_skip_unnecessary_check()` method to identify excluded lines
    - Skip blank lines (empty or whitespace-only)
    - Skip comment-only lines (`*` or `//` at start after trimming)
    - Skip continuation lines (previous line ends with `///`)
    - Skip lines inside block comments (use existing `compute_block_comment_lines()`)
    - _Requirements: 2.3, 2.4_

  - [ ] 1.3 Add `find_unnecessary_indentation_issues()` method for over-indentation detection
    - For each non-excluded line, compare actual indentation to expected depth × indent_size
    - Emit `UNNECESSARY_INDENTATION` diagnostic when actual > expected
    - Include top-level (depth 0) lines with any leading whitespace
    - _Requirements: 1.1, 2.1, 2.2_

  - [ ] 1.4 Update `analyze()` to call new methods and combine diagnostics
    - Call `compute_expected_depths()` for each Stata range
    - Call `find_unnecessary_indentation_issues()` alongside existing `find_block_indentation_issues()`
    - Merge diagnostics from both sources
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_

- [ ] 1.5 Write property test for top-level unnecessary indentation detection
  - **Property 1: Top-level unnecessary indentation detection**
  - **Validates: Requirements 1.1, 2.1**

- [ ] 1.6 Write property test for correct indentation producing no diagnostic
  - **Property 2: Correct indentation produces no unnecessary diagnostic**
  - **Validates: Requirements 1.2**

- [ ] 1.7 Write property test for excluded lines
  - **Property 5: Excluded lines produce no unnecessary diagnostic**
  - **Validates: Requirements 2.3, 2.4**

- [ ] 2. Checkpoint - Verify diagnostic detection
  - Ensure all diagnostic tests pass, ask the user if questions arise.

- [ ] 3. Enhance formatter for mixed indentation normalization
  - [ ] 3.1 Review `TokenReconstructor.reconstruct()` to ensure mixed indentation is fully replaced
    - At line start, generate fresh indentation from computed indent level
    - Do not preserve original whitespace characters when applying indentation
    - Ensure space+tab combinations are normalized to configured style
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 3.2 Verify `make_indent()` generates correct indentation for both styles
    - Spaces mode: `' '.repeat(level * indent_size)`
    - Tabs mode: `'\t'.repeat(level)`
    - _Requirements: 3.2, 3.3_

- [ ] 3.3 Write property test for formatter indentation normalization
  - **Property 6: Formatter normalizes indentation to configured style**
  - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ] 3.4 Write property test for content preservation
  - **Property 7: Formatter preserves non-whitespace content**
  - **Validates: Requirements 3.4**

- [ ] 4. Checkpoint - Verify formatter behavior
  - Ensure all formatter tests pass, ask the user if questions arise.

- [ ] 5. Integration and round-trip verification
  - [ ] 5.1 Add integration test verifying diagnostic-formatter consistency
    - Generate code with indentation issues
    - Verify diagnostics are emitted
    - Format the code
    - Verify diagnostics are resolved
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 5.2 Write property test for round-trip elimination of diagnostics
  - **Property 8: Formatting eliminates all indentation diagnostics**
  - **Validates: Requirements 4.1, 4.2, 4.3**

- [ ] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation reuses existing `IndentationAnalyzer` logic to ensure consistency between diagnostics and formatter
