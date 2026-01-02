# Implementation Plan: Hover Multi-Symbol Display

## Overview

This implementation enhances the HoverProvider to display all matching symbol types and adds cross-file variable resolution with source links. The approach refactors `get_hover()` to collect matches first, then format based on match count.

## Tasks

- [x] 1. Add SymbolMatch type and collection method
  - [x] 1.1 Add SymbolMatch interface to hover.ts
    - Define type with `type` field for symbol category and `content` field for MarkupContent
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Implement collect_all_symbol_matches() method
    - Create private method that calls individual symbol matchers
    - Return array of SymbolMatch objects in display order
    - _Requirements: 1.1, 1.3_

- [x] 2. Enhance variable hover with cross-file resolution
  - [x] 2.1 Update get_variable_hover() signature and implementation
    - Add workspace_symbols, resolved_scope, workspace_root parameters
    - Implement lookup precedence: resolved_scope → document.symbols → workspace_symbols
    - Add source link formatting using format_source_link()
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1_

  - [x] 2.2 Write property test for variable lookup precedence
    - **Property 3: Variable Lookup Precedence**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 3. Implement multi-symbol formatting
  - [x] 3.1 Implement format_multi_symbol_hover() method
    - Single match: return content directly without heading
    - Multiple matches: add markdown headings and separators
    - _Requirements: 1.2, 1.4_

  - [x] 3.2 Write property test for multi-symbol display completeness
    - **Property 1: Multi-Symbol Display Completeness and Ordering**
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 3.3 Write property test for single symbol format preservation
    - **Property 2: Single Symbol Display Preserves Format**
    - **Validates: Requirements 1.4**

- [x] 4. Refactor get_hover() to use new collection approach
  - [x] 4.1 Modify get_hover() main logic
    - Replace sequential short-circuit checks with collect_all_symbol_matches()
    - Use format_multi_symbol_hover() for formatting
    - Preserve fallback to command database when no symbols match
    - _Requirements: 1.1, 1.4, 1.5_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write property test for variable source link consistency
  - **Property 4: Variable Source Link Consistency**
  - **Validates: Requirements 2.2, 4.1**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The existing format_source_link() method is reused for variable source links
