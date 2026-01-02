# Implementation Plan: forvalues Parsing Fix

## Overview

Fix the `parseLoopStatement()` function in `src/parser/index.ts` to correctly detect the loop specification for `forvalues` statements by checking for OPERATOR `=` instead of WORD `=`.

## Tasks

- [x] 1. Fix the loop specification detection logic
  - [x] 1.1 Modify the condition in `parseLoopStatement()` to handle OPERATOR `=` for forvalues
    - Change from: `if (this.check('WORD') && (this.peek().value === 'in' || this.peek().value === 'of' || this.peek().value === '='))`
    - Change to: separate checks for forvalues (OPERATOR `=`) and foreach (WORD `in`/`of`)
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Write property test for forvalues loop spec parsing
    - **Property 1: forvalues Loop Spec Parsing**
    - **Validates: Requirements 1.1, 1.2**

- [x] 2. Verify no false positive diagnostics
  - [x] 2.1 Write property test for no false positive brace diagnostic
    - **Property 2: No False Positive Brace Diagnostic**
    - **Validates: Requirements 1.3**

- [x] 3. Test single-line loop parsing
  - [x] 3.1 Write property test for single-line loop parsing
    - **Property 3: Single-Line Loop Parsing**
    - **Validates: Requirements 1.4, 3.1**

- [x] 4. Verify foreach regression
  - [x] 4.1 Write property test for foreach regression
    - **Property 4: foreach Regression**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 5. Verify invalid brace placement still errors
  - [x] 5.1 Write property test for invalid brace placement detection
    - **Property 5: Invalid Brace Placement Detection**
    - **Validates: Requirements 3.2**

- [x] 6. Test continuation line handling
  - [x] 6.1 Write property test for continuation line handling
    - **Property 6: Continuation Line Handling**
    - **Validates: Requirements 3.3**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Verify the original bug is fixed
  - [x] 8.1 Run the LSP against the original file `fertility_surveys/dhs/year_recodes.do`
    - Verify line 88 (`forvalues b = 1/9 {`) no longer produces the false positive diagnostic
    - _Requirements: 1.3_

## Notes

- All tasks are required for comprehensive testing
- The fix is localized to a single function in `src/parser/index.ts`
- Property tests should use fast-check with minimum 100 iterations
- All property tests go in `tests/property/forvalues-parsing-fix.prop.test.ts`
