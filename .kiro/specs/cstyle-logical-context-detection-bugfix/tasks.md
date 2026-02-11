# Implementation Plan: C-Style Logical Context Detection Bugfix

## Overview

This bugfix corrects the context detection order in `OperatorSequenceAnalyzer.find_context_in_nodes()` to properly classify C-style logical operators in if qualifiers inside control flow bodies. The fix reorders the logic to check the body first before checking the condition.

## Tasks

- [x] 1. Fix context detection order in find_context_in_nodes
  - [x] 1.1 Reorder the if/else control flow node handling logic
    - Move the body check before the condition check
    - Ensure body context is returned if non-'other'
    - Only return 'control_flow' if body check returns 'other' and condition exists
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write unit test for reproduction case
    - Test `if (1 && 1) { gen x = y if 1 && 2 }` scenario
    - Verify line 1 gets code 6003 (Information)
    - Verify line 2 gets code 6002 (Error)
    - _Requirements: 2.1, 2.2_

- [x] 2. Add property tests for context detection
  - [x] 2.1 Write property test for if qualifier context detection
    - **Property 1: If qualifier context detection emits Error diagnostic**
    - Generate control flow structures with if qualifiers containing C-style logical operators
    - Verify Error diagnostic with code 6002
    - **Validates: Requirements 1.1, 2.1, 3.1**

  - [x] 2.2 Write property test for control flow context detection
    - **Property 2: Control flow context detection emits Information diagnostic**
    - Generate if/else if statements with C-style logical operators in conditions
    - Verify Information diagnostic with code 6003
    - **Validates: Requirements 1.2, 2.2, 3.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Run existing operator-sequence-diagnostics tests to verify no regressions

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The fix is a simple logic reordering in a single method
- Existing tests should continue to pass after the fix
