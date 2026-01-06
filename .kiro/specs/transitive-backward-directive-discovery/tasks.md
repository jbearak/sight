# Implementation Plan: Transitive Backward Directive Discovery

## Overview

This implementation ensures backward directive dependencies are registered when files are added to the file parse cache, not just when files are opened in the editor.

## Tasks

- [ ] 1. Register backward directive dependencies when caching files
  - [ ] 1.1 Add call to register dependencies in `get_or_parse_file_with_cache`
    - After `file_cache.set()`, call existing methods to register dependencies
    - Reuse existing `register_backward_directive_dependency()` method
    - _Requirements: 2.1_

  - [ ] 1.2 Write property test for cache population
    - **Property 1: Cache Population Registers Dependencies**
    - **Validates: Requirements 2.1**

- [ ] 2. Clear backward directive dependencies on cache invalidation
  - [ ] 2.1 Update `invalidate_file_cache` to clear backward directive dependencies
    - Call `clear_backward_directive_dependencies(uri)` when invalidating
    - _Requirements: 2.2, 2.3_

  - [ ] 2.2 Write property test for cache invalidation
    - **Property 3: Cache Invalidation Clears Dependencies**
    - **Validates: Requirements 2.2, 2.3**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Integration testing
  - [ ] 4.1 Write integration test for transitive discovery from cache
    - Create three-file directive chain (a.do → b.do → c.do)
    - Open only c.do (which caches b.do during scope resolution)
    - Verify `get_transitive_backward_directive_children(a.do)` returns both b.do and c.do
    - **Property 2: Transitive Discovery Uses Cached Relationships**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The fix reuses existing methods (`register_backward_directive_dependency`, `clear_backward_directive_dependencies`)
- No new data structures needed - just ensuring the existing map is populated at the right time
- The change is minimal: add one call when caching, add one call when invalidating

