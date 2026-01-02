# Implementation Plan: Rename Variable Registration

## Overview

This plan implements support for the `rename` command to register new variable names in the symbol table. The implementation follows the existing pattern for variable-creating commands (`gen`, `egen`, `input`) and adds property-based tests to verify correctness.

## Tasks

- [x] 1. Update VariableSymbol type to include 'rename' source
  - Modify `src/types/index.ts` to add `'rename'` to the source union type
  - _Requirements: 3.1_

- [x] 2. Implement rename variable extraction in analyzer
  - [x] 2.1 Add `contains_wildcard` helper method
    - Add private method to check if a name contains `*` or `?`
    - _Requirements: 2.2, 2.3_
  - [x] 2.2 Add `extract_rename_variables` method
    - Handle simple syntax: `rename oldvar newvar`
    - Handle abbreviated form: `ren oldvar newvar`
    - Skip wildcards and incomplete commands
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.3 Add `extract_grouped_rename_variables` method
    - Parse grouped syntax: `rename (old1 old2) (new1 new2)`
    - Register all new variable names from second group
    - _Requirements: 2.1_
  - [x] 2.4 Wire up rename handling in `process_command`
    - Add condition for `rename` and `ren` commands
    - Call `extract_rename_variables`
    - _Requirements: 1.1, 1.2_

- [x] 3. Checkpoint - Verify basic functionality
  - Ensure TypeScript compiles without errors
  - Run existing tests to verify no regressions

- [x] 4. Add property-based tests
  - [x] 4.1 Write property test for simple rename registration
    - **Property 1: Simple Rename Variable Registration**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
  - [x] 4.2 Write property test for grouped rename registration
    - **Property 2: Grouped Rename Variable Registration**
    - **Validates: Requirements 2.1**
  - [x] 4.3 Write property test for wildcard non-registration
    - **Property 3: Wildcard Rename Non-Registration**
    - **Validates: Requirements 2.2, 2.3**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- The implementation follows the existing pattern for `gen`/`egen`/`input` variable extraction
- Property tests use fast-check with minimum 100 iterations
