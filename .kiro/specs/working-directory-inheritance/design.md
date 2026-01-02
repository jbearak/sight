# Design Document: Working Directory Inheritance

## Overview

This feature enhances the cross-file scope resolution system to automatically inherit the working directory context from parent files when using backward directives (`@lsp-done-by`, `@lsp-included-by`). It also adds `@lsp-run-by` as a synonym for `@lsp-done-by`.

The implementation requires changes to:
1. **DirectiveParser**: Add `@lsp-run-by` as a synonym for `@lsp-done-by`
2. **ScopeResolver**: Propagate working directory through the directive chain and return it in the resolved scope
3. **DocumentStore**: Use inherited working directory when the current file lacks its own directive

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DocumentStore                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ update_document(uri, content)                                │   │
│  │   1. Parse directives (get own working_directory)            │   │
│  │   2. If has backward directives AND no own working_directory │   │
│  │      → Call ScopeResolver.resolve() to get inherited WD      │   │
│  │   3. Use effective working_directory for analysis            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ScopeResolver                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ resolve(uri, content, config)                                │   │
│  │   1. Parse current file (get directives, working_directory)  │   │
│  │   2. Follow directive chain recursively                      │   │
│  │   3. Track working_directory at each level                   │   │
│  │   4. Return ResolvedScope with inherited_working_directory   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        DirectiveParser                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ parse(content, file_uri)                                     │   │
│  │   - Parse @lsp-done-by, @lsp-included-by, @lsp-run-by        │   │
│  │   - Parse @lsp-working-directory (and synonyms)              │   │
│  │   - Return directives + working_directory                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### DirectiveParser Changes

Add `run-by` to the directive pattern to recognize `@lsp-run-by` as a synonym for `@lsp-done-by`:

```typescript
// Current pattern
const DIRECTIVE_PATTERN = /@lsp-(done-by|included-by):?\s+(?:"([^"]+)"|([^\s]+))(?:\s+(.*))?$/;

// Updated pattern
const DIRECTIVE_PATTERN = /@lsp-(done-by|run-by|included-by):?\s+(?:"([^"]+)"|([^\s]+))(?:\s+(.*))?$/;
```

When parsing, map `run-by` to `done-by` type:

```typescript
// In parse() method
const my_type_raw = my_match[1] as 'done-by' | 'run-by' | 'included-by';
const my_type = my_type_raw === 'run-by' ? 'done-by' : my_type_raw;
```

### ScopeResolver Changes

#### ResolvedScope Extension

Add `inherited_working_directory` to the `ResolvedScope` type:

```typescript
interface ResolvedScope {
    chain: ScopeChainEntry[];
    symbols: SymbolTable;
    out_of_scope_symbols: OutOfScopeSymbol[];
    diagnostics: DirectiveDiagnostic[];
    has_directives: boolean;
    // NEW: Working directory inherited from parent files (if any)
    inherited_working_directory?: string;
}
```

#### Working Directory Propagation

The `follow_directives` method needs to track and propagate working directory:

```typescript
private async follow_directives(
    directives: Directive[],
    current_uri: string,
    visited: Set<string>,
    chain: ScopeChainEntry[],
    diagnostics: DirectiveDiagnostic[],
    out_of_scope: OutOfScopeSymbol[],
    depth: number,
    config: ScopeResolverConfig,
    token?: CancellationToken,
    inherited_working_directory?: string  // NEW parameter
): Promise<{ working_directory?: string }> {
    // Track the working directory found at this level
    let found_working_directory: string | undefined;
    
    for (const my_directive of directives) {
        // ... existing directive processing ...
        
        const my_parent_result = await this.get_parsed_file(my_parent_uri, my_directive.path);
        
        // Check if parent has a working directory
        if ('working_directory' in my_parent_result && my_parent_result.working_directory) {
            // Use nearest parent's working directory (first one found at smallest depth)
            if (!found_working_directory) {
                found_working_directory = my_parent_result.working_directory;
            }
        }
        
        // Recurse with current working directory context
        const recursive_result = await this.follow_directives(
            normalized_parent_directives,
            my_parent_uri,
            visited,
            chain,
            diagnostics,
            out_of_scope,
            depth + 1,
            config,
            token,
            found_working_directory ?? inherited_working_directory
        );
        
        // If no working directory found at this level, use one from deeper in chain
        if (!found_working_directory && recursive_result.working_directory) {
            found_working_directory = recursive_result.working_directory;
        }
    }
    
    return { working_directory: found_working_directory ?? inherited_working_directory };
}
```

#### Resolve Method Update

Update `resolve()` to return inherited working directory:

```typescript
async resolve(
    file_uri: string,
    file_content: string,
    config: Partial<ScopeResolverConfig> = {},
    token?: CancellationToken
): Promise<ResolvedScope> {
    // ... existing code ...
    
    // Parse current file
    const my_parse_result = this.parse_file(file_uri, file_content);
    
    // Check if current file has its own working directory
    const own_working_directory = my_parse_result.working_directory;
    
    // Follow directive chain and get inherited working directory
    const directive_result = await this.follow_directives(
        normalized_directives,
        file_uri,
        visited,
        the_chain,
        the_diagnostics,
        the_out_of_scope,
        1,
        my_config,
        token
    );
    
    // Only use inherited working directory if current file doesn't have its own
    const inherited_working_directory = own_working_directory 
        ? undefined 
        : directive_result.working_directory;
    
    return {
        chain: the_chain,
        symbols: merged_symbols,
        out_of_scope_symbols: the_out_of_scope,
        diagnostics: the_diagnostics,
        has_directives,
        inherited_working_directory,
    };
}
```

### DocumentStore Changes

Update `update_document` to use inherited working directory:

```typescript
private async update_document(uri: string, content: string): Promise<DocumentState> {
    // Parse directives to get own working_directory
    const directive_result = directive_parser.parse(content, uri);
    let resolved_working_directory: string | undefined;
    
    if (directive_result.working_directory) {
        // File has its own working directory directive
        resolved_working_directory = this.resolve_working_directory(
            directive_result.working_directory,
            uri
        );
    } else if (directive_result.directives.length > 0) {
        // File has backward directives but no own working directory
        // Try to inherit from parent files
        const scope_result = await this.scope_resolver?.resolve(uri, content);
        if (scope_result?.inherited_working_directory) {
            resolved_working_directory = scope_result.inherited_working_directory;
        }
    }
    
    // Use resolved_working_directory for analysis
    // ... rest of method ...
}
```

## Data Models

### Extended Types

```typescript
// In src/types/index.ts

// Update ResolvedScope
export interface ResolvedScope {
    chain: ScopeChainEntry[];
    symbols: SymbolTable;
    out_of_scope_symbols: OutOfScopeSymbol[];
    diagnostics: DirectiveDiagnostic[];
    has_directives: boolean;
    inherited_working_directory?: string;  // NEW
}

// FileCacheEntry already has working_directory field
export interface FileCacheEntry {
    content_hash: string;
    symbols: SymbolTable;
    directives: Directive[];
    forward_calls: ForwardCall[];
    working_directory?: string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Working Directory Inheritance

*For any* child file with a backward directive (`@lsp-done-by` or `@lsp-included-by`) that lacks its own working directory directive, if the parent file has a working directory directive, the resolved scope SHALL include the parent's working directory as `inherited_working_directory`.

**Validates: Requirements 1.1**

### Property 2: Child Directive Precedence

*For any* child file that has both a backward directive and its own working directory directive, the `inherited_working_directory` in the resolved scope SHALL be undefined (child's own directive takes precedence and is used directly, not via inheritance).

**Validates: Requirements 1.2**

### Property 3: Depth-Based Precedence

*For any* child file with multiple parent files at different depths in the directive chain, if multiple parents have working directory directives, the `inherited_working_directory` SHALL be from the nearest parent (smallest depth).

**Validates: Requirements 1.3**

### Property 4: Path Resolution Context

*For any* parent file with a relative working directory path (e.g., `@lsp-cd: "../data"`), the inherited working directory SHALL be resolved relative to the parent file's containing directory, not the child file's.

**Validates: Requirements 1.4**

### Property 5: Chain Propagation

*For any* directive chain where an intermediate file has a working directory directive, files below that point in the chain SHALL inherit from that intermediate file, not from files above it.

**Validates: Requirements 1.5**

### Property 6: @lsp-run-by Parsing Equivalence

*For any* valid `@lsp-done-by` directive (quoted path, unquoted path, with call-site parameters), the equivalent `@lsp-run-by` directive SHALL produce an identical `Directive` object (with `type: 'done-by'`).

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 7: @lsp-run-by Inheritance Equivalence

*For any* parent file with symbols (globals, scalars, matrices, programs, locals), using `@lsp-run-by` SHALL inherit the same symbols as `@lsp-done-by` (all except locals).

**Validates: Requirements 2.3**

## Error Handling

### Missing Parent File

When a backward directive references a file that doesn't exist:
- Emit a warning diagnostic (existing behavior)
- Do not inherit working directory from that branch
- Continue processing other directives

### Circular Dependencies

When a circular dependency is detected in the directive chain:
- Emit a warning diagnostic (existing behavior)
- Stop following that branch
- Use working directory found before the cycle

### Invalid Working Directory Path

When an inherited working directory path cannot be resolved:
- Log a warning
- Do not set `inherited_working_directory`
- Fall back to script-relative path resolution

## Testing Strategy

### Unit Tests

1. **DirectiveParser tests**:
   - Parse `@lsp-run-by` with quoted path
   - Parse `@lsp-run-by` with unquoted path
   - Parse `@lsp-run-by` with call-site parameters
   - Verify `run-by` maps to `done-by` type

2. **ScopeResolver tests**:
   - Single parent with working directory → child inherits
   - Child has own working directory → no inheritance
   - Multiple parents at different depths → nearest wins
   - Chain propagation stops at intermediate working directory

### Property-Based Tests

Use fast-check to generate:
- Random file structures with varying directive configurations
- Random working directory paths (relative, absolute, workspace-relative)
- Random directive chains with different depths

Each property test should run minimum 100 iterations.

### Integration Tests

1. Test with real file structure matching the user's use case:
   - `loop.do` with `@lsp-cd: "../"`
   - `survey.do` with `@lsp-done-by: "loop.do"` (no own working directory)
   - Verify `survey.do` inherits working directory from `loop.do`

2. Test README examples work as documented
