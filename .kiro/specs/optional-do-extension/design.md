# Design Document: Optional .do Extension Handling

## Overview

This design addresses the handling of optional `.do` file extensions throughout the Stata LSP. The implementation ensures that when a user writes `do foo`, the LSP correctly resolves to `foo.do` if it exists, without emitting false-positive "file not found" diagnostics.

The changes are localized to path resolution logic in three components:
1. **Analyzer** - For `do`/`run`/`include` commands
2. **DirectiveParser** - For `@lsp-*` directives
3. **ForwardScopeResolver** and **ScopeResolver** - For scope resolution

Most of the path resolution logic already exists. The main changes are:
1. Ensuring the `.do` fallback is applied consistently
2. Improving diagnostic messages to indicate which paths were tried
3. Ensuring the resolved path (not raw path) is used in diagnostics

## Architecture

The path resolution with `.do` fallback follows this flow:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Path Resolution Flow                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User Input: "foo" or "foo.do"                                      │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  resolve_path_with_fallback(raw_path, containing_dir)        │   │
│  │                                                               │   │
│  │  1. Resolve to absolute path                                  │   │
│  │  2. If exact path exists → return it                          │   │
│  │  3. If path doesn't end in .do:                               │   │
│  │     - Try path + ".do"                                        │   │
│  │     - If exists → return it                                   │   │
│  │  4. Return original resolved path                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│       │                                                              │
│       ▼                                                              │
│  Resolved Path: "/abs/path/to/foo.do" (if exists)                   │
│                 "/abs/path/to/foo" (if neither exists)              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### ScopeResolver (Needs Update)

The `ScopeResolver.get_parsed_file` method needs to apply `.do` fallback when reading files:

```typescript
class ScopeResolver {
    /**
     * Get parsed file from disk with caching.
     * Applies .do extension fallback if the exact path doesn't exist.
     */
    async get_parsed_file(
        uri: string,
        fs_path: string,
        options?: { skip_disk_if_cached?: boolean }
    ): Promise<ParsedFileResult | { error: string }>;
}
```

**Current Issue**: When `fs_path` doesn't exist, the method returns an error immediately without trying `fs_path + ".do"`.

**Fix**: Before returning an error, check if `fs_path + ".do"` exists and read from that path instead.

### ForwardScopeResolver (Needs Update)

The `ForwardScopeResolver.get_callee_scope` method needs to apply `.do` fallback:

```typescript
class ForwardScopeResolver {
    /**
     * Get callee scope from disk, reusing ScopeResolver cache.
     * Applies .do extension fallback if the exact path doesn't exist.
     */
    private async get_callee_scope(
        fs_path: string,
        uri: string
    ): Promise<CalleeScope | { error: string }>;
}
```

**Current Issue**: The method passes the path directly to `scope_resolver.get_parsed_file` without checking for `.do` fallback.

**Fix**: Before calling `get_parsed_file`, check if `fs_path` exists. If not, try `fs_path + ".do"`.

### DirectiveParser (Already Implemented)

The `DirectiveParser` already has `resolve_path_with_fallback` that handles `.do` extension fallback:

```typescript
class DirectiveParser {
    /**
     * Resolve a path with .do extension fallback.
     * If the exact path doesn't exist, tries appending .do.
     */
    resolve_path_with_fallback(
        raw_path: string,
        containing_dir: string,
        file_exists?: (path: string) => boolean
    ): string;
}
```

### SemanticAnalyzer (Already Implemented)

The `SemanticAnalyzer` already has `resolve_with_do_fallback` for commands:

```typescript
class SemanticAnalyzer {
    /**
     * Try to resolve a path, appending .do if the exact path doesn't exist.
     */
    private resolve_with_do_fallback(resolved_path: string): string;
}
```

### Definition Provider (Needs Update)

The definition provider needs to apply `.do` fallback when resolving file paths for go-to-definition:

```typescript
// In definition.ts
// When resolving file paths, apply .do fallback
const resolved_path = path.resolve(current_dir, file_path);
if (!fs.existsSync(resolved_path) && !resolved_path.endsWith('.do')) {
    const with_do = resolved_path + '.do';
    if (fs.existsSync(with_do)) {
        return { uri: `file://${with_do}`, range: ... };
    }
}
```

## Data Models

### ForwardCall (Existing)

```typescript
interface ForwardCall {
    type: 'do' | 'run' | 'include';
    path: string;           // Resolved absolute path (with .do fallback applied)
    raw_path: string;       // Original path from user
    call_site_line: number;
    range: Range;
    source: 'command' | 'directive';
    is_static: boolean;
}
```

The `path` field already contains the resolved path with `.do` fallback applied. The `raw_path` field preserves the original user input for display purposes.

### Directive (Existing)

```typescript
interface Directive {
    type: 'done-by' | 'included-by';
    path: string;           // Resolved absolute path (with .do fallback applied)
    raw_path: string;       // Original path from user
    call_site?: CallSite;
    range: Range;
}
```

Same as ForwardCall - `path` is resolved, `raw_path` is original.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Path Resolution Fallback

*For any* path without a `.do` extension, if the exact path does not exist but `path.do` exists, the resolver SHALL return `path.do`.

This applies to:
- `do`, `run`, `include` commands
- `@lsp-do`, `@lsp-run`, `@lsp-include` directives
- `@lsp-done-by`, `@lsp-included-by` directives

**Validates: Requirements 1.1, 2.1, 2.2**

### Property 2: Explicit Extension Preserved

*For any* path that explicitly ends in `.do`, the resolver SHALL return that path without modification (regardless of whether the file exists).

**Validates: Requirements 1.2, 2.3**

### Property 3: Exact Path Precedence

*For any* path where both `path` and `path.do` exist, the resolver SHALL return the exact path specified by the user.

**Validates: Requirements 1.3, 2.4**

### Property 4: No False Positive Diagnostics

*For any* path without a `.do` extension where `path.do` exists, the LSP SHALL NOT emit a "file not found" diagnostic.

**Validates: Requirements 3.2**

### Property 5: Missing File Diagnostic

*For any* path where neither the exact path nor `path.do` exists, the LSP SHALL emit a diagnostic indicating the file was not found.

**Validates: Requirements 3.1, 3.3**

### Property 6: Forward Scope Resolution

*For any* `do`/`run`/`include` command or `@lsp-do`/`@lsp-run`/`@lsp-include` directive referencing a path without `.do` extension where `path.do` exists, the ForwardScopeResolver SHALL successfully resolve symbols from `path.do`.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 7: Backward Scope Resolution

*For any* `@lsp-done-by` or `@lsp-included-by` directive referencing a path without `.do` extension where `path.do` exists, the ScopeResolver SHALL successfully resolve symbols from `path.do`.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 8: Go-to-Definition Resolution

*For any* file path in a command or directive where the path omits `.do` and `path.do` exists, go-to-definition SHALL navigate to `path.do`.

**Validates: Requirements 6.1, 6.2**

## Error Handling

### Diagnostic Message Format

When a file is not found, the diagnostic message should indicate which paths were tried:

| Scenario | Diagnostic Message |
|----------|-------------------|
| `do foo` where neither `foo` nor `foo.do` exists | "Cannot read file: foo (also tried foo.do)" |
| `do foo.do` where `foo.do` doesn't exist | "Cannot read file: foo.do" |
| `@lsp-done-by: "parent"` where neither exists | "Cannot read file: parent (also tried parent.do)" |

### Implementation Notes

1. The `.do` fallback is only tried if the path doesn't already end in `.do`
2. The fallback check uses `fs.existsSync` for synchronous resolution
3. The resolved path is stored in `ForwardCall.path` and `Directive.path`
4. The raw path is preserved in `ForwardCall.raw_path` and `Directive.raw_path` for display

## Testing Strategy

### Unit Tests

1. **Path Resolution**
   - Test `resolve_path_with_fallback` with various path formats
   - Test with mocked file existence
   - Test precedence when both paths exist

2. **Diagnostic Messages**
   - Test message format for missing files
   - Test that no diagnostic is emitted when `.do` fallback succeeds

### Property-Based Tests

Using fast-check with minimum 100 iterations per test.

1. **Property 1: Path Resolution Fallback**
   - Generate random path names (without `.do`)
   - Mock file existence for `path.do` only
   - Verify resolution returns `path.do`

2. **Property 2: Explicit Extension Preserved**
   - Generate random paths ending in `.do`
   - Verify path is returned unchanged

3. **Property 3: Exact Path Precedence**
   - Generate random paths
   - Mock both `path` and `path.do` as existing
   - Verify exact path is returned

4. **Property 4: No False Positive Diagnostics**
   - Generate random paths without `.do`
   - Mock `path.do` as existing
   - Verify no "file not found" diagnostic

5. **Property 5: Missing File Diagnostic**
   - Generate random paths
   - Mock neither path as existing
   - Verify diagnostic is emitted

6. **Property 6: Forward Scope Resolution**
   - Create test files with symbols
   - Reference via path without `.do`
   - Verify symbols are resolved

7. **Property 7: Backward Scope Resolution**
   - Create test files with symbols
   - Reference via directive without `.do`
   - Verify symbols are inherited

8. **Property 8: Go-to-Definition Resolution**
   - Create test files
   - Invoke go-to-definition on path without `.do`
   - Verify correct file is returned

### Integration Tests

1. **End-to-end scope resolution**
   - Create multi-file project with mixed extension usage
   - Verify all symbols resolve correctly
   - Verify no false-positive diagnostics
