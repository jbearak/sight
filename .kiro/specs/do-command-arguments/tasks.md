# Implementation Plan: Do Command Arguments Parsing

## Overview

Fix the Analyzer to correctly extract only the file path (first varlist item) from `do`, `run`, and `include` commands, ignoring script arguments that follow.

## Tasks

- [x] 1. Fix file path extraction in Analyzer
  - [x] 1.1 Modify `detect_forward_call` to use only first varlist item
    - Change the loop that concatenates all varlist items to use only `node.varlist[0]`
    - Update macro reference detection to check only the first item
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2_

  - [x] 1.2 Write property test for file path extraction
    - **Property 1: File Path Extraction Correctness**
    - Generate random file commands with paths and arguments
    - Verify only the first varlist item is used as the path
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3**

- [x] 2. Verify forward scope resolution
  - [x] 2.1 Add unit test for do command with arguments
    - Test `do "wfs/survey.do" Cameroon 1978` extracts correct path
    - Test `do survey.do arg1 arg2` extracts correct path
    - _Requirements: 3.1, 3.2_

  - [x] 2.2 Write property test for forward scope resolution
    - **Property 2: Forward Scope Resolution Path Accuracy**
    - Create test files and verify resolution uses correct path
    - **Validates: Requirements 3.1, 3.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integration verification
  - [x] 4.1 Test with real fertility_surveys files
    - Verify `fertility_surveys/wfs/loop.do` parses without false positives
    - Verify forward scope resolution works for the do commands
    - _Requirements: 1.1, 3.1, 4.1_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- The fix is localized to a single method in `src/analyzer/index.ts`
- Existing tests should continue to pass (regression safety)
