# Implementation Tasks

## Task 1: Extend Metrics Structure
**Files:** `src/types/index.ts`, `src/scope-resolver/index.ts`

- [x] 1.1 Update `ScopeCacheMetrics` interface to include nested `scope` and `file` counters.
- [x] 1.2 Add top-level `hits`, `misses`, `invalidations` as getters aliasing `scope` counters.
- [x] 1.3 Initialize metrics with nested structure in `ScopeResolver` constructor.
- [x] 1.4 Update `reset_cache_metrics()` to reset both `scope` and `file` counters.

## Task 2: Add get_parsed_file() Helper
**Files:** `src/scope-resolver/index.ts`

- [x] 2.1 Create `get_parsed_file(uri: string, fs_path: string)` method.
- [x] 2.2 Read file from disk, compute `disk_hash = hash_content(content)`.
- [x] 2.3 If `file_cache` has entry with matching hash, return cached result and increment `file.hits`.
- [x] 2.4 Otherwise parse, cache `{ content_hash, symbols, directives }`, increment `file.misses`.
- [x] 2.5 On read error, delete stale `file_cache` entry, increment `file.misses`, return error result.

## Task 3: Update FileCacheEntry Shape
**Files:** `src/scope-resolver/index.ts`

- [x] 3.1 Change `file_cache` value type from `{ content, symbols, directives }` to `{ content_hash, symbols, directives }`.
- [x] 3.2 Remove raw `content` storage.
- [x] 3.3 Update `parse_file()` to use `get_parsed_file()` for parent files (or inline the logic).

## Task 4: Add invalidate_scope_cache()
**Files:** `src/scope-resolver/index.ts`

- [x] 4.1 Add `invalidate_scope_cache(uri: string)` method.
- [x] 4.2 Iterate `scope_cache`, remove entries where `dependent_uris.includes(uri)`.
- [x] 4.3 Increment `scope.invalidations` for each removed entry.
- [x] 4.4 Do NOT touch `file_cache`.

## Task 5: Update invalidate_file_cache()
**Files:** `src/scope-resolver/index.ts`

- [x] 5.1 Delete `file_cache.get(uri)` if present; increment `file.invalidations`.
- [x] 5.2 Reuse cascade logic from `invalidate_scope_cache()` (extract shared helper).
- [x] 5.3 Increment `scope.invalidations` for each cascaded scope entry.

## Task 6: Update clear_cache()
**Files:** `src/scope-resolver/index.ts`

- [x] 6.1 Record `scope_cache.size` and `file_cache.size` before clearing.
- [x] 6.2 Increment `scope.invalidations` by scope count.
- [x] 6.3 Increment `file.invalidations` by file count.
- [x] 6.4 Clear both maps.

## Task 7: Update Call Sites
**Files:** `src/server.ts`

- [x] 7.1 Change `validate_text_document` to call `invalidate_scope_cache(uri)` instead of `invalidate_file_cache(uri)`.
- [x] 7.2 Verify `server-handlers.ts` still calls `invalidate_file_cache` (no change needed).
- [x] 7.3 Verify `file-rename-handler.ts` still calls `invalidate_file_cache` (no change needed).

## Task 8: Update follow_directives() to Use get_parsed_file()
**Files:** `src/scope-resolver/index.ts`

- [x] 8.1 Replace inline `fs.readFileSync` + `parse_file()` calls with `get_parsed_file()`.
- [x] 8.2 Handle error results from `get_parsed_file()` (emit diagnostic, continue).

## Task 9: Checkpoint - Core Implementation Complete
- [x] 9. Ensure all implementation compiles without errors, ask the user if questions arise.

## Task 10: Unit Tests
**Files:** `tests/unit/scope-resolver-cache.test.ts` (new or existing)

- [x] 10.1 Test: `invalidate_scope_cache(uri)` with no dependents is a no-op (no metric increment).
  - Edge case R1.6
- [x] 10.2 Test: `get_parsed_file()` handles read errors, removes stale entry.
  - Edge case R2.6
- [x] 10.3 Test: Metrics structure has nested and top-level counters; aliases work.
- [x] 10.4 Test: Call site - `validate_text_document` calls `invalidate_scope_cache`.
- [x] 10.5 Test: Call site - `on_did_change_watched_files` calls `invalidate_file_cache`.
- [x] 10.6 Test: Call site - `file-rename-handler` calls `invalidate_file_cache`.
- [x] 10.7 Test: `FileCacheEntry` stores `content_hash`, `symbols`, `directives` (no raw content).

## Task 11: Property-Based Tests
**Files:** `tests/property/scope-cache-optimization.prop.test.ts` (new)

- [x] 11.1 Write property test for scope-cache invalidation correctness
  - **Property 1: Scope-cache invalidation removes only dependent entries**
  - **Validates: Requirements R1.2**

- [x] 11.2 Write property test for file-cache invalidation cascade
  - **Property 2: File-cache invalidation cascades to scope-cache**
  - **Validates: Requirements R1.4**

- [x] 11.3 Write property test for cache hit/miss correctness
  - **Property 3: Cache hit/miss correctness based on hash**
  - **Validates: Requirements R2.2, R2.3, R2.4**

- [x] 11.4 Write property test for scope cache key format
  - **Property 4: Scope cache key format consistency**
  - **Validates: Requirements R3.1**

- [x] 11.5 Write property test for dependent URIs completeness
  - **Property 5: Dependent URIs completeness**
  - **Validates: Requirements R3.2, R3.4**

- [x] 11.6 Write property test for clear cache metrics accuracy
  - **Property 6: Clear cache metrics accuracy**
  - **Validates: Requirements R4.5, R5.4**

- [x] 11.7 Write property test for metrics alias correctness
  - **Property 7: Metrics alias correctness**
  - **Validates: Requirements R5.2**

- [x] 11.8 Write property test for reset metrics preserves caches
  - **Property 8: Reset metrics preserves caches**
  - **Validates: Requirements R5.3**

- [x] 11.9 Write property test for metrics counting accuracy
  - **Property 9: Metrics counting accuracy**
  - **Validates: Requirements R5.5, R5.6**

## Task 12: Integration Tests
**Files:** `tests/integration/scope-cache-optimization.test.ts` (new)

- [x] 12.1 Test: Editing child.do does NOT re-read unchanged parent.do (mock fs.readFileSync).
- [x] 12.2 Test: Saving parent.do triggers re-read on next resolve.
- [x] 12.3 Test: Deleting parent.do produces diagnostic on next resolve.

## Task 13: Update Existing Tests
**Files:** `tests/property/scope-caching.test.ts`, `tests/integration/comprehensive-fixes.test.ts`

- [x] 13.1 Update tests that check `cache_metrics` to use new nested structure.
- [x] 13.2 Update tests that call `invalidate_file_cache` to verify expected behavior.
- [x] 13.3 Ensure backward-compatible top-level aliases work in existing assertions.

## Task 14: Final Checkpoint
- [x] 14. Ensure all tests pass, ask the user if questions arise.

## Task 15: Fix Double-Read Issue in follow_directives()
**Files:** `src/scope-resolver/index.ts`

- [x] 15.1 Update `get_parsed_file()` return type to include `content` field for successful results.
  - Return `{ content, symbols, directives, diagnostics }` on success
  - Return `{ error }` on failure (unchanged)
  - _Requirements: R2.7_

- [x] 15.2 Update `follow_directives()` to use content from `get_parsed_file()` result.
  - Remove the second `fs.readFileSync()` call after `get_parsed_file()`
  - Use `my_parent_result.content` for `find_match_line()` and `infer_call_site_for_file()`
  - _Requirements: R2.8_

- [x] 15.3 Update integration test to verify single disk read per parent file.
  - Mock `fs.readFileSync` and verify it's called exactly once per parent file during resolution
  - _Requirements: R2.7, R2.8_

## Task 16: Final Checkpoint - Double-Read Fix
- [x] 16. Ensure all tests pass after double-read fix, ask the user if questions arise.
