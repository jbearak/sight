# Implementation Plan: Callee Change Caller Revalidation

## Overview

This implementation plan fixes the cache invalidation bug where caller files are not revalidated when callee files change via forward calls. The fix extends the existing reverse dependency tracking to include relationships discovered during forward scope resolution.

## Tasks

- [ ] 1. Add forward call relationship registration in ScopeResolver
  - [ ] 1.1 Implement `register_forward_call_relationships_from_cache` method
    - Add method to register caller→callee relationships from parsed forward calls
    - Clear existing relationships for the caller before registering new ones
    - Skip dynamic paths (containing macro references)
    - _Requirements: 1.1, 1.2, 5.1_
  
  - [ ] 1.2 Implement `clear_forward_call_relationships` method
    - Add method to remove all callee_to_callers entries where the given URI is a caller
    - Handle case where caller has no existing relationships
    - _Requirements: 1.3, 5.2_
  
  - [ ] 1.3 Call registration in `get_parsed_file` after caching
    - After successfully parsing and caching a file, call `register_forward_call_relationships_from_cache`
    - Pass the actual URI (after .do fallback resolution) and parsed forward calls
    - _Requirements: 1.1, 1.2, 5.1_

- [ ] 2. Update cache invalidation to cascade to callers
  - [ ] 2.1 Extend `invalidate_file_cache` to clear forward call relationships
    - Call `clear_forward_call_relationships` when invalidating file cache
    - Ensure this happens before cascading to scope caches
    - _Requirements: 1.3, 5.2_
  
  - [ ] 2.2 Extend `invalidate_file_cache` to invalidate caller scope caches
    - Look up all callers from `callee_to_callers` for the invalidated URI
    - Delete scope cache entries for each caller
    - Log the number of caller caches invalidated
    - _Requirements: 2.1, 2.3_
  
  - [ ] 2.3 Extend `invalidate_scope_cache` to also invalidate caller scope caches
    - When a file's scope cache is invalidated, also invalidate callers
    - This handles in-memory edits (didChange) that don't go through file cache
    - _Requirements: 2.1_

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add unit tests for new functionality
  - [ ] 4.1 Write unit tests for `register_forward_call_relationships_from_cache`
    - Test registration with single forward call
    - Test registration with multiple forward calls
    - Test that dynamic paths are skipped
    - Test that existing relationships are cleared before registration
    - _Requirements: 1.1, 1.2, 5.1, 5.3_
  
  - [ ] 4.2 Write unit tests for `clear_forward_call_relationships`
    - Test clearing relationships for a caller with multiple callees
    - Test clearing when caller has no relationships (no-op)
    - Test that other callers' relationships are preserved
    - _Requirements: 1.3, 5.2_
  
  - [ ] 4.3 Write unit tests for cache invalidation cascade
    - Test that invalidating callee file cache invalidates caller scope caches
    - Test with multiple callers of the same callee
    - Test that callers not in callee_to_callers are unaffected
    - _Requirements: 2.1, 2.3_

- [ ] 5. Add property tests for correctness properties
  - [ ] 5.1 Write property test for forward call relationship registration
    - **Property 1: Forward Call Relationship Registration**
    - Generate random forward calls, register them, verify all static calls are in callee_to_callers
    - **Validates: Requirements 1.1, 1.2, 5.1**
  
  - [ ] 5.2 Write property test for relationship cleanup
    - **Property 2: Relationship Cleanup on Cache Removal**
    - Generate random relationships, clear them, verify no references remain
    - **Validates: Requirements 1.3, 5.2**
  
  - [ ] 5.3 Write property test for caller scope cache invalidation
    - **Property 3: Caller Scope Cache Invalidation**
    - Generate random call graph, invalidate callee, verify caller scope caches invalidated
    - **Validates: Requirements 2.1, 2.3**
  
  - [ ] 5.4 Write property test for atomic relationship update
    - **Property 6: Atomic Relationship Update**
    - Generate old and new forward calls, update, verify only new relationships exist
    - **Validates: Requirements 5.3**

- [ ] 6. Add integration test for end-to-end behavior
  - [ ] 6.1 Write integration test for callee change triggering caller revalidation
    - Create caller.do with `include callee.do` and `display "`fruit'"`
    - Create callee.do with `local fruit apple`
    - Simulate editing callee.do to rename `fruit` to `fruits`
    - Verify caller.do diagnostics are updated to show undefined macro warning
    - _Requirements: 2.2, 3.1_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
