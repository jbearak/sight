# Design Document: Transitive Backward Directive Invalidation

## Overview

This design addresses a bug where editing a file at the root of a backward directive chain doesn't propagate diagnostic revalidation to all transitive dependents. The fix involves computing transitive backward directive dependencies and triggering revalidation for all files in the chain when a root file's interface changes.

## Architecture

The solution modifies the existing `ScopeResolver` class to:

1. Track transitive backward directive dependencies efficiently
2. Compute resolved interface hashes that include inherited symbols
3. Propagate invalidation through the entire directive chain

### Current Flow (Buggy)

```
a.do changes → revalidate b.do (direct child) → b.do's own symbols unchanged → c.do NOT revalidated
```

### Fixed Flow

```
a.do changes → compute transitive dependents [b.do, c.do] → revalidate all
```

## Components and Interfaces

### Modified: ScopeResolver

The `ScopeResolver` class will be extended with:

#### New Method: `get_transitive_backward_directive_children`

```typescript
/**
 * Get all files that transitively depend on a parent file via backward directives.
 * Uses BFS to traverse the dependency graph with cycle detection.
 * @param parent_uri - The URI of the parent file
 * @param max_depth - Maximum chain depth (default: config.max_chain_depth)
 * @returns Set of all transitive dependent URIs
 */
get_transitive_backward_directive_children(
    parent_uri: string,
    max_depth?: number
): Set<string>
```

#### Modified Method: `invalidate_file_cache`

Update to invalidate scope caches for all transitive backward directive dependents, not just direct children.

### Modified: server-factory.ts

The `validate_text_document` function will be updated to:

1. When `interface_changed` is true, get transitive backward directive children instead of direct children
2. Schedule revalidation for all transitive dependents

## Data Models

### Existing: `backward_directive_children`

```typescript
// Current: parent_uri → Set<direct_child_uri>
private backward_directive_children: Map<string, Set<string>>;
```

This existing data structure is sufficient. Transitive dependencies can be computed on-demand by traversing the graph using BFS.

### Algorithm: Transitive Dependency Computation

```
function get_transitive_backward_directive_children(parent_uri, max_depth):
    result = Set()
    queue = [parent_uri]
    visited = Set([parent_uri])
    depth = 0
    
    while queue is not empty and depth < max_depth:
        level_size = queue.length
        for i in 0..level_size:
            current = queue.dequeue()
            direct_children = backward_directive_children.get(current) or Set()
            for child in direct_children:
                if child not in visited:
                    visited.add(child)
                    result.add(child)
                    queue.enqueue(child)
        depth++
    
    return result
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Transitive Invalidation Propagation

*For any* directive chain where file A is the root, file B depends on A via `@lsp-done-by`, and file C depends on B via `@lsp-done-by`, when A's interface changes, both B and C should be included in the set of URIs to revalidate.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Cycle Detection Terminates

*For any* backward directive dependency graph containing cycles (e.g., A → B → C → A), the `get_transitive_backward_directive_children` function should terminate and return a finite set of URIs without entering an infinite loop.

**Validates: Requirements 1.4**

### Property 3: Depth Limiting Respected

*For any* directive chain of length N where N > max_depth, the `get_transitive_backward_directive_children` function should return only dependents within max_depth levels, not the entire chain.

**Validates: Requirements 1.5**

## Error Handling

1. **Cycle Detection**: The BFS algorithm uses a visited set to detect cycles. When a cycle is detected, the node is skipped without error.

2. **Max Depth Exceeded**: When max_depth is reached, the algorithm stops traversing deeper without error. This is a normal termination condition, not an error.

3. **Missing Files**: If a file in the dependency graph no longer exists, it should be gracefully skipped during traversal.

## Testing Strategy

### Property-Based Tests

Property-based tests will be implemented using fast-check to verify the correctness properties:

1. **Transitive Propagation Test**: Generate random directive chain structures and verify all transitive dependents are included in invalidation.

2. **Cycle Detection Test**: Generate graphs with cycles and verify termination.

3. **Depth Limiting Test**: Generate deep chains and verify depth limit is respected.

### Unit Tests

1. **Simple Chain Test**: A → B → C chain, verify C is included when A changes.

2. **Diamond Dependency Test**: A → B, A → C, B → D, C → D, verify D is included once.

3. **Empty Dependents Test**: File with no backward directive children returns empty set.

### Integration Tests

1. **End-to-End Revalidation Test**: Create three files with directive chain, edit root file, verify all files get diagnostics updated.

