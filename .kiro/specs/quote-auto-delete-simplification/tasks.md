# Implementation Plan: Quote Auto-Delete Simplification

## Overview

This plan implements the simplified quote auto-delete logic by replacing the complex `compute_deletion_cleanup` function with two simple rules. The implementation requires adding a document cache to track deleted characters and updating the deletion handler.

## Tasks

- [x] 1. Add document content cache for tracking deleted characters
  - Add `document_cache` Map to store previous document content by URI
  - Add cache update logic in `handle_document_change` to store content before processing
  - Add cache cleanup when documents are closed
  - _Requirements: 1.1, 3.1 (need deleted character to apply rules)_

- [x] 2. Simplify the deletion cleanup function
  - [x] 2.1 Create new `compute_deletion_cleanup` with simplified signature
    - Change signature to `(deleted_char: string, char_to_right: string) => number`
    - Implement the two simple rules: backtick→apostrophe and quote→quote
    - Remove all existing complex pattern matching logic
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 3.2_

  - [x] 2.2 Write property test for backtick deletion cleanup
    - **Property 1: Backtick deletion cleanup**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 2.3 Write property test for apostrophe deletion passthrough
    - **Property 2: Apostrophe deletion passthrough**
    - **Validates: Requirements 2.1**

  - [x] 2.4 Write property test for double quote deletion cleanup
    - **Property 3: Double quote deletion cleanup**
    - **Validates: Requirements 3.1, 3.2**

- [x] 3. Update the deletion handler to use new function
  - [x] 3.1 Modify `handle_character_deletion` to extract deleted character from cache
    - Read the character at the deletion position from cached content
    - Extract the character to the right from current document
    - Call simplified `compute_deletion_cleanup` with both characters
    - _Requirements: 1.1, 3.1_

  - [x] 3.2 Write property test for multi-character deletion passthrough
    - **Property 4: Multi-character deletion passthrough**
    - **Validates: Requirements 5.1, 5.2**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write integration tests for compound string cleanup sequence
  - [x] 5.1 Add unit test for the compound string cleanup example
    - Test the exact sequence from Requirement 4: typing `` `"a`"b `` then backspacing
    - Verify each step produces the expected state
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The document cache adds minimal overhead since we only cache the current line or small context
- The simplified logic removes ~80 lines of complex pattern matching
- Property tests use fast-check library (already in project dependencies)
