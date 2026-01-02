# Implementation Plan: Cross-File Awareness Fixes

## Overview

This plan implements fixes for directive presence detection, type safety in workspace config, and proper logging in the scope resolver.

## Tasks

- [x] 1. Add has_directives field to ResolvedScope
  - [x] 1.1 Update ResolvedScope interface in src/types/index.ts
    - Add `has_directives: boolean` field to the interface
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Update ScopeResolver to set has_directives
    - Modify resolve() to track whether directives were parsed from current file
    - Set has_directives based on directive_parser result, not chain length
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.3 Update CompletionProvider to use has_directives
    - Replace `temp_scope.chain.length > 1` check with `temp_scope.has_directives`
    - _Requirements: 1.1_

  - [x] 1.4 Write property test for directive presence detection
    - **Property 1: Directive Presence Detection Accuracy**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 2. Tighten types in workspace-config.ts
  - [x] 2.1 Add DeepPartial type helper
    - Define DeepPartial<T> type in src/utils/workspace-config.ts
    - _Requirements: 2.1_

  - [x] 2.2 Update map_stata_lsp_json_to_partial_config return type
    - Change return type from `any` to `DeepPartial<StataLSPConfig>`
    - Update internal type annotations to avoid `any`
    - _Requirements: 2.1, 2.2_

  - [x] 2.3 Update read_workspace_file_config_from_root return type
    - Change partial_config type from `any` to `DeepPartial<StataLSPConfig>`
    - _Requirements: 2.3_

  - [x] 2.4 Write property test for config mapping type safety
    - **Property 2: Config Mapping Type Safety**
    - **Validates: Requirements 2.2, 2.3**

- [x] 3. Route ScopeResolver logging through logger interface
  - [x] 3.1 Add ScopeResolverLogger interface to types
    - Define interface with log() and warn() methods
    - _Requirements: 3.1_

  - [x] 3.2 Update ScopeResolver constructor to accept logger
    - Add optional logger parameter to constructor
    - Store logger as private field
    - _Requirements: 3.1_

  - [x] 3.3 Add private log/warn helper methods
    - Create private log() method that routes to logger or console
    - Create private warn() method that routes to logger or console
    - _Requirements: 3.2, 3.3_

  - [x] 3.4 Replace console.log/warn calls with helper methods
    - Update all console.log calls to use this.log()
    - Update all console.warn calls to use this.warn()
    - _Requirements: 3.2, 3.4_

  - [x] 3.5 Update server.ts to pass logger to ScopeResolver
    - Create logger adapter from connection.console
    - Pass to ScopeResolver constructor
    - _Requirements: 3.2_

  - [x] 3.6 Write property test for logger routing
    - **Property 3: Logger Routing**
    - **Validates: Requirements 3.2, 3.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
