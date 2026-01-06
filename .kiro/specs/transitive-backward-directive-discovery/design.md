# Design Document: Transitive Backward Directive Discovery

## Overview

This design fixes a bug where the `backward_directive_children` map is only populated when files are opened in the editor. The fix ensures that backward directive dependencies are also registered when files are added to the file parse cache during scope resolution.

## Architecture

### Current Flow (Buggy)

```
bh_vars.do opened in editor
  → sync_backward_directive_dependencies() called
  → Registers: survey.do → bh_vars.do
  → Resolves scope, reads survey.do from disk
  → survey.do added to file_cache (with directives)
  → BUT: loop.do → survey.do NOT registered (survey.do not opened in editor)

loop.do edited
  → get_transitive_backward_directive_children(loop.do)
  → Looks up loop.do in backward_directive_children
  → Returns empty set (survey.do relationship not registered)
  → bh_vars.do NOT revalidated
```

### Fixed Flow

```
bh_vars.do opened in editor
  → sync_backward_directive_dependencies() called
  → Registers: survey.do → bh_vars.do
  → Resolves scope, reads survey.do from disk
  → survey.do added to file_cache (with directives)
  → register_backward_directive_dependencies_from_cache() called
  → Registers: loop.do → survey.do (from cached directives)

loop.do edited
  → get_transitive_backward_directive_children(loop.do)
  → Looks up loop.do in backward_directive_children
  → Finds: survey.do
  → Looks up survey.do in backward_directive_children
  → Finds: bh_vars.do
  → Returns: {survey.do, bh_vars.do}
  → Both files revalidated
```

## Components and Interfaces

### Modified: ScopeResolver

#### New Private Method: `register_backward_directive_dependencies_from_directives`

```typescript
/**
 * Register backward directive dependencies from a list of directives.
 * Called when a file is added to the file cache to ensure the dependency
 * graph includes relationships from cached files, not just open documents.
 * 
 * @param child_uri - The URI of the file whose directives are being registered
 * @param directives - The parsed directives from the file
 */
private register_backward_directive_dependencies_from_directives(
    child_uri: string,
    directives: Directive[]
): void
```

#### Modified: `get_or_parse_file_with_cache`

Update to call `register_backward_directive_dependencies_from_directives` after adding a file to the cache.

#### Modified: `invalidate_file_cache`

Update to also clear backward directive dependencies for the invalidated file.

## Data Models

### Existing: `backward_directive_children`

```typescript
// parent_uri → Set<child_uri>
private backward_directive_children: Map<string, Set<string>>;
```

No changes to the data structure. The fix ensures this map is populated from both:
1. Files opened in the editor (via `sync_backward_directive_dependencies`)
2. Files read from disk during scope resolution (via `register_backward_directive_dependencies_from_directives`)

## Algorithm

### Register Dependencies from Cache

When a file is added to the file cache:

```
function register_backward_directive_dependencies_from_directives(child_uri, directives):
    // Normalize directives (same as sync_backward_directive_dependencies)
    normalized = normalize_directives(directives, [])
    
    // Clear existing dependencies for this child
    clear_backward_directive_dependencies(child_uri)
    
    // Register each parent relationship
    for directive in normalized:
        parent_uri = URI.file(directive.path).toString()
        register_backward_directive_dependency(child_uri, parent_uri)
```

### Integration Point

In `get_or_parse_file_with_cache`, after adding to cache:

```
// After file_cache.set(uri, {...})
register_backward_directive_dependencies_from_directives(uri, parse_result.directives)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cache Population Registers Dependencies

*For any* file added to the file parse cache with backward directives, the `backward_directive_children` map shall contain the relationship from each parent to the cached file.

**Validates: Requirements 2.1**

### Property 2: Transitive Discovery Uses Cached Relationships

*For any* directive chain A → B → C where B is in the file cache but was never opened in the editor, calling `get_transitive_backward_directive_children(A)` shall return a set containing both B and C.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 3: Cache Invalidation Clears Dependencies

*For any* file in the file cache, calling `invalidate_file_cache(uri)` shall remove all backward directive dependencies where that file is the child.

**Validates: Requirements 2.2, 2.3**

## Error Handling

1. **Parse Errors**: If a file cannot be parsed when added to cache, its directives array will be empty, so no dependencies are registered. This is the existing behavior.

2. **Invalid Paths**: If a directive references a non-existent file, the path is still registered in the map. This is consistent with existing behavior - the map tracks declared relationships, not validated ones.

## Testing Strategy

### Property-Based Tests

1. **Cache Population Test**: Generate random file contents with directives, add to cache, verify dependencies are registered.

2. **Transitive Discovery Test**: Generate random directive chains, add intermediate files to cache (not via editor open), verify transitive lookup finds all dependents.

3. **Invalidation Test**: Generate random cache states, invalidate files, verify dependencies are cleared.

### Unit Tests

1. **Simple Chain Test**: A → B → C where B is cached but not opened, verify C is found when A changes.

2. **Diamond Test**: A → B, A → C, B → D, C → D where B and C are cached, verify D is found once.

### Integration Tests

1. **End-to-End Test**: Create three files with directive chain, open only leaf file, edit root file, verify leaf gets updated diagnostics.

