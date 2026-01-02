# Implementation Plan: Nested Macro Invalid Character False Positive Fix

## Overview

This implementation adds brace-depth tracking to the lexer for nested global macros, and detection logic in the analyzer to suppress the "Invalid character in macro name" diagnostic for valid nested macro syntax.

## Tasks

- [x] 1. Implement nested macro detection in analyzer
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
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 5. Fix lexer brace-depth tracking for nested global macros
  - [x] 5.1 Update `scanGlobalMacroRef()` to track brace depth
    - Add `brace_depth` counter starting at 1 after consuming initial `{`
    - Increment on `{` when `local_depth === 0`
    - Decrement on `}` when `local_depth === 0`
    - Continue scanning until `brace_depth === 0`
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 5.2 Add local macro nesting tracking within braced globals
    - Add `local_depth` counter for backtick/apostrophe pairs
    - Increment on backtick, decrement on apostrophe (when `local_depth > 0`)
    - Only track braces when `local_depth === 0`
    - _Requirements: 4.2_

  - [x] 5.3 Write property test for lexer brace-depth tracking
    - **Property 6: Lexer Brace-Depth Tracking**
    - Generate nested braced globals like `${a${b}}`, `${a${b${c}}}`
    - Verify lexer returns single MACRO_REF_GLOBAL token with complete value
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [x] 5.4 Write property test for lexer mixed nesting
    - **Property 7: Lexer Mixed Nesting**
    - Generate mixed nesting like `${a`b'}`, `${a`b'${c}}`
    - Verify lexer correctly handles both brace and local macro nesting
    - **Validates: Requirements 4.2**

  - [x] 5.5 Write unit test for specific nested global macro examples
    - Test `${one${two}}` returns single token with value `${one${two}}`
    - Test `${a${b${c}}}` returns single token
    - Test `${one`two'}` returns single token
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 6. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including tests are required for comprehensive coverage
- The lexer fix (task 5) is the root cause of the "unexpected closing brace" error
- The analyzer fix (tasks 1-4) was already implemented but depends on correct lexer tokenization
- Property tests use `fast-check` with minimum 100 iterations
- Each property test references its design document property
