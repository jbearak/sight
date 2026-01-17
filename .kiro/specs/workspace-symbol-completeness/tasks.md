# Implementation Plan: Workspace Symbol Completeness

## Overview

This implementation adds iteration over variables, scalars, matrices, and local macros from the workspace index in the `get_workspace_symbols()` method, following the existing pattern for programs and global macros.

## Tasks

- [x] 1. Add workspace index symbol iteration
  - [x] 1.1 Add variables iteration from workspace_symbols
    - Add loop over `workspace_symbols.variables` in `get_workspace_symbols()`
    - Use `SymbolKind.Field` and containerName `'Variable'`
    - Follow existing pattern for case-insensitive matching
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.2 Add scalars iteration from workspace_symbols
    - Add loop over `workspace_symbols.scalars` in `get_workspace_symbols()`
    - Use `SymbolKind.Variable` and containerName `'Scalar'`
    - _Requirements: 2.1, 2.2_
  
  - [x] 1.3 Add matrices iteration from workspace_symbols
    - Add loop over `workspace_symbols.matrices` in `get_workspace_symbols()`
    - Use `SymbolKind.Variable` and containerName `'Matrix'`
    - _Requirements: 3.1, 3.2_
  
  - [x] 1.4 Add local macros iteration from workspace_symbols
    - Add loop over `workspace_symbols.localMacros` in `get_workspace_symbols()`
    - Use `SymbolKind.Variable`, backtick-quote syntax for name, and containerName `'Local Macro'`
    - _Requirements: 4.1, 4.2_

- [x] 2. Checkpoint - Verify implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Add unit tests
  - [x] 3.1 Add unit test for variables from workspace index
    - Test that variables in workspace_symbols appear in results
    - _Requirements: 1.1, 1.2_
  
  - [x] 3.2 Add unit test for scalars from workspace index
    - Test that scalars in workspace_symbols appear in results
    - _Requirements: 2.1, 2.2_
  
  - [x] 3.3 Add unit test for matrices from workspace index
    - Test that matrices in workspace_symbols appear in results
    - _Requirements: 3.1, 3.2_
  
  - [x] 3.4 Add unit test for local macros from workspace index
    - Test that local macros in workspace_symbols appear in results
    - _Requirements: 4.1, 4.2_

- [x] 4. Add property-based tests
  - [x] 4.1 Write property test for all matching symbols included
    - **Property 1: All Matching Symbols Included**
    - **Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1, 5.2**
  
  - [x] 4.2 Write property test for correct symbol format per type
    - **Property 2: Correct Symbol Format Per Type**
    - **Validates: Requirements 1.2, 2.2, 3.2, 4.2**
  
  - [x] 4.3 Write property test for case-insensitive query matching
    - **Property 3: Case-Insensitive Query Matching**
    - **Validates: Requirements 6.1**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The fix is straightforward - adding 4 loops following the existing pattern
- Property tests validate universal correctness across all inputs
- Unit tests validate specific examples and edge cases
