# Implementation Plan: Nested Macro Invalid Character False Positive Fix

## Overview

This implementation adds detection logic to recognize nested macro patterns in the Analyzer and suppress the "Invalid character in macro name" diagnostic for valid nested macro syntax.

## Tasks

- [x] 1. Implement nested macro detection
  - [x] 1.1 Add `contains_nested_macro()` method to Analyzer class
    - Add private method to `src/analyzer/index.ts`
    - Check for nested local macro patterns (backtick + apostrophe)
    - Check for nested braced global patterns (`${...}`)
    - Check for nested unbraced global patterns (`$identifier`)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [x] 1.2 Write property test for nested local macro detection
    - **Property 1: Nested Local Macro Detection**
    - Generate nested local macros at various depths (1-6 levels)
    - Verify `contains_nested_macro()` returns true for all
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 1.3 Write property test for nested global macro detection
    - **Property 2: Nested Global Macro Detection**
    - Generate nested braced globals, locals in globals, mixed nesting
    - Verify `contains_nested_macro()` returns true for all
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 2. Integrate detection into diagnostic flow
  - [x] 2.1 Update local macro token processing in `collect_token_diagnostics()`
    - Add `contains_nested_macro()` check after stored result check
    - Skip invalid character check if nested macro detected
    - _Requirements: 1.4_

  - [x] 2.2 Update global macro token processing in `collect_token_diagnostics()`
    - Add `contains_nested_macro()` check for braced globals
    - Skip invalid character check if nested macro detected
    - _Requirements: 2.4_

  - [x] 2.3 Write property test for nested macro diagnostic suppression
    - **Property 3: Nested Macro Diagnostic Suppression**
    - Generate nested macros (local and global)
    - Run analyzer and verify no INVALID_MACRO_CHAR diagnostic
    - **Validates: Requirements 1.4, 2.4**

- [x] 3. Verify invalid character detection preserved
  - [x] 3.1 Write property test for non-nested invalid character detection
    - **Property 4: Non-Nested Invalid Character Detection**
    - Generate macro names with invalid chars (dots, spaces, etc.) but no nesting
    - Verify INVALID_MACRO_CHAR diagnostic is produced
    - **Validates: Requirements 3.1**

  - [x] 3.2 Write unit tests for specific invalid character examples
    - Test `` `foo.bar' `` produces diagnostic
    - Test `` `my var' `` produces diagnostic
    - Test `${foo.bar}` produces diagnostic
    - Test `${my var}` produces diagnostic
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

- [x] 4. Verify unbalanced macro handling
  - [x] 4.1 Write property test for no duplicate diagnostics
    - **Property 5: No Duplicate Diagnostics for Unbalanced Macros**
    - Generate unbalanced macro expressions
    - Verify only lexer error appears, no analyzer INVALID_MACRO_CHAR
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 5. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including tests are required for comprehensive coverage
- The fix is localized to `src/analyzer/index.ts`
- Property tests use `fast-check` with minimum 100 iterations
- Each property test references its design document property
