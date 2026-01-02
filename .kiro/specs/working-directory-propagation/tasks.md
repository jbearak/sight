# Implementation Plan: Working Directory Propagation

## Overview

This implementation adds working directory propagation through forward scope resolution and improves diagnostic reporting for nested file errors. The changes are focused on the `ForwardScopeResolver` and related components.

## Tasks

- [x] 1. Extend ForwardResolveContext with working directory support
  - [x] 1.1 Add `working_directory` field to `ForwardResolveContext` interface in `src/types/index.ts`
    - Add optional `working_directory?: string` field
    - Add optional `call_chain?: string[]` field for diagnostic messages
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 Update `ForwardScopeResolver.resolve()` to accept and propagate working directory
    - Accept `working_directory` from context
    - Pass to nested resolution calls
    - _Requirements: 1.1, 1.3, 1.4_

- [x] 2. Implement working directory propagation in get_callee_scope
  - [x] 2.1 Modify `get_callee_scope` to accept working directory parameter
    - Add `working_directory?: string` parameter
    - Pass to file parsing/analysis
    - _Requirements: 1.1_

  - [x] 2.2 Parse nested file's own working directory directive
    - Check if callee has its own `@lsp-cd` directive
    - Return callee's working directory if present
    - _Requirements: 1.2_

  - [x] 2.3 Implement working directory inheritance logic
    - Use callee's own directive if present
    - Otherwise inherit from parent
    - Pass effective working directory to recursive calls
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 2.4 Write property test for working directory inheritance
    - **Property 1: Working Directory Inheritance and Propagation**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 3. Checkpoint - Ensure working directory propagation works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Improve diagnostic reporting for nested files
  - [x] 4.1 Add call chain tracking to ForwardResolveContext
    - Initialize call chain with root file
    - Append to chain when entering nested files
    - _Requirements: 2.3_

  - [x] 4.2 Update diagnostic generation to include source file
    - Modify "Cannot read file" message to include source file path
    - Format: "source.do: Cannot read file: missing.do"
    - _Requirements: 2.1, 2.4_

  - [x] 4.3 Map diagnostic ranges to parent call site
    - Store parent call site range when entering nested resolution
    - Use parent range for diagnostics from nested files
    - _Requirements: 2.2_

  - [x] 4.4 Write property test for diagnostic source identification
    - **Property 2: Nested File Diagnostic Source Identification**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 5. Checkpoint - Ensure diagnostic improvements work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update DocumentStore to pass working directory to ForwardScopeResolver
  - [x] 6.1 Modify server-handlers to pass working directory when calling ForwardScopeResolver
    - Extract working directory from document analysis
    - Pass to ForwardScopeResolver.resolve()
    - _Requirements: 1.1_

  - [x] 6.2 Write property test for backward compatibility
    - **Property 3: Backward Compatibility**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 7. Integration testing with real files
  - [x] 7.1 Write integration test using fertility_surveys/dhs/survey.do
    - Verify working directory propagation resolves paths correctly
    - Verify diagnostic line numbers point to correct locations
    - _Requirements: 1.1, 2.2_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
