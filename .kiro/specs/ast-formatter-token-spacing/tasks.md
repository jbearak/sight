# Implementation Plan: AST Formatter Token Spacing

## Overview

This implementation adds intelligent token spacing to the AST formatter (PrettyPrinter) by creating a utility function that formats expression strings with proper spacing while preserving content inside string literals and nested macro references.

## Tasks

- [ ] 1. Create token spacing utility module
  - [ ] 1.1 Create `src/pretty-printer/expression-spacing.ts` with core types and interfaces
    - Define `TokenCategory` type for classifying tokens
    - Define `ProtectedRegion` interface for tracking skip regions
    - Define `SpacingContext` interface for context tracking
    - _Requirements: 0.1, 0.2, 0.3, 1.1-1.4_

  - [ ] 1.2 Implement protected region detection
    - Implement `find_protected_regions()` to identify string literals, compound strings, and nested macros
    - Handle double-quoted strings: `"..."`
    - Handle compound strings: `` `"..."' ``
    - Handle nested local macros: `` `x`y'' ``
    - Handle global macros with nested content: `${...}`
    - _Requirements: 0.1, 0.2, 0.3_

  - [ ] 1.3 Write property test for protected region detection
    - **Property 0: Protected Content Preservation**
    - **Validates: Requirements 0.1, 0.2, 0.3**

- [ ] 2. Implement token classification and spacing rules
  - [ ] 2.1 Implement token classification logic
    - Classify operators (binary vs unary based on context)
    - Classify delimiters (parens, brackets, braces)
    - Classify identifiers, numbers, keywords
    - Handle simple macro references as single tokens
    - _Requirements: 1.1-1.4, 8.1-8.3_

  - [ ] 2.2 Implement unary vs binary operator detection
    - Detect unary minus at expression start or after operator/delimiter
    - Detect `!` and `~` as unary operators
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 2.3 Write property test for unary operator spacing
    - **Property 8: Unary Operator Spacing**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 3. Implement spacing rules engine
  - [ ] 3.1 Implement `get_spacing()` decision function
    - Binary operators: space before and after
    - Parentheses: no internal spaces
    - Commas: space after, not before
    - Brackets: no spaces around content
    - Curly braces: space before opening, no internal spaces
    - _Requirements: 1.1-1.4, 2.1-2.3, 3.1-3.2, 5.1-5.3, 7.1-7.4_

  - [ ] 3.2 Write property test for binary operator spacing
    - **Property 1: Binary Operator Spacing**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [ ] 3.3 Write property test for parenthesis spacing
    - **Property 2: Parenthesis Internal Spacing**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.4 Write property test for comma spacing
    - **Property 3: Comma Spacing**
    - **Validates: Requirements 3.1, 3.2**

  - [ ] 3.5 Write property test for bracket spacing
    - **Property 5: Bracket Spacing**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ] 3.6 Write property test for curly brace spacing
    - **Property 7: Curly Brace Spacing**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [ ] 4. Implement special context handling
  - [ ] 4.1 Implement keyword spacing for extended macro functions
    - Handle `of` keyword in list expressions
    - Handle `in` keyword in list expressions
    - _Requirements: 4.1, 4.2_

  - [ ] 4.2 Implement colon spacing rules
    - Extended macro function colons: space before and after
    - By-prefix colons: no space before, space after
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 4.3 Write property test for keyword spacing
    - **Property 4: Keyword Spacing**
    - **Validates: Requirements 4.1, 4.2**

  - [ ] 4.4 Write property test for colon spacing
    - **Property 6: Colon Spacing**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 5. Implement main formatting function
  - [ ] 5.1 Implement `format_expression_spacing()` function
    - Find protected regions first
    - Tokenize non-protected content
    - Apply spacing rules
    - Reconstruct expression preserving protected content
    - _Requirements: 0.1-0.3, 1.1-1.4, 2.1-2.3, 3.1-3.2, 4.1-4.2, 5.1-5.3, 6.1-6.3, 7.1-7.4, 8.1-8.3_

  - [ ] 5.2 Write property test for idempotency
    - Verify `format(format(expr)) === format(expr)`
    - _Requirements: All_

- [ ] 6. Integrate with PrettyPrinter
  - [ ] 6.1 Update PrettyPrinter to use expression spacing
    - Apply `format_expression_spacing()` to `node.expression`
    - Apply to `node.ifExpression`
    - Apply to `node.inExpression`
    - Apply to option arguments
    - _Requirements: All_

  - [ ] 6.2 Update PrettyPrinter for control flow conditions
    - Apply spacing to `if` conditions
    - Apply spacing to `while` conditions
    - Apply spacing to loop specifications
    - _Requirements: All_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- The implementation only affects the AST formatter (PrettyPrinter), not the source-preserving formatter
- Existing tests should continue to pass - any failures indicate implementation bugs
- Property tests validate universal correctness properties using fast-check
