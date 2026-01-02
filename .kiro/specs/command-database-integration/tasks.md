# Implementation Plan: Command Database Integration

## Overview

This plan completes the command database integration by fixing TypeScript errors, enhancing the cache generator with parallel processing and monotonicity checks, and adding validation tests.

## Tasks

- [x] 1. Fix TypeScript compilation errors
  - [x] 1.1 Remove non-standard onDidSave handler from server.ts
    - Remove the `connection.onDidSave` handler (lines ~417-421)
    - Remove the `create_did_save_handler` import if no longer used
    - _Requirements: 3.1, 3.2_
  - [x] 1.2 Remove saveOptions from server capabilities
    - Remove `saveOptions` from the capabilities object in server-handlers.ts
    - _Requirements: 3.1, 3.3_
  - [x] 1.3 Verify TypeScript compiles without errors
    - Run `bun run tsc --noEmit` and verify exit code 0
    - _Requirements: 3.1_

- [x] 2. Enhance cache generator with parallel processing
  - [x] 2.1 Update generate-cache.ts with batch parallel processing
    - Process files in batches of 100 using Promise.all
    - Read only first 1KB of each file for efficiency
    - _Requirements: 1.1_
  - [x] 2.2 Add monotonicity check to generator
    - Compare new command count to existing cache before writing
    - Fail if new count < existing count (unless --force)
    - Report command count difference on success
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 3. Regenerate full command cache
  - [x] 3.1 Run cache generator without command limit
    - Execute: `bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json`
    - Verify cache contains thousands of commands (not 50)
    - Cache now contains 2854 commands
    - _Requirements: 1.1, 1.3_

- [x] 4. Add legacy superset validation test
  - [x] 4.1 Create validation test file
    - Create `tests/integration/command-database-superset.test.ts`
    - Load legacy database commands
    - Load new database commands
    - Verify every legacy command exists in new database
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 4.2 Write property test for superset validation
    - **Property 1: Legacy Database Superset**
    - **Validates: Requirements 1.2, 2.1**

- [x] 5. Verify provider integration
  - [x] 5.1 Verify completion provider imports
    - Check that completion.ts imports from `../command-database`
    - _Requirements: 4.1_
  - [x] 5.2 Verify hover provider imports
    - Check that hover.ts imports from `../command-database`
    - _Requirements: 4.2_
  - [x] 5.3 Verify server imports
    - Check that server.ts imports from `./command-database`
    - Check that server.ts does NOT import from `./commands`
    - _Requirements: 4.3, 4.4_
  - [x] 5.4 Add import verification test
    - Create test that greps source files for correct imports
    - Fail if any non-test file imports from legacy `./commands`
    - Created `tests/integration/import-verification.test.ts`
    - _Requirements: 4.4_

- [x] 6. Ensure build copies cache files
  - [x] 6.1 Verify package.json build script copies caches
    - Check that build script includes cache copy step
    - Build script: `tsc && cp -r src/command-database/caches dist/command-database/`
    - _Requirements: 5.3_
  - [x] 6.2 Test build process
    - Run `bun run build` (or just tsc + copy)
    - Verify `dist/command-database/caches/v18.json` exists
    - _Requirements: 5.3_

- [x] 7. Checkpoint - Verify all tests pass
  - Run `bun test` and ensure all tests pass
  - Verify TypeScript compiles without errors
  - Verify cache has thousands of commands (2854 commands confirmed)

- [x] 8. Add monotonicity property test
  - [x] 8.1 Write property test for cache monotonicity
    - **Property 2: Cache Monotonicity**
    - **Validates: Requirements 6.2**

## Notes

- The cache generator requires a Stata installation to discover help files
- If Stata is not installed, task 3.1 may need to use a pre-generated cache
- Property tests validate correctness properties from the design document
- All integration tests pass (13 tests across 3 files)
- Cache contains 2854 commands and 6571 abbreviations
