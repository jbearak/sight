# Implementation Plan: AST Formatter Token Spacing

## Overview

This implementation adds intelligent token spacing to the AST formatter (PrettyPrinter) by creating a utility function that formats expression strings with proper spacing while preserving content inside string literals and nested macro references.

## Tasks

- [x] 1. Create token spacing utility module
  - [x] 1.1 Create `src/pretty-printer/expression-spacing.ts` with core types and interfaces
    - Define `TokenCategory` type for classifying tokens
    - Define `ProtectedRegion` interface for tracking skip regions
    - Define `SpacingContext` interface for context tracking
    - _Requirements: 0.1, 0.2, 0.3, 1.1-1.4_

  - [x] 1.2 Implement protected region detection
    - Implement `find_protected_regions()` to identify string literals, compound strings, and nested macros
    - Handle double-quoted strings: `"..."`
    - Handle compound strings: `` `"..."' ``
    - Handle nested local macros: `` `x`y'' ``
    - Handle global macros with nested content: `${...}`
    - _Requirements: 0.1, 0.2, 0.3_

  - [x] 1.3 Write property test for protected region detection
    - **Property 0: Protected Content Preservation**
    - **Validates: Requirements 0.1, 0.2, 0.3**

- [x] 2. Implement token classification and spacing rules
  - [x] 2.1 Implement token classification logic
    - Classify operators (binary vs unary based on context)
    - Classify delimiters (parens, brackets, braces)
    - Classify identifiers, numbers, keywords
    - Handle simple macro references as single tokens
    - _Requirements: 1.1-1.4, 8.1-8.3_

  - [x] 2.2 Implement unary vs binary operator detection
    - Detect unary minus at expression start or after operator/delimiter
    - Detect `!` and `~` as unary operators
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 2.3 Write property test for unary operator spacing
    - **Property 8: Unary Operator Spacing**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [x] 3. Implement spacing rules engine
  - [x] 3.1 Implement `get_spacing()` decision function
    - Binary operators: space before and after
    - Parentheses: no internal spaces
    - Commas: space after, not before
    - Brackets: no spaces around content
    - Curly braces: space before opening, no internal spaces
    - _Requirements: 1.1-1.4, 2.1-2.3, 3.1-3.2, 5.1-5.3, 7.1-7.4_

  - [x] 3.2 Write property test for binary operator spacing
    - **Property 1: Binary Operator Spacing**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [x] 3.3 Write property test for parenthesis spacing
    - **Property 2: Parenthesis Internal Spacing**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 3.4 Write property test for comma spacing
    - **Property 3: Comma Spacing**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 3.5 Write property test for bracket spacing
    - **Property 5: Bracket Spacing**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 3.6 Write property test for curly brace spacing
    - **Property 7: Curly Brace Spacing**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 4. Implement special context handling
  - [x] 4.1 Implement keyword spacing for extended macro functions
    - Handle `of` keyword in list expressions
    - Handle `in` keyword in list expressions
    - _Requirements: 4.1, 4.2_

  - [x] 4.2 Implement colon spacing rules
    - Extended macro function colons: space before and after
    - By-prefix colons: no space before, space after
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.3 Write property test for keyword spacing
    - **Property 4: Keyword Spacing**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 4.4 Write property test for colon spacing
    - **Property 6: Colon Spacing**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 5. Implement main formatting function
  - [x] 5.1 Implement `format_expression_spacing()` function
    - Find protected regions first
    - Tokenize non-protected content
    - Apply spacing rules
    - Reconstruct expression preserving protected content
    - _Requirements: 0.1-0.3, 1.1-1.4, 2.1-2.3, 3.1-3.2, 4.1-4.2, 5.1-5.3, 6.1-6.3, 7.1-7.4, 8.1-8.3_

  - [x] 5.2 Write property test for idempotency
    - Verify `format(format(expr)) === format(expr)`
    - _Requirements: All_

- [x] 6. Integrate with PrettyPrinter
  - [x] 6.1 Update PrettyPrinter to use expression spacing
    - Apply `format_expression_spacing()` to `node.expression`
    - Apply to `node.ifExpression`
    - Apply to `node.inExpression`
    - Apply to option arguments
    - _Requirements: All_

  - [x] 6.2 Update PrettyPrinter for control flow conditions
    - Apply spacing to `if` conditions
    - Apply spacing to `while` conditions
    - Apply spacing to loop specifications
    - _Requirements: All_

- [x] 7. Checkpoint - Ensure all tests pass
  - All tests pass (44 property tests + 1152 unit tests + 160 formatter tests)

- [x] 8. Fix PR #22 feedback issues
  - [x] 8.1 Fix bounds checking in protected region detection
    - Add `i + 1 < expression.length` checks before accessing `expression[i + 1]`
    - Fix lines 90, 96, 99, 155 in `expression-spacing.ts`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 8.2 Fix case-sensitive keyword matching
    - Remove `toLowerCase()` from keyword matching in `classify_token()`
    - Use exact string comparison: `EXPRESSION_KEYWORDS.has(value)` instead of `EXPRESSION_KEYWORDS.has(value.toLowerCase())`
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 8.3 Fix test generator to use non-reserved identifiers
    - Import `arbitrary_non_reserved_identifier` from `tests/property/generators/index.ts`
    - Replace custom `identifier_arb` with `arbitrary_non_reserved_identifier()`
    - Update imports to use public API (`src/pretty-printer/index.ts`)
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 8.4 Fix code style issues
    - Break long lines (520-521) to comply with 80-character limit
    - _Requirements: Code style compliance_

- [x] 9. Final checkpoint - Verify PR feedback fixes
  - Ensure all tests pass after PR feedback fixes
  - Verify bounds safety with edge case expressions
  - Verify case-sensitive keyword matching works correctly

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- The implementation only affects the AST formatter (PrettyPrinter), not the source-preserving formatter
- Existing tests should continue to pass - any failures indicate implementation bugs
- Property tests validate universal correctness properties using fast-check
