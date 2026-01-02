# Design Document: Directive Syntax Flexibility

## Overview

This design extends the existing directive parser to support flexible syntax forms for cross-file awareness directives. The enhancement allows users to write `@lsp-done-by` and `@lsp-included-by` directives with or without a colon after the directive name, and with or without quotes around the path.

The implementation modifies the existing `DirectiveParser` class in `src/directive-parser/index.ts` to recognize additional syntax patterns while maintaining full backward compatibility.

## Architecture

The change is localized to the directive parser component. No changes are required to the scope resolver, providers, or other components since the parsed `Directive` objects remain structurally identical regardless of input syntax.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Directive Parser (Modified)                       │
├─────────────────────────────────────────────────────────────────────┤
│  Input: "* @lsp-done-by path/to/file"                               │
│         "* @lsp-done-by: path/to/file"                              │
│         "* @lsp-done-by \"path/to/file\""                           │
│         "* @lsp-done-by: \"path/to/file\""                          │
│         "* @lsp-included-by path/to/file"                           │
│         "* @lsp-included-by: path/to/file"                          │
│         "* @lsp-included-by \"path/to/file\""                       │
│         "* @lsp-included-by: \"path/to/file\""                      │
│                          │                                           │
│                          ▼                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Unified Regex Pattern                                       │   │
│  │  @lsp-(done-by|included-by):?\s+(?:"([^"]+)"|(\S+))         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                           │
│                          ▼                                           │
│  Output: Directive { type: 'done-by', path: '/abs/path/to/file' }   │
└─────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified DirectiveParser

The `DirectiveParser` class is modified to:

1. Use an updated regex pattern that accepts all syntax variations
2. Add a file existence check for `.do` extension fallback
3. Maintain the same output interface (`Directive` objects)

```typescript
// Updated regex pattern - accepts all 8 syntax forms
// Groups:
//   [1] = directive type (done-by | included-by)
//   [2] = quoted path (if present)
//   [3] = unquoted path (if present)
//   [4] = remaining parameters (line=, match=)
const DIRECTIVE_PATTERN = 
    /@lsp-(done-by|included-by):?\s+(?:"([^"]+)"|([^\s]+))(?:\s+(.*))?$/;

class DirectiveParser {
    /**
     * Parse directives from file content.
     * Recognizes all 16 syntax variations for each directive type.
     */
    parse(content: string, file_uri: string): DirectiveParseResult;
    
    /**
     * Resolve a path, checking for .do extension fallback.
     * If the exact path doesn't exist, tries appending .do.
     * 
     * @param raw_path - The path from the directive
     * @param containing_dir - Directory of the file containing the directive
     * @param file_exists - Function to check file existence (injectable for testing)
     * @returns Resolved absolute path
     */
    resolve_path_with_fallback(
        raw_path: string,
        containing_dir: string,
        file_exists?: (path: string) => boolean
    ): string;
}
```

### File Existence Checking

For the `.do` extension fallback, the parser needs to check file existence. This is handled by:

1. Accepting an optional `file_exists` function parameter for testability
2. Defaulting to `fs.existsSync` in production
3. Checking the exact path first, then trying with `.do` appended

```typescript
interface PathResolutionOptions {
    file_exists?: (path: string) => boolean;
}

// Resolution logic:
// 1. Resolve raw_path to absolute path
// 2. If file exists at absolute path, return it
// 3. If file doesn't exist and path doesn't end in .do, try path + ".do"
// 4. Return whichever path exists, or the original if neither exists
```

## Data Models

No changes to data models. The `Directive` interface remains unchanged:

```typescript
interface Directive {
    type: 'done-by' | 'included-by';
    path: string;                    // Resolved absolute path
    raw_path: string;                // Original path from directive
    call_site?: CallSite;            // Optional call site specification
    range: Range;                    // Location in source file
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Syntax Form Equivalence

*For any* valid file path without spaces, all 8 syntax forms for the two directive types SHALL produce identical `Directive` objects (same `type`, same resolved `path`).

The 8 forms are:
- 2 directive names (`@lsp-done-by`, `@lsp-included-by`) × 2 colon options (with/without) × 2 quote options (with/without) = 8 forms total

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3**

### Property 2: .do Extension Fallback

*For any* directive path that does not end in `.do`:
- If the exact path exists, the parser SHALL resolve to that path
- If the exact path does not exist but `path.do` exists, the parser SHALL resolve to `path.do`
- If neither exists, the parser SHALL resolve to the original path (and emit a diagnostic elsewhere)

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

## Error Handling

### Malformed Directive Handling

The parser continues to emit diagnostics for malformed directives:

| Condition | Handling | Diagnostic |
|-----------|----------|------------|
| Unquoted path with spaces | Skip directive | Warning: "Path contains spaces; use quotes" |
| Missing path entirely | Skip directive | Warning: "Directive requires a path" |
| Invalid characters in path | Skip directive | Warning: "Invalid path characters" |

### File Resolution Errors

| Condition | Handling | Diagnostic |
|-----------|----------|------------|
| File not found (even with .do fallback) | Continue with path as-is | Warning emitted by scope resolver |
| Permission denied | Continue with path as-is | Warning emitted by scope resolver |

## Testing Strategy

### Unit Tests

1. **Syntax Parsing**
   - Test each of the 8 syntax forms individually
   - Test mixed syntax in same file
   - Test with various path formats (relative, absolute, with .., etc.)

2. **Path Resolution**
   - Test .do extension fallback with mocked file system
   - Test precedence when both paths exist
   - Test with various path separators

### Property-Based Tests

Using fast-check with minimum 100 iterations per test.

1. **Property 1: Syntax Form Equivalence**
   - Generate random valid paths (no spaces, valid characters)
   - For each path, generate all 8 syntax forms
   - Verify all forms produce identical Directive objects

2. **Property 2: .do Extension Fallback**
   - Generate random paths with and without .do extension
   - Mock file existence in various combinations
   - Verify correct resolution behavior

### Integration Tests

1. **Cross-file resolution with new syntax**
   - Create test files using short directive forms
   - Verify scope resolution works correctly
   - Test completion and go-to-definition across files
