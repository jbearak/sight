# Implementation Plan: Variable-Macro Definition Disambiguation

## Overview

This implementation plan addresses the bug where go-to-definition on a variable name incorrectly navigates to a macro definition. The fix modifies the `DefinitionProvider` to use token type information for symbol disambiguation.

## Tasks

- [x] 1. Add token lookup helper methods to DefinitionProvider
  - [x] 1.1 Add `position_in_range` method
    - Implement range checking logic for cursor position within token range
    - Handle edge cases: position at range boundaries
    - _Requirements: 4.2_
  
  - [x] 1.2 Add `get_token_at_position` method
    - Iterate through document.tokens to find token containing position
    - Return null when tokens unavailable or position not in any token
    - _Requirements: 4.1_
  
  - [x] 1.3 Write property test for token position lookup
    - **Property 6: Token Position Lookup Accuracy**
    - **Validates: Requirements 4.1, 4.2**

- [x] 2. Add extended macro context detection
  - [x] 2.1 Add `is_in_extended_macro_context` method
    - Detect `local/global name : list` pattern before cursor
    - Return true when cursor is on bare identifier in list function context
    - _Requirements: 5.1, 5.2_
  
  - [x] 2.2 Write unit tests for extended macro context detection
    - Test positive cases: `local x : list a`, `local x : list a | b`
    - Test negative cases: `local x = 5`, `tab varname`
    - _Requirements: 5.1, 5.2_

- [x] 3. Modify get_definition to use token-based disambiguation
  - [x] 3.1 Refactor get_definition to check token type first
    - Get token at position using new helper method
    - Branch logic based on token type (WORD, MACRO_REF_LOCAL, MACRO_REF_GLOBAL)
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 3.2 Implement WORD token resolution logic
    - Check extended macro context first
    - If in extended macro context, resolve to local macro only
    - Otherwise, search variables, programs, scalars, matrices (not macros)
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 5.1_
  
  - [x] 3.3 Implement MACRO_REF_LOCAL token resolution logic
    - Search only localMacros symbol table
    - Return null if not found
    - _Requirements: 1.2, 3.1, 3.3_
  
  - [x] 3.4 Implement MACRO_REF_GLOBAL token resolution logic
    - Search only globalMacros symbol table
    - Return null if not found
    - _Requirements: 1.3, 3.2, 3.3_
  
  - [x] 3.5 Maintain fallback to existing heuristics
    - When token lookup fails, use existing word extraction and context heuristics
    - Ensures backward compatibility
    - _Requirements: 1.4, 4.3_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write property tests for token-based disambiguation
  - [x] 5.1 Write property test for WORD token variable priority
    - **Property 1: WORD Token Variable Priority**
    - Generate random symbol names, create both variable and macro
    - Verify WORD token resolves to variable, not macro
    - **Validates: Requirements 1.1, 2.1, 2.2**
  
  - [x] 5.2 Write property test for MACRO_REF_LOCAL resolution
    - **Property 2: MACRO_REF_LOCAL Token Resolution**
    - Generate random macro names with backtick-quote syntax
    - Verify resolution to local macro definition
    - **Validates: Requirements 1.2, 3.1**
  
  - [x] 5.3 Write property test for MACRO_REF_GLOBAL resolution
    - **Property 3: MACRO_REF_GLOBAL Token Resolution**
    - Generate random macro names with $ syntax
    - Verify resolution to global macro definition
    - **Validates: Requirements 1.3, 3.2**
  
  - [x] 5.4 Write property test for WORD token not resolving to macro
    - **Property 4: WORD Token Does Not Resolve to Macro**
    - Generate cases where only macro exists (no variable)
    - Verify WORD token returns null, not macro
    - **Validates: Requirements 2.3**
  
  - [x] 5.5 Write property test for extended macro context
    - **Property 5: Extended Macro Context Resolution**
    - Generate extended macro function contexts
    - Verify WORD tokens resolve to local macros
    - **Validates: Requirements 5.1, 5.2, 5.3**
  
  - [x] 5.6 Write property test for missing macro returns null
    - **Property 7: Missing Macro Returns Null**
    - Generate macro reference tokens with no definition
    - Verify null is returned
    - **Validates: Requirements 3.3**

- [x] 6. Write regression tests for backward compatibility
  - [x] 6.1 Write unit tests for program definition resolution
    - Verify program names still resolve correctly
    - _Requirements: 6.1_
  
  - [x] 6.2 Write unit tests for scalar and matrix resolution
    - Verify scalar and matrix names still resolve correctly
    - _Requirements: 6.2, 6.3_
  
  - [x] 6.3 Write unit tests for file path navigation
    - Verify do/run/include file paths still navigate correctly
    - _Requirements: 6.4_
  
  - [x] 6.4 Write unit tests for embedded context behavior
    - Verify Mata/Python contexts still resolve only macros
    - _Requirements: 6.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
