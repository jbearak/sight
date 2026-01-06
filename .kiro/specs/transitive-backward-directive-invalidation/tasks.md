# Implementation Plan: Transitive Backward Directive Invalidation

## Overview

This implementation adds transitive backward directive dependency tracking to the ScopeResolver, ensuring that when a file's interface changes, all files in the directive chain are revalidated.

## Tasks

- [x] 1. Implement transitive dependency lookup in ScopeResolver
  - [x] 1.1 Add `get_transitive_backward_directive_children` method
    - Implement BFS traversal of `backward_directive_children` map
    - Include cycle detection via visited set
    - Respect max_depth parameter (default to config.max_chain_depth)
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 1.2 Write property test for transitive propagation
    - **Property 1: Transitive Invalidation Propagation**
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 1.3 Write property test for cycle detection
    - **Property 2: Cycle Detection Terminates**
    - **Validates: Requirements 1.4**

  - [x] 1.4 Write property test for depth limiting
    - **Property 3: Depth Limiting Respected**
    - **Validates: Requirements 1.5**

- [x] 2. Update server-factory to use transitive dependents
  - [x] 2.1 Modify revalidation trigger to use transitive dependents
    - Replace `get_backward_directive_children` call with `get_transitive_backward_directive_children`
    - Update logging to show transitive dependent count
    - _Requirements: 1.2_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integration testing
  - [x] 4.1 Write integration test for directive chain revalidation
    - Create three-file directive chain (a.do → b.do → c.do)
    - Modify root file to remove a global macro
    - Verify all three files receive updated diagnostics
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The existing `backward_directive_children` data structure is reused; no new data structures needed
- The BFS algorithm is O(V + E) where V is number of files and E is number of directive relationships
