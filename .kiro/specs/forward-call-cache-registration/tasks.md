# Implementation Plan: Forward Call Cache Registration

## Overview

This implementation ensures forward call relationships are registered when files are added to the file parse cache, not just when files are opened in the editor.

## Tasks

- [ ] 1. Register forward call relationships when caching files
  - [ ] 1.1 Add method to register forward call relationships from cached forward calls
    - Create helper method to register callee → caller relationships
    - Only register static forward calls (skip dynamic paths with macros)
    - Use existing `callee_to_callers` map structure
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Call registration method in `get_or_parse_file_with_cache`
    - After `file_cache.set()`, call the registration method
    - Pass the URI and forward_calls from the parse result
    - _Requirements: 1.1_

  - [ ] 1.3 Write property test for cache population
    - **Property 1: Cache Population Registers Forward Call Relationships**
    - **Validates: Requirements 1.1, 1.2**

- [ ] 2. Clear forward call relationships on cache invalidation
  - [ ] 2.1 Add method to clear forward call relationships for a caller
    - Remove the caller from all callee entries in `callee_to_callers`
    - Clean up empty sets
    - _Requirements: 1.3_

  - [ ] 2.2 Call clearing method in `invalidate_file_cache`
    - Before deleting from file_cache, clear forward call relationships
    - _Requirements: 1.3_

  - [ ] 2.3 Write property test for cache invalidation
    - **Property 2: Cache Invalidation Clears Forward Call Relationships**
    - **Validates: Requirements 1.3**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Integration testing
  - [ ] 4.1 Write integration test for forward call lookup from cache
    - Create four files: loop.do, import_metadata.do, survey.do, bh_vars.do
    - loop.do calls import_metadata.do and survey.do
    - survey.do has @lsp-done-by: loop.do
    - bh_vars.do has @lsp-included-by: survey.do
    - Resolve scope for bh_vars.do (caches loop.do)
    - Verify `get_callers_for_callee(import_metadata.do)` returns loop.do
    - **Property 3: Callee Lookup Finds Cached Callers**
    - **Validates: Requirements 1.1, 2.1**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The fix mirrors the backward directive cache registration fix
- Uses existing `callee_to_callers` map structure
- Only registers static forward calls (dynamic paths with macros are skipped)

