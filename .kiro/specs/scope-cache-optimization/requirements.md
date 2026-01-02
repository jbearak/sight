---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Scope Cache Optimization

## Problem
Editing a child `.do` file currently calls `invalidate_file_cache()`, which clears both caches and forces parent files referenced via `@lsp-done-by` / `@lsp-included-by` to be re-read on every keystroke. This wastes I/O and delays diagnostics even though parents are unchanged.

## Solution
Separate cache invalidation paths and validate parent freshness via content hashes:
- **In-memory edits (didChange):** invalidate only scope-cache entries that depend on the edited file.
- **On-disk changes (watcher/rename):** invalidate the file cache entry plus any scope-cache entries that depend on that file.
- Reuse parsed parent results when the on-disk content hash matches the cached hash.

## Requirements

### R1: Cache Separation with Cascade
**User Story:** As a developer, I want edits to avoid re-reading unchanged parents so typing stays responsive.

**Acceptance Criteria**
1. On `textDocument/didChange`, the server **shall** call `invalidate_scope_cache(uri)` instead of `invalidate_file_cache(uri)`.
2. `invalidate_scope_cache(uri)` **shall** remove scope-cache entries whose `dependent_uris` include `uri` and **shall not** mutate `file_cache`.
3. On `DidChangeWatchedFiles`, rename, or delete events, the server **shall** call `invalidate_file_cache(uri)`.
4. `invalidate_file_cache(uri)` **shall** delete the `file_cache` entry for `uri` and cascade-remove scope-cache entries whose `dependent_uris` include `uri`.
5. Cascade logic **shall not** read files from disk; it uses stored `dependent_uris`.
6. Calling `invalidate_scope_cache(uri)` for a file with no dependent scope entries **shall** be a no-op (no error, no metric increment).

### R2: File Cache Entries Use Content Hashes
**User Story:** As a developer, I want stale parent data prevented without unnecessary re-parsing.

**Acceptance Criteria**
1. `FileCacheEntry` **shall** store `content_hash`, `symbols`, and `directives` (no raw `content` string).
2. When resolving a parent, the resolver **shall** read the file once, compute `disk_hash = hash_content(content)`, and reuse the cached parse when hashes match.
3. If hashes differ or the entry is missing, the resolver **shall** parse, update the cache, and count a file-cache miss.
4. If hashes match and entry exists, the resolver **shall** count a file-cache hit.
5. `hash_content` **shall** remain a fast, non-cryptographic hash (reuse the existing 32-bit rolling hash).
6. If reading a parent file fails (deleted, permission error, encoding error), the resolver **shall** remove any stale `file_cache` entry for that URI and emit a diagnostic.
7. `get_parsed_file()` **shall** return the file content it read from disk along with the parsed results, so callers can use it for call-site inference without a second disk read.
8. `follow_directives()` **shall** use the content returned by `get_parsed_file()` for `find_match_line()` and `infer_call_site_for_file()` instead of reading the file again.

### R3: Scope Cache Keys and Dependency Tracking
**User Story:** As a maintainer, I want predictable cascade behavior.

**Acceptance Criteria**
1. The scope cache key **shall** remain `${file_uri}:${content_hash}:${config_hash}`.
2. Every scope-cache entry **shall** store `dependent_uris` that include the root file and all ancestors followed during resolution.
3. Scope-cache invalidation **shall** rely on `dependent_uris` to remove any entry referencing the changed file.
4. The `dependent_uris` list **shall** be computed from `resolved_scope.chain.map(e => e.uri)` (current behavior preserved).

### R4: API Surface and Call Sites
**Acceptance Criteria**
1. `ScopeResolver` **shall** expose `invalidate_scope_cache(uri: string)` and `invalidate_file_cache(uri: string)`.
2. `server.ts/validate_text_document` **shall** call `invalidate_scope_cache` (changed from current `invalidate_file_cache`).
3. `server-handlers.ts/on_did_change_watched_files` **shall** continue to call `invalidate_file_cache`.
4. `utils/file-rename-handler.ts` **shall** continue to call `invalidate_file_cache`.
5. `clear_cache()` **shall** continue to clear both caches and increment scope invalidations by the number of scope entries removed.

### R5: Metrics & Observability
**Acceptance Criteria**
1. `ScopeCacheMetrics` **shall** include nested `scope` and `file` counters: `{ scope: { hits, misses, invalidations }, file: { hits, misses, invalidations } }`.
2. Top-level `hits`, `misses`, `invalidations` **shall** remain as aliases for `scope` counters for backward compatibility.
3. `reset_cache_metrics()` **shall** reset all counters (scope and file) without clearing caches.
4. `clear_cache()` **shall** increment `scope.invalidations` by the number of scope entries removed and `file.invalidations` by the number of file entries removed.
5. File-cache hits/misses **shall** be counted in `get_parsed_file()` when parent files are loaded during resolution.
6. Scope-cache hits/misses **shall** continue to be counted in `resolve()`.

## Edge Cases

### E1: Concurrent Resolution
Multiple `resolve()` calls may run concurrently (e.g., diagnostics for multiple open files). The implementation **shall** tolerate concurrent reads/writes to the caches without corruption. Since JavaScript is single-threaded, explicit locking is not required, but async operations must not interleave cache mutations unsafely.

### E2: Deleted Parent Files
If a parent file referenced by a directive is deleted between cache population and the next resolve:
- `get_parsed_file()` **shall** catch the read error, remove any stale `file_cache` entry, and return an error result.
- The resolver **shall** emit a diagnostic and continue with remaining directives.

### E3: Hash Collisions
The 32-bit hash has a small collision probability. A hash collision would cause stale data to be served. This is acceptable for an LSP cache (non-critical, recoverable via file save or restart). No mitigation required.

### E4: Large Workspaces
The `file_cache` grows unboundedly as parent files are resolved. This is acceptable for typical workspaces. A future optimization could add LRU eviction, but this is out of scope.

## Non-Goals
- Persistent disk caching of parsed files.
- Incremental parsing of edited regions.
- LRU eviction for file cache.
- Cryptographic hashing for collision resistance.
- Early cutoff optimization (skip cascade when parsed symbols unchanged despite content change).
- Durability levels (unlike rust-analyzer, Stata has no stdlib/deps hierarchy—all files are local project files).
