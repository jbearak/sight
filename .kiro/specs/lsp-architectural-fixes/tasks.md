# Implementation Plan: LSP Architectural Fixes

## Overview

Incremental implementation of 16 architectural fixes for the Sight Stata LSP server. Changes are ordered so each step builds on the previous: disposable infrastructure first, then debounce pipeline, handler registration, cancellation, token index, and finally correctness guards. All code is TypeScript targeting the existing project structure.

## Tasks

- [ ] 1. Add disposable infrastructure to core components
  - [ ] 1.1 Add `dispose()` to `DocumentDebounceManager`
    - Add `disposed` flag, clear timers/queue/versions on dispose, guard `schedule_validation` with disposed check
    - Add `wait_for_debounce(uri)` method with pending promises/resolvers tracking
    - Update `DebounceManager` interface to include `dispose()` and `wait_for_debounce(uri)`
    - _Requirements: 1.2, 1.5, 10.1, 10.3_

  - [ ]* 1.2 Write property tests for debounce dispose and wait
    - **Property 1: Dispose clears debounce state**
    - **Validates: Requirements 1.5**
    - **Property 11: Debounce wait resolves correctly**
    - **Validates: Requirements 10.1, 10.3**

  - [ ] 1.3 Add `dispose()` to `DocumentStore`
    - Await all active update promises via `Promise.allSettled`, then clear the map
    - Add generation counter tracking (`generations`, `closed_generations` maps)
    - Update `close()` to increment generation and record closed generation
    - Add `commit_state` guard to discard updates for closed/stale generations
    - _Requirements: 1.3, 16.1, 16.2_

  - [ ]* 1.4 Write property test for document close generation safety
    - **Property 14: Closed documents are not reinserted**
    - **Validates: Requirements 16.1, 16.2**

  - [ ] 1.5 Add `dispose()` to `ScopeResolver` and `ForwardScopeResolver`
    - Clear file_cache, scope_cache, uri_to_cache_keys in ScopeResolver
    - Clear internal caches in ForwardScopeResolver
    - _Requirements: 1.4_

- [ ] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Enhance shutdown handler and pending revalidations cleanup
  - [ ] 3.1 Update `create_shutdown_handler` in `server-handlers.ts`
    - Accept `disposables` parameter with `debounce_manager` and `pending_revalidations`
    - Cancel all pending revalidation entries, dispose debounce manager, await document store dispose, dispose scope resolvers, cancel workspace indexer, dispose rename handler
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 15.1, 15.2_

  - [ ]* 3.2 Write unit tests for shutdown handler
    - **Property 2: Cancel pending revalidations on shutdown**
    - **Validates: Requirements 1.1**
    - Test that shutdown awaits active document store updates (Req 1.3)
    - Test that shutdown disposes scope resolvers (Req 1.4)
    - Test that shutdown calls workspace_indexer.cancel() (Req 15.1)

  - [ ] 3.3 Add pending revalidations cleanup after callback completion
    - Delete entry from `pending_revalidations` in the `finally` block of revalidation callbacks
    - Cancel-then-replace when scheduling a new revalidation for an existing URI
    - _Requirements: 7.1, 7.2_

  - [ ]* 3.4 Write unit tests for pending revalidations cleanup
    - **Property 7: Pending revalidations cleaned up after completion**
    - **Validates: Requirements 7.1**
    - **Property 8: Pending revalidation replacement cancels previous**
    - **Validates: Requirements 7.2**

- [ ] 4. Move parse into debounce callback and add request freshness
  - [ ] 4.1 Refactor `validate_text_document` in `server-factory.ts`
    - Capture content snapshot, schedule through debounce_manager
    - Move `document_store.update`/`open` inside the debounce callback
    - Move cross-file revalidation scheduling inside the callback
    - Move diagnostic publication inside the callback
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [ ]* 4.2 Write property test for debounce coalescing
    - **Property 3: Debounce coalesces rapid changes into single callback**
    - **Validates: Requirements 2.2, 3.2**

  - [ ] 4.3 Add `wait_for_debounce` calls in request handlers
    - In completion, hover, definition, references handlers: await `deps.debounce_manager.wait_for_debounce(uri)` before reading document store state
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 4.4 Write unit tests for debounced parse pipeline and request freshness
    - Test parse happens inside callback, not eagerly (Req 2.1, 2.3)
    - Test cross-file revalidation routes through debounce (Req 3.1)
    - Test handlers wait for debounce before reading state (Req 10.2)

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Stable handler registration with mutable deps container
  - [ ] 6.1 Refactor handler registration in `server-factory.ts`
    - Create a single mutable `handler_deps` object with `debounce_manager` as required field
    - Register all handlers once during initialization using this object
    - Include `onDidChangeWatchedFiles` and `sight/getWorkingDirectory` handlers
    - Mutate `handler_deps` properties when providers are initialized later
    - _Requirements: 4.1, 4.2, 4.3, 14.1, 14.2, 14.3_

  - [ ]* 6.2 Write property test for mutable deps visibility
    - **Property 4: Mutable deps container visible to all handlers**
    - **Validates: Requirements 4.2, 4.3, 14.1, 14.2, 14.3**

- [ ] 7. CancellationToken checking in providers and resolvers
  - [ ] 7.1 Add cancellation checks in hover, definition, and references providers
    - Add `cancellation_token` parameter to provider methods that perform token scanning
    - Check `token.isCancellationRequested` every 500 iterations in token scan loops
    - Return null/empty on cancellation
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 7.2 Add cancellation checks in ScopeResolver and ForwardScopeResolver
    - Add `cancellation_token` parameter to `resolve()` and forward-call traversal methods
    - Check cancellation in traversal loops and return early
    - _Requirements: 13.1, 13.2_

  - [ ] 7.3 Add cancellation checks in references workspace scan
    - Check cancellation periodically when scanning workspace-indexed files
    - _Requirements: 13.3_

  - [ ]* 7.4 Write property and unit tests for cancellation
    - **Property 5: Cancellation causes early exit in token scan loops**
    - **Validates: Requirements 5.4, 13.3**
    - **Property 13: Cancellation short-circuits cross-file resolution**
    - **Validates: Requirements 13.1, 13.2**
    - Unit tests for hover/definition/references returning null on pre-cancelled token (Req 5.1, 5.2, 5.3)

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Token position index
  - [ ] 9.1 Add `token_line_index` to `DocumentState` and build during parse
    - Add `token_line_index: Map<number, Token[]>` field to `DocumentState`
    - Implement `build_token_line_index` that registers every line a token spans
    - Call during `create_document_state` and `create_error_state`
    - _Requirements: 6.1, 6.3, 12.1_

  - [ ] 9.2 Add `get_token_at_position` helper method
    - Implement line-bucketed lookup with correct multi-line boundary checks
    - _Requirements: 6.1, 6.2, 12.2_

  - [ ]* 9.3 Write property test for token position index
    - **Property 6: Token position index matches linear scan**
    - **Validates: Requirements 6.1, 12.1, 12.2**

- [ ] 10. Gated debug logging
  - [ ] 10.1 Add `debug` field to `StataLSPConfig` and `DEFAULT_SETTINGS`
    - Add `debug?: boolean` to config type, default to `false`
    - _Requirements: 8.1_

  - [ ] 10.2 Gate logging calls in `validate_text_document` and revalidation scheduling
    - Wrap `connection.console.log` calls with `if (is_debug)` guard
    - Gate `scope_resolver.get_reverse_deps_debug_info()` call behind debug check
    - _Requirements: 8.2, 8.3, 8.4_

  - [ ]* 10.3 Write property and unit tests for debug logging
    - **Property 9: Debug logging gated by config**
    - **Validates: Requirements 8.2, 8.3**
    - Unit test that debug=true emits logs (Req 8.4)

- [ ] 11. Context-aware completion isIncomplete and scope resolver content source
  - [ ] 11.1 Update completion handler to return context-aware `isIncomplete`
    - Detect macro context from completion context type
    - Return `isIncomplete: false` for non-macro contexts, `true` for macro contexts
    - Preserve `isIncomplete: true` fallback when no document state
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 11.2 Write property test for isIncomplete
    - **Property 10: isIncomplete reflects macro context**
    - **Validates: Requirements 9.1, 9.2**

  - [ ] 11.3 Update scope resolver content provider to prefer TextDocuments
    - In `server-factory.ts`, update the `read_file` callback to check `documents.get(uri)` first
    - Fall back to disk read for closed files
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 11.4 Write property test for scope resolver content source
    - **Property 12: Scope resolver uses in-memory content when open**
    - **Validates: Requirements 11.1, 11.3**

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- All code is TypeScript targeting the existing project structure
