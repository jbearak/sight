# Implementation Plan: Outline Variable Definitions

## Overview

Add variable definitions (from `gen` and `egen` commands) to the document outline in the Sight LSP. The implementation extends the existing `SymbolProvider` class with minimal changes.

## Tasks

- [x] 1. Add variable symbols to document outline
  - [x] 1.1 Add variable extraction loop in get_document_symbols()
    - Add loop over `document.symbols.variables` after matrices section
    - Filter to only include variables with `source === 'gen'` or `source === 'egen'`
    - Create DocumentSymbol with `kind: SymbolKind.Field`
    - Set detail to `Variable (${variable.source})`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Write property test for variable source filtering
    - **Property 1: Variable Source Filtering**
    - Generate documents with variables from all source types
    - Verify only gen/egen variables appear in outline
    - **Validates: Requirements 1.1, 1.2**

  - [x] 1.3 Write property test for variable symbol format
    - **Property 2: Variable Symbol Format**
    - Verify kind is SymbolKind.Field
    - Verify detail matches `Variable (gen)` or `Variable (egen)`
    - Verify name equals variable name unchanged
    - **Validates: Requirements 1.3, 1.4, 1.5**

- [x] 2. Checkpoint - Verify basic functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Verify ordering and section integration
  - [x] 3.1 Verify variables are sorted with other symbols
    - The existing sorting logic at the end of get_document_symbols() handles this
    - No code changes needed - just verify behavior
    - _Requirements: 2.1_

  - [x] 3.2 Write property test for document order preservation
    - **Property 3: Document Order Preservation**
    - Generate documents with mixed symbol types at random positions
    - Verify output is sorted by start position
    - **Validates: Requirements 2.1**

  - [x] 3.3 Verify section nesting works for variables
    - The existing nest_in_sections() function handles this automatically
    - No code changes needed - variables are treated like other symbols
    - _Requirements: 2.2_

  - [x] 3.4 Write property test for section nesting consistency
    - **Property 4: Section Nesting Consistency**
    - Generate documents with sections and variables
    - Verify variables nest under containing sections
    - **Validates: Requirements 2.2**

- [x] 4. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The workspace symbols functionality already includes variables - no changes needed there
- The implementation follows existing patterns for scalars and matrices
- Property tests should run minimum 100 iterations each
