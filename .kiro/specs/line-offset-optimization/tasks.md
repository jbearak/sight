# Implementation Plan: Line Offset Optimization

## Overview

This implementation creates utility functions for O(1) line/character access and migrates all `content.split('\n')` patterns in the codebase to use them. The work is organized by module, with utility functions created first.

## Tasks

- [x] 1. Create line utility functions
  - [x] 1.1 Create `src/utils/line-utils.ts` with `get_line_start_offset`, `get_line_text`, `get_char_at_position`
    - Implement O(1) lookup using line_offsets when available
    - Implement fallback computation when line_offsets unavailable
    - Add JSDoc documentation
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Write property test for graceful fallback
    - **Property 1: Graceful Fallback**
    - Generate random content, compute line_offsets, verify results match with/without line_offsets
    - **Validates: Requirements 1.2, 3.3**

  - [x] 1.3 Write property test for behavior preservation
    - **Property 2: Behavior Preservation**
    - Generate random content and positions, verify utility output matches split-based approach
    - **Validates: Requirements 1.3, 2.2, 2.3**

- [x] 2. Checkpoint - Verify utility functions
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Optimize completion provider
  - [x] 3.1 Migrate `src/providers/completion.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - Update imports
    - _Requirements: 4.1_

  - [x] 3.2 Migrate `src/providers/completion/macro-completion.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.1_

- [x] 4. Optimize hover provider
  - [x] 4.1 Migrate `src/providers/hover.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.2_

- [x] 5. Optimize definition provider
  - [x] 5.1 Migrate `src/providers/definition.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.3_

- [x] 6. Checkpoint - Verify provider migrations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Optimize diagnostics provider
  - [x] 7.1 Migrate `src/providers/diagnostics.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.4_

- [x] 8. Optimize formatter provider
  - [x] 8.1 Migrate `src/providers/formatter.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.5_

- [x] 9. Optimize directive-parser module
  - [x] 9.1 Migrate `src/directive-parser/index.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - Note: May need to pass line_offsets or compute on-demand for parent file content
    - _Requirements: 4.6_

- [x] 10. Optimize scope-resolver module
  - [x] 10.1 Migrate `src/scope-resolver/index.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.7_

- [x] 11. Checkpoint - Verify core module migrations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Optimize context-tracker module
  - [x] 12.1 Migrate `src/context-tracker/index.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.8_

- [x] 13. Optimize analyzer module
  - [x] 13.1 Migrate `src/analyzer/index.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.9_

- [x] 14. Optimize document-store module
  - [x] 14.1 Migrate `src/document-store.ts` patterns
    - Replace all `content.split('\n')` with utility functions where applicable
    - Note: Some patterns here compute line_offsets, keep those
    - _Requirements: 4.10_

- [x] 15. Optimize indexer module
  - [x] 15.1 Migrate `src/indexer/index.ts` patterns
    - Replace all `content.split('\n')` with utility functions
    - _Requirements: 4.11_

- [x] 16. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Run full test suite to verify no regressions

## Notes

- All tasks are required for comprehensive coverage
- Each migration task should be verified with existing tests before moving on
- Some modules work with raw content strings without DocumentState - these may need line_offsets computed on-demand or passed as parameter
- The comment-processor and smcl-extractor modules are intentionally excluded per Requirement 4.12
