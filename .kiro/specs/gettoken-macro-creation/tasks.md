# Implementation Plan: gettoken Macro Creation

## Overview

This implementation adds support for the `gettoken` command in the semantic analyzer, following the existing patterns for macro-creating commands like `args` and `unab`.

## Tasks

- [x] 1. Implement gettoken macro extraction
  - [x] 1.1 Add extract_gettoken_macros method to SemanticAnalyzer
    - Create new private method in `src/analyzer/index.ts`
    - Extract macro names from `node.varlist` (1 or 2 names before colon)
    - Register each as a local macro with proper `definition_index` and `definition_line`
    - Use `is_valid_identifier` to skip invalid macro names
    - _Requirements: 1.1, 1.2, 2.2, 2.3, 3.3_

  - [x] 1.2 Add gettoken case to process_command
    - Add `else if (cmd_name === 'gettoken')` branch in `process_command`
    - Call `extract_gettoken_macros` with node, symbols, current_scope, node_index
    - _Requirements: 1.1, 1.2_

- [x] 2. Write unit tests
  - [x] 2.1 Create unit test file for gettoken macro creation
    - Create `tests/unit/gettoken-macro-creation.test.ts`
    - Test single output macro: `gettoken first : input`
    - Test two output macros: `gettoken first rest : input`
    - Test with options: `gettoken first : input, parse(" ")`
    - Test inside program definition
    - Test forward reference detection (warning before, no warning after)
    - Test edge cases: empty varlist, invalid identifiers
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.4, 3.1, 3.2_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 4. Write property-based tests
  - [ ]* 4.1 Write property test for single output macro registration
    - **Property 1: Single Output Macro Registration**
    - **Validates: Requirements 1.1, 2.1, 2.2**

  - [ ]* 4.2 Write property test for two output macro registration
    - **Property 2: Two Output Macro Registration**
    - **Validates: Requirements 1.2, 2.3**

  - [ ]* 4.3 Write property test for options not interfering
    - **Property 3: Options Do Not Interfere**
    - **Validates: Requirements 2.4**

  - [ ]* 4.4 Write property test for no warning on post-definition references
    - **Property 4: No Warning for Post-Definition References**
    - **Validates: Requirements 1.3**

  - [ ]* 4.5 Write property test for warning on pre-definition references
    - **Property 5: Warning for Pre-Definition References**
    - **Validates: Requirements 1.4**

  - [ ]* 4.6 Write property test for correct scope assignment
    - **Property 6: Correct Scope Assignment**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 4.7 Write property test for definition position tracking
    - **Property 7: Definition Position Tracking**
    - **Validates: Requirements 3.3**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
