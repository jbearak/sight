# Implementation Plan: Quoted Path Parsing Fix

## Overview

This implementation fixes a bug where STRING tokens (quoted paths) are not captured in command varlist. The fix is a one-line change to the parser, plus property tests to verify correctness.

## Tasks

- [x] 1. Fix parser to capture STRING tokens in varlist
  - [x] 1.1 Modify parseCommand() to include STRING tokens
    - Add `|| this.check('STRING')` to the varlist parsing condition
    - Location: `src/parser/index.ts`, line ~656
    - _Requirements: 1.1, 2.1_

  - [x] 1.2 Write property test for all argument token types
    - **Property 1: All Argument Token Types Captured in Varlist**
    - **Validates: Requirements 1.1, 1.5, 2.1, 3.1, 3.2**

  - [x] 1.3 Write property test for comma boundary
    - **Property 2: Comma Boundary Respected**
    - **Validates: Requirements 3.3**

- [x] 2. Checkpoint - Ensure parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Verify integration with working directory directive
  - [x] 3.1 Write property test for quoted path integration
    - **Property 3: Quoted Path Integration with Working Directory**
    - **Validates: Requirements 4.1**

  - [x] 3.2 Run existing working directory tests to verify no regressions
    - Run `bun test working-directory` to ensure all existing tests pass
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update original spec documentation
  - [x] 5.1 Update called-from-directive tasks.md with note about this fix
    - Add a note in the Notes section documenting that this follow-up spec addresses a parser bug discovered during testing
    - _Requirements: 5.1_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Run full test suite with `bun test`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This is a follow-up spec to `called-from-directive` that addresses a parser bug discovered during testing
- The fix is minimal (one-line change) but critical for the working directory feature to function with quoted paths
- All tasks are required for comprehensive implementation
- Property tests validate universal correctness properties
