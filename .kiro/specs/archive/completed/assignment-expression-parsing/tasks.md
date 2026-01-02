# Implementation Plan: Assignment Expression Parsing

## Overview

Fix the parser to correctly handle commands with assignment expression syntax by detecting `=` after the varlist and consuming the entire expression. The implementation adds an `expression` field to CommandNode and a new `parseExpression()` method.

## Tasks

- [ ] 1. Extend CommandNode type
  - [ ] 1.1 Add `expression?: string` field to CommandNode in `src/types/index.ts`
    - _Requirements: 1.1, 1.2_

- [ ] 2. Implement expression parsing
  - [ ] 2.1 Add `parseExpression()` method to parser
    - Track parenthesis depth to handle nested function calls
    - Stop at top-level comma or statement terminator
    - Return expression as trimmed string
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 2.2 Update `parseCommand()` to detect and parse assignment expressions
    - After parsing varlist, check for OPERATOR `=`
    - If found, consume `=` and call `parseExpression()`
    - Store result in command node's expression field
    - _Requirements: 1.1, 1.3, 1.4, 1.5_
  - [ ] 2.3 Write property test for single command node
    - **Property 1: Single Command Node for Assignment Syntax**
    - **Validates: Requirements 1.1, 1.4, 1.5**
  - [ ] 2.4 Write property test for expression token handling
    - **Property 2: Expression Token Handling**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [ ] 3. Checkpoint - Ensure parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Update pretty printer
  - [ ] 4.1 Update `printCommand()` to output expression
    - If expression field is present, output ` = ` followed by expression
    - _Requirements: 1.1_
  - [ ] 4.2 Write property test for option separation
    - **Property 3: Option Separation at Top-Level Comma**
    - **Validates: Requirements 1.2, 1.3, 2.5**

- [ ] 5. Verify analyzer compatibility
  - [ ] 5.1 Verify `extract_egen_variable()` works with new AST structure
    - The varlist should still contain the variable name
    - No changes expected, just verification
    - _Requirements: 3.1_
  - [ ] 5.2 Verify `extract_gen_variable()` works with new AST structure
    - _Requirements: 3.2_
  - [ ] 5.3 Write property test for variable extraction preservation
    - **Property 4: Variable Extraction Preservation**
    - **Validates: Requirements 3.1, 3.2**

- [ ] 6. Handle edge cases
  - [ ] 6.1 Handle missing expression after `=`
    - Report error but continue parsing
    - _Requirements: 4.4_
  - [ ] 6.2 Handle unbalanced parentheses in expression
    - Report error, recover at comma/terminator
    - _Requirements: 4.4_
  - [ ] 6.3 Write property test for error handling
    - **Property 5: Error Handling Without Cascading**
    - **Validates: Requirements 4.4**

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The expression field stores the raw expression string; semantic analysis is left to downstream consumers
- Parenthesis depth tracking is essential for handling function calls like `max(a, b)` where the comma is not an option separator
- Existing analyzer methods (`extract_egen_variable`, `extract_gen_variable`) should continue to work since they use the varlist, not the expression
- All tasks including property tests are required for comprehensive coverage
