# Implementation Plan: Hover Out-of-Scope Display

## Overview

This implementation adds out-of-scope symbol display to the HoverProvider, showing "(out of scope)" indicator instead of falling through to unrelated symbols.

## Tasks

- [x] 1. Implement out-of-scope hover generation
  - [x] 1.1 Add `get_out_of_scope_hover` method to HoverProvider
    - Create new private method that takes word, reference_type, resolved_scope, current_uri, workspace_root
    - Return null if resolved_scope is undefined or reference_type is 'other'
    - Find matching out-of-scope symbol by name and type
    - Generate MarkupContent with "(out of scope)" indicator and source link
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

  - [x] 1.2 Modify `collect_all_symbol_matches` to use out-of-scope hover
    - Replace the early return of empty array with call to `get_out_of_scope_hover`
    - Return single-element array with out-of-scope match if found
    - Fall through to existing logic if no out-of-scope match
    - _Requirements: 1.3, 2.3, 3.2_

- [x] 2. Update unit tests
  - [x] 2.1 Update hover-suppression.test.ts for new behavior
    - Change test "should return empty matches for out-of-scope local macro reference" to expect out-of-scope match
    - Add test for out-of-scope global macro reference
    - Add test verifying "(out of scope)" text in hover content
    - Add test verifying source link in hover content
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

  - [x] 2.2 Update integration test for get_hover
    - Change test "should return null for out-of-scope local macro reference" to expect hover with indicator
    - Add test for global macro out-of-scope hover
    - _Requirements: 1.1, 2.1_

- [x] 3. Add property-based tests
  - [x] 3.1 Write property test for out-of-scope indicator presence
    - **Property 1: Out-of-Scope Indicator Presence**
    - **Validates: Requirements 1.1, 2.1, 3.1**

  - [x] 3.2 Write property test for source information inclusion
    - **Property 2: Source Information Inclusion**
    - **Validates: Requirements 1.2, 2.2**

  - [x] 3.3 Write property test for no fallthrough behavior
    - **Property 3: No Fallthrough for Out-of-Scope Macros**
    - **Validates: Requirements 1.3, 2.3**

  - [x] 3.4 Write property test for reference type matching
    - **Property 4: Reference Type Matching**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The implementation is localized to `src/providers/hover.ts`
- Existing `OutOfScopeSymbol` type provides all needed information
- No changes to scope resolution logic required
