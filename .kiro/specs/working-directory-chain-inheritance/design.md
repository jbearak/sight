# Design Document: Working Directory Chain Inheritance

## Overview

This design addresses two related issues in the cross-file directive resolution system:

1. **Working directory inheritance**: The `@lsp-cd` directive in an ancestor file should propagate through the backward directive chain so that forward calls in descendant files resolve paths correctly.

2. **Diagnostic source attribution**: When "Cannot read file" errors occur during cross-file resolution, diagnostics should indicate the source file and map line numbers to the active file.

The solution involves:
- Passing working directory context through the backward resolution chain
- Propagating working directory to forward call resolution in parent files
- Tracking diagnostic source information through the resolution chain
- Remapping diagnostic ranges to the active file's directive lines

## Architecture

The existing architecture has these components involved in cross-file resolution:

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  ScopeResolver  │────▶│ ForwardScopeResolver │────▶│   DirectiveParser   │
│                 │     │                      │     │                     │
│ - follow_dirs() │     │ - resolve()          │     │ - parse()           │
│ - resolve()     │     │ - get_callee_scope() │     │ - working_directory │
└─────────────────┘     └──────────────────────┘     └─────────────────────┘
```

The changes will:
1. Pass `working_directory` through `follow_directives()` to `resolve_parent_forward_calls()`
2. Pass `working_directory` to `get_parsed_file()` for path resolution in nested files
3. Track source file information in diagnostics
4. Remap diagnostic ranges to the active file's directive line

## Components and Interfaces

### ScopeResolver Changes

The `follow_directives()` method already returns `working_directory` from the chain. The key change is to pass this working directory to `resolve_parent_forward_calls()` and ensure it's used when parsing parent files.

```typescript
// In follow_directives(), when calling resolve_parent_forward_calls:
const forward_result = await this.resolve_parent_forward_calls(
    my_parent_uri,
    my_parent_result.forward_calls,
    my_call_site_line,
    my_directive.type,
    my_parent_result.working_directory ?? found_working_directory, // Use parent's WD or inherited
    depth,
    config,
    visited,
    token
);
```

### ForwardScopeResolver Changes

The `get_callee_scope()` method needs to pass `working_directory` to `get_parsed_file()`:

```typescript
private async get_callee_scope(
    fs_path: string,
    uri: string,
    working_directory?: string
): Promise<...> {
    // Pass working_directory to get_parsed_file for path resolution
    const parsed_result = await this.scope_resolver.get_parsed_file(
        final_uri, 
        final_fs_path, 
        { skip_disk_if_cached, working_directory }
    );
    // ...
}
```

### Diagnostic Source Attribution

Add a new interface to track diagnostic source information:

```typescript
interface DiagnosticSource {
    source_file: string;      // Filename where error originated
    source_line: number;      // Line number in source file (0-indexed)
    active_file_range: Range; // Range to use in active file
}
```

Modify `DirectiveDiagnostic` to include optional source information:

```typescript
interface DirectiveDiagnostic {
    message: string;
    range: Range;
    severity: 'error' | 'warning' | 'info';
    source?: DiagnosticSource;  // NEW: Source attribution
}
```

### Diagnostic Range Remapping

When diagnostics are collected during backward resolution, they need to be remapped to the active file's directive line. This happens in `ScopeResolver.resolve()`:

```typescript
// After follow_directives(), remap diagnostic ranges
const active_file_directive_range = my_directives[0]?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
};

for (const diagnostic of the_diagnostics) {
    if (diagnostic.source) {
        // Remap range to active file's directive
        diagnostic.range = active_file_directive_range;
        // Update message to include source info
        diagnostic.message = `${diagnostic.message}: ${diagnostic.source.source_file} line ${diagnostic.source.source_line + 1}`;
    }
}
```

## Data Models

### Working Directory Context Flow

```
loop.do (@lsp-cd ../)
    │
    ▼ working_directory = "/path/to/fertility_surveys"
survey.do (@lsp-done-by loop.do)
    │
    ▼ inherits working_directory from loop.do
bh_vars.do (@lsp-included-by survey.do)
    │
    ▼ inherits working_directory from survey.do (via loop.do)
```

### Diagnostic Source Tracking

When a diagnostic is created in a parent file:

```typescript
// In ForwardScopeResolver.resolve() when creating diagnostic:
my_context.diagnostics.push({
    message: `Cannot read file: ${my_call.raw_path}${error_suffix}`,
    range: my_call.range,  // Original range in source file
    severity: 'warning',
    source: {
        source_file: path.basename(URI.parse(file_uri).fsPath),
        source_line: my_call.range.start.line,
        active_file_range: undefined  // Set later during remapping
    }
});
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Working Directory Inheritance Transitivity

*For any* directive chain A → B → C where C has `@lsp-cd`, the working directory from C SHALL be available when resolving forward calls in A and B.

**Validates: Requirements 1.1, 1.2, 2.1**

### Property 2: Local Working Directory Override

*For any* file with its own `@lsp-cd` directive, that directive SHALL take precedence over any inherited working directory from the directive chain.

**Validates: Requirements 1.3**

### Property 3: Forward Call Path Resolution with Working Directory

*For any* forward call with a relative path and an inherited working directory, the path SHALL resolve relative to the working directory, not the script's containing directory.

**Validates: Requirements 2.2, 2.3, 5.1, 5.2**

### Property 4: Diagnostic Source Attribution Completeness

*For any* "Cannot read file" diagnostic originating from a parent file in the directive chain, the diagnostic message SHALL include the source filename and line number.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: Diagnostic Range Remapping

*For any* diagnostic originating from a parent file, the diagnostic range SHALL point to a directive line in the active file (line 0 or the first directive line).

**Validates: Requirements 4.1, 4.2, 4.3**

## Error Handling

### Missing Working Directory

If a working directory is specified but the directory doesn't exist:
- Continue resolution with the specified path
- The "Cannot read file" diagnostic will indicate the attempted paths

### Circular Dependencies

The existing cycle detection in `ScopeResolver` and `ForwardScopeResolver` handles circular dependencies. Working directory inheritance doesn't change this behavior.

### Invalid Working Directory Paths

If `@lsp-cd` specifies an invalid path (e.g., contains macro references):
- Skip working directory inheritance for that file
- Log a warning but don't emit a diagnostic (the directive parser already handles this)

## Testing Strategy

### Unit Tests

1. **Working directory inheritance through chain**
   - Test 2-level chain (A → B with `@lsp-cd`)
   - Test 3-level chain (A → B → C with `@lsp-cd` in C)
   - Test override (A has `@lsp-cd`, B → A also has `@lsp-cd`)

2. **Forward call path resolution**
   - Test relative path with working directory
   - Test relative path without working directory (fallback behavior)
   - Test absolute path (should ignore working directory)

3. **Diagnostic source attribution**
   - Test diagnostic message format
   - Test diagnostic range remapping

### Property-Based Tests

Property tests will use fast-check to generate:
- Random directive chains with varying depths
- Random working directory configurations
- Random forward call paths

Each property test will run minimum 100 iterations to ensure coverage.

### Integration Tests

1. **Real file scenario**: Test with the actual `fertility_surveys/dhs/` files
   - `bh_vars.do` → `survey.do` → `loop.do` chain
   - Verify `dhs/year_recodes` resolves correctly

2. **Diagnostic display**: Verify diagnostics appear at correct locations in IDE
