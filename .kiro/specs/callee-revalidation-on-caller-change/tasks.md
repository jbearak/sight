# Implementation Plan: Callee Revalidation on Caller Change

## Overview

This implementation adds reverse dependency tracking to the LSP, enabling automatic re-validation of callee files when their caller files change. The approach follows Pyright's strategy: interface hashing for stability, prioritized lazy validation, transitive propagation, and work cancellation.

## Tasks

- [ ] 1. Add ReverseDependencyIndex data structure to ScopeResolver
  - [ ] 1.1 Define CallEdge and ReverseDependencyIndex interfaces in types/index.ts
    - Add CallEdge interface with call_type and call_site_line
    - Add InterfaceHash type alias
    - Add ReverseDependencyIndex interface with caller_to_callees, callee_to_callers, and interface_hashes maps
    - _Requirements: 1.2_

  - [ ] 1.2 Initialize ReverseDependencyIndex in ScopeResolver constructor
    - Add private reverse_deps field
    - Initialize empty maps in constructor
    - _Requirements: 1.2_

  - [ ] 1.3 Write property test for ReverseDependencyIndex basic operations
    - **Property 2: Index Maintenance and Diff-Based Invalidation**
    - Test add, remove, update, lookup operations
    - **Validates: Requirements 1.2, 1.3**

- [ ] 2. Implement interface hashing for stability optimization
  - [ ] 2.1 Implement compute_interface_hash method in ScopeResolver
    - Hash symbol names and types (programs, globals, scalars, matrices, variables)
    - Exclude local macros (they don't affect callees via `do`)
    - Use stable sorting for deterministic hashes
    - _Requirements: 2.4_

  - [ ] 2.2 Write property test for interface hash stability
    - **Property 4b: Interface Hashing Stability**
    - Verify same symbols produce same hash regardless of insertion order
    - Verify different symbols produce different hashes
    - Verify non-semantic changes (comments, whitespace, adding @lsp-ignore) do NOT change the hash
    - **Validates: Requirements 2.4**

- [ ] 3. Implement reverse dependency update logic
  - [ ] 3.1 Implement update_reverse_dependencies method in ScopeResolver
    - Extract callee URIs from forward calls (static only)
    - Compute diff between old and new forward calls
    - Update caller_to_callees and callee_to_callers maps
    - Compare old and new interface hashes
    - Return affected callees and interface_changed flag
    - _Requirements: 1.3, 2.1, 2.4_

  - [ ] 3.2 Implement helper method to compute CallEdgeDiff
    - Identify added, removed, and modified edges
    - Handle multiple calls to same callee
    - _Requirements: 1.3, 7.1_

  - [ ] 3.3 Write property test for diff computation
    - **Property 2: Index Maintenance and Diff-Based Invalidation**
    - Generate random forward call sequences
    - Verify diff correctly identifies changes
    - **Validates: Requirements 1.3, 2.1, 2.2**

- [ ] 4. Implement cleanup methods for close and delete
  - [ ] 4.1 Implement remove_caller_from_reverse_deps method
    - Remove all entries where URI is a caller
    - Update callee_to_callers reverse lookup
    - Remove interface hash for closed document
    - _Requirements: 1.4_

  - [ ] 4.2 Implement remove_uri_from_reverse_deps method
    - Remove entries where URI is a caller
    - Remove entries where URI is a callee
    - Update both maps consistently
    - _Requirements: 1.5_

  - [ ] 4.3 Write property test for cleanup operations
    - **Property 3: Cleanup on Close and Delete**
    - Verify no dangling references after cleanup
    - **Validates: Requirements 1.4, 1.5**

- [ ] 5. Implement cascading invalidation with transitive propagation
  - [ ] 5.1 Implement cascade_invalidate method in ScopeResolver
    - Invalidate scope caches for given URIs
    - Check if invalidated URIs are also callers
    - Recursively propagate if callee's interface would change
    - Use visited set to prevent infinite loops
    - Respect max depth limit (crossFile.maxForwardDepth)
    - _Requirements: 2.2, 2.5_

  - [ ] 5.2 Implement invalidate_callee_scope_caches helper method
    - Batch invalidate scope caches for multiple URIs
    - Do NOT invalidate file parse caches
    - _Requirements: 2.2, 2.3_

  - [ ] 5.3 Write property test for transitive propagation
    - **Property 4c: Transitive Propagation**
    - Generate dependency chains (A → B → C)
    - Verify change in A propagates to C only if B's interface changes
    - Verify propagation stops if B's interface remains stable
    - Verify cycle detection (A → B → A) terminates safely
    - Verify max depth enforcement stops recursion
    - **Validates: Requirements 2.5**

- [ ] 6. Checkpoint - Ensure all ScopeResolver tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement prioritized callee re-validation scheduling
  - [ ] 7.1 Add get_document_priority helper function in server.ts
    - Return priority based on document state (active > visible > background)
    - Use document_store or connection state to determine visibility
    - _Requirements: 3.3_

  - [ ] 7.2 Implement schedule_callee_revalidation function in server.ts
    - Sort callees by priority
    - Respect max_callee_revalidations limit (default 10)
    - Only schedule open documents
    - Use setTimeout(0) for batching
    - Log when limit is exceeded
    - _Requirements: 3.1, 3.2, 3.3, 6.2, 6.3, 6.4, 6.5_

  - [ ] 7.3 Write property test for prioritization and limit enforcement
    - **Property 7: Re-validation Limit and Prioritization**
    - Generate scenarios with many callees
    - Verify only top N by priority are scheduled
    - **Validates: Requirements 6.2, 6.3, 6.4**

- [ ] 8. Implement work cancellation for stale re-validations
  - [ ] 8.1 Add cancellation token tracking in server.ts
    - Map from trigger URI to cancellation token
    - Create new token when scheduling re-validation
    - Cancel old token when new change arrives
    - _Requirements: 3.5, 6.6_

  - [ ] 8.2 Implement cancel_pending_revalidations function
    - Cancel all pending re-validations for a caller chain
    - Clear cancelled tokens from tracking map
    - _Requirements: 3.5, 6.6_

  - [ ] 8.3 Write property test for work cancellation
    - **Property 7b: Work Cancellation**
    - Simulate rapid edits ("typing burst")
    - Verify only the *last* re-validation task in a series for the same callee actually executes analysis
    - Verify that a cancelled task yields early without publishing diagnostics
    - **Validates: Requirements 3.5, 6.6**

- [ ] 9. Integrate reverse dependencies into validate_text_document
  - [ ] 9.1 Update validate_text_document to call update_reverse_dependencies
    - Call after document is parsed and symbols extracted
    - Pass forward_calls and symbols to update method
    - _Requirements: 1.1, 1.3_

  - [ ] 9.2 Add callee re-validation scheduling after reverse dep update
    - Check if affected_callees is non-empty or interface_changed
    - Cancel pending re-validations for this caller
    - Schedule new re-validations with prioritization
    - _Requirements: 3.1, 3.2_

  - [ ] 9.3 Write property test for open callee re-validation
    - **Property 4: Prioritized Open Callee Re-validation**
    - Verify open callees are scheduled for re-validation
    - Verify closed callees are not scheduled
    - **Validates: Requirements 3.1, 3.2, 3.4, 6.4**

- [ ] 10. Integrate cleanup into document close and file watcher handlers
  - [ ] 10.1 Update documents.onDidClose handler
    - Call scope_resolver.remove_caller_from_reverse_deps
    - _Requirements: 1.4_

  - [ ] 10.2 Update create_did_change_watched_files_handler for delete events
    - Call scope_resolver.remove_uri_from_reverse_deps
    - _Requirements: 1.5_

- [ ] 11. Checkpoint - Ensure server integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement call type change handling
  - [ ] 12.1 Ensure call type changes trigger invalidation
    - Verify CallEdgeDiff detects call type changes as modifications
    - Verify scope cache is invalidated on call type change
    - _Requirements: 4.1, 4.2_

  - [ ] 12.2 Write property test for call type change inheritance
    - **Property 5: Call Type Change Inheritance**
    - Generate call type changes (do ↔ include)
    - Verify local macro inheritance changes correctly
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ] 12.3 Add directive/call-type mismatch warning in DiagnosticsProvider
    - Detect when @lsp-included-by is used but effective call type is 'do'
    - Emit warning diagnostic in callee
    - _Requirements: 4.4_

- [ ] 13. Implement call site line change handling
  - [ ] 13.1 Ensure call site line changes trigger invalidation
    - Verify CallEdgeDiff detects line changes as modifications
    - Verify scope cache is invalidated on line change
    - _Requirements: 5.1, 5.2_

  - [ ] 13.2 Write property test for call site line change filtering
    - **Property 6: Call Site Line Change Filtering**
    - Generate line insertions/deletions above call site
    - Verify out-of-scope warnings update correctly
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [ ] 14. Handle edge cases
  - [ ] 14.1 Ensure multiple calls to same callee are stored
    - Verify all CallEdge entries are preserved
    - _Requirements: 7.1_

  - [ ] 14.2 Ensure earliest call site line is used for filtering
    - When multiple edges exist, use minimum call_site_line
    - _Requirements: 7.2_

  - [ ] 14.3 Ensure multiple callers are tracked independently
    - Verify callee_to_callers contains all callers
    - _Requirements: 7.3_

  - [ ] 14.4 Write property test for multi-edge storage and resolution
    - **Property 8: Multi-Edge Storage and Deterministic Resolution**
    - Generate complex call graphs
    - Verify all edges stored and earliest line used
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ] 14.5 Handle path resolution changes
    - Detect when working_directory directive changes
    - Re-evaluate affected callees
    - _Requirements: 7.4_

  - [ ] 14.6 Write property test for path resolution changes
    - **Property 9: Path Resolution Change Handling**
    - Generate working directory changes
    - Verify callees are re-evaluated
    - **Validates: Requirements 7.4**

  - [ ] 14.7 Test Callee Rename/Move
    - Simulate a file rename (delete old URI, add new URI)
    - Verify that the ReverseDependencyIndex correctly reflects the removal of the old callee and (after caller update) the addition of the new one.
    - **Validates: Requirements 1.5**

- [ ] 15. Add configuration option for max_callee_revalidations
  - [ ] 15.1 Add cross_file.max_callee_revalidations to config schema
    - Default value: 10
    - Add to StataLSPConfig type
    - Add to DEFAULT_SETTINGS
    - _Requirements: 6.2_

  - [ ] 15.2 Update config-validator.ts to validate the new option
    - Ensure positive integer
    - Apply default if not specified
    - _Requirements: 6.2_

- [ ] 16. Final checkpoint - Run full test suite
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Write integration tests for end-to-end behavior
  - [ ] 17.1 Write integration test: caller edit → callee diagnostic update
    - Edit a caller file
    - Verify callee diagnostics reflect the change
    - _Requirements: 3.4, 3.6_

  - [ ] 17.2 Write integration test: call type change → inheritance change
    - Change `do child.do` to `include child.do`
    - Verify local macros appear in callee scope
    - _Requirements: 4.3_

  - [ ] 17.3 Write integration test: call site line change → out-of-scope warnings
    - Insert lines above a call site
    - Verify out-of-scope warnings update in callee
    - _Requirements: 5.4_

  - [ ] 17.4 Write integration test: interface hash stability
    - Edit caller without changing exported symbols (e.g., adding a comment)
    - Verify callees are NOT re-validated (no `textDocument/publishDiagnostics` sent)
    - _Requirements: 2.4_

  - [ ] 17.5 Write integration test: transitive propagation stopping
    - Change A such that B is re-validated but B's public interface remains the same
    - Verify C (which depends on B) is NOT re-validated
    - _Requirements: 2.5_

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
