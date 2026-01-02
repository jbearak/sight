# Implementation Plan: Macro Test Scenarios

## Overview

Add specific unit tests to verify macro completion and undefined macro diagnostic behavior.

## Tasks

- [x] 1. Add macro completion test scenarios
  - [x] 1.1 Add test: suggest apple when typing \`a after local apple sauce
    - Add to `tests/unit/completion.test.ts`
    - _Requirements: 1.1_
  - [x] 1.2 Add test: suggest apple when typing \`A (case-insensitive)
    - Verify case-insensitive prefix matching
    - _Requirements: 1.2_
  - [x] 1.3 Add test: suggest both apple and apricot when typing \`ap
    - Verify multiple matches returned
    - _Requirements: 1.3_

- [x] 2. Add undefined macro diagnostic test scenarios
  - [x] 2.1 Add test: warn when referencing Apple but only apple is defined
    - Add to `tests/unit/diagnostics-provider.test.ts`
    - _Requirements: 2.1_
  - [x] 2.2 Add test: NOT warn when referencing apple with correct case
    - Verify no false positive
    - _Requirements: 2.2_
  - [x] 2.3 Add test: warn when referencing completely undefined macro
    - Verify basic undefined macro detection
    - _Requirements: 2.3_
  - [x] 2.4 Add test: diagnostic message includes macro name as written
    - Verify message contains the reference text
    - _Requirements: 2.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Run `bun test` and verify all new tests pass
  - Ensure existing tests still pass

## Notes

- These are example-based unit tests that complement property-based tests
- Tests should be added to existing describe blocks where appropriate
- Use existing test helpers like `create_test_document()`
