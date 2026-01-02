# Implementation Plan: LSP Performance Optimization

## Overview

This plan implements performance optimizations for the Stata LSP server by eliminating redundant parsing, introducing caching layers, and optimizing hot-path algorithms. Tasks are ordered to build incrementally, with property tests validating correctness at each stage.

## Tasks

- [x] 1. Implement Line Offset Index in Lexer
  - [x] 1.1 Modify LexerResult interface to include line_offsets array
    - Add `line_offsets: number[]` to LexerResult in `src/types/index.ts`
    - _Requirements: 3.1, 3.4_
  - [x] 1.2 Build line_offsets during tokenization (single pass)
    - Modify `src/lexer/index.ts` to track newlines and build offsets during tokenization
    - Remove any existing `getStartPosition()` calls that scan from document start
    - _Requirements: 3.1, 3.3_
  - [x] 1.3 Add position_to_offset helper function with column bounds checking
    - Implement in `src/lexer/index.ts` or new utility file
    - Return -1 for out-of-bounds line or column
    - _Requirements: 3.2_
  - [x] 1.4 Write property test for line offset correctness
    - **Property 3: Line Offset Index Correctness**
    - **Validates: Requirements 3.2**
  - [x] 1.5 Write property test for linear tokenization scaling
    - **Property 4: Linear Tokenization Scaling**
    - **Validates: Requirements 3.5**

- [x] 2. Checkpoint - Verify lexer changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement LRU Cache for Completion Prefixes
  - [x] 3.1 Create CompletionPrefixCache class
    - Implement in new file `src/utils/lru-cache.ts`
    - Include context-aware key generation (prefix + context)
    - Include metrics (hits, misses, evictions)
    - _Requirements: 6.1, 6.4_
  - [x] 3.2 Add invalidate_on_db_change method
    - Track command_db_version for cache invalidation
    - _Requirements: 6.3_
  - [x] 3.3 Integrate cache into CompletionProvider
    - Modify `src/providers/completion.ts` to use cache
    - _Requirements: 6.1, 6.2_
  - [x] 3.4 Write property test for LRU cache bounded size
    - **Property 7: LRU Cache Bounded Size**
    - **Validates: Requirements 6.4**
  - [x] 3.5 Write property test for completion cache hit rate
    - **Property 6: Completion Cache Hit Rate**
    - **Validates: Requirements 6.1, 6.2**

- [x] 4. Implement Binary Search for Context Ranges
  - [x] 4.1 Add sorting to ContextTracker.get_all_context_ranges()
    - Ensure ranges sorted by (start.line, start.character)
    - Add debug assertion for sorted invariant
    - Modify `src/context-tracker/index.ts`
    - _Requirements: 7.1_
  - [x] 4.2 Implement find_context_range_binary function
    - Add to `src/context-tracker/index.ts`
    - Handle nested ranges correctly
    - _Requirements: 7.2_
  - [x] 4.3 Replace linear scan with binary search in context lookups
    - Update all context lookup call sites
    - _Requirements: 7.2, 7.3_
  - [x] 4.4 Write property test for context ranges sorted invariant
    - **Property 8: Context Ranges Sorted Invariant**
    - **Validates: Requirements 7.1**
  - [x] 4.5 Write property test for binary search logarithmic scaling
    - **Property 9: Binary Search Logarithmic Scaling**
    - **Validates: Requirements 7.3**

- [x] 5. Checkpoint - Verify utility components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Debounce Manager
  - [x] 6.1 Create DocumentDebounceManager class
    - Implement in new file `src/utils/debounce-manager.ts`
    - Include version tracking for staleness checks
    - Include MAX_QUEUE_LENGTH for backpressure
    - Include metrics (merged_parses, dropped_parses, stale_parses)
    - Auto-scale max_concurrent_parses based on CPU cores
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 6.2 Add is_pending method for diagnostics integration
    - Return true if document has pending parse in timer or queue
    - _Requirements: 5.4_
  - [x] 6.3 Add logging for dropped parses (backpressure visibility)
    - Log when MAX_QUEUE_LENGTH exceeded with uri and version
    - Tie to metrics.dropped_parses counter
    - _Requirements: Error Handling_
  - [x] 6.4 Write property test for debounce batching
    - **Property 5: Debounce Batching**
    - **Validates: Requirements 5.1, 5.3**

- [x] 7. Implement Parse Timeout Wrapper
  - [x] 7.1 Create with_parse_timeout function
    - Implement in new file `src/utils/parse-timeout.ts`
    - Return ParseResult with success, result, error, timed_out fields
    - Default timeout 5 seconds
    - _Requirements: Error Handling_

- [x] 8. Enhance DocumentState and DocumentStore
  - [x] 8.1 Update DocumentState interface
    - Add tokens, context_tracker, line_offsets fields
    - Modify `src/types/index.ts`
    - _Requirements: 1.4, 2.1_
  - [x] 8.2 Add DocumentStoreMetrics interface
    - Track parse_count, parse_total_ms, cache_hits, cache_misses, evictions
    - _Requirements: Testing Strategy_
  - [x] 8.3 Implement LRU eviction in DocumentStore
    - Add MAX_DOCUMENTS and MAX_TOKEN_BYTES limits
    - Track access_order for LRU
    - Modify `src/document-store.ts`
    - _Requirements: Design Constraints_
  - [x] 8.4 Modify DocumentStore.open() and update() to be async
    - Use with_parse_timeout for lex/parse/analyze
    - Build line_offsets from lexer result (no separate pass)
    - Initialize context_tracker from tokens (no re-scan)
    - _Requirements: 1.1, 2.1, 3.1_
  - [x] 8.5 Add fast path for unchanged content
    - Skip re-parse if content unchanged (e.g., didSave with no edits)
    - _Requirements: 1.3_
  - [x] 8.6 Add assert_ranges_sorted debug assertion
    - Validate context ranges sorted in development mode
    - _Requirements: 7.1_
  - [x] 8.7 Write property test for parse caching consistency
    - **Property 1: Parse Caching Consistency**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [x] 8.8 Write property test for single context tracker instance
    - **Property 2: Single Context Tracker Instance**
    - **Validates: Requirements 2.1**

- [x] 9. Checkpoint - Verify DocumentStore changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Modify DiagnosticsProvider to Reuse Cached Results
  - [x] 10.1 Remove redundant lexer/parser/analyzer from DiagnosticsProvider
    - Remove private instances that duplicate DocumentStore work
    - Modify `src/providers/diagnostics.ts`
    - _Requirements: 1.2, 2.4_
  - [x] 10.2 Add filtered diagnostics cache with config hash
    - Cache keyed by (uri, version, config_hash)
    - Include suppressions, lint_rules, ado_paths in hash
    - _Requirements: 1.2_
  - [x] 10.3 Return pending flag when debounce in progress
    - Accept debounce_manager parameter
    - Return { diagnostics, pending } tuple
    - _Requirements: 5.4_
  - [x] 10.4 Wire pending flag to LSP response
    - Propagate pending state to client via diagnostics response
    - Consider using LSP diagnostic tags or custom metadata
    - _Requirements: 5.4_

- [x] 11. Modify ContextTracker to Initialize from Tokens
  - [x] 11.1 Add initialize_from_tokens method
    - Accept Token[] instead of raw content
    - Avoid re-scanning document
    - Modify `src/context-tracker/index.ts`
    - _Requirements: 2.3_
  - [x] 11.2 Ensure ranges are sorted during initialization
    - Sort by (start.line, start.character)
    - _Requirements: 7.1_

- [x] 12. Implement Async Workspace Indexer
  - [x] 12.1 Add IndexerMetrics interface
    - Track files_indexed, files_skipped, total_index_time_ms, avg_file_time_ms
    - _Requirements: Testing Strategy_
  - [x] 12.2 Convert to async file operations
    - Use fs.promises.readdir and fs.promises.readFile
    - Modify `src/indexer/index.ts`
    - _Requirements: 4.1, 4.2_
  - [x] 12.3 Implement promise-based worker pool
    - MAX_PARALLEL workers with time-based yielding
    - YIELD_INTERVAL_MS for event loop responsiveness
    - _Requirements: 4.3_
  - [x] 12.4 Add file size limit and cancellation support
    - MAX_FILE_SIZE_BYTES to skip large files
    - cancel() method for workspace change
    - _Requirements: 4.4_
  - [x] 12.5 Write test for cancellation halting in-flight workers
    - Verify cancel() stops workers promptly
    - Assert no new files indexed after cancel() called
    - _Requirements: 4.4_

- [x] 13. Integrate Debounce Manager into Server
  - [x] 13.1 Create debounce manager instance in server
    - Initialize in `src/server.ts`
    - _Requirements: 5.1_
  - [x] 13.2 Wire document change handlers through debounce
    - Modify `src/server-handlers.ts`
    - _Requirements: 5.1, 5.3_
  - [x] 13.3 Clean up on document close
    - Call debounce_manager.on_close() and diagnostics_provider.clear_cache()
    - _Requirements: Error Handling_
  - [x] 13.4 Add metrics emission and threshold logging hooks
    - Create stub hooks for telemetry export (future integration)
    - Log warnings when thresholds exceeded (slow parse, backpressure, memory pressure)
    - _Requirements: Testing Strategy_

- [x] 14. Checkpoint - Verify full integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Add Performance Regression Tests
  - [x] 15.1 Add tokenization time budget tests
    - 1KB < 10ms, 10KB < 50ms, 100KB < 500ms
    - Verify linear scaling (2x size ≈ 2x time, ±20%)
    - _Requirements: 3.5_
  - [x] 15.2 Add context lookup budget tests
    - 100 ranges: < 1ms for 1000 lookups
    - 1000 ranges: < 2ms for 1000 lookups
    - _Requirements: 7.3_
  - [x] 15.3 Add metrics validation tests
    - Verify DocumentStore, Debounce, Cache, Indexer metrics
    - Test threshold alerts fire when limits exceeded
    - _Requirements: Testing Strategy_
  - [x] 15.4 Add cooperative async stubs for future work
    - Create placeholder AbortSignal parameter in parse functions
    - Add feature flag for chunked parsing (disabled by default)
    - Document yield points for future implementation
    - _Requirements: Future Considerations_

- [x] 16. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Performance tests validate time budgets and scaling
