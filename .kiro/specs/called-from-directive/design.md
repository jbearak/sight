# Design Document: @lsp-working-directory Directive

## Overview

This feature adds an `@lsp-working-directory` directive (with synonyms `@lsp-working-dir`, `@lsp-current-directory`, `@lsp-current-dir`, `@lsp-cd`, and `@lsp-wd`) that specifies the working directory context for a Stata script. The directive enables accurate path resolution for `do`, `run`, and `include` commands when scripts are executed from a different directory than where they reside.

The implementation involves:
1. Extending the `DirectiveParser` to recognize and parse the new directive (and its synonyms)
2. Modifying the `SemanticAnalyzer` to use the working directory context when resolving forward call paths
3. Implementing a fallback path resolution strategy when no directive is present
4. Adding appropriate diagnostics for error conditions
5. Updating the README documentation

## Architecture

The feature integrates with the existing directive parsing and forward scope resolution pipeline:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ DirectiveParser │────▶│ SemanticAnalyzer │────▶│ ForwardScopeResolver│
│                 │     │                  │     │                     │
│ - Parse header  │     │ - Extract forward│     │ - Resolve callee    │
│ - Extract       │     │   calls from     │     │   files             │
│   working_dir   │     │   do/run/include │     │ - Build scope chain │
└─────────────────┘     │ - Apply working  │     └─────────────────────┘
                        │   directory      │
                        └──────────────────┘
```

The `@lsp-working-directory` directive (or any of its synonyms) is parsed in the header (like `@lsp-done-by` and `@lsp-included-by`) and stored in the `DirectiveParseResult`. The `SemanticAnalyzer` then uses this working directory context when resolving paths for `do`, `run`, and `include` commands.

### Directive Synonyms

The following directive names are all equivalent:
- `@lsp-working-directory` (canonical form)
- `@lsp-working-dir`
- `@lsp-current-directory`
- `@lsp-current-dir`
- `@lsp-cd`
- `@lsp-wd`

## Components and Interfaces

### DirectiveParser Extensions

The `DirectiveParser` class will be extended to:

1. Parse `@lsp-working-directory` directives (and synonyms) from file headers
2. Store the parsed working directory in the result
3. Emit diagnostics for multiple directives

```typescript
// Regex pattern for all synonym forms
const WORKING_DIR_DIRECTIVE_PATTERN = 
    /@lsp-(working-directory|working-dir|current-directory|current-dir|cd|wd):?\s+(?:"([^"]+)"|([^\s]+))/;

// New type for working directory directive
interface WorkingDirectoryDirective {
    path: string;           // The raw path from the directive
    resolved_path: string;  // Resolved absolute path (or workspace-relative)
    is_workspace_relative: boolean;  // True if path starts with /
    range: Range;           // Location in source for diagnostics
    directive_form: string; // Which synonym was used (for diagnostics)
}

// Extended DirectiveParseResult
interface DirectiveParseResult {
    directives: Directive[];
    declaration_directives: DeclarationDirective[];
    forward_calls?: ForwardCallDirective[];
    working_directory?: WorkingDirectoryDirective;  // NEW: working directory context
    diagnostics: DirectiveDiagnostic[];
}
```

### SemanticAnalyzer Extensions

The `SemanticAnalyzer` will be modified to:

1. Accept the working directory context from directive parsing
2. Use the working directory when resolving forward call paths
3. Implement fallback resolution (script-relative → workspace-root-relative)

```typescript
// Extended AnalyzerConfig
interface AnalyzerConfig {
    // ... existing fields ...
    working_directory?: string;      // NEW: from @lsp-called-from
    workspace_root?: string;         // NEW: for fallback resolution
}

// Path resolution with fallback
function resolve_forward_call_path(
    raw_path: string,
    script_dir: string,
    working_dir: string | undefined,
    workspace_root: string | undefined
): { resolved_path: string; resolution_method: 'working_dir' | 'script_relative' | 'workspace_root' }
```

### DocumentStore Integration

The `DocumentStore` will pass the parsed `working_directory` directive to the analyzer:

```typescript
// In DocumentStore.update()
const directive_result = directive_parser.parse(content, uri);
const working_directory = this.resolve_working_directory(
    directive_result.working_directory,
    containing_dir,
    workspace_root
);

const analyze_result = analyzer.analyze(ast, uri, workspace_symbols, {
    ...config,
    working_directory,
    workspace_root,
});
```

## Data Models

### WorkingDirectoryDirective

```typescript
interface WorkingDirectoryDirective {
    /** The raw path string from the directive */
    path: string;
    
    /** Resolved absolute filesystem path */
    resolved_path: string;
    
    /** True if the path started with / (workspace-relative) */
    is_workspace_relative: boolean;
    
    /** Source location for diagnostics */
    range: Range;
    
    /** Which directive synonym was used (e.g., "working-directory", "cd", "wd") */
    directive_form: string;
}
```

### ForwardCall Extension

The existing `ForwardCall` type will be extended to track resolution method:

```typescript
interface ForwardCall {
    type: 'do' | 'run' | 'include';
    path: string;
    raw_path: string;
    call_site_line: number;
    range: Range;
    source: 'command' | 'directive';
    is_static: boolean;
    resolution_method?: 'working_dir' | 'script_relative' | 'workspace_root';  // NEW
}
```

## Correctness Properties


*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Directive Parsing Accepts All Synonym Forms

*For any* valid path string and any directive synonym (`@lsp-working-directory`, `@lsp-working-dir`, `@lsp-current-directory`, `@lsp-current-dir`, `@lsp-cd`, `@lsp-wd`), the `DirectiveParser` should correctly extract the path from both quoted and unquoted forms, producing equivalent results.

**Validates: Requirements 1.1, 1.2**

### Property 2: Header-Only Constraint

*For any* file content where a working directory directive appears after non-comment, non-blank code, the `DirectiveParser` should return `undefined` for `working_directory` (directive is ignored).

**Validates: Requirements 1.3**

### Property 3: Multiple Directive Warning

*For any* file header containing multiple working directory directives (even if using different synonyms), the `DirectiveParser` should use the last directive's path and emit exactly one warning diagnostic.

**Validates: Requirements 1.4**

### Property 4: Workspace-Relative Flag

*For any* working directory directive, the `is_workspace_relative` flag should be `true` if and only if the path starts with `/`.

**Validates: Requirements 1.5**

### Property 5: Path Resolution with Working Directory

*For any* script with a working directory directive and a `do`/`run`/`include` command with a relative path, the resolved path should be computed relative to the working directory (which itself is resolved relative to workspace root if `/`-prefixed, or script directory otherwise).

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 6: Non-Existent Working Directory Fallback

*For any* working directory directive pointing to a non-existent directory, the `Analyzer` should emit a warning diagnostic and use the script's containing directory for path resolution instead.

**Validates: Requirements 2.4**

### Property 7: Missing File Diagnostic

*For any* `do`/`run`/`include` command referencing a file that cannot be found, the `ForwardScopeResolver` should emit a warning diagnostic indicating the file was not found.

**Validates: Requirements 2.5**

### Property 8: Directive Isolation

*For any* file containing both a working directory directive and other directives (`@lsp-do`, `@lsp-run`, `@lsp-include`, `@lsp-done-by`, `@lsp-included-by`), the other directives should resolve paths relative to the script's containing directory, unaffected by the working directory directive.

**Validates: Requirements 2.6**

### Property 9: Fallback Resolution Strategy

*For any* script without a working directory directive and a `do`/`run`/`include` command with a relative path, if the file exists at the workspace root but not relative to the script, the path should resolve to the workspace root location.

**Validates: Requirements 3.1, 3.2**

### Property 10: Fallback Failure Diagnostic

*For any* `do`/`run`/`include` command where the referenced file cannot be found by either script-relative or workspace-root-relative resolution, the `Analyzer` should emit an informational diagnostic suggesting the working directory directive.

**Validates: Requirements 3.3**

### Property 11: Round-Trip Parsing

*For any* valid working directory directive, parsing then printing should produce an equivalent directive (the path should be preserved).

**Validates: Requirements 5.1**

## Error Handling

### Diagnostic Types

| Condition | Severity | Message Template |
|-----------|----------|------------------|
| Multiple working directory directives | Warning | "Multiple working directory directives found; using the last one" |
| Working directory does not exist | Warning | "Working directory '{path}' does not exist; using script directory" |
| Referenced file not found | Warning | "Cannot read file: {path}" |
| File not found (no directive) | Information | "File '{path}' not found. Consider adding @lsp-working-directory directive if the script runs from a different directory" |
| Malformed directive | Warning | "Malformed working directory directive. Expected: // @lsp-working-directory: \"path\"" |

### Fallback Behavior

1. **Non-existent working directory**: Fall back to script's containing directory
2. **File not found with directive**: Emit warning, continue with unresolved path
3. **File not found without directive**: Try workspace root, then emit informational diagnostic

## Testing Strategy

### Unit Tests

Unit tests will cover:
- Directive parsing with various path formats (quoted, unquoted, with/without colon)
- Header-only constraint enforcement
- Multiple directive handling
- Workspace-relative path detection (`/` prefix)
- Path resolution logic with mocked filesystem

### Property-Based Tests

Property-based tests will use `fast-check` to verify:
- **Property 1**: Generate random paths, test both quoted/unquoted parsing
- **Property 2**: Generate files with directive at various positions
- **Property 3**: Generate headers with 2+ directives
- **Property 4**: Generate paths with/without `/` prefix
- **Property 5**: Generate scripts with directives and forward calls
- **Property 6**: Generate directives pointing to non-existent directories
- **Property 7**: Generate forward calls to non-existent files
- **Property 8**: Generate files with multiple directive types
- **Property 9**: Generate scripts without directive, files at workspace root
- **Property 10**: Generate forward calls where file doesn't exist anywhere
- **Property 11**: Generate valid directives, verify round-trip

### Integration Tests

Integration tests will verify:
- End-to-end forward scope resolution with working directory directive
- Interaction with existing directives (`@lsp-done-by`, etc.)
- Real filesystem scenarios with actual file structures

### Test Configuration

- Property tests: minimum 100 iterations per property
- Use `fast-check` for property-based testing
- Tag format: **Feature: working-directory-directive, Property {number}: {property_text}***
