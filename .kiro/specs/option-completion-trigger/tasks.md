# Implementation Plan: Option Completion Trigger

## Overview

This plan updates the test suite to align with the behavior change from commit 4bf90299. The implementation is already complete; we only need to fix the failing tests.

## Tasks

- [x] 1. Update LSP lifecycle test for trigger characters
  - Update expected trigger characters array to include `,` and ` `
  - File: `tests/integration/lsp-lifecycle.test.ts`
  - _Requirements: 1.2, 2.2, 4.1_

- [x] 2. Remove outdated unit test for empty option prefix
  - Delete the test "should return empty array for empty option prefix"
  - File: `tests/unit/completion.test.ts`
  - _Requirements: 3.1_

- [x] 3. Update property test for empty prefix completions
  - [x] 3.1 Delete the test "immediately after comma returns empty completions"
    - This test contradicts the new behavior
    - File: `tests/property/empty-prefix-completions.prop.test.ts`
    - _Requirements: 3.1_
  - [x] 3.2 Update the property test to exclude option context
    - The "empty prefix returns empty" property should not apply to option context
    - Remove the "after comma" scenario from the property test generator
    - File: `tests/property/empty-prefix-completions.prop.test.ts`
    - _Requirements: 3.1_

- [x] 4. Checkpoint - Verify all tests pass
  - Run `bun test` to ensure all tests pass
  - Ensure no regressions in other completion behavior
