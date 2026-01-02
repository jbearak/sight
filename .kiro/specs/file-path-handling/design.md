# Design Document: File Path Handling

## Overview

This design addresses two related issues:
1. Parsing unquoted file paths with `/` separators in `do`/`run`/`include` commands
2. Providing file path completions for directives and file-accepting commands

The approach uses context-aware parsing in the parser (not lexer) to recognize file paths after specific commands, and extends the completion provider to detect directive/command contexts.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Changes Overview                          │
├─────────────────────────────────────────────────────────────────┤
│  src/parser/index.ts                                            │
│  └── parseCommand() - Add file path coalescing for file commands│
│                                                                 │
│  src/providers/completion.ts                                    │
│  └── Add directive context detection                            │
│  └── Add file path completion logic                             │
│                                                                 │
│  src/utils/file-path-utils.ts (new)                            │
│  └── File path completion helpers                               │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Component 1: Parser File Path Coalescing

**Location**: `src/parser/index.ts`

**Approach**: After recognizing a file command (`do`, `run`, `include`, etc.), the parser will coalesce subsequent tokens that form a file path into a single varlist entry.

**File Commands** (commands that accept file paths as first argument):
- `do`, `run`, `include` - Execute/include scripts
- `use`, `save`, `append`, `merge` - Data file operations
- `import`, `export` - Data import/export
- `cd`, `adopath` - Directory operations

**Path Token Coalescing Rules**:
1. If STRING token, return as-is (quoted paths already work)
2. Otherwise, consume all consecutive non-whitespace tokens until:
   - WHITESPACE token
   - COMMA token (options follow)
   - STATEMENT_TERMINATOR
   - Comment/trivia token
   - End of input
3. Concatenate all consumed token values into a single path string

This simple approach works because the lexer already separates tokens by whitespace, so we just need to rejoin them for file paths.

**Pseudocode**:
```typescript
private parseFilePathArgument(): IdentifierNode | null {
  // If STRING, return as-is (already handles quoted paths)
  if (this.check('STRING')) {
    const token = this.advance();
    return { name: token.value, range: token.range };
  }
  
  // Must start with WORD or macro ref
  if (!this.check('WORD') && !this.check('MACRO_REF_LOCAL') && !this.check('MACRO_REF_GLOBAL')) {
    return null;
  }
  
  // Coalesce all tokens until whitespace, comma, terminator, or trivia
  const start_token = this.advance();
  let path = start_token.value;
  let end_range = start_token.range.end;
  
  while (!this.isAtEnd()) {
    // Stop at whitespace, comma, terminator, or trivia
    if (this.check('WHITESPACE') || 
        this.check('COMMA') || 
        this.check('STATEMENT_TERMINATOR') ||
        this.isTrivia()) {
      break;
    }
    
    // Consume any other token as part of the path
    const token = this.advance();
    path += token.value;
    end_range = token.range.end;
  }
  
  return {
    name: path,
    range: { start: start_token.range.start, end: end_range }
  };
}
```

### Component 2: Completion Provider Extension

**Location**: `src/providers/completion.ts`

**New Context Detection**:
```typescript
interface CompletionContext {
  type: 'directive_path' | 'command_path' | 'variable' | 'command' | 'option';
  directive?: string;  // e.g., '@lsp-done-by'
  command?: string;    // e.g., 'do', 'run'
  partial_path?: string;  // e.g., 'dhs/' for partial path completion
}
```

**Directive Detection Logic**:
1. Check if cursor is inside a comment token
2. Parse comment text for `@lsp-*:` pattern before cursor
3. If found, extract directive name and any partial path after it

**File Path Completion Logic**:
```typescript
async function getFilePathCompletions(
  workspace_root: string,
  partial_path: string,
  filter: 'files' | 'directories' | 'stata_files'
): Promise<CompletionItem[]> {
  // Resolve base directory from partial_path
  // List files/directories
  // Filter by type and extension
  // Return completion items with file icons
}
```

### Component 3: File Path Utilities

**Location**: `src/utils/file-path-utils.ts` (new file)

```typescript
export const FILE_COMMANDS = new Set([
  'do', 'run', 'include',
  'use', 'save', 'append', 'merge',
  'import', 'export',
  'cd', 'adopath'
]);

export const PATH_DIRECTIVES = new Set([
  '@lsp-done-by',
  '@lsp-included-by', 
  '@lsp-do',
  '@lsp-run',
  '@lsp-include',
  '@lsp-working-directory'
]);

export const STATA_FILE_EXTENSIONS = ['.do', '.ado', '.doh', '.mata'];

export function isFileCommand(command: string): boolean {
  return FILE_COMMANDS.has(command.toLowerCase());
}

export function isPathDirective(directive: string): boolean {
  return PATH_DIRECTIVES.has(directive.toLowerCase());
}
```

## Data Models

No new data models needed. Existing `IdentifierNode` and `CompletionItem` are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Unquoted Path Coalescing

*For any* file command (`do`, `run`, `include`) with an unquoted path containing `/` separators, the entire path should be captured as a single varlist entry.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Path with Options Separation

*For any* file command with a path followed by a comma and options, the path should be in varlist and options should be parsed separately.

**Validates: Requirements 1.6**

### Property 3: Division Operator Preservation

*For any* arithmetic expression containing `/` (like `gen x = a/b`), the `/` should be treated as division, not a path separator.

**Validates: Requirements 2.4**

### Property 4: Macro Path Coalescing

*For any* file command with a macro reference followed by path components (like `do `mypath'/file.do`), all components should be coalesced into a single varlist entry.

**Validates: Requirements 2.3**

### Property 5: Directive Path Completion Context

*For any* cursor position after a path directive (like `@lsp-done-by:`), the completion provider should return file path completions, not variable completions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 6: Directory-Only Completions

*For any* cursor position after `@lsp-working-directory:`, the completion provider should return only directory completions.

**Validates: Requirements 3.6, 3.8**

### Property 7: Stata File Filtering

*For any* file path completion request, the results should include only files with Stata extensions (`.do`, `.ado`, `.doh`, `.mata`).

**Validates: Requirements 3.7**

### Property 8: Command Path Completion Context

*For any* cursor position after a file command (like `do `), the completion provider should return file path completions.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

## Error Handling

- **Invalid paths**: Parser continues with partial path if coalescing fails
- **Missing directories**: Completion provider returns empty list gracefully
- **Permission errors**: Completion provider catches and logs errors, returns empty list

## Testing Strategy

### Property-Based Tests

Property-based tests will use `fast-check` with minimum 100 iterations per property.

**Property 1-4 Tests**: Generate random file paths and commands, verify parsing behavior.

**Property 5-8 Tests**: Generate completion contexts and verify correct completion types are returned.

### Unit Tests

- `do dhs/survey.do` → varlist contains `dhs/survey.do`
- `include a/b/c/file.do` → varlist contains `a/b/c/file.do`
- `do file.do, nostop` → varlist contains `file.do`, options contain `nostop`
- `gen x = a/b` → `/` treated as division (no path coalescing)
- Completion after `// @lsp-done-by:` returns file paths
- Completion after `do ` returns file paths

### Integration Tests

- End-to-end test with real workspace files
- Verify `@lsp-working-directory` + unquoted path works together
