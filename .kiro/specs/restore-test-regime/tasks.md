# Implementation Plan: Restore Test Regime

## Overview

This plan restores tests that were removed or altered during embedded language detection development, fixes skipped tests, and resolves test infrastructure issues.

## Tasks

- [x] 1. Restore parser error handling tests
  - [x] 1.1 Add error handling describe block to parser.test.ts
    - Add test for missing program `end` statement
    - Add test for missing closing brace in if blocks
    - Verify parser returns non-empty errors array with descriptive messages
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Fix TypeScript type errors in integration tests
  - [x] 2.1 Fix DEFAULT_CONFIG literal types in embedded-language-lsp.test.ts
    - Change severity values to use `as const` assertions
    - Ensure StataLSPConfig type compatibility
    - _Requirements: 4.1, 4.2_
  - [x] 2.2 Remove unused imports from embedded-language-lsp.test.ts
    - Remove `afterAll` import
    - Remove `ContextTracker` import
    - Remove `URI` import
    - Remove `Position` import
    - Remove unused `definition_provider` variable or add usage
    - _Requirements: 4.3_

- [x] 3. Fix or enable skipped document symbol tests
  - [x] 3.1 Investigate document symbol functionality for embedded blocks
    - Check if SymbolProvider supports embedded blocks
    - Determine if tests should be enabled or removed
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 3.2 Enable tests or add TODO documentation
    - If functionality works: remove `.skip` from tests
    - If functionality incomplete: add TODO comment and keep skipped
    - _Requirements: 2.3, 2.4_

- [x] 4. Fix test infrastructure issues
  - [x] 4.1 Investigate unhandled error in test suite
    - Identify source of "Connection input stream is not set" error
    - Determine if server.ts is being imported incorrectly
    - _Requirements: 3.1, 3.2_
  - [x] 4.2 Fix or isolate the problematic import
    - Add proper mocking for LSP connection if needed
    - Ensure tests don't trigger real server initialization
    - _Requirements: 3.3, 3.4_

- [x] 5. Checkpoint - Verify all tests pass
  - Run `bun test` and verify 0 failures, 0 errors
  - Ensure no skipped tests without documentation
  - _Requirements: 3.3_

## Notes

- The error handling tests were removed in commit b97b5c4 when embedded language block tests were added
- The skipped tests have comments indicating functionality may not be fully implemented
- The unhandled error appears to be from server.ts being imported during test discovery
