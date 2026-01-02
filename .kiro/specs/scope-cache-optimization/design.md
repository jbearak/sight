# Design Document

## Overview
Optimize `ScopeResolver` so editing a file invalidates only the work that depends on that file, while preserving correctness and avoiding redundant disk I/O for unchanged parents.

## Current State
- `textDocument/didChange` calls `invalidate_file_cache()`, which clears both caches on every keystroke.
- Parent files referenced via `@lsp-done-by` / `@lsp-included-by` are re-read and re-parsed even when unchanged.
- `file_cache` stores raw content string, so staleness detection relies solely on content equality.
- `parse_file()` compares `cached.content === content` to decide whether to reuse.

## Goals
1. Separate scope-cache invalidation (for in-memory edits) from file-cache invalidation (for on-disk changes).
2. Cascade invalidation to all cached scope entries that depend on a changed file.
3. Reuse parsed parent results when the on-disk content hash matches the cached hash.
4. Maintain predictable metrics and backward-compatible APIs.

## Target Architecture

### Data Structures

```typescript
// File cache: stores parsed results keyed by URI
file_cache: Map<uri, FileCacheEntry>

interface FileCacheEntry {
    content_hash: string;      // hash of file content when parsed
    symbols: SymbolTable;
    directives: Directive[];
}

// Scope cache: stores resolved scopes keyed by composite key
scope_cache: Map<cache_key, ScopeCacheEntry>

interface ScopeCacheEntry {
    resolved_scope: ResolvedScope;
    content_hash: string;      // root file content hash
    dependent_uris: string[];  // root + all ancestors
    timestamp: number;
}

// Cache key format (unchanged)
cache_key = `${file_uri}:${hash_content(file_content)}:${hash_content(config_json)}`
```

### Invalidation APIs

```typescript
invalidate_scope_cache(uri: string): void
```
- Iterate `scope_cache` entries.
- Remove entries where `dependent_uris.includes(uri)`.
- Increment `scope.invalidations` for each removed entry.
- Do NOT touch `file_cache`.
- No-op if no entries depend on `uri`.

```typescript
invalidate_file_cache(uri: string): void
```
- Delete `file_cache.get(uri)` if present; increment `file.invalidations`.
- Cascade: remove scope-cache entries where `dependent_uris.includes(uri)`; increment `scope.invalidations` for each.

```typescript
clear_cache(): void
```
- Record `scope_cache.size` and `file_cache.size`.
- Clear both maps.
- Increment `scope.invalidations` by scope count, `file.invalidations` by file count.

### Event Flows

**1. textDocument/didChange (in-memory edits)**
```
User types in child.do
  → server.ts/validate_text_document
  → invalidate_scope_cache(child_uri)
  → diagnostics run
  → resolve(child_uri, new_content)
     → scope cache miss (key changed due to content hash)
     → follow_directives reads parent.do
        → get_parsed_file(parent_uri)
           → read disk, compute hash
           → hash matches file_cache → file cache HIT
           → return cached symbols/directives
     → populate scope cache with new entry
```

**2. DidChangeWatchedFiles (on-disk changes, including save)**
```
User saves parent.do (or external edit)
  → server-handlers.ts/on_did_change_watched_files
  → invalidate_file_cache(parent_uri)
     → removes file_cache entry for parent
     → cascades to scope_cache entries depending on parent
  → next resolve for any child
     → get_parsed_file(parent_uri)
        → file_cache miss → read, parse, cache
```

**3. Rename/Delete**
```
User renames old.do → new.do
  → file-rename-handler.ts
  → invalidate_file_cache(old_uri)
  → invalidate_file_cache(new_uri)  // if applicable
```

### Parent Load Algorithm: get_parsed_file()

```typescript
private get_parsed_file(uri: string, fs_path: string): ParsedFileResult {
    // 1. Read file from disk
    let content: string;
    try {
        content = fs.readFileSync(fs_path, 'utf8');
    } catch (error) {
        // Remove stale cache entry if present
        this.file_cache.delete(uri);
        this.cache_metrics.file.misses++;
        return { error: error.message };
    }

    // 2. Compute hash
    const disk_hash = this.hash_content(content);

    // 3. Check cache
    const cached = this.file_cache.get(uri);
    if (cached && cached.content_hash === disk_hash) {
        this.cache_metrics.file.hits++;
        // Return content along with cached results for call-site inference
        return { content, symbols: cached.symbols, directives: cached.directives };
    }

    // 4. Parse and cache
    this.cache_metrics.file.misses++;
    const parse_result = this.parse_content(uri, content);
    this.file_cache.set(uri, {
        content_hash: disk_hash,
        symbols: parse_result.symbols,
        directives: parse_result.directives,
    });
    // Return content along with parsed results
    return { content, ...parse_result };
}
```

Key points:
- Always reads disk to get current content (one read per parent per resolve when uncached).
- Hash comparison avoids re-parsing if content unchanged.
- Stale entries are cleaned up on read errors.
- Returns `content` along with parsed results so callers can use it for call-site inference without a second disk read.
- Note: `FileCacheEntry` does NOT store raw content (per R2.1), but `get_parsed_file()` returns it transiently for immediate use.

### Metrics Structure

```typescript
interface ScopeCacheMetrics {
    // Nested counters (new)
    scope: { hits: number; misses: number; invalidations: number };
    file: { hits: number; misses: number; invalidations: number };
    
    // Top-level aliases for backward compatibility
    hits: number;         // alias for scope.hits
    misses: number;       // alias for scope.misses
    invalidations: number; // alias for scope.invalidations
}
```

Implementation note: Use getters for top-level aliases to avoid duplication:
```typescript
get hits() { return this.scope.hits; }
```

### Early Cutoff Optimization

When a parent file's content changes but the parsed result (symbols + directives) is semantically identical, we can avoid cascading invalidation to dependent scope entries. This is inspired by rust-analyzer's Salsa framework.

**Implementation**: In `get_parsed_file()`, after parsing:
1. Compare new `symbols` and `directives` with cached values
2. If identical, update `content_hash` but skip scope-cache invalidation
3. If different, proceed with normal invalidation cascade

This optimization is deferred to future work but noted here for completeness.

### Trade-offs & Risks

| Trade-off | Rationale |
|-----------|-----------|
| Still reads parent files from disk | Ensures correctness; avoids serving stale data if watcher misses an event. Future optimization could trust watcher entirely. |
| 32-bit hash has collision risk | Acceptable for non-critical cache; collision causes stale data until next invalidation. |
| `file_cache` grows unboundedly | Typical workspaces have few parent files; LRU eviction deferred to future work. |
| Synchronous file reads | Matches existing behavior; avoids event-loop reentrancy complexity. |
| No durability levels | Unlike rust-analyzer (which has stdlib → deps → user code hierarchy), Stata projects have only local `.do` files with similar volatility. Durability optimization doesn't apply. |

### Risks

1. **Cascade accuracy**: If `dependent_uris` is incomplete, some scope entries won't be invalidated. Mitigation: ensure `dependent_uris` is always populated from `chain.map(e => e.uri)`.

2. **Watcher reliability**: If file watcher misses an event, `file_cache` may have stale entry. Mitigation: hash validation on every parent load catches this.

3. **Performance regression**: If hash computation is slow for large files, typing latency could increase. Mitigation: existing 32-bit rolling hash is O(n) but fast; monitor in practice.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Scope-cache invalidation removes only dependent entries

*For any* scope cache state and any URI, calling `invalidate_scope_cache(uri)` shall remove exactly those scope-cache entries whose `dependent_uris` includes `uri`, and shall leave all other scope-cache entries and the entire file-cache unchanged.

**Validates: Requirements R1.2**

### Property 2: File-cache invalidation cascades to scope-cache

*For any* cache state (file-cache and scope-cache) and any URI, calling `invalidate_file_cache(uri)` shall:
1. Remove the file-cache entry for `uri` (if present)
2. Remove all scope-cache entries whose `dependent_uris` includes `uri`
3. Leave all other entries in both caches unchanged

**Validates: Requirements R1.4**

### Property 3: Cache hit/miss correctness based on hash

*For any* file URI and file content:
- If the file-cache contains an entry for `uri` with `content_hash` matching `hash_content(current_content)`, then `get_parsed_file(uri)` shall return the cached result and increment `file.hits`
- If the file-cache entry is missing or has a different hash, then `get_parsed_file(uri)` shall parse the content, update the cache, and increment `file.misses`

**Validates: Requirements R2.2, R2.3, R2.4**

### Property 4: Scope cache key format consistency

*For any* file URI, file content, and config object, the scope cache key shall be exactly `${file_uri}:${hash_content(file_content)}:${hash_content(JSON.stringify(config))}`.

**Validates: Requirements R3.1**

### Property 5: Dependent URIs completeness

*For any* resolution that follows a chain of directives (root → parent1 → parent2 → ...), the resulting scope-cache entry's `dependent_uris` shall contain exactly the URIs of all files in the chain, including the root file.

**Validates: Requirements R3.2, R3.4**

### Property 6: Clear cache metrics accuracy

*For any* cache state with N scope-cache entries and M file-cache entries, calling `clear_cache()` shall:
1. Clear both caches completely
2. Increment `scope.invalidations` by exactly N
3. Increment `file.invalidations` by exactly M

**Validates: Requirements R4.5, R5.4**

### Property 7: Metrics alias correctness

*For any* metrics state, the top-level `hits`, `misses`, and `invalidations` properties shall equal `scope.hits`, `scope.misses`, and `scope.invalidations` respectively.

**Validates: Requirements R5.2**

### Property 8: Reset metrics preserves caches

*For any* cache state with scope-cache entries S and file-cache entries F, calling `reset_cache_metrics()` shall:
1. Set all counters (scope.hits, scope.misses, scope.invalidations, file.hits, file.misses, file.invalidations) to zero
2. Leave S and F unchanged (same entries, same values)

**Validates: Requirements R5.3**

### Property 9: Metrics counting accuracy

*For any* sequence of resolve operations:
- `scope.hits + scope.misses` shall equal the total number of `resolve()` calls
- `file.hits + file.misses` shall equal the total number of parent file loads in `get_parsed_file()`

**Validates: Requirements R5.5, R5.6**

## Testing Strategy

This feature uses a dual testing approach combining unit tests for specific examples/edge cases and property-based tests for universal correctness guarantees.

### Property-Based Testing

Property-based tests will use `fast-check` with minimum 100 iterations per property. Each test must reference its design document property.

**Tag format:** `Feature: scope-cache-optimization, Property N: {property_text}`

| Property | Test Description |
|----------|------------------|
| Property 1 | Generate random scope-cache states and URIs; verify `invalidate_scope_cache` removes exactly dependent entries |
| Property 2 | Generate random cache states; verify `invalidate_file_cache` cascades correctly |
| Property 3 | Generate random file contents and cache states; verify hit/miss behavior based on hash |
| Property 4 | Generate random URIs, contents, configs; verify key format |
| Property 5 | Generate random directive chains; verify `dependent_uris` completeness |
| Property 6 | Generate random cache states; verify `clear_cache` metrics accuracy |
| Property 7 | Generate random metrics states; verify alias equality |
| Property 8 | Generate random cache states; verify `reset_cache_metrics` preserves caches |
| Property 9 | Generate random resolve sequences; verify metrics counting accuracy |

### Unit Tests

Unit tests cover specific examples, edge cases, and error conditions:

1. `invalidate_scope_cache(uri)` with no dependents is a no-op (no metric increment) - **Edge case R1.6**
2. `get_parsed_file()` handles read errors gracefully; removes stale entry - **Edge case R2.6**
3. Metrics structure has both nested and top-level counters; aliases work correctly
4. Call site verification: `validate_text_document` calls `invalidate_scope_cache`
5. Call site verification: `on_did_change_watched_files` calls `invalidate_file_cache`
6. Call site verification: `file-rename-handler` calls `invalidate_file_cache`
7. `FileCacheEntry` stores `content_hash`, `symbols`, `directives` (no raw content)

### Integration Tests

1. Editing `child.do` does NOT re-read unchanged `parent.do` (mock `fs.readFileSync`, assert call count)
2. Saving `parent.do` triggers re-read on next `resolve` for `child.do`
3. Deleting `parent.do` produces diagnostic on next `resolve`
