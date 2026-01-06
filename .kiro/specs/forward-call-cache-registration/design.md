# Design Document: Forward Call Cache Registration

## Overview

This design fixes a bug where forward call relationships (`callee_to_callers`) are only registered when files are opened in the editor. The fix ensures that forward call relationships are also registered when files are added to the file parse cache during scope resolution.

## Architecture

### Current Flow (Buggy)

```
bh_vars.do opened in editor
  → Scope resolution reads survey.do, loop.do from disk
  → loop.do added to file_cache (with forward_calls: [import_metadata.do, survey.do])
  → BUT: callee_to_callers NOT updated (loop.do not opened in editor)

import_metadata.do edited
  → get_callers_for_callee(import_metadata.do) = {} (empty!)
  → No callers to revalidate
  → bh_vars.do NOT revalidated (stale)
```

### Fixed Flow

```
bh_vars.do opened in editor
  → Scope resolution reads survey.do, loop.do from disk
  → loop.do added to file_cache (with forward_calls)
  → register_forward_call_relationships_from_cache() called
  → callee_to_callers updated: import_metadata.do ← loop.do, survey.do ← loop.do

import_metadata.do edited
  → get_callers_for_callee(import_metadata.do) = {loop.do}
  → loop.do scheduled for revalidation
  → get_transitive_backward_directive_children(loop.do) = {survey.do, bh_vars.do}
  → All files revalidated
```

## Components and Interfaces

### Modified: ScopeResolver

#### New Private Method: `register_forward_call_relationships_from_cache`

```typescript
/**
 * Register forward call relationships from a cached file's forward calls.
 * Called when a file is added to the file cache to ensure the callee_to_callers
 * map includes relationships from cached files, not just open documents.
 * 
 * @param caller_uri - The URI of the file whose forward calls are being registered
 * @param forward_calls - The parsed forward calls from the file
 */
private register_forward_call_relationships_from_cache(
    caller_uri: string,
    forward_calls: ForwardCall[]
): void
```

#### Modified: `get_or_parse_file_with_cache`

Update to call `register_forward_call_relationships_from_cache` after adding a file to the cache.

#### Modified: `invalidate_file_cache`

Update to also clear forward call relationships for the invalidated file from `callee_to_callers`.

## Data Models

### Existing: `reverse_deps.callee_to_callers`

```typescript
// callee_uri → Set<caller_uri>
callee_to_callers: Map<string, Set<string>>;
```

No changes to the data structure. The fix ensures this map is populated from both:
1. Files opened in the editor (via `update_reverse_dependencies`)
2. Files read from disk during scope resolution (via `register_forward_call_relationships_from_cache`)

## Algorithm

### Register Forward Call Relationships from Cache

When a file is added to the file cache:

```
function register_forward_call_relationships_from_cache(caller_uri, forward_calls):
    // Clear existing relationships for this caller
    clear_forward_call_relationships(caller_uri)
    
    // Register each callee relationship
    for forward_call in forward_calls:
        if forward_call.path is static (not dynamic):
            callee_uri = URI.file(forward_call.path).toString()
            
            // Add to callee_to_callers
            caller_set = callee_to_callers.get(callee_uri) or new Set()
            caller_set.add(caller_uri)
            callee_to_callers.set(callee_uri, caller_set)
```

### Clear Forward Call Relationships

When a file is invalidated from the cache:

```
function clear_forward_call_relationships(caller_uri):
    // Remove this caller from all callee entries
    for (callee_uri, caller_set) in callee_to_callers:
        caller_set.delete(caller_uri)
        if caller_set.size == 0:
            callee_to_callers.delete(callee_uri)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cache Population Registers Forward Call Relationships

*For any* file added to the file parse cache with forward calls, the `callee_to_callers` map shall contain the relationship from each callee to the cached file as caller.

**Validates: Requirements 1.1, 1.2**

### Property 2: Cache Invalidation Clears Forward Call Relationships

*For any* file in the file cache, calling `invalidate_file_cache(uri)` shall remove all forward call relationships where that file is the caller.

**Validates: Requirements 1.3**

### Property 3: Callee Lookup Finds Cached Callers

*For any* file A that is called by file B via a forward call, where B is in the file cache but was never opened in the editor, calling `get_callers_for_callee(A)` shall return a set containing B.

**Validates: Requirements 1.1, 2.1**

## Error Handling

1. **Dynamic Paths**: Forward calls with dynamic paths (containing macro references) are skipped, as we can't resolve them statically.

2. **Parse Errors**: If a file cannot be parsed when added to cache, its forward_calls array will be empty, so no relationships are registered.

## Testing Strategy

### Unit Tests

1. **Simple Registration Test**: Add file with forward calls to cache, verify callee_to_callers is updated.

2. **Invalidation Test**: Add file to cache, then invalidate, verify relationships are cleared.

3. **Lookup Test**: Add file B to cache (calls A), verify `get_callers_for_callee(A)` returns B.

### Integration Tests

1. **End-to-End Test**: Create the exact scenario from the bug report:
   - `loop.do` calls `import_metadata.do` and `survey.do`
   - `survey.do` has `@lsp-done-by: loop.do`
   - `bh_vars.do` has `@lsp-included-by: survey.do`
   - Open only `bh_vars.do` and `import_metadata.do`
   - Edit `import_metadata.do` to remove a global
   - Verify `bh_vars.do` gets updated diagnostics

