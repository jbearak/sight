# Implementation Plan: Syntax Command Bug Fixes

## Overview

This plan implements fixes for two bugs in the Stata LSP's handling of the `syntax` command:
1. Prefixed syntax commands being parsed as regular commands
2. Weight argument types not being recognized

## Tasks

- [x] 1. Fix prefixed syntax command parsing
  - [x] 1.1 Add syntax command detection in parseCommand()
    - In `src/parser/index.ts`, in `parseCommand()`, after consuming prefix commands
    - Check if command name is 'syntax' and route to `parseSyntaxCommand()`
    - Attach prefix nodes to the resulting SyntaxNode
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Add prefix property to SyntaxNode type
    - In `src/types/index.ts`, add optional `prefix?: PrefixNode[]` to SyntaxNode interface
    - _Requirements: 1.1_

- [x] 2. Add weight argument type recognition
  - [x] 2.1 Add weight types to standard_types in parser
    - In `src/parser/index.ts`, in `parse_argument_spec()`
    - Add 'weight', 'fweight', 'fw', 'aweight', 'aw', 'pweight', 'pw', 'iweight', 'iw' to standard_types array
    - _Requirements: 2.1, 2.5, 2.7_

  - [x] 2.2 Update get_implicit_local_name() for weight types
    - In `src/analyzer/index.ts`, modify `get_implicit_local_name()`
    - Map all weight type variants to return 'weight'
    - _Requirements: 2.2, 2.6_

  - [x] 2.3 Register 'exp' implicit local for weight arguments
    - In `src/analyzer/index.ts`, modify `register_implicit_locals()`
    - When registering a weight argument, also register 'exp' as implicit local
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

- [x] 3. Checkpoint - Verify core functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Write property tests
  - [x] 4.1 Write property test for prefixed syntax parsing
    - **Property 1: Prefixed syntax command parsing**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [x] 4.2 Write property test for weight argument implicit locals
    - **Property 2: Weight argument implicit locals**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

  - [x] 4.3 Write property test for regression
    - **Property 3: Regression - existing functionality preserved**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 5. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
