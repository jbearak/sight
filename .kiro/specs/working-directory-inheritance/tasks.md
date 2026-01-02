# Implementation Plan: Working Directory Inheritance

## Overview

This implementation adds working directory inheritance from parent files and the `@lsp-run-by` synonym. Changes span DirectiveParser, ScopeResolver, DocumentStore, types, and README documentation.

## Tasks

- [x] 1. Add @lsp-run-by synonym to DirectiveParser
  - [x] 1.1 Update DIRECTIVE_PATTERN regex to include `run-by`
    - Modify pattern in `src/directive-parser/index.ts`
    - Pattern: `/@lsp-(done-by|run-by|included-by):?\s+...`
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 Map `run-by` to `done-by` type in parse logic
    - When directive type is `run-by`, convert to `done-by`
    - Ensures identical behavior for inheritance rules
    - _Requirements: 2.1, 2.3_

  - [x] 1.3 Write property test for @lsp-run-by parsing equivalence
    - **Property 6: @lsp-run-by Parsing Equivalence**
    - Generate random paths and call-site parameters
    - Verify @lsp-run-by produces identical Directive as @lsp-done-by
    - **Validates: Requirements 2.1, 2.2, 2.4**

- [x] 2. Extend ResolvedScope type with inherited_working_directory
  - [x] 2.1 Add `inherited_working_directory?: string` to ResolvedScope interface
    - Update `src/types/index.ts`
    - _Requirements: 1.1_

- [x] 3. Update ScopeResolver to propagate working directory
  - [x] 3.1 Modify follow_directives to track working directory from parents
    - Add parameter to track inherited working directory
    - Return working directory found in chain
    - _Requirements: 1.1, 1.5_

  - [x] 3.2 Implement depth-based precedence for working directory
    - Nearest parent (smallest depth) wins
    - First working directory found at each depth level takes precedence
    - _Requirements: 1.3_

  - [x] 3.3 Update resolve() to return inherited_working_directory
    - Only set if current file lacks own working directory directive
    - _Requirements: 1.1, 1.2_

  - [x] 3.4 Write property test for working directory inheritance
    - **Property 1: Working Directory Inheritance**
    - Generate parent files with working directory, child files without
    - Verify inherited_working_directory is set correctly
    - **Validates: Requirements 1.1**

  - [x] 3.5 Write property test for child directive precedence
    - **Property 2: Child Directive Precedence**
    - Generate files where both parent and child have working directory
    - Verify inherited_working_directory is undefined
    - **Validates: Requirements 1.2**

  - [x] 3.6 Write property test for depth-based precedence
    - **Property 3: Depth-Based Precedence**
    - Generate chains with working directories at different depths
    - Verify nearest parent's working directory is used
    - **Validates: Requirements 1.3**

- [x] 4. Update DocumentStore to use inherited working directory
  - [x] 4.1 Modify update_document to check for inherited working directory
    - If file has backward directives but no own working directory
    - Call ScopeResolver.resolve() to get inherited_working_directory
    - Use inherited working directory for analysis
    - _Requirements: 1.1, 1.4_

  - [x] 4.2 Write property test for path resolution context
    - **Property 4: Path Resolution Context**
    - Generate parent with relative working directory path
    - Verify path is resolved relative to parent's directory
    - **Validates: Requirements 1.4**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write integration test for real-world scenario
  - [x] 6.1 Create integration test matching user's use case
    - Test with loop.do having `@lsp-cd: "../"`
    - Test with survey.do having `@lsp-done-by: "loop.do"`
    - Verify survey.do inherits working directory from loop.do
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 6.2 Write property test for chain propagation
    - **Property 5: Chain Propagation**
    - Generate multi-level chains with intermediate working directories
    - Verify propagation stops at intermediate file with own directive
    - **Validates: Requirements 1.5**

  - [x] 6.3 Write property test for @lsp-run-by inheritance equivalence
    - **Property 7: @lsp-run-by Inheritance Equivalence**
    - Generate parent files with various symbol types
    - Verify @lsp-run-by inherits same symbols as @lsp-done-by
    - **Validates: Requirements 2.3**

- [x] 7. Update README documentation
  - [x] 7.1 Document @lsp-run-by as synonym for @lsp-done-by
    - Add to directives section
    - Explain semantic use case (files called via `run` command)
    - _Requirements: 3.3_

  - [x] 7.2 Document working directory inheritance behavior
    - Explain automatic inheritance from parent files
    - Document precedence rules (child's own directive wins)
    - _Requirements: 3.1, 3.2_

  - [x] 7.3 Add example showing working directory inheritance
    - Show loop.do with @lsp-cd
    - Show survey.do with @lsp-done-by inheriting working directory
    - _Requirements: 3.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
