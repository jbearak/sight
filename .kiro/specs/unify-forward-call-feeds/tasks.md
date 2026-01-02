# Implementation Plan: Unify Forward-Call Feeds

## Overview

This implementation plan refactors the forward-call symbol feeds to eliminate redundant computation. The primary change is to skip handler-computed `forward_scope` when `scope_resolver` is available, using `resolved_scope.forward_call_symbols` as the single source.

## Tasks

- [ ] 1. Update handler logic to skip forward_scope computation when scope_resolver is available
  - [ ] 1.1 Modify server-factory.ts to conditionally compute forward_scope
    - Add condition: `if (!scope_resolver && forward_scope_resolver && ...)`
    - Only compute forward_scope when scope_resolver is NOT available
    - _Requirements: 1.1, 1.4_
  - [ ] 1.2 Modify server-handlers.ts to conditionally compute forward_scope
    - Same pattern as server-factory.ts
    - _Requirements: 1.1, 1.4_

- [ ] 2. Update DiagnosticsProvider to use single source
  - [ ] 2.1 Refactor get_diagnostics to use single forward-call source
    - Use `resolved_scope?.forward_call_symbols ?? forward_scope?.call_sites`
    - Remove duplicate checking logic
    - _Requirements: 1.2, 2.1_
  - [ ] 2.2 Ensure fallback path works correctly
    - When scope_resolver is null, use forward_scope.call_sites
    - _Requirements: 2.1, 2.3_

- [ ] 3. Checkpoint - Verify basic functionality
  - Ensure all existing tests pass
  - Manually verify diagnostics work in VS Code
  - Ask the user if questions arise

- [ ] 4. Add property-based tests for the refactoring
  - [ ] 4.1 Write property test for handler skipping forward_scope computation
    - **Property 1: Handler Skips Forward-Scope Computation When Scope-Resolver Available**
    - **Validates: Requirements 1.1, 1.4**
  - [ ] 4.2 Write property test for fallback path equivalence
    - **Property 2: Fallback Path Equivalence**
    - **Validates: Requirements 1.3, 2.1, 2.3**
  - [ ] 4.3 Write property test for position-aware symbol visibility
    - **Property 3: Position-Aware Symbol Visibility**
    - **Validates: Requirements 3.4, 5.1, 5.2, 5.3**
  - [ ] 4.4 Write property test for effective type filtering
    - **Property 4: Effective Type Filtering**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 5. Add unit tests for edge configurations
  - [ ] 5.1 Write unit test for scope_resolver null (fallback path)
    - Test that forward_scope is computed and used when scope_resolver is null
    - _Requirements: 7.1_
  - [ ] 5.2 Write unit test for scope_resolver available (primary path)
    - Test that forward_scope is NOT computed when scope_resolver is available
    - _Requirements: 7.2, 7.3_
  - [ ] 5.3 Write unit test for duplicate directive/command scenarios
    - Test same file referenced by both @lsp-do and auto-detected do command
    - _Requirements: 7.7_

- [ ] 6. Final checkpoint - Ensure all tests pass
  - Run full test suite
  - Verify no regressions
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive coverage
- The core refactoring is in tasks 1-2
- Property tests (task 4) validate the correctness properties from the design
- Unit tests (task 5) cover edge configurations
- Checkpoints ensure incremental validation
