# Implementation Plan: Document Symbols Enhancement

## Overview

This plan implements hierarchical document symbols with scalar/matrix support in `src/providers/symbols.ts`. The approach builds program symbols first, then assigns local macros to programs or top-level based on range containment.

## Tasks

- [x] 1. Add helper functions for range containment
  - [x] 1.1 Implement is_position_in_range() helper
    - Add function to check if a Position falls within a Range (inclusive both ends)
    - Handle edge case where position is on the last line of range
    - _Requirements: 3.3_
  - [x] 1.2 Implement find_containing_program() helper
    - Add function to find the smallest program range containing a macro
    - Return null if no program contains the macro
    - _Requirements: 3.4_
  - [x] 1.3 Write unit tests for range containment helpers
    - Test boundary positions (start line, end line, middle)
    - Test position outside all programs
    - Test smallest-range selection when multiple programs contain position
    - _Requirements: 3.3, 3.4_

- [x] 2. Add scalar and matrix symbols to get_document_symbols()
  - [x] 2.1 Add scalars from document.symbols.scalars
    - Filter by sourceUri matching document.uri
    - Use SymbolKind.Variable and detail "Scalar"
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.2 Add matrices from document.symbols.matrices
    - Filter by sourceUri matching document.uri
    - Use SymbolKind.Variable and detail "Matrix"
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.3 Write unit tests for scalar and matrix symbols
    - Test document with scalar returns symbol with correct kind/detail
    - Test document with matrix returns symbol with correct kind/detail
    - Test URI filtering excludes symbols from other files
    - _Requirements: 1.1-1.4, 2.1-2.4_

- [x] 3. Implement hierarchical nesting for local macros
  - [x] 3.1 Refactor get_document_symbols() to build program symbols first
    - Create program DocumentSymbols with empty children arrays
    - Store program ranges for containment checking (prefer AST ranges)
    - _Requirements: 3.1, 5.1_
  - [x] 3.2 Implement local macro assignment logic
    - For each local macro, check if it falls within any program range
    - If inside program, add to program's children array
    - If outside all programs, add as top-level symbol
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 3.3 Write unit tests for local macro nesting
    - Test local inside program appears as child
    - Test local outside program appears at top level
    - Test local on last line of program is nested (boundary case)
    - Test document with no programs has all locals at top level
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 5.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write property test for containment correctness
  - [x] 5.1 Write property test for local macro containment
    - **Property 4: Local macro containment and nesting**
    - Generate documents with programs and local macros at various positions
    - Verify locals inside program ranges appear as children
    - Verify locals outside programs appear at top level
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Range containment uses inclusive bounds on both ends to match codebase conventions
- Prefer AST program node ranges over symbol table ranges for accuracy
- All locals within programs use "Local Macro" detail (no implicit/explicit distinction)
