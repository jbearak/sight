# Design Document: Parent Forward Call Inheritance

## Overview

This feature enhances the backward scope resolution (`@lsp-done-by`, `@lsp-included-by`, `@lsp-run-by`) to also follow forward calls (`do`, `run`, `include`) in parent files. When a child file declares a parent via a backward directive, the LSP will now also resolve forward calls in the parent that occur before the call site, making symbols from those executed scripts visible to the child.

This addresses the common pattern where a parent script runs setup/utility scripts before calling child scripts, and the child scripts expect to use symbols defined in those setup scripts.

## Architecture

The solution integrates the existing `ForwardScopeResolver` into the backward resolution flow in `ScopeResolver`. When following a backward directive, after getting the parent's symbols, we also resolve the parent's forward calls and include symbols from calls that occur before the call site.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Child File (survey.do)                       │
│  @lsp-done-by loop.do                                           │
│  ...                                                             │
│  if ( "${aww_programs_are_ready}" != "1" ) { ... }              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Backward Resolution
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Parent File (loop.do)                        │
│  @lsp-cd ../                                                     │
│  ...                                                             │
│  run programs.do          ← Line 75 (forward call)              │
│  ...                                                             │
│  do "dhs/survey.do"       ← Line 107+ (call site)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Forward Resolution (before call site)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     programs.do                                  │
│  ...                                                             │
│  global aww_programs_are_ready 1                                │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified: ScopeResolver

The `ScopeResolver.follow_directives()` method will be enhanced to:

1. After parsing a parent file, extract its forward calls
2. Filter forward calls to only those before the call site
3. Use `ForwardScopeResolver` to resolve those forward calls
4. Merge the forward-resolved symbols into the parent's symbols before applying inheritance rules

```typescript
interface ParentForwardResolutionResult {
    symbols: SymbolTable;           // Symbols from parent + its forward calls
    forward_diagnostics: DirectiveDiagnostic[];  // Diagnostics from forward resolution
}

// New method in ScopeResolver
private async resolve_parent_forward_calls(
    parent_uri: string,
    parent_forward_calls: ForwardCall[],
    call_site_line: number,
    effective_call_type: EffectiveCallType,
    working_directory: string | undefined,
    depth: number,
    config: ScopeResolverConfig,
    token?: CancellationToken
): Promise<ParentForwardResolutionResult>;
```

### Modified: ForwardScopeResolver

The `ForwardScopeResolver` already supports the core functionality needed. We'll add a helper method to filter calls by line number:

```typescript
// New helper method
filter_calls_before_line(
    forward_calls: ForwardCall[],
    line: number
): ForwardCall[];
```

### Data Flow

1. Child file has `@lsp-done-by parent.do`
2. `ScopeResolver.follow_directives()` loads parent file
3. Determine call site line (explicit, inferred, or default)
4. Extract parent's forward calls that occur before call site
5. Call `ForwardScopeResolver.resolve()` on those forward calls
6. Merge forward-resolved symbols with parent's direct symbols
7. Apply inheritance rules based on backward directive type
8. Filter by call site and add to scope chain

## Data Models

### Extended ScopeChainEntry

No changes needed - the existing structure can represent the merged symbols.

### ForwardResolveContext Extension

The existing `ForwardResolveContext` already has all needed fields:
- `working_directory`: For path resolution
- `effective_call_type`: For inheritance rules
- `depth`: For depth limiting
- `visited`: For cycle detection

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Forward calls before call site are included

*For any* parent file with forward calls and any child file with a backward directive, symbols from forward calls that occur before the call site SHALL be included in the child's resolved scope.

**Validates: Requirements 1.1, 2.1, 2.2**

### Property 2: Forward calls after call site are excluded

*For any* parent file with forward calls after the call site, symbols from those forward calls SHALL NOT be included in the child's resolved scope.

**Validates: Requirements 2.1**

### Property 3: do/run inheritance excludes locals

*For any* parent file with `do` or `run` forward calls, local macros from the called scripts SHALL NOT be included in the child's scope, while globals, scalars, matrices, and programs SHALL be included.

**Validates: Requirements 1.2, 1.3**

### Property 4: include inheritance includes all symbols

*For any* parent file with `include` forward calls AND a child using `@lsp-included-by`, ALL symbols including locals from the included scripts SHALL be included in the child's scope.

**Validates: Requirements 1.4, 3.2**

### Property 5: Effective call type propagation

*For any* child using `@lsp-done-by` or `@lsp-run-by`, all forward calls in the parent SHALL be treated with effective type `do`, excluding locals from all forward-called scripts regardless of the original call type.

**Validates: Requirements 3.1, 3.3**

### Property 6: Nested forward calls are resolved

*For any* parent file with nested forward calls (A calls B, B calls C), symbols from all levels SHALL be included in the child's scope (up to max depth), with correct inheritance rules applied at each level.

**Validates: Requirements 1.5**

### Property 7: Cycle detection prevents infinite loops

*For any* forward call chain that creates a cycle, the resolver SHALL detect the cycle, emit a warning, and terminate without hanging.

**Validates: Requirements 4.1**

### Property 8: Depth limiting is enforced

*For any* combined backward + forward resolution that exceeds max depth, the resolver SHALL stop at the limit and emit a warning.

**Validates: Requirements 4.2**

### Property 9: Working directory context is used

*For any* parent file with a working directory directive (`@lsp-cd`), forward call paths SHALL be resolved relative to that working directory.

**Validates: Requirements 5.1, 5.2, 5.3**

## Error Handling

1. **Missing forward-called file**: Emit warning diagnostic, continue with other forward calls
2. **Cycle in forward calls**: Emit warning diagnostic, skip the cyclic call
3. **Max depth exceeded**: Emit warning diagnostic, stop resolution at that point
4. **Parse error in forward-called file**: Emit warning diagnostic, skip that file

## Testing Strategy

### Unit Tests

- Test `filter_calls_before_line()` with various line configurations
- Test inheritance rule application for each call type combination
- Test cycle detection with simple and complex cycles
- Test depth limiting at various depths

### Property-Based Tests

Each correctness property will be implemented as a property-based test using fast-check:

1. Generate random parent files with forward calls at various positions
2. Generate random child files with backward directives
3. Generate random symbol definitions in forward-called files
4. Verify the properties hold for all generated inputs

Configuration:
- Minimum 100 iterations per property test
- Tag format: **Feature: parent-forward-call-inheritance, Property N: <property_text>**

### Integration Tests

- Test the full flow with real file structures (like the fertility_surveys example)
- Test interaction with working directory inheritance
- Test interaction with existing forward scope resolution in child files

