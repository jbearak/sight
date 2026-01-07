# Implementation Plan: Parenthesized Group Parsing Refactor

## Overview

This implementation plan refactors the duplicated LPAREN handling logic in the Stata parser by extracting it into a shared `parseParenthesizedGroup` method. The refactoring follows a safe approach: first add the new method, then update callers one at a time, verifying behavior at each step.

## Tasks

- [x] 1. Add the shared parseParenthesizedGroup method
  - [x] 1.1 Create the `parseParenthesizedGroup` private method in `src/parser/index.ts`
    - Add method after `parseFilePathArgument` (around line 1290)
    - Implement LPAREN consumption, nested depth tracking, word spacing, and RPAREN handling
    - Return `IdentifierNode | null` (null for empty content)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Write property test for nested parenthesis depth tracking
    - **Property 1: Nested Parenthesis Depth Tracking**
    - **Validates: Requirements 1.3, 4.2**

  - [x] 1.3 Write property test for word token spacing preservation
    - **Property 2: Word Token Spacing Preservation**
    - **Validates: Requirements 1.4**

- [x] 2. Refactor parseCommand to use shared method
  - [x] 2.1 Replace inline LPAREN handling in `parseCommand` with call to `parseParenthesizedGroup`
    - Locate the LPAREN handling block (around lines 895-938)
    - Replace with: `const paren_node = this.parseParenthesizedGroup(); if (paren_node) { varlist.push(paren_node); }`
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Write property test for parsing consistency
    - **Property 3: Parsing Consistency After Refactoring**
    - **Validates: Requirements 2.3, 3.3, 4.1, 4.3, 5.3, 5.4**

- [x] 3. Refactor parseCommandBody to use shared method
  - [x] 3.1 Replace inline LPAREN handling in `parseCommandBody` with call to `parseParenthesizedGroup`
    - Locate the LPAREN handling block (around lines 1145-1185)
    - Replace with: `const paren_node = this.parseParenthesizedGroup(); if (paren_node) { varlist.push(paren_node); }`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.2 Write property test for direct vs frame-prefixed equivalence
    - **Property 4: Direct vs Frame-Prefixed Equivalence**
    - **Validates: Requirements 4.4**

- [x] 4. Checkpoint - Verify all tests pass
  - Run existing tests to ensure no regressions
  - Run new property tests to verify correctness properties
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Final cleanup and verification
  - [x] 5.1 Verify code reduction
    - Confirm the duplicated code has been removed
    - Verify the shared method is called from both locations
    - _Requirements: 2.2, 3.2_

  - [x] 5.2 Run full test suite including existing frame-prefixed tests
    - Verify `frame-prefixed-parenthesized-varlist.prop.test.ts` passes
    - Verify no regressions in other parser tests
    - _Requirements: 4.1, 4.4, 5.1, 5.2, 5.3, 5.4_

## Notes

- All tasks are required for comprehensive coverage
- The existing property tests in `frame-prefixed-parenthesized-varlist.prop.test.ts` serve as regression tests
- Each task references specific requirements for traceability
- The refactoring is designed to be incremental - each step can be verified independently
