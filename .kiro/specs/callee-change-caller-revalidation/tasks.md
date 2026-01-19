# Implementation Plan: Callee Change Caller Revalidation

## Overview

This implementation plan fixes the cache invalidation bug where caller files are not revalidated when callee files change via forward calls. The fix extends the existing reverse dependency tracking to include relationships discovered during forward scope resolution.

## Tasks

- [x] 1. Add bidirectional forward call relationship tracking in ScopeResolver
  - [x] 1.1 Add `forward_caller_to_callees` map to ReverseDependencyIndex
    - Add new Map<string, Set<string>> to track caller→callees for forward calls
    - Initialize in constructor alongside existing maps
    - _Requirements: 5.1, 6.1_
  
  - [x] 1.2 Implement `register_forward_call_relationships_from_cache` method
    - Add method to register caller→callee relationships from parsed forward calls
    - Accept symbols parameter to populate interface_hashes (for detecting meaningful changes)
    - Clear existing relationships for the caller before registering new ones
    - Update BOTH callee_to_callers AND forward_caller_to_callees maps
    - Populate interface_hashes with computed hash from symbols
    - Skip dynamic paths (containing macro references)
    - Use same core logic as update_reverse_dependencies for consistency
    - _Requirements: 1.1, 1.2, 2.2, 5.1, 5.4_
  
  - [x] 1.3 Implement `clear_forward_call_relationships` method with O(M) complexity
    - Use forward_caller_to_callees for O(M) lookup instead of scanning callee_to_callers
    - Remove caller from each callee's caller set
    - Clean up empty sets in callee_to_callers
    - Remove the forward_caller_to_callees entry
    - Clear interface_hashes entry to prevent ghosting on file delete/recreate
    - _Requirements: 1.3, 5.2, 6.1_
  
  - [x] 1.4 Call registration in `get_parsed_file` after caching
    - After successfully parsing and caching a file, call `register_forward_call_relationships_from_cache`
    - Pass the actual URI (after .do fallback resolution), parsed forward calls, AND symbols
    - _Requirements: 1.1, 1.2, 2.2, 5.1_

- [x] 2. Add scope cache secondary index for efficient invalidation
  - [x] 2.1 Add `uri_to_cache_keys` secondary index to ScopeCache
    - Add Map<string, Set<string>> to track uri→cache_keys
    - Update when adding entries to scope_cache
    - Update when removing entries from scope_cache
    - _Requirements: 6.2_
  
  - [x] 2.2 Implement `invalidate_scope_cache_for_uri` with O(1) lookup
    - Use uri_to_cache_keys for instant lookup of cache entries
    - Delete all cache entries for the URI
    - Clean up the uri_to_cache_keys entry
    - _Requirements: 6.2_

- [x] 3. Update cache invalidation to cascade to callers
  - [x] 3.1 Extend `invalidate_file_cache` to clear forward call relationships
    - Call `clear_forward_call_relationships` when invalidating file cache
    - Ensure this happens before cascading to scope caches
    - _Requirements: 1.3, 5.2_
  
  - [x] 3.2 Extend `invalidate_file_cache` to invalidate caller scope caches
    - Look up all callers from `callee_to_callers` for the invalidated URI
    - Use `invalidate_scope_cache_for_uri` for O(1) invalidation
    - Log the number of caller caches invalidated
    - _Requirements: 2.1, 2.3, 6.2_

- [x] 4. Add forward-call URIs to dependent_uris for cascade invalidation
  - [x] 4.1 Update `resolve()` to include forward-call callee URIs in dependent_uris
    - After processing forward calls, add all source URIs to dependent_uris
    - This enables cascade_invalidate_scope_cache_for_uri to handle transitive invalidation
    - _Requirements: 3.4_

- [x] 5. Implement transitive caller discovery in server-factory
  - [x] 5.1 Implement `get_transitive_callers` helper function
    - Use BFS traversal of callee_to_callers map
    - Respect config.cross_file.max_chain_depth as the depth limit
    - Handle cycles via visited set
    - _Requirements: 3.1, 3.2_
  
  - [x] 5.2 Update `schedule_caller_revalidation` to use transitive discovery
    - Call get_transitive_callers instead of just immediate callers
    - Prioritize open documents over closed documents
    - Respect max_callee_revalidations limit
    - _Requirements: 3.2, 4.1, 4.3_
  
  - [x] 5.3 Wire up file watcher to trigger revalidation
    - In onDidChangeWatchedFiles handler, call invalidate_file_cache(uri)
    - Then call schedule_caller_revalidation(uri) to revalidate transitive callers
    - This ensures callers see fresh data from disk after external changes
    - _Requirements: 2.1, 2.2, 3.2_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add unit tests for new functionality
  - [x] 7.1 Write unit tests for `register_forward_call_relationships_from_cache`
    - Test registration with single forward call
    - Test registration with multiple forward calls
    - Test that dynamic paths are skipped
    - Test that existing relationships are cleared before registration
    - Test that both callee_to_callers and forward_caller_to_callees are updated
    - _Requirements: 1.1, 1.2, 5.1, 5.3_
  
  - [x] 7.2 Write unit tests for `clear_forward_call_relationships`
    - Test clearing relationships for a caller with multiple callees
    - Test clearing when caller has no relationships (no-op)
    - Test that other callers' relationships are preserved
    - Test that interface_hashes entry is cleared (prevents ghosting)
    - Test O(M) complexity (no full map scan)
    - _Requirements: 1.3, 5.2, 6.1_
  
  - [x] 7.3 Write unit tests for scope cache secondary index
    - Test uri_to_cache_keys is updated on cache add
    - Test uri_to_cache_keys is updated on cache remove
    - Test invalidate_scope_cache_for_uri uses O(1) lookup
    - _Requirements: 6.2_
  
  - [x] 7.4 Write unit tests for cache invalidation cascade
    - Test that invalidating callee file cache invalidates caller scope caches
    - Test with multiple callers of the same callee
    - Test that callers not in callee_to_callers are unaffected
    - _Requirements: 2.1, 2.3_
  
  - [x] 7.5 Write unit tests for transitive caller discovery
    - Test A→B→C chain: changing C finds both A and B
    - Test diamond pattern: A→B, A→C, B→D, C→D
    - Test cycle handling: A→B→A
    - Test max_chain_depth limiting
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 8. Add property tests for correctness properties
  - [x] 8.1 Write property test for forward call relationship registration
    - **Property 1: Forward Call Relationship Registration**
    - Generate random forward calls, register them, verify all static calls are in both maps
    - **Validates: Requirements 1.1, 1.2, 5.1**
  
  - [x] 8.2 Write property test for relationship cleanup
    - **Property 2: Relationship Cleanup on Cache Removal**
    - Generate random relationships, clear them, verify no references remain
    - Verify O(M) complexity by checking forward_caller_to_callees is used
    - **Validates: Requirements 1.3, 5.2, 6.1**
  
  - [x] 8.3 Write property test for caller scope cache invalidation
    - **Property 3: Caller Scope Cache Invalidation**
    - Generate random call graph, invalidate callee, verify caller scope caches invalidated
    - Verify uri_to_cache_keys is used for O(1) lookup
    - **Validates: Requirements 2.1, 2.3, 6.2**
  
  - [x] 8.4 Write property test for transitive caller discovery
    - **Property 4: Transitive Caller Discovery**
    - Generate random DAG call graphs, verify all transitive callers are found
    - **Validates: Requirements 3.1, 3.2, 3.3**
  
  - [x] 8.5 Write property test for atomic relationship update
    - **Property 6: Atomic Relationship Update**
    - Generate old and new forward calls, update, verify only new relationships exist
    - **Validates: Requirements 5.3**
  
  - [x] 8.6 Write property test for forward-call URIs in dependent_uris
    - **Property 7: Forward Call URIs in dependent_uris**
    - Generate forward calls, resolve scope, verify source URIs in dependent_uris
    - **Validates: Requirements 3.4**

- [x] 9. Add integration test for end-to-end behavior
  - [x] 9.1 Write integration test for callee change triggering caller revalidation
    - Create caller.do with `include callee.do` and `display "`fruit'"`
    - Create callee.do with `local fruit apple`
    - Simulate editing callee.do to rename `fruit` to `fruits`
    - Verify caller.do diagnostics are updated to show undefined macro warning
    - _Requirements: 2.2, 3.1_
  
  - [x] 9.2 Write integration test for transitive revalidation
    - Create A.do that calls B.do, B.do that calls C.do
    - Edit C.do to change exported symbols
    - Verify both A.do and B.do are revalidated
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases

## Key Design Decisions (from feedback)

1. **O(M) Cleanup**: Use `forward_caller_to_callees` bidirectional map to avoid O(N) scans of `callee_to_callers` during cleanup
2. **Transitive Invalidation**: Add forward-call callee URIs to `dependent_uris` in ScopeCacheEntry to enable automatic cascade invalidation
3. **Scope Cache Index**: Maintain `uri_to_cache_keys` secondary index for O(1) scope cache invalidation by URI
4. **Transitive Revalidation**: Use BFS traversal of `callee_to_callers` in `schedule_caller_revalidation` to find all transitive callers (respecting `config.cross_file.max_chain_depth`)
5. **Unified Tracking**: Use same core logic for open documents and cached files to ensure consistent dependency tracking
6. **Interface Hash Population**: Pass symbols to `register_forward_call_relationships_from_cache` to populate `interface_hashes` for detecting meaningful changes
7. **Cleanup Symmetry**: Clear `interface_hashes` entry in `clear_forward_call_relationships` to prevent ghosting on file delete/recreate
8. **File Watcher Integration**: Wire `onDidChangeWatchedFiles` to call both `invalidate_file_cache` and `schedule_caller_revalidation`
