# Implementation Plan: Cross-File Forward Reference Fix

## Overview

This implementation modifies the `DiagnosticsProvider` to preserve forward reference warnings for same-file symbols while still suppressing warnings for cross-file symbols. The fix is localized to a single method with minimal changes.

## Tasks

- [-] 1. Modify is_symbol_defined_in_scope method
  - [x] 1.1 Add current_document_uri parameter to is_symbol_defined_in_scope
    - Update method signature to accept document URI
    - Update all call sites to pass document.uri
    - _Requirements: 1.3, 2.3_

  - [x] 1.2 Implement sourceUri comparison logic
    - Look up symbol in appropriate map
    - Compare symbol's sourceUri against current_document_uri
    - Return true only if symbol exists AND sourceUri differs from current document
    - Handle edge case where sourceUri is undefined (treat as same-file)
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [-] 1.3 Write property test for forward reference preservation
    - **Property 1: Forward references to same-file symbols produce warnings with cross-file directives**
    - **Validates: Requirements 1.1**

- [ ] 1.4 Write property test for non-forward reference suppression
    - **Property 2: Non-forward references to same-file symbols do not produce warnings**
    - **Validates: Requirements 1.2**

- [ ] 1.5 Write property test for cross-file symbol suppression
    - **Property 3: Cross-file symbols suppress undefined macro warnings**
    - **Validates: Requirements 2.1, 2.2**

- [ ] 1.6 Write property test for string literal macro detection
    - **Property 4: Undefined macros in string literals produce warnings**
    - **Validates: Requirements 3.1, 3.2**

- [ ] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Add integration test for the specific bug scenario
  - [ ] 3.1 Create integration test with apple.do and orange.do scenario
    - Create test files matching the user's reported scenario
    - Verify first `di `apple'` produces warning (forward reference)
    - Verify second `di `apple'` does not produce warning
    - Verify `di `orange'` does not produce warning (cross-file)
    - _Requirements: 1.1, 1.2, 2.1_

  - [ ] 3.2 Create integration test for string literal macro detection
    - Create berry.do test file: `di "`apple'"`
    - Verify undefined macro warning is produced for `apple` within string
    - Compare with non-string version: `di `apple'`
    - _Requirements: 3.1, 3.2_

- [ ] 4. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive validation
- Each task references specific requirements for traceability
- The fix is minimal and localized to avoid regressions
- Property tests validate universal correctness properties
- Integration test validates the specific reported bug scenario
