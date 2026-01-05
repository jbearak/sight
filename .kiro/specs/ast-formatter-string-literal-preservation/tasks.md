# Implementation Plan: AST Formatter String Literal Preservation

## Overview

This implementation plan addresses bugs in the AST formatter (PrettyPrinter) where string literals are corrupted during formatting. The issues include delimiter deletion, string deletion, spacing corruption inside strings, and extended function spacing issues. The root cause is that `format_expression_spacing()` is being called on values containing string literals without proper protection.

## Tasks

- [ ] 1. Investigate and diagnose root cause
  - [ ] 1.1 Add debug logging to trace string literal flow
    - Add temporary logging to `printStringLiteral()` to verify it's being called
    - Add logging to `format_expression_spacing()` to see what content it receives
    - Trace the concrete test case through the formatter pipeline
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 1.2 Identify where string corruption occurs
    - Determine if corruption happens in `printMacroDef()`, `printCommand()`, `printControlFlow()`, or `printOption()`
    - Check if `format_expression_spacing()` is receiving string literals that should be protected
    - Verify AST node creation preserves string content correctly
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 2. Fix protected region detection in expression-spacing.ts
  - [ ] 2.1 Fix compound string delimiter matching
    - Ensure `find_protected_regions()` correctly identifies compound string boundaries (`` `" `` and `` "' ``)
    - Handle nested compound strings (`` `"`"`nested'"'"' ``)
    - Add test cases for edge cases with nested delimiters
    - _Requirements: 1.2, 1.5, 3.1, 7.1, 7.2_

  - [ ] 2.2 Fix double-quoted string protection
    - Ensure simple double-quoted strings are fully protected
    - Handle strings containing macro references without adding spaces
    - _Requirements: 1.1, 1.3, 1.4_

  - [ ] 2.3 Write property test for string delimiter preservation
    - **Property 1: String Delimiter Preservation**
    - **Validates: Requirements 1.1, 1.2, 1.5, 7.1, 7.2, 7.3**

- [ ] 3. Fix PrettyPrinter string literal handling
  - [ ] 3.1 Fix printStringLiteral to preserve content exactly
    - Ensure `printStringLiteral()` outputs string content without modification
    - Verify delimiters are correctly added based on `quoteStyle`
    - _Requirements: 1.1, 1.2, 1.5, 7.1, 7.2, 7.3_

  - [ ] 3.2 Fix printMacroDef to skip expression spacing for string values
    - Detect when macro value is purely a string literal
    - Skip `format_expression_spacing()` call for string-only values
    - Preserve extended function spacing (e.g., `: other_macro - another_macro`)
    - _Requirements: 2.2, 2.4_

  - [ ] 3.3 Fix printCommand to preserve string arguments
    - Ensure string literals in expressions are not modified
    - Preserve strings in if-qualifiers and in-qualifiers
    - _Requirements: 2.1, 2.3_

  - [ ] 3.4 Fix printControlFlow to preserve string conditions
    - Ensure strings in control flow conditions are preserved
    - Handle compound strings in if/while conditions
    - _Requirements: 4.3_

  - [ ] 3.5 Write property test for string content preservation
    - **Property 2: String Content Preservation**
    - **Validates: Requirements 1.3, 1.4, 3.2, 3.3**

- [ ] 4. Fix standalone string literal handling
  - [ ] 4.1 Ensure standalone strings are not deleted
    - Fix issue where string literals on their own line are deleted from output
    - Verify compound strings inside blocks preserve opening delimiter
    - _Requirements: 1.6, 3.4_

  - [ ] 4.2 Write property test for round-trip preservation
    - **Property 3: Round-Trip Preservation**
    - **Validates: Requirements 1.6, 3.1, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3**

- [ ] 5. Fix extended macro function spacing
  - [ ] 5.1 Normalize spacing in extended function arguments
    - Apply expression spacing to extended function arguments (add spaces around operators)
    - Fix bug where space after `-` operator is not being added
    - Ensure `local x: list a-b` becomes `local x : list a - b`
    - _Requirements: 2.4_

  - [ ] 5.2 Write property test for extended function spacing
    - **Property 4: Extended Function Spacing Normalization**
    - **Validates: Requirements 2.4**

- [ ] 6. Checkpoint - Verify core fixes
  - Ensure all property tests pass
  - Run existing formatter tests to check for regressions
  - Ask the user if questions arise

- [ ] 7. Add unit tests for concrete test cases
  - [ ] 7.1 Add unit test for main concrete test case
    - Test the exact input document from requirements (if/else with compound strings)
    - Verify output matches input exactly
    - Run against both formatter modes (AST and source-preserving)
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 7.2 Add unit test for macro extended function spacing
    - Test `local macro : other_macro - another_macro` preservation
    - _Requirements: 8.1, 8.2_

  - [ ] 7.3 Add unit test for strings in control flow conditions
    - Test `if "\`myvar'" == "value" { ... }` preservation
    - _Requirements: 8.1, 8.2_

  - [ ] 7.4 Add unit test for strings passed to user programs
    - Test `my_program \`"\`complex_string'"' "simple_string"` preservation
    - _Requirements: 8.1, 8.2_

  - [ ] 7.5 Add unit test for multi-line compound strings
    - Test compound strings spanning multiple lines
    - _Requirements: 8.1, 8.2_

  - [ ] 7.6 Add unit test for embedded Mata block with string literals
    - Test Mata block containing string literals with macros
    - Verify embedded blocks pass through unchanged
    - _Requirements: 8.1, 8.2, 8.5_

- [ ] 8. Add expression context distinction property test
  - [ ] 8.1 Write property test for expression context distinction
    - **Property 5: Expression Context Distinction**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Run full test suite including new property tests
  - Verify dual-mode testing passes for both formatter implementations
  - Ensure all tests pass, ask the user if questions arise

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples from the requirements document
- All formatter tests must run against both formatter modes (AST and source-preserving)
