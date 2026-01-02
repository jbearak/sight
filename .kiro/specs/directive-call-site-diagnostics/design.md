# Design Document: Directive Call Site Diagnostics

## Overview

This feature enhances the diagnostic messaging in the Scope Resolver when processing cross-file directives (`@lsp-done-by`, `@lsp-run-by`, `@lsp-included-by`). The goal is to provide clear, actionable feedback to users about call site identification and type mismatches without being overly alarming.

The implementation modifies the `follow_directives` method in `ScopeResolver` to emit appropriate diagnostics based on the call site resolution outcome and any type mismatches detected.

## Architecture

The changes are localized to the `ScopeResolver` class in `src/scope-resolver/index.ts`. The existing call site resolution logic already handles multiple resolution strategies (explicit parameters, reverse deps, text inference, config default). This feature adds diagnostic emission at appropriate points in that flow.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Call Site Resolution Flow                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Explicit call_site parameter?                               │
│     ├─ line=N → Validate line exists & contains call statement  │
│     │           ├─ Out of bounds → WARNING                      │
│     │           └─ No call statement → WARNING                  │
│     └─ match=S → Find match string                              │
│                  └─ Not found → WARNING                         │
│                                                                  │
│  2. Reverse deps available?                                      │
│     ├─ Yes → Use earliest edge, check for mixed call types      │
│     │        └─ Mixed types → WARNING                           │
│     └─ No → Continue to text inference                          │
│                                                                  │
│  3. Text inference successful?                                   │
│     ├─ Yes → Use inferred line and call type                    │
│     │        └─ Check for mixed call types → WARNING            │
│     └─ No → Use config default, emit INFORMATION                │
│                                                                  │
│  4. Check directive/call-type mismatch                          │
│     ├─ included-by + do/run → WARNING (existing)                │
│     └─ done-by/run-by + include → INFORMATION (new)             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified: ScopeResolver.follow_directives()

The `follow_directives` method is the primary location for changes. The method already handles call site resolution with the following priority:

1. Explicit `call_site` parameter (`line=` or `match=`)
2. Reverse dependency edges from forward scope resolution
3. Text inference by scanning parent file content
4. Config default (`assume_call_site: 'end' | 'start'`)

#### New Helper Methods

```typescript
/**
 * Validate that a line number is within bounds of the parent file.
 * @param line_number - 0-indexed line number
 * @param parent_content - Content of the parent file
 * @returns true if line exists, false otherwise
 */
private is_line_in_bounds(line_number: number, parent_content: string): boolean;

/**
 * Check if a line contains a valid call statement (do/run/include command or @lsp-do/run/include directive).
 * @param line_content - The content of the line to check
 * @returns Object with is_valid and detected call_type, or undefined if no call found
 */
private validate_call_statement(line_content: string): { is_valid: boolean; call_type?: 'do' | 'run' | 'include' } | undefined;

/**
 * Detect if parent file has mixed call types (both do/run AND include) referencing the child.
 * @param parent_content - Content of the parent file
 * @param child_filename - Filename of the child file
 * @returns Object with has_mixed_types and the call types found
 */
private detect_mixed_call_types(parent_content: string, child_filename: string): { has_mixed: boolean; types: ('do' | 'run' | 'include')[] };
```

### Modified: DirectiveParser

Add a new method to find all call sites (not just the first one) for mixed call type detection:

```typescript
/**
 * Find all call sites for a child file in the parent content.
 * @param parent_content - Content of the parent file
 * @param child_filename - Filename of the child file
 * @returns Array of { line: number; call_type: 'do' | 'run' | 'include' }
 */
find_all_call_sites_for_file(
    parent_content: string,
    child_filename: string
): Array<{ line: number; call_type: 'do' | 'run' | 'include' }>;
```

### DirectiveDiagnostic Type

The existing `DirectiveDiagnostic` type already supports the required severity levels:

```typescript
interface DirectiveDiagnostic {
    message: string;
    range: Range;
    severity: 'error' | 'warning' | 'information';
    source?: DiagnosticSource;
}
```

## Data Models

No new data models are required. The existing `DirectiveDiagnostic` type is sufficient for all new diagnostics.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*



### Property 1: Call Site Not Identified Emits Information Diagnostic

*For any* parent file content that does not contain `do`/`run`/`include` statements referencing the child file, AND the directive has no explicit `line=` or `match=` parameter, AND reverse deps have no call edges, the Scope_Resolver SHALL emit an information-level diagnostic that mentions the parent filename and suggests using `line=` or `match=`.

**Validates: Requirements 1.1, 1.7**

### Property 2: Valid line= Parameter Suppresses Diagnostic

*For any* parent file with N lines containing a valid call statement at line L (where 1 ≤ L ≤ N), when the directive specifies `line=L`, the Scope_Resolver SHALL NOT emit a "cannot identify call site" diagnostic.

**Validates: Requirements 1.2**

### Property 3: Out-of-Bounds line= Emits Warning

*For any* parent file with N lines, when the directive specifies `line=M` where M > N, the Scope_Resolver SHALL emit a warning-level diagnostic indicating the line is out of bounds.

**Validates: Requirements 1.3**

### Property 4: Invalid Call Statement at line= Emits Warning

*For any* parent file where line L exists but does not contain a `do`/`run`/`include` command or `@lsp-do`/`@lsp-run`/`@lsp-include` directive, when the directive specifies `line=L`, the Scope_Resolver SHALL emit a warning-level diagnostic.

**Validates: Requirements 1.4**

### Property 5: Valid match= Parameter Suppresses Diagnostic

*For any* parent file containing string S, when the directive specifies `match=S`, the Scope_Resolver SHALL NOT emit a "cannot identify call site" diagnostic.

**Validates: Requirements 1.5**

### Property 6: Not-Found match= Emits Warning

*For any* parent file not containing string S, when the directive specifies `match=S`, the Scope_Resolver SHALL emit a warning-level diagnostic indicating the match string was not found.

**Validates: Requirements 1.6**

### Property 7: included-by with do/run Mismatch Emits Warning

*For any* child file with `@lsp-included-by` directive where the detected call type in the parent is `do` or `run`, the Scope_Resolver SHALL emit a warning-level diagnostic explaining that local macros will not be inherited.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 8: done-by/run-by with include Mismatch Emits Information

*For any* child file with `@lsp-done-by` or `@lsp-run-by` directive where the detected call type in the parent is `include`, the Scope_Resolver SHALL emit an information-level diagnostic explaining that full inheritance (including local macros) will occur.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 9: Mixed Call Types Emits Warning

*For any* parent file containing both `do`/`run` AND `include` statements referencing the same child file, the Scope_Resolver SHALL emit a warning-level diagnostic explaining the ambiguity and suggesting `line=` or `match=` parameters.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 10: Diagnostic Range Matches Directive Location

*For any* call-site-related diagnostic emitted by the Scope_Resolver, the diagnostic range SHALL match the range of the directive in the child file.

**Validates: Requirements 5.1**

### Property 11: Diagnostic Includes Source Attribution

*For any* call-site-related diagnostic emitted by the Scope_Resolver, the diagnostic SHALL include source attribution indicating the parent file involved.

**Validates: Requirements 5.2**

### Property 12: Information Diagnostics Respect Configuration

*For any* information-level diagnostic for call site identification, when the cross-file diagnostic configuration is set to suppress information-level diagnostics, the diagnostic SHALL NOT be emitted.

**Validates: Requirements 6.1**

### Property 13: included-by Warning Is Not Suppressible

*For any* warning-level diagnostic for `included-by` with `do`/`run` mismatch, regardless of the cross-file diagnostic configuration, the warning SHALL be emitted.

**Validates: Requirements 6.2**

## Error Handling

### Parent File Not Found

When the parent file specified in a directive cannot be read, the existing error handling remains unchanged. This feature does not modify that behavior.

### Parse Errors

If the parent file cannot be parsed, the existing error handling applies. Call site validation is skipped, and the default call site assumption is used.

### Edge Cases

1. **Empty parent file**: Treated as "call site not identified" → information diagnostic
2. **Parent file with only comments**: Treated as "call site not identified" → information diagnostic
3. **Multiple directives to same parent**: Each directive is processed independently; mixed call type detection applies per directive
4. **Circular directive chains**: Existing cycle detection handles this; no additional diagnostics needed

## Testing Strategy

### Unit Tests

Unit tests will verify individual helper methods:

1. `is_line_in_bounds()` - boundary conditions
2. `validate_call_statement()` - various line content patterns
3. `detect_mixed_call_types()` - mixed and non-mixed scenarios

### Property-Based Tests

Property-based tests will use fast-check to verify the correctness properties defined above. Each property test will:

1. Generate random parent file content
2. Generate random child file names
3. Generate random directive configurations
4. Verify the expected diagnostic is emitted (or not emitted)

The property tests will run with a minimum of 100 iterations each.

### Integration Tests

Integration tests will verify end-to-end behavior:

1. Create temporary files with specific directive configurations
2. Invoke the Scope Resolver
3. Verify the diagnostics in the resolved scope

### Test Configuration

- Property-based testing library: fast-check
- Minimum iterations per property: 100
- Test file location: `tests/property/directive-call-site-diagnostics.prop.test.ts`
