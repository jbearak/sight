# Design Document: Workspace Root Fallback Fix

## Overview

This design addresses a bug where the workspace root fallback path resolution is never activated because the server fails to call `document_store.set_workspace_root()`. The analyzer already has the fallback logic implemented in `resolve_forward_call_path`, but `workspace_root` is always `undefined` because it's never set.

The fix is minimal: add a single line to call `document_store.set_workspace_root()` when workspace folders are available during server initialization.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Current Flow (Broken)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Server Initialization                                           │
│       │                                                          │
│       ├── forward_scope_resolver.set_workspace_roots(folders) ✓  │
│       │                                                          │
│       └── document_store.set_workspace_root(???) ✗ MISSING       │
│                                                                  │
│  Document Store                                                  │
│       │                                                          │
│       └── workspace_root = undefined (never set)                 │
│                                                                  │
│  Analyzer.resolve_forward_call_path()                            │
│       │                                                          │
│       └── workspace_root is undefined → fallback never tried     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Fixed Flow                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Server Initialization                                           │
│       │                                                          │
│       ├── forward_scope_resolver.set_workspace_roots(folders) ✓  │
│       │                                                          │
│       └── document_store.set_workspace_root(folders[0]) ✓ NEW    │
│                                                                  │
│  Document Store                                                  │
│       │                                                          │
│       └── workspace_root = "/path/to/workspace"                  │
│                                                                  │
│  Analyzer.resolve_forward_call_path()                            │
│       │                                                          │
│       ├── Try script-relative path                               │
│       │                                                          │
│       └── If not found, try workspace-relative path ✓            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Server (Needs Update)

**Location**: `src/server.ts`

The server already retrieves workspace folders and calls `forward_scope_resolver.set_workspace_roots()`. We need to add a call to `document_store.set_workspace_root()` in the same location.

**Current Code** (around line 347):
```typescript
// Set workspace roots for forward scope resolver cache-first mode
if (forward_scope_resolver) {
    forward_scope_resolver.set_workspace_roots(folder_paths);
}
```

**Fixed Code**:
```typescript
// Set workspace roots for forward scope resolver cache-first mode
if (forward_scope_resolver) {
    forward_scope_resolver.set_workspace_roots(folder_paths);
}

// Set workspace root on document store for fallback path resolution
if (folder_paths.length > 0) {
    document_store.set_workspace_root(folder_paths[0]);
}
```

### Document Store (No Changes Needed)

The `DocumentStore` class already has:
- `set_workspace_root(workspace_root: string | undefined): void` method
- `workspace_root` private field
- Passes `workspace_root` to analyzer in `create_document_state()`

### Analyzer (No Changes Needed)

The `SemanticAnalyzer` class already has:
- `workspace_root` in `AnalyzerConfig`
- `resolve_forward_call_path()` with workspace root fallback logic

## Data Models

No changes to data models. The existing `AnalyzerConfig.workspace_root` and `ForwardCall` types are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Workspace Root Fallback Resolution

*For any* forward call path that does not exist relative to the script directory but does exist relative to the workspace root, the analyzer SHALL resolve to the workspace-root-relative path, the `ForwardCall.path` SHALL contain the resolved workspace-relative path, and no "file not found" diagnostic SHALL be emitted.

**Validates: Requirements 2.1, 3.1, 3.3**

### Property 2: Script-Relative Precedence

*For any* forward call path that exists relative to the script directory, the analyzer SHALL use the script-relative path regardless of whether the path also exists relative to the workspace root.

**Validates: Requirements 2.2**

### Property 3: Missing File Handling

*For any* forward call path that does not exist at either script-relative or workspace-relative locations, the analyzer SHALL return the script-relative path and a "file not found" diagnostic SHALL be emitted.

**Validates: Requirements 2.3, 3.2**

### Property 4: Working Directory Precedence

*For any* forward call path when `@lsp-working-directory` is set, the analyzer SHALL resolve relative to the working directory without using workspace root fallback.

**Validates: Requirements 2.4**

### Property 5: Server Initialization

*For any* server initialization with workspace folders available, the document store's `workspace_root` SHALL be set to the first workspace folder path.

**Validates: Requirements 1.1**

## Error Handling

No new error handling needed. The existing fallback logic in `resolve_forward_call_path` already handles:
- Missing files (returns script-relative path for diagnostics)
- Invalid paths (normalized before resolution)
- Absolute paths (no fallback applied)

## Testing Strategy

### Unit Tests

1. **Server Initialization**
   - Verify `document_store.set_workspace_root()` is called with correct path
   - Verify behavior when no workspace folders available

### Property-Based Tests

Using fast-check with minimum 100 iterations per test.

1. **Property 1: Workspace Root Fallback Resolution**
   - Generate random file paths
   - Create file at workspace-relative location only
   - Verify analyzer resolves to workspace-relative path
   - Verify ForwardCall.path contains workspace-relative path
   - Verify no diagnostic emitted

2. **Property 2: Script-Relative Precedence**
   - Generate random file paths
   - Create file at script-relative location
   - Optionally create at workspace-relative location
   - Verify analyzer uses script-relative path

3. **Property 3: Missing File Handling**
   - Generate random file paths
   - Don't create file at either location
   - Verify analyzer returns script-relative path
   - Verify diagnostic is emitted

4. **Property 4: Working Directory Precedence**
   - Generate random file paths with working_directory set
   - Verify analyzer resolves relative to working_directory
   - Verify workspace root fallback is not used

5. **Property 5: Server Initialization**
   - This is better tested as an integration test since it involves server lifecycle

### Integration Tests

1. **End-to-end workspace root fallback**
   - Create workspace with nested directories
   - Create file at workspace root level
   - Reference from subdirectory without full path
   - Verify resolution succeeds

