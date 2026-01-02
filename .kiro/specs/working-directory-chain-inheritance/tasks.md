# Implementation Plan: Working Directory Chain Inheritance

## Overview

This implementation plan addresses working directory inheritance through directive chains and diagnostic source attribution. The changes are primarily in `ScopeResolver` and `ForwardScopeResolver`, with minor type additions.

## Tasks

- [x] 1. Add diagnostic source tracking types
  - Add `DiagnosticSource` interface to `src/types/index.ts`
  - Add optional `source` field to `DirectiveDiagnostic` interface
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Update ScopeResolver to pass working directory to forward call resolution
  - [x] 2.1 Modify `resolve_parent_forward_calls()` to use parent's working directory
    - Pass `my_parent_result.working_directory ?? found_working_directory` to forward resolver
    - _Requirements: 1.1, 1.4, 2.1_
  - [x] 2.2 Write property test for working directory inheritance transitivity
    - **Property 1: Working Directory Inheritance Transitivity**
    - **Validates: Requirements 1.1, 1.2, 2.1**

- [x] 3. Update ForwardScopeResolver to use working directory context
  - [x] 3.1 Modify `get_callee_scope()` to pass working directory to `get_parsed_file()`
    - Ensure working directory is used for path resolution in nested files
    - _Requirements: 2.2, 2.3_
  - [x] 3.2 Write property test for forward call path resolution with working directory
    - **Property 3: Forward Call Path Resolution with Working Directory**
    - **Validates: Requirements 2.2, 2.3, 5.1, 5.2**

- [x] 4. Implement diagnostic source attribution
  - [x] 4.1 Update `ForwardScopeResolver.resolve()` to include source info in diagnostics
    - Add `source` field with `source_file` and `source_line` when creating "Cannot read file" diagnostics
    - Include call chain in message for nested forward calls
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.2 Update `ScopeResolver.follow_directives()` to include source info in diagnostics
    - Add `source` field when creating diagnostics from parent file errors
    - _Requirements: 3.1, 3.3_
  - [x] 4.3 Write property test for diagnostic source attribution completeness
    - **Property 4: Diagnostic Source Attribution Completeness**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 5. Implement diagnostic range remapping
  - [x] 5.1 Update `ScopeResolver.resolve()` to remap diagnostic ranges to active file
    - After `follow_directives()`, remap diagnostics with `source` field to active file's directive line
    - Update message format to include source file and line
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 5.2 Write property test for diagnostic range remapping
    - **Property 5: Diagnostic Range Remapping**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 6. Checkpoint - Ensure all tests pass
  - All tests pass (1877 pass, 0 fail)

- [x] 7. Write integration test for real file scenario
  - [x] 7.1 Create integration test using `fertility_surveys/dhs/` files
    - Test `bh_vars.do` → `survey.do` → `loop.do` chain
    - Verify working directory inheritance from `loop.do`'s `@lsp-cd ../`
    - Verify diagnostics point to correct locations
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 8. Final checkpoint - Ensure all tests pass
  - All 1877 tests pass

## Notes

- All tasks are required for comprehensive validation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
