# Implementation Plan: Indentation Diagnostics

## Overview

This plan implements information-level diagnostics for indentation issues in Stata code. The implementation adds a new `IndentationDiagnosticAnalyzer` class that integrates with the existing `DiagnosticsProvider` to detect unnecessary indentation after comments and missing indentation inside control flow blocks.

## Tasks

- [ ] 1. Add diagnostic codes and configuration types
  - [ ] 1.1 Add `UNNECESSARY_INDENTATION` (5001) and `MISSING_INDENTATION` (5002) to `StataDiagnosticCode` enum in `src/types/index.ts`
    - _Requirements: 4.1, 4.2_
  - [ ] 1.2 Add `indentation` boolean field to `diagnostics` section of `StataLSPConfig` interface
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ] 1.3 Update `DEFAULT_SETTINGS` in `src/server-handlers.ts` to set `diagnostics.indentation` to `true` by default
    - _Requirements: 3.1_

- [ ] 2. Implement IndentationDiagnosticAnalyzer
  - [ ] 2.1 Create `src/providers/indentation-diagnostics.ts` with `IndentationDiagnosticAnalyzer` class
    - Implement `analyze()` method that returns `Diagnostic[]`
    - Implement `get_line_indentation()` helper to measure indentation in spaces
    - Implement `is_continuation_line()` to detect `///` continuations
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 6.1, 6.2_
  - [ ] 2.2 Implement `find_comment_indentation_issues()` method
    - Scan for comments followed by lines with greater indentation
    - Exclude cases where comment precedes control flow block
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ] 2.3 Implement `find_block_indentation_issues()` method
    - Walk AST to find control flow blocks (if/else, foreach, forvalues, while, program)
    - Check if body lines have greater indentation than block-opening line
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ] 2.4 Implement embedded language block exclusion using `ContextTracker`
    - Skip diagnostics for lines inside Mata or Python blocks
    - _Requirements: 5.1, 5.2_
  - [ ] 2.5 Write property test for unnecessary indentation detection
    - **Property 1: Unnecessary indentation detection after comments**
    - **Validates: Requirements 1.1**
  - [ ] 2.6 Write property test for missing indentation detection
    - **Property 4: Missing indentation detection in control flow blocks**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 3. Integrate with DiagnosticsProvider
  - [ ] 3.1 Import and instantiate `IndentationDiagnosticAnalyzer` in `src/providers/diagnostics.ts`
    - Call analyzer in `get_diagnostics()` method when `config.diagnostics.indentation !== false`
    - Map analyzer output to LSP `Diagnostic` objects with correct codes
    - _Requirements: 3.2, 3.3, 4.3_
  - [ ] 3.2 Update config hash computation to include `indentation` setting
    - Ensure cache invalidation when setting changes
    - _Requirements: 3.2, 3.3_
  - [ ] 3.3 Write property test for configuration toggle
    - **Property 6: Configuration disables diagnostics**
    - **Validates: Requirements 3.2, 3.3**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Add diagnostic message formatting
  - [ ] 5.1 Implement clear diagnostic messages with formatter suggestion
    - Unnecessary: "Line appears unnecessarily indented after comment. Use Format Document to fix."
    - Missing: "Line should be indented inside {block_type} block. Use Format Document to fix."
    - _Requirements: 4.1, 4.2, 4.4_
  - [ ] 5.2 Write property test for diagnostic message content
    - **Property 7: Diagnostic message content for unnecessary indentation**
    - **Property 8: Diagnostic message content for missing indentation**
    - **Property 12: Diagnostic messages suggest using formatter**
    - **Validates: Requirements 4.1, 4.2, 4.4**
  - [ ] 5.3 Write property test for diagnostic severity
    - **Property 9: Diagnostic severity is Information**
    - **Validates: Requirements 4.3**

- [ ] 6. Handle edge cases
  - [ ] 6.1 Handle continuation lines (/// and ; delimiter mode)
    - Skip unnecessary indentation diagnostics for continuation lines
    - _Requirements: 6.1, 6.2_
  - [ ] 6.2 Handle empty blocks and single-line blocks
    - No diagnostics for blocks with no body or single-line blocks
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 6.3 Write property test for embedded language exclusion
    - **Property 11: Embedded language block exclusion**
    - **Validates: Requirements 5.1, 5.2**
  - [ ] 6.4 Write property test for continuation line exclusion
    - **Property 12: Continuation line exclusion**
    - **Validates: Requirements 6.1, 6.2**

- [ ] 7. Update configuration mapping
  - [ ] 7.1 Update `map_stata_lsp_json_to_partial_config()` in `src/utils/workspace-config.ts`
    - Map `diagnostics.indentation` from `.sight.json` to internal config
    - _Requirements: 3.2, 3.3_

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Update documentation
  - [ ] 9.1 Update README.md to document the indentation diagnostics feature
    - Describe the feature purpose and detected issues
    - Document the `diagnostics.indentation` configuration option
    - Provide examples of detected indentation issues
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
