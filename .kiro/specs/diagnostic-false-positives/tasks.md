# Implementation Plan: Diagnostic False Positives Fix

## Overview

This implementation fixes three categories of false positive diagnostics by:
1. Fixing inline Mata/Python context handling in the lexer (primary fix)
2. Fixing args command macro scope in the analyzer
3. Verifying macro path handling in forward scope resolver (likely already working once #1 is fixed)

## Tasks

- [x] 1. Fix Inline Mata/Python Context Handling in Lexer
  - [x] 1.1 Remove context push for MATA_INLINE token
    - In `src/lexer/index.ts`, modify `scanWord()` method
    - When creating `MATA_INLINE` token, do NOT call `this.push_context(LanguageContext.MATA)`
    - The inline command should not change the lexer's language context
    - _Requirements: 1.1, 1.3, 1.5_

  - [x] 1.2 Remove context push for PYTHON_INLINE token
    - In `src/lexer/index.ts`, modify `scanWord()` method
    - When creating `PYTHON_INLINE` token, do NOT call `this.push_context(LanguageContext.PYTHON)`
    - _Requirements: 1.2, 1.3_

  - [x] 1.3 Write unit tests for inline context handling
    - Test that `mata: expression` does not change context for subsequent lines
    - Test that `python: expression` does not change context for subsequent lines
    - Test that full `mata` block still works correctly
    - Test that strings after inline mata are parsed with Stata rules
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Checkpoint - Verify lexer fix resolves main issue
  - Run the lexer on `fertility_surveys/dhs/loop.do`
  - Verify no "unclosed string literal" errors on lines 121+
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Fix Args Command Macro Scope in Analyzer
  - [x] 3.1 Update extract_args_macros to use definition_index 0
    - In `src/analyzer/index.ts`, modify `extract_args_macros()` method
    - Change `definition_index: node_index` to `definition_index: 0`
    - Change `definition_line: node.range.start.line` to `definition_line: 0`
    - This makes args-defined macros valid from the start of the scope
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Write unit tests for args macro scope
    - Test that `args x y z` registers three local macros
    - Test that references before `args` command don't produce warnings
    - Test that undefined macros still produce warnings
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Verify Macro Path Handling
  - [x] 4.1 Verify existing macro path detection works
    - Check that `detect_forward_call` correctly sets `is_static: false` for macro paths
    - Verify forward scope resolver filters out non-static calls
    - This should already work once the lexer fix is in place
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 Write unit tests for macro path handling
    - Test that `do "`macro'"` is marked as non-static
    - Test that `do "$macro"` is marked as non-static
    - Test that `do "static.do"` is marked as static
    - Test that non-static paths don't produce "cannot read file" diagnostics
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Final Checkpoint - Full Integration Test
  - Run full test suite
  - Verify `fertility_surveys/dhs/loop.do` has no false positive diagnostics
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write Property-Based Tests
  - [x] 6.1 Write property test for inline context isolation
    - **Property 1: Inline Mata Context Isolation**
    - **Validates: Requirements 1.1, 1.3, 1.5**

  - [x] 6.2 Write property test for args macro scope
    - **Property 4: Args Command Macro Scope**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 6.3 Write property test for macro path suppression
    - **Property 6: Macro Path Diagnostic Suppression**
    - **Validates: Requirements 3.1, 3.2**

## Notes

- All tasks are required for comprehensive testing
- The primary fix is task 1 (lexer inline context handling) - this should resolve most issues
- Task 3 (args macro scope) is a separate issue that may or may not be visible after task 1
- Task 4 (macro path handling) should work automatically once task 1 is complete
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
