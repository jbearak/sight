# Design Document: Cross-File Awareness Fixes

## Overview

This design addresses three issues that need to be fixed before merging the cross-file-awareness feature branch:

1. **Directive presence detection**: The completion provider incorrectly determines whether a file has directives by checking if parent files were resolved into the scope chain, rather than checking if directives were actually parsed from the file.

2. **Type safety in workspace-config**: The workspace configuration module uses `any` types which reduces type safety.

3. **Logging in ScopeResolver**: The scope resolver uses raw `console.log`/`console.warn` instead of routing through the LSP connection's logging interface.

## Architecture

The fixes involve three components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Completion Provider                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ get_completions()                                        │   │
│  │   - Calls scope_resolver.resolve()                       │   │
│  │   - Checks has_directives from ResolvedScope             │   │
│  │   - Uses directives_required config                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Scope Resolver                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ resolve()                                                │   │
│  │   - Parses directives via DirectiveParser                │   │
│  │   - Returns ResolvedScope with has_directives flag       │   │
│  │   - Uses logger interface for logging                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Workspace Config                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ map_stata_lsp_json_to_partial_config()                   │   │
│  │   - Returns Partial<StataLSPConfig>                      │   │
│  │   - Uses DeepPartial helper type                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. ResolvedScope Extension

Add a `has_directives` field to `ResolvedScope` to indicate whether the current file has directives declared (regardless of whether they resolved successfully):

```typescript
export interface ResolvedScope {
  chain: ScopeChainEntry[];
  symbols: SymbolTable;
  out_of_scope_symbols: OutOfScopeSymbol[];
  diagnostics: DirectiveDiagnostic[];
  has_directives: boolean;  // NEW: true if current file has directive comments
}
```

### 2. Logger Interface

Define a simple logger interface that the ScopeResolver can use:

```typescript
export interface ScopeResolverLogger {
  log(message: string): void;
  warn(message: string): void;
}
```

### 3. ScopeResolver Constructor Update

Update the ScopeResolver to accept an optional logger:

```typescript
export class ScopeResolver {
  private logger?: ScopeResolverLogger;
  
  constructor(logger?: ScopeResolverLogger) {
    this.logger = logger;
    // ... existing initialization
  }
  
  private log(message: string): void {
    if (this.logger) {
      this.logger.log(message);
    } else {
      console.log(message);
    }
  }
  
  private warn(message: string): void {
    if (this.logger) {
      this.logger.warn(message);
    } else {
      console.warn(message);
    }
  }
}
```

### 4. Workspace Config Type Safety

Define a `DeepPartial` helper type and use it for the config mapping:

```typescript
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export function map_stata_lsp_json_to_partial_config(
  raw: unknown
): DeepPartial<StataLSPConfig> {
  // ... implementation
}

export function read_workspace_file_config_from_root(
  workspace_root: string
): { partial_config: DeepPartial<StataLSPConfig>; error?: string } {
  // ... implementation
}
```

## Data Models

### DeepPartial Type

A recursive partial type that makes all nested properties optional:

```typescript
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
```

This allows `map_stata_lsp_json_to_partial_config` to return a properly typed partial config where any subset of the config can be specified.

### ScopeResolverLogger Interface

```typescript
export interface ScopeResolverLogger {
  log(message: string): void;
  warn(message: string): void;
}
```

This matches the interface of `connection.console` from vscode-languageserver, allowing direct use of the connection's console.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Directive Presence Detection Accuracy

*For any* Stata file content, the `has_directives` field in `ResolvedScope` should be `true` if and only if the file contains `@lsp-done-by` or `@lsp-included-by` directive comments in its header, regardless of whether the target files exist or can be resolved.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Config Mapping Type Safety

*For any* valid JSON object representing a `.stata-lsp.json` configuration, the `map_stata_lsp_json_to_partial_config` function should return a value that conforms to `DeepPartial<StataLSPConfig>`, with all recognized fields properly mapped from camelCase to snake_case.

**Validates: Requirements 2.2, 2.3**

### Property 3: Logger Routing

*For any* ScopeResolver instance created with a logger, all warning and log messages generated during `resolve()` should be routed through the provided logger interface, not through raw `console.log` or `console.warn`.

**Validates: Requirements 3.2, 3.4**

## Error Handling

### Missing Target Files

When a directive points to a non-existent file:
- `has_directives` should still be `true` (the directive exists)
- A diagnostic warning should be added to `ResolvedScope.diagnostics`
- The scope chain should not include the missing file

### Invalid JSON Config

When `.stata-lsp.json` contains invalid JSON or unrecognized fields:
- Return an empty partial config `{}`
- Include error message in the result's `error` field
- Do not throw exceptions

### Logger Fallback

When no logger is provided to ScopeResolver:
- Fall back to `console.log`/`console.warn` for backward compatibility
- This ensures existing code that doesn't provide a logger continues to work

## Testing Strategy

### Unit Tests

1. **Directive presence detection**:
   - Test file with valid directives to existing files → `has_directives: true`
   - Test file with directives to non-existent files → `has_directives: true`
   - Test file with no directives → `has_directives: false`
   - Test file with malformed directives → `has_directives: false` (malformed don't count)

2. **Config mapping**:
   - Test mapping of all recognized fields
   - Test handling of unknown fields (ignored)
   - Test handling of invalid JSON

3. **Logger routing**:
   - Test that logger receives messages when provided
   - Test that console is used when no logger provided

### Property-Based Tests

Property tests should use fast-check to generate:
- Random file contents with/without directive comments
- Random JSON config objects
- Random sequences of resolve() calls with various file states

Each property test should run minimum 100 iterations to ensure coverage of edge cases.
