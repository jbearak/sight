# Implementation Plan: Out-of-Scope Diagnostic Message Fix

## Overview

This implementation plan addresses the bug where local macros excluded due to inheritance rules display incorrect diagnostic messages. The fix adds deduplication logic to `ScopeResolver` to ensure the correct reason is preserved when a symbol could be excluded for multiple reasons.

## Tasks

- [-] 1. Add out-of-scope deduplication helper method
  - [-] 1.1 Implement `add_out_of_scope_symbols()` method in ScopeResolver
    - Add private method that deduplicates entries by symbol name
    - Prioritize `inheritance_excludes_locals` over `after_call_site`
    - Handle edge cases (empty array, same reason)
    - _Requirements: 1.2, 2.1, 2.2_

  - [ ] 1.2 Write unit tests for `add_out_of_scope_symbols()`
    - Test adding to empty array
    - Test adding new symbol (no existing entry)
    - Test replacing `after_call_site` with `inheritance_excludes_locals`
    - Test keeping `inheritance_excludes_locals` when adding `after_call_site`
    - _Requirements: 1.2, 2.1_

- [ ] 2. Update out_of_scope population call sites
  - [ ] 2.1 Replace first `out_of_scope.push()` call (line ~876)
    - Change `out_of_scope.push(...excluded_locals)` to use helper method
    - _Requirements: 1.3_

  - [ ] 2.2 Replace second `out_of_scope.push()` call (line ~882)
    - Change `out_of_scope.push(...my_out_of_scope)` to use helper method
    - _Requirements: 2.2_

  - [ ] 2.3 Replace third `out_of_scope.push()` call (line ~914)
    - Change `out_of_scope.push(...excluded_locals)` to use helper method
    - _Requirements: 1.3, 2.2_

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Write property tests for correctness properties
  - [ ] 4.1 Write property test for out-of-scope reason prioritization
    - **Property 1: Out-of-Scope Reason Prioritization**
    - **Validates: Requirements 1.2, 2.1, 2.2**

  - [ ] 4.2 Write property test for correct inheritance-excluded message
    - **Property 2: Correct Message for Inheritance-Excluded Locals**
    - **Validates: Requirements 1.1, 3.2**

  - [ ] 4.3 Write property test for no duplicate entries
    - **Property 4: No Duplicate Out-of-Scope Entries**
    - **Validates: Requirements 2.1**

- [ ] 5. Write integration test for bug scenario
  - [ ] 5.1 Create integration test with exact bug scenario
    - Create file hierarchy: survey.do -> bh_vars.do -> bircmc.do
    - Verify diagnostic message says "local macros are not inherited via do/run"
    - _Requirements: 1.1_

- [ ] 6. Update HoverProvider to suppress unrelated symbol info for out-of-scope references
  - [ ] 6.1 Add `get_reference_type_from_context()` helper method
    - Detect local macro syntax (`` `word' ``)
    - Detect global macro syntax (`$word` or `${word}`)
    - Return 'other' for bare identifiers
    - _Requirements: 4.4_

  - [ ] 6.2 Add `is_reference_out_of_scope()` helper method
    - Check if symbol is in out_of_scope_symbols
    - Match the out-of-scope symbol type to the reference type
    - _Requirements: 4.1, 4.2_

  - [ ] 6.3 Update `collect_all_symbol_matches()` to filter based on reference type
    - If reference is out-of-scope for its type, return empty matches
    - Let diagnostic message be the primary information
    - _Requirements: 4.1, 4.2_

  - [ ] 6.4 Write unit tests for hover suppression
    - Test that hover returns null for out-of-scope local macro references
    - Test that hover still works for valid variable references with same name
    - Test that hover still works for in-scope symbols
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
