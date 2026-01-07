# Implementation Plan: PR Feedback Fixes

## Overview

This implementation plan addresses critical bugs and semantic issues identified in PR feedback by fixing the broken `apply_edits` function, consolidating duplicate test utilities, correcting frame prefix parsing semantics, and fixing code style violations.

## Tasks

- [x] 1. Create shared test utilities
  - Create `tests/property/helpers/text-edit-utils.ts` with correct `apply_edits` implementation
  - Create shared `find_command_nodes` function in the same file
  - Export utilities from `tests/property/helpers/index.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 4.1_

- [x] 1.1 Write property test for multi-edit application
  - **Property 1: Multi-edit application correctness**
  - **Validates: Requirements 1.1, 1.3, 1.4**

- [x] 1.2 Write unit tests for apply_edits edge cases
  - Test zero edits, single edit, and multiple edit scenarios
  - Test invalid ranges and out-of-bounds cases
  - _Requirements: 1.2, 1.5_

- [x] 2. Update PrefixNode type definition
  - Add optional `frameName?: string` field to PrefixNode interface
  - Update type exports and documentation
  - _Requirements: 3.4_

- [x] 3. Fix frame prefix parsing logic
  - Update frame prefix parsing to use `frameName` field instead of `varlist`
  - Ensure `varlist` remains undefined for frame prefixes
  - Update `parseFramePrefixedCommand` method to read from `frameName`
  - _Requirements: 3.1, 3.2, 3.5_

- [x] 3.1 Write property test for frame prefix parsing
  - **Property 2: Frame prefix parsing semantics**
  - **Validates: Requirements 3.1, 3.2**

- [x] 3.2 Write property test for by-prefix preservation
  - **Property 3: By-prefix parsing preservation**
  - **Validates: Requirements 3.3, 3.5**

- [x] 4. Update test files to use shared utilities
  - Replace duplicate `apply_edits` in `ast-formatter-prefix-command-spacing.prop.test.ts`
  - Replace duplicate `apply_edits` in `pretty-printer-frame-block-deletion.prop.test.ts`
  - Replace duplicate `find_command_nodes` in `wildcard-operator-handling.prop.test.ts`
  - Replace duplicate `find_command_nodes` in `unab-colon-field.prop.test.ts`
  - Update imports to use shared utilities
  - _Requirements: 2.2, 2.3, 4.2, 4.3_

- [x] 4.1 Write property test for shared utility consistency
  - **Property 4: Shared utility consistency**
  - **Validates: Requirements 4.4**

- [x] 4.2 Write integration tests for backward compatibility
  - Verify existing tests continue to work with shared utilities
  - _Requirements: 2.4_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Fix code style violations
  - Rename `startToken` to `start_token` in parser functions
  - Rename `commandToken` to `command_token` in parser functions  
  - Rename `macroNameToken` to `macro_name_token` and similar variables
  - Fix line length violations (lines 1052, 1074 in parser)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The shared utilities approach eliminates code duplication and ensures consistency