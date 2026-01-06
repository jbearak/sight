# Design Document: Forward Call Transitive Invalidation

## Overview

This design fixes a bug where editing a file that is called via `do`/`run`/`include` doesn't propagate revalidation to files that depend on the callers via backward directives.

## Architecture

### Current Flow (Buggy)

```
import_metadata.do edited (removes global merp)
  → interface_changed = true
  → get_callers_for_callee(import_metadata.do) = {loop.do}
  → schedule_caller_revalidation({loop.do})
  → loop.do revalidated
  → survey.do, bh_vars.do NOT revalidated (stale diagnostics)
```

### Fixed Flow

```
import_metadata.do edited (removes global merp)
  → interface_changed = true
  → get_callers_for_callee(import_metadata.do) = {loop.do}
  → schedule_caller_revalidation({loop.do})
  → For each caller (loop.do):
      → get_transitive_backward_directive_children(loop.do) = {survey.do, bh_vars.do}
      → Add to revalidation set
  → Revalidate: loop.do, survey.do, bh_vars.do
```

## Components and Interfaces

### Modified: server-factory.ts

#### Modified Function: `schedule_caller_revalidation`

Update to also include transitive backward directive dependents of each caller.

```typescript
function schedule_caller_revalidation(
    caller_uris: Set<string>,
    trigger_uri: string,
    config: StataLSPConfig
): void {
    // Existing: collect callers to revalidate
    // NEW: For each caller, also collect its transitive backward directive dependents
    
    const all_uris_to_revalidate = new Set<string>();
    
    for (const caller_uri of caller_uris) {
        all_uris_to_revalidate.add(caller_uri);
        
        // NEW: Get transitive backward directive dependents of this caller
        if (scope_resolver) {
            const backward_dependents = scope_resolver.get_transitive_backward_directive_children(caller_uri);
            for (const dependent_uri of backward_dependents) {
                all_uris_to_revalidate.add(dependent_uri);
            }
        }
    }
    
    // Continue with existing revalidation logic using all_uris_to_revalidate
}
```

## Data Models

No new data structures needed. The fix uses existing:
- `get_callers_for_callee()` - returns direct callers of a file
- `get_transitive_backward_directive_children()` - returns all files that depend on a file via backward directives

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Callee Change Propagates to Backward Directive Dependents

*For any* file A that calls file B via `do`/`run`/`include`, and file C that depends on A via backward directives, when B's interface changes, C shall be included in the set of files to revalidate.

**Validates: Requirements 1.1, 1.2**

### Property 2: No Duplicate Revalidations

*For any* set of callers and their backward directive dependents, the final revalidation set shall contain each URI at most once.

**Validates: Requirements 2.3**

## Error Handling

1. **Missing Scope Resolver**: If `scope_resolver` is not available, fall back to existing behavior (only revalidate direct callers).

2. **Empty Dependents**: If a caller has no backward directive dependents, the set is empty and no additional revalidations are scheduled.

## Testing Strategy

### Unit Tests

1. **Simple Chain Test**: A calls B, C depends on A via backward directive. Edit B, verify C is revalidated.

2. **Multiple Callers Test**: A calls B, D calls B, C depends on A. Edit B, verify both A and C are revalidated.

3. **Deep Chain Test**: A calls B, C depends on A, D depends on C. Edit B, verify A, C, D are all revalidated.

### Integration Tests

1. **End-to-End Test**: Create the exact scenario from the bug report:
   - `loop.do` calls `import_metadata.do`
   - `survey.do` has `@lsp-done-by: loop.do`
   - `bh_vars.do` has `@lsp-included-by: survey.do`
   - Edit `import_metadata.do` to remove a global
   - Verify `bh_vars.do` gets updated diagnostics

