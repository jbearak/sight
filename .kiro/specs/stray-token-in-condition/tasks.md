# Implementation Plan: Stray Token Detection in Conditions

## Overview

This implementation adds diagnostic detection for stray tokens after comparison expressions in `if` and `in` qualifier conditions. The work extends the existing parser's expression parsing methods with a state machine to track expression structure and detect invalid token sequences.

## Tasks

- [x] 1. Add new error code and types
  - Add `STRAY_TOKEN_IN_CONDITION = 3013` to `ParseErrorCode` enum in `src/types/index.ts`
  - Add `SPLIT_LITERAL_IN_CONDITION = 3014` for split literal detection
  - _Requirements: 1.1, 5.1_

- [x] 2. Implement helper methods in parser
  - [x] 2.1 Add `isComparisonOperator()` method
    - Returns true for `==`, `!=`, `~=`, `<`, `>`, `<=`, `>=`
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 2.2 Add `isLogicalOperator()` method
    - Returns true for `&`, `|`
    - _Requirements: 3.1_
  - [x] 2.3 Add `isArithmeticOperator()` method
    - Returns true for `+`, `-`, `*`, `/`
    - _Requirements: 3.4_
  - [x] 2.4 Add `isValidAfterComparison()` method
    - Returns true for `)`, `{`, `&`, `|`, comma, terminator, `in`, trivia
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Implement stray token detection in parseIfQualifierExpression
  - [x] 3.1 Add expression state tracking (INITIAL, AFTER_OPERAND, AFTER_COMPARE, AFTER_RHS)
    - Track state transitions as tokens are consumed
    - _Requirements: 1.1, 2.1_
  - [x] 3.2 Detect stray tokens when in AFTER_RHS state
    - Emit STRAY_TOKEN_IN_CONDITION error when identifier/number follows comparison RHS
    - Include token text in message and suggest `&` or `|`
    - _Requirements: 1.2, 1.3, 5.1, 5.2, 5.3_
  - [x] 3.3 Handle nested parentheses correctly
    - Reset state to INITIAL when entering nested parens
    - _Requirements: 4.3_
  - [x] 3.4 Handle negation operators
    - `!` and `~` reset state to INITIAL
    - _Requirements: 4.1, 4.2_
  - [x] 3.5 Write property test for stray token detection
    - **Property 1: Stray Token Detection After Comparison**
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 6.1, 6.2, 6.3, 6.4**

- [x] 4. Implement split literal detection
  - [x] 4.1 Detect `. N` pattern (dot space number)
    - Emit diagnostic suggesting `.N`
    - _Requirements: 7.1_
  - [x] 4.2 Detect `. a` pattern (dot space letter)
    - Emit diagnostic suggesting `.a` (extended missing value)
    - _Requirements: 7.2_
  - [x] 4.3 Detect `N .` and `a .` patterns
    - Emit diagnostic about potential split
    - _Requirements: 7.3, 7.4_
  - [x] 4.4 Write property test for split literal detection
    - **Property 4: Split Literal Detection**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

- [x] 5. Apply same logic to parseInQualifierExpression
  - [x] 5.1 Add state tracking to in-qualifier parsing
    - Same state machine as if-qualifier
    - _Requirements: 2.1_
  - [x] 5.2 Detect stray tokens in in-qualifiers
    - Same detection logic as if-qualifier
    - _Requirements: 2.2_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write unit tests for edge cases
  - [x] 7.1 Test basic stray token cases
    - `if (x == y oops)`, `if x == y oops`, `replace x = y if z == 0 oops`
    - _Requirements: 1.2, 2.2_
  - [x] 7.2 Test valid compound expressions (no false positives)
    - `if (x == 1 & y == 2)`, `if (x == 1 | y == 2)`, `if (x + 1 == y)`, `if !(x == y)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2_
  - [x] 7.3 Test the specific multi-line case from requirements
    - Test case with `///` continuation and `. 9` split literal
    - _Requirements: 7.5, 8.1, 8.2, 8.3_
  - [x] 7.4 Test edge cases
    - Multiple stray tokens, keyword as stray token, function calls, nested parens
    - _Requirements: 1.3, 1.4, 3.5, 4.3_

- [x] 8. Write property test for valid expression acceptance
  - **Property 2: Valid Expression Acceptance**
  - Generate random valid compound expressions with &, |, arithmetic, negation
  - Verify no stray token diagnostic emitted
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3**

- [x] 9. Write property test for diagnostic message quality
  - **Property 3: Diagnostic Message Quality**
  - Verify message contains token text, suggestion, and range matches token
  - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 10. Write property test for continuation line handling
  - **Property 5: Continuation Line Handling**
  - Generate expressions with `///` continuations containing stray tokens
  - Verify stray tokens still detected
  - **Validates: Requirements 8.1, 8.2, 8.3**

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The lexer already handles `///` continuations, so the parser sees a continuous token stream
