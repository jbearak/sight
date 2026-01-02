# Design Document: Callee Revalidation on Caller Change

## Overview

This design introduces a reverse dependency tracking system that enables the LSP to re-validate callee files when their caller files change. The core insight is that while the existing system tracks backward dependencies (callee → caller via `@lsp-done-by`/`@lsp-included-by` directives), it lacks forward dependency tracking (caller → callee via `do`/`run`/`include` commands).

The solution adds a `ReverseDependencyIndex` to the `ScopeResolver` that maps caller URIs to their callees with edge metadata. When a caller changes, the system computes an **Interface Hash**. If the hash or forward calls change, it identifies affected callees, invalidates their scope caches, and schedules prioritized re-validation for open callee documents. If a callee's own interface changes as a result, the invalidation propagates transitively.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           LSP Server                                     │
│                                                                          │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────────┐   │
│  │ Document     │───▶│ Scope           │───▶│ Diagnostics          │   │
│  │ Store        │    │ Resolver        │    │ Provider             │   │
│  │              │    │                 │    │                      │   │
│  │ - forward_   │    │ - file_cache    │    │ - publish_diagnostics│   │
│  │   calls      │    │ - scope_cache   │    │                      │   │
│  │              │    │ - reverse_deps  │◀───│                      │   │
│  └──────────────┘    └─────────────────┘    └──────────────────────┘   │
│         │                    │                        ▲                 │
│         │                    │                        │                 │
│         ▼                    ▼                        │                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Callee Revalidation Flow                       │  │
│  │                                                                   │  │
│  │  1. Caller edited → debounce → parse → extract forward_calls     │  │
│  │  2. Update symbol table and compute Interface_Hash              │  │
│  │  3. Diff old vs new forward_calls and Interface_Hash            │  │
│  │  4. Update ReverseDependencyIndex                               │  │
│  │  5. Invalidate affected callee scope caches                      │  │
│  │  6. Transitive Invalidation: Propagate if callee interface shifts   │  │
│  │  7. Identify open callee documents (prioritizing active view)      │  │
│  │  8. Schedule re-validation (with cancellation on new edits)        │  │
│  │  9. Publish updated diagnostics                                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### ReverseDependencyIndex

A new data structure in `ScopeResolver` that tracks caller → callee relationships.

```typescript
interface CallEdge {
    call_type: 'do' | 'run' | 'include';
    call_site_line: number;  // 0-indexed
}

/**
 * Stable hash of the symbols exported by a file.
 * Used to skip re-validating callees if the interface hasn't changed.
 */
type InterfaceHash = string;

interface ReverseDependencyIndex {
    // Map from caller URI to (callee URI → array of call edges)
    // A caller can have multiple calls to the same callee
    caller_to_callees: Map<string, Map<string, CallEdge[]>>;
    
    // Reverse lookup: callee URI → set of caller URIs
    // Used for cleanup when a callee is deleted
    callee_to_callers: Map<string, Set<string>>;

    // Cache of the last known interface hash for each file
    interface_hashes: Map<string, InterfaceHash>;
}
```

### ScopeResolver Extensions

New methods added to `ScopeResolver`:

```typescript
class ScopeResolver {
    private reverse_deps: ReverseDependencyIndex;
    
    /**
     * Compute a stable hash of the symbols that would be inherited by a child.
     * The hash targets the 'public interface' (globals, programs, etc.).
     */
    compute_interface_hash(uri: string, symbols: SymbolTable): InterfaceHash;

    /**
     * Update reverse dependencies when a document's forward calls or interface changes.
     * Returns the set of affected callee URIs (union of old and new callees).
     */
    update_reverse_dependencies(
        caller_uri: string,
        new_forward_calls: ForwardCall[],
        new_symbols: SymbolTable
    ): { affected_callees: Set<string>, interface_changed: boolean };
    
    /**
     * Invalidate scope caches for a set of callee URIs and transitively
     * propagate invalidation if those callees are also callers.
     */
    cascade_invalidate(uris: Set<string>): void;
}
```

### Server Integration

New logic in `validate_text_document` and related handlers:

```typescript
// In validate_text_document (after document is parsed)
async function validate_text_document(text_document: TextDocument): Promise<void> {
    // ... existing parsing logic ...
    
    // After document is updated in document_store:
    const document_state = document_store.get(text_document.uri);
    if (document_state && scope_resolver) {
        // Update reverse dependencies and check if interface changed
        const { affected_callees, interface_changed } = scope_resolver.update_reverse_dependencies(
            text_document.uri,
            document_state.forward_calls,
            document_state.symbols
        );
        
        // Schedule re-validation if call graph or interface changed
        if (affected_callees.size > 0 || interface_changed) {
            cancel_pending_revalidations(text_document.uri); // Cancel stale requests
            schedule_callee_revalidation(affected_callees, text_document.uri);
        }
    }
    
    // ... existing diagnostics logic ...
}

function schedule_callee_revalidation(callee_uris: Set<string>, trigger_uri: string): void {
    const max_revalidations = config.cross_file?.max_callee_revalidations ?? 10;
    
    // Prioritization: Active > Visible > Other
    const sorted_callees = Array.from(callee_uris).sort((a, b) => {
        const priority_a = get_document_priority(a);
        const priority_b = get_document_priority(b);
        return priority_b - priority_a;
    });

    let count = 0;
    for (const callee_uri of sorted_callees) {
        if (count >= max_revalidations) break;
        
        const callee_doc = documents.get(callee_uri);
        if (callee_doc) {
            const my_token = create_cancellation_token(trigger_uri);
            setTimeout(() => {
                if (my_token.isCancelled) return;
                validate_text_document(callee_doc);
            }, 0);
            count++;
        }
    }
}
```

### Document Close Handler

Update the document close handler to clean up reverse dependencies:

```typescript
documents.onDidClose((e) => {
    // ... existing cleanup ...
    
    // Remove caller entries from reverse dependency index
    if (scope_resolver) {
        scope_resolver.remove_caller_from_reverse_deps(e.document.uri);
    }
});
```

### File Watcher Handler

Update the file watcher handler to clean up reverse dependencies on delete:

```typescript
// In create_did_change_watched_files_handler
if (my_event.type === FileChangeType.Deleted) {
    // ... existing cleanup ...
    
    // Remove all reverse dependency entries for deleted file
    if (deps.scope_resolver) {
        deps.scope_resolver.remove_uri_from_reverse_deps(my_event.uri);
    }
}
```

## Data Models

### ForwardCall (existing, for reference)

```typescript
interface ForwardCall {
    type: 'do' | 'run' | 'include';
    path: string;           // Resolved filesystem path
    raw_path: string;       // Original path from source
    call_site_line: number; // 0-indexed line number
    range: Range;           // Source range of the command
    source: 'command' | 'directive';
    is_static: boolean;     // false if path contains macros
}
```

### CallEdgeDiff

Used internally to compute changes between old and new forward calls:

```typescript
interface CallEdgeDiff {
    added: Map<string, CallEdge[]>;    // New callees
    removed: Map<string, CallEdge[]>;  // Removed callees
    modified: Map<string, {            // Callees with changed edges
        old_edges: CallEdge[];
        new_edges: CallEdge[];
    }>;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Forward Call Extraction Completeness

*For any* Stata document containing static `do`, `run`, or `include` commands, parsing the document SHALL extract all static forward calls with correct call_type and call_site_line.

**Validates: Requirements 1.1**

### Property 2: Index Maintenance and Diff-Based Invalidation

*For any* sequence of forward call changes to a caller document, the ReverseDependencyIndex SHALL be updated to reflect the current call graph, and scope caches for all affected callees (added, removed, or modified) SHALL be invalidated.

**Validates: Requirements 1.2, 1.3, 2.1, 2.2, 2.3, 2.4**

### Property 3: Cleanup on Close and Delete

*For any* document that is closed or deleted, all entries in the ReverseDependencyIndex where that document appears as a caller SHALL be removed. For deleted files, entries where the file appears as a callee SHALL also be removed.

**Validates: Requirements 1.4, 1.5**

### Property 4: Prioritized Open Callee Re-validation

*For any* caller change that affects forward calls or its public interface, open callee documents in the affected set SHALL be scheduled for re-validation, prioritized by user visibility (active > visible > background).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 4b: Interface Hashing Stability

*For any* caller content change that does NOT modify its forward calls or its public interface (exported symbols), THE system SHALL NOT trigger re-validation of its callees.

**Validates: Requirements 2.4**

### Property 4c: Transitive Propagation

*For any* chain of dependencies (A calls B, B calls C), if a change in A causes B's resolved scope to change such that B's public interface shifts, then C SHALL also be invalidated and re-validated (if open).

**Validates: Requirements 2.5**

### Property 5: Call Type Change Inheritance

*For any* call type change from `include` to `do`/`run`, the callee's resolved scope SHALL exclude local macros from the caller. For changes from `do`/`run` to `include`, local macros SHALL be included.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 6: Call Site Line Change Filtering

*For any* change to a call site line in a caller, the callee's scope cache SHALL be invalidated, and symbols that become out-of-scope due to the line change SHALL generate out-of-scope warnings in the callee's diagnostics.

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 7: Re-validation Limit and Prioritization

*For any* caller change affecting more than N open callees (where N is the configured limit), only the top N callees according to **Prioritization** rules SHALL be re-validated.

**Validates: Requirements 6.2, 6.3, 6.4**

### Property 7b: Work Cancellation

*For any* pending re-validation task, if a new `didChange` event arrives for any file in the caller-chain before the task executes, the stale task SHALL be cancelled.

**Validates: Requirements 3.5, 6.6**

### Property 8: Multi-Edge Storage and Deterministic Resolution

*For any* call graph where a caller has multiple calls to the same callee, or a callee is called by multiple callers, all call edges SHALL be stored independently, and scope resolution SHALL use the earliest call site line for call-site filtering.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 9: Path Resolution Change Handling

*For any* change to a caller's path resolution context (e.g., working directory directive added), the affected callees SHALL be re-evaluated based on the new path resolution.

**Validates: Requirements 7.4**

## Error Handling

### Parse Errors in Caller

When a caller document has parse errors, forward call extraction may be incomplete or fail. The system handles this by:

1. Extracting whatever forward calls can be parsed (partial extraction)
2. Preserving the previous ReverseDependencyIndex state if extraction fails completely
3. Logging a warning but not failing the entire validation

### Missing Callee Files

When a forward call references a file that doesn't exist:

1. The call is still recorded in the ReverseDependencyIndex (path may become valid later)
2. Scope resolution for the callee will fail gracefully with existing error handling
3. No re-validation is scheduled for non-existent files

### Circular Dependencies

The existing cycle detection in `ScopeResolver` and `ForwardScopeResolver` handles circular call graphs. The ReverseDependencyIndex does not introduce new cycle risks because:

1. It only tracks edges, not resolved scopes
2. Re-validation uses the existing debounce infrastructure which prevents infinite loops
3. Each re-validation is part of a cascading chain, but bounded by a max recursion depth (consistent with `crossFile.maxForwardDepth`).

### Re-validation Failures

If re-validation of a callee fails (e.g., due to concurrent edits):

1. The existing diagnostics are preserved (no clearing)
2. The next edit to the callee will trigger fresh validation
3. A warning is logged for debugging

## Testing Strategy

### Unit Tests

Unit tests verify individual components in isolation:

1. **ReverseDependencyIndex operations**: add, remove, update, lookup
2. **CallEdgeDiff computation**: correctly identifies added/removed/modified edges
3. **Cleanup logic**: proper removal on close/delete

### Property-Based Tests

Property-based tests verify universal properties across many generated inputs:

1. **Property 1**: Generate documents with various forward call patterns, verify extraction completeness
2. **Property 2**: Generate sequences of forward call changes, verify index consistency and cache invalidation
3. **Property 3**: Generate close/delete events, verify cleanup completeness
4. **Property 4**: Generate caller changes with open callees, verify re-validation scheduling
5. **Property 5**: Generate call type changes, verify inheritance rule application
6. **Property 6**: Generate call site line changes, verify filtering updates
7. **Property 7**: Generate scenarios with many callees, verify limit enforcement
8. **Property 8**: Generate multi-edge call graphs, verify storage and resolution
9. **Property 9**: Generate path resolution changes, verify callee re-evaluation

### Integration Tests

Integration tests verify end-to-end behavior:

1. **Caller edit → callee diagnostic update**: Edit a caller, verify callee diagnostics change
2. **Call type change → inheritance change**: Change `do` to `include`, verify local macros appear
3. **Call site line change → out-of-scope warnings**: Move call site, verify warnings update
4. **Multiple callers → independent tracking**: Multiple callers to same callee, verify all tracked

### Test Configuration

- Property tests: minimum 100 iterations per property
- Use fast-check for property-based testing
- Tag format: **Feature: callee-revalidation-on-caller-change, Property N: {property_text}**
