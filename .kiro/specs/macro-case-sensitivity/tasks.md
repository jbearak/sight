# Implementation Plan: Macro Completion Prefix Filtering

## Overview

Add prefix filtering to macro completions so that typing `` `a `` returns only macros starting with "a" (case-sensitive).

## Tasks

- [x] 1. Add prefix extraction helper
  - Add `get_macro_prefix()` method to CompletionProvider
  - Handle local macro prefix (text after backtick)
  - Handle global macro prefix (text after $ or ${)
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Update get_macro_completions to filter by prefix
  - [x] 2.1 Add position parameter to method signature
    - Update call site in `get_completions()` to pass position
    - _Requirements: 1.1, 1.2_
  - [x] 2.2 Implement case-sensitive prefix filtering
    - Filter macros where name.startsWith(prefix)
    - Return all macros when prefix is empty
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_
  - [x] 2.3 Add alphabetical sorting
    - Sort completions by label
    - _Requirements: 1.5_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Write property tests for macro completion filtering
  - [x] 4.1 Write property test for prefix matching
    - **Property 1: Prefix Matching Completions**
    - **Validates: Requirements 1.1, 1.2**
  - [x] 4.2 Write property test for empty prefix
    - **Property 2: Empty Prefix Returns All Macros**
    - **Validates: Requirements 1.3, 1.4**
  - [x] 4.3 Write property test for sorting
    - **Property 3: Completions Are Sorted Alphabetically**
    - **Validates: Requirements 1.5**
  - [x] 4.4 Write property test for no match
    - **Property 4: No Match Returns Empty**
    - **Validates: Requirements 1.6**

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- The existing `detect_macro_context()` function already identifies when we're in a macro context
- The prefix extraction logic is similar to what's already in `detect_macro_context()` but needs to return the actual prefix text
