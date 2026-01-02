# Implementation Plan: Command Database Cleanup

## Overview

This plan removes dead code from the command database system by deleting unused files and updating dependencies. The cleanup is ordered to avoid intermediate compilation errors.

## Tasks

- [x] 1. Update test files to remove dependencies on elaborate types
  - [x] 1.1 Update `tests/property/abbreviation-minimum-uniqueness.prop.test.ts`
    - Replace `CommandMetadata` imports with `CommandInfo` from `types.ts`
    - Simplify generators to use minimal type fields
    - _Requirements: 5.1, 5.3_
  - [x] 1.2 Update `tests/property/cache-serialization-roundtrip.prop.test.ts`
    - Remove or rewrite tests that depend on `cache-schema.ts` types
    - Update to test minimal `CommandCache` serialization
    - _Requirements: 5.1, 5.2_
  - [x] 1.3 Update `tests/property/command-database-cache.prop.test.ts`
    - Replace `CommandMetadata` with `CommandInfo`
    - Remove `AbbreviationDict` usage, use simple `Record<string, string>`
    - _Requirements: 5.1, 5.3_
  - [x] 1.4 Update `tests/property/command-database-lookup.prop.test.ts`
    - Replace `CommandMetadata` with `CommandInfo`
    - Remove version-related test logic
    - _Requirements: 5.1, 5.3_
  - [x] 1.5 Update `tests/unit/command-metadata-system.test.ts`
    - Remove imports from `cache-schema.ts`
    - Update test data to use `CommandInfo` structure
    - Remove tests for `serialize_abbreviation_dict`/`deserialize_abbreviation_dict`
    - _Requirements: 5.2, 5.3_
  - [x] 1.6 Update `tests/integration/lsp-providers-command-db.test.ts`
    - Replace `CommandMetadata` with `CommandInfo`
    - Remove version filtering tests
    - _Requirements: 5.1, 5.3_

- [x] 2. Checkpoint - Verify tests compile
  - Run `bun run build` and `bun test` to ensure tests still work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Update `src/command-database/index.ts`
  - [x] 3.1 Remove `CommandMetadata` export
    - Delete line: `export type { CommandMetadata } from './cache-schema';`
    - _Requirements: 1.2, 4.3_
  - [x] 3.2 Remove `is_available_in_version()` method
    - Delete the method that ignores the version parameter
    - _Requirements: 4.1_

- [x] 4. Delete dead code files
  - [x] 4.1 Delete `src/command-database/cache-schema.ts`
    - _Requirements: 1.1_
  - [x] 4.2 Delete `src/command-database/abbreviation-builder.ts`
    - _Requirements: 3.3_
  - [x] 4.3 Delete `src/command-database/abbreviation-resolver.ts`
    - _Requirements: 3.3_
  - [x] 4.4 Delete `src/command-database/version-detector.ts`
    - _Requirements: 4.2_
  - [x] 4.5 Delete `scripts/generate-command-cache.ts`
    - _Requirements: 2.1_

- [x] 5. Checkpoint - Verify compilation
  - Run `tsc --noEmit` to verify no TypeScript errors
  - Run `bun test` to verify all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write property test for command lookup preservation
  - **Property 1: Command Lookup Preservation**
  - **Validates: Requirements 6.1**
  - Test that for any command in the cache, lookup returns correct data

- [x] 7. Write property test for abbreviation expansion preservation
  - **Property 2: Abbreviation Expansion Preservation**
  - **Validates: Requirements 3.4, 6.2**
  - Test that for any abbreviation in the cache, expansion returns correct command

- [x] 8. Update documentation
  - [x] 8.1 Update `src/command-database/README.md`
    - Remove references to elaborate schema
    - Document the minimal type system
    - Point to `generate-cache.ts` as the sole generator
    - _Requirements: 2.3_

- [x] 9. Final checkpoint - Verify everything works
  - Run full test suite: `bun test`
  - Verify LSP starts and loads cache correctly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The deletion order in task 4 is important to avoid intermediate errors
- Property tests validate that cleanup doesn't break existing functionality
- All tasks are required for comprehensive testing
