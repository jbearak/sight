# Design Document

## Overview

This feature addresses two related issues with the `@lsp-working-directory` directive when used with forward scope resolution:

1. **Working Directory Propagation**: Propagate the working directory context from parent files to nested files during forward scope resolution
2. **Diagnostic Line Number Accuracy**: Ensure diagnostics from nested files are reported with accurate location information

The implementation involves modifications to:
- `ForwardScopeResolver` to accept and propagate working directory context
- `ScopeResolver.get_parsed_file` to accept working directory for path resolution
- Diagnostic generation to include source file information and map ranges to parent call sites

## Architecture

The working directory propagation follows the existing forward scope resolution flow:

```
Root File (with @lsp-cd)
    │
    ├── working_directory = resolved from directive
    │
    └── ForwardScopeResolver.resolve()
            │
            ├── Pass working_directory to get_callee_scope()
            │
            └── For each nested file:
                    │
                    ├── Parse nested file with inherited working_directory
                    │
                    ├── If nested file has own @lsp-cd, use that instead
                    │
                    └── Recursively resolve with (possibly overridden) working_directory
```

## Components and Interfaces

### ForwardScopeResolver Changes

The `resolve` method will accept an optional `working_directory` parameter:

```typescript
interface ForwardResolveContext {
    visited: Map<string, EffectiveCallType>;
    effective_call_type: EffectiveCallType;
    depth: number;
    diagnostics: DirectiveDiagnostic[];
    working_directory?: string;  // NEW: inherited working directory
    call_chain?: string[];       // NEW: for diagnostic messages
}

async resolve(
    file_uri: string,
    forward_calls: ForwardCall[],
    effective_call_type: EffectiveCallType = 'include',
    context?: ForwardResolveContext,
    recursion_stack?: Set<string>,
    token?: CancellationToken,
    config?: Partial<ForwardScopeConfig>
): Promise<ForwardResolvedScope>
```

### get_callee_scope Changes

The method will accept working directory for path resolution in nested files:

```typescript
private async get_callee_scope(
    fs_path: string,
    uri: string,
    working_directory?: string  // NEW: for nested file path resolution
): Promise<{ 
    symbols: SymbolTable; 
    forward_calls: ForwardCall[];
    working_directory?: string;  // NEW: nested file's own directive (if any)
} | { error: string }>
```

### Diagnostic Enhancement

Diagnostics from nested files will include source information:

```typescript
interface NestedDiagnostic extends DirectiveDiagnostic {
    source_file?: string;        // Path of the file where error originated
    call_chain?: string[];       // Full call chain from root to error
    parent_call_site?: Range;    // Range in parent file that triggered this
}
```

## Data Models

### Working Directory Context Flow

```
DocumentStore.update_document()
    │
    ├── Parse @lsp-cd directive
    │
    ├── Resolve working_directory (relative to script or workspace)
    │
    └── Pass to Analyzer via config.working_directory
            │
            └── Analyzer detects forward calls with resolved paths
                    │
                    └── ForwardScopeResolver.resolve()
                            │
                            ├── Inherit working_directory from context
                            │
                            └── For each callee:
                                    │
                                    ├── get_callee_scope(path, uri, working_directory)
                                    │
                                    ├── Parse callee file
                                    │
                                    ├── Check for callee's own @lsp-cd
                                    │
                                    └── Use callee's directive OR inherited working_directory
```

### Diagnostic Range Mapping

When a nested file has an error, the diagnostic range should point to the parent's call site:

```
survey.do (line 230): include dhs/wm_vars
    │
    └── wm_vars.do (line 10): do "dhs/wm_vars/survey_round.do"
            │
            └── ERROR: Cannot read file

Diagnostic:
    range: { line: 230 }  // Points to survey.do's include statement
    message: "dhs/wm_vars.do: Cannot read file: dhs/wm_vars/survey_round.do"
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Working Directory Inheritance and Propagation

*For any* file hierarchy where a parent file has a working directory directive, all nested files without their own directive SHALL resolve paths using the inherited working directory, and nested files with their own directive SHALL use their own directive instead.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Nested File Diagnostic Source Identification

*For any* diagnostic originating from a nested file during forward scope resolution, the diagnostic message SHALL include the source file path and the diagnostic range SHALL point to the call site in the immediate parent file.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Backward Compatibility

*For any* file hierarchy without working directory directives, the path resolution behavior SHALL match the existing fallback strategy (script-relative first, then workspace-root-relative), and single-file analysis SHALL remain unchanged.

**Validates: Requirements 3.1, 3.2, 3.3**

## Error Handling

### Missing Working Directory

When a working directory directive specifies a path that doesn't exist:
- Emit a warning diagnostic
- Fall back to script-relative resolution
- Continue processing with fallback behavior

### Circular Dependencies

The existing cycle detection in ForwardScopeResolver handles circular dependencies. Working directory propagation does not change this behavior.

### Invalid Paths in Nested Files

When a nested file references a path that cannot be resolved:
- Generate diagnostic with source file information
- Map range to parent's call site
- Include call chain in message for multi-level nesting

## Testing Strategy

### Unit Tests

1. Test working directory propagation through single-level nesting
2. Test working directory override by nested file's own directive
3. Test diagnostic message format includes source file
4. Test diagnostic range points to parent call site

### Property-Based Tests

1. **Working Directory Inheritance Property Test**
   - Generate random file hierarchies with/without directives
   - Verify path resolution uses correct working directory at each level
   - Minimum 100 iterations

2. **Diagnostic Source Identification Property Test**
   - Generate nested file structures with intentional errors
   - Verify diagnostics include source file and correct range
   - Minimum 100 iterations

3. **Backward Compatibility Property Test**
   - Generate file hierarchies without directives
   - Verify behavior matches existing implementation
   - Minimum 100 iterations

### Integration Tests

1. Test with real file structure (fertility_surveys/dhs/survey.do)
2. Verify working directory propagation resolves paths correctly
3. Verify diagnostic line numbers point to correct locations
