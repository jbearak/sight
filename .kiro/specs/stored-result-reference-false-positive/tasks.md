# Implementation Plan: Stored Result Reference False Positive Fix

## Overview

This implementation adds detection logic to recognize Stata stored result references (`r()`, `e()`, `c()`, `s()`) within local macro reference tokens and suppress the invalid character diagnostic for these valid constructs.

## Tasks

- [x] 1. Add stored result reference detection
  - [x] 1.1 Add `is_stored_result_reference` helper method to Analyzer
    - Add new private method in `src/analyzer/index.ts`
    - Implement regex pattern to match `r(...)`, `e(...)`, `c(...)`, `s(...)` with optional matrix subscripts
    - Handle nested macro syntax within parentheses
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 4.1, 4.2_

  - [x] 1.2 Modify `collect_undefined_macro_diagnostics` to skip stored results
    - Add check for `is_stored_result_reference` before `has_invalid_macro_char` check
    - Skip both invalid char check and undefined macro check for stored results
    - _Requirements: 1.5, 2.1_

  - [x] 1.3 Write property test for stored result recognition
    - **Property 1: Stored Result References Are Not Flagged**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x] 1.4 Write property test for invalid char detection preservation
    - **Property 2: Non-Stored-Result Invalid Characters Are Flagged**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

  - [x] 2.1 Write property test for nested macros in stored results
    - **Property 3: Nested Macros in Stored Results Are Not Flagged**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.2 Write property test for matrix subscripts in stored results
    - **Property 4: Matrix Subscripts in Stored Results Are Not Flagged**
    - **Validates: Requirements 4.1, 4.2**

- [x] 3. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All core implementation tasks (1.1, 1.2) are required
- Each task references specific requirements for traceability
- The fix is localized to `src/analyzer/index.ts` with minimal changes
- Property tests use `fast-check` library with minimum 100 iterations
