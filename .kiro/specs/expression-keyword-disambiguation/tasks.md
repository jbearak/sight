# Implementation Plan: Expression Keyword Disambiguation

## Overview

This implementation fixes false positive parse errors when Stata keywords are used as variable names in expressions. The changes are focused on the parser's command parsing logic to properly handle if-qualifiers and expression contexts.

## Tasks

- [ ] 1. Add if-qualifier expression parsing method
  - [ ] 1.1 Create `parseIfQualifierExpression()` method in StataParser
    - Parse expression until statement terminator, comma, or `in` keyword
    - Track parenthesis depth to handle nested expressions
    - Treat all WORD tokens as identifiers (not keywords)
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 3.2_
  - [ ] 1.2 Write property test for expression continuation
    - **Property 2: Expression Continuation After Operators**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [ ] 2. Modify parseCommand to detect if-qualifiers
  - [ ] 2.1 Update varlist parsing to stop at `if` keyword
    - Detect `if` as qualifier when it appears after command name
    - Stop varlist parsing when `if` is encountered
    - _Requirements: 3.1, 3.4_
  - [ ] 2.2 Call parseIfQualifierExpression when if-qualifier detected
    - Consume `if` token and parse following expression
    - Store result in command node
    - _Requirements: 1.3, 3.2_
  - [ ] 2.3 Write property test for if-qualifier detection
    - **Property 6: If-Qualifier vs If-Statement Distinction**
    - **Validates: Requirements 3.1, 3.4**

- [ ] 3. Add in-qualifier expression parsing
  - [ ] 3.1 Create `parseInQualifierExpression()` method
    - Parse range expression (e.g., `1/10`, `f/l`)
    - Stop at statement terminator or comma
    - _Requirements: 3.2_
  - [ ] 3.2 Update parseCommand to handle in-qualifier after if-qualifier
    - Detect `in` keyword after if-expression
    - Parse in-qualifier expression
    - _Requirements: 3.2_

- [ ] 4. Extend CommandNode type
  - [ ] 4.1 Add `ifExpression` field to CommandNode interface
    - Optional string field for if-qualifier expression
    - _Requirements: 1.3_
  - [ ] 4.2 Add `inExpression` field to CommandNode interface
    - Optional string field for in-qualifier expression
    - _Requirements: 3.2_

- [ ] 5. Checkpoint - Ensure basic parsing works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Handle keyword disambiguation in expressions
  - [ ] 6.1 Ensure keywords are treated as variables in expression context
    - In parseIfQualifierExpression, don't check for statement keywords
    - All WORD tokens become part of the expression
    - _Requirements: 1.1, 1.2, 1.4, 3.3_
  - [ ] 6.2 Write property test for keyword disambiguation
    - **Property 1: Keyword Disambiguation in Expressions**
    - **Validates: Requirements 1.1, 1.2, 1.4, 3.3**

- [ ] 7. Handle complex expressions
  - [ ] 7.1 Support chained conditions with `&` and `|`
    - Continue parsing after logical operators
    - _Requirements: 2.1, 2.2, 2.4_
  - [ ] 7.2 Support parenthesized sub-expressions
    - Track parenthesis depth correctly
    - Don't stop at comma/in inside parentheses
    - _Requirements: 2.5_
  - [ ] 7.3 Write property test for complex expressions
    - **Property 5: Complex Expression Handling**
    - **Validates: Requirements 2.4, 2.5**

- [ ] 8. Add error handling
  - [ ] 8.1 Handle unbalanced parentheses in if-expressions
    - Emit warning but continue parsing
    - _Requirements: 2.5_
  - [ ] 8.2 Handle empty if-expressions
    - Emit warning when `if` is followed by terminator/comma
    - _Requirements: 1.3_

- [ ] 9. Write unit tests for specific cases
  - [ ] 9.1 Test `count if program == "x"` parses without errors
    - Verify no "Expected 'define' after 'program'" error
    - _Requirements: 1.1, 1.5_
  - [ ] 9.2 Test `drop if _merge == 1 & program == "dhs"` parses correctly
    - Verify entire expression is captured
    - _Requirements: 1.2, 2.1, 2.4_
  - [ ] 9.3 Test if-statement still works correctly
    - Verify `if x == 1 { ... }` is parsed as control flow
    - _Requirements: 3.4_
  - [ ] 9.4 Write property test for no false parse errors
    - **Property 4: No False Parse Errors for Keywords in Expressions**
    - **Validates: Requirements 1.5**

- [ ] 10. Checkpoint - Ensure expression boundary detection works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Write property test for expression boundary detection
  - **Property 3: Expression Boundary Detection**
  - **Validates: Requirements 1.3, 3.2**

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
