# Design Document: Find References

## Overview

This document describes the design for implementing LSP `textDocument/references` support in the Sight LSP for Stata. The feature enables users to find all locations where a symbol (macro, program, variable, scalar, or matrix) is used across the workspace.

The implementation leverages existing infrastructure:
- **WorkspaceIndexer**: Provides indexed files and their tokens
- **DocumentStore**: Manages open documents with in-memory content
- **DefinitionProvider**: Shares symbol identification logic
- **ContextTracker**: Provides embedded language context awareness

## Architecture

The find-references feature follows the existing provider pattern in the codebase:

```
┌─────────────────────────────────────────────────────────────────┐
│                        LSP Server                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              textDocument/references                     │    │
│  │                        │                                 │    │
│  │                        ▼                                 │    │
│  │              ReferencesProvider                          │    │
│  │                        │                                 │    │
│  │         ┌──────────────┼──────────────┐                  │    │
│  │         ▼              ▼              ▼                  │    │
│  │   DocumentStore   WorkspaceIndexer  ContextTracker       │    │
│  │   (current doc)   (indexed files)   (language context)   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### ReferencesProvider

New provider class in `src/providers/references.ts`:

```typescript
interface ReferenceSearchContext {
  symbol_name: string;
  symbol_type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
  include_declaration: boolean;
}

class ReferencesProvider {
  /**
   * Find all references to a symbol at the given position.
   * 
   * @param document - Current document state (from DocumentStore)
   * @param position - Cursor position
   * @param context - LSP reference context (includeDeclaration)
   * @param workspace_indexer - Workspace indexer for cross-file search
   * @param context_tracker - Context tracker for embedded language awareness
   * @returns Array of Location objects, sorted by URI then position
   */
  async get_references(
    document: DocumentState,
    position: Position,
    context: ReferenceContext,
    workspace_indexer?: WorkspaceIndexer,
    context_tracker?: IContextTracker
  ): Promise<Location[]>;
}
```

### Symbol Identification

Reuse logic from `DefinitionProvider.get_word_at_position()` with additional context:

```typescript
interface IdentifiedSymbol {
  name: string;
  type: 'local_macro' | 'global_macro' | 'program' | 'variable' | 'scalar' | 'matrix';
  range: Range;  // Full range including delimiters (e.g., `name' for local macros)
}

/**
 * Identify the symbol at cursor position.
 * Returns null if cursor is not on a valid symbol.
 */
function identify_symbol_at_position(
  document: DocumentState,
  position: Position,
  context_tracker?: IContextTracker
): IdentifiedSymbol | null;
```

### Token Scanning

For each indexed file, scan tokens to find references:

```typescript
interface TokenMatch {
  uri: string;
  range: Range;
}

/**
 * Scan tokens in a file for references to a symbol.
 * 
 * @param tokens - Tokens from the file
 * @param uri - File URI
 * @param search_context - Symbol to search for
 * @param context_ranges - Embedded language context ranges (optional)
 * @returns Array of matching token locations
 */
function scan_tokens_for_references(
  tokens: Token[],
  uri: string,
  search_context: ReferenceSearchContext,
  context_ranges?: ContextRange[]
): TokenMatch[];
```

### WorkspaceIndexer Extension

Add method to get tokens for indexed files:

```typescript
// In WorkspaceIndexer class
interface IndexedFileData {
  uri: string;
  tokens: Token[];
  context_ranges?: ContextRange[];
}

/**
 * Get all indexed files with their tokens.
 * Used by ReferencesProvider for workspace-wide search.
 */
get_indexed_files(): Map<string, IndexedFileData>;
```

## Data Models

### Token Types for Reference Detection

| Symbol Type | Token Type | Name Extraction |
|-------------|------------|-----------------|
| Local Macro | `MACRO_REF_LOCAL` | Strip backtick and quote: `` `name' `` → `name` |
| Global Macro | `MACRO_REF_GLOBAL` | Strip `$` or `${...}`: `$name` → `name` |
| Program | `WORD` (command position) | Direct match |
| Variable | `WORD` (varlist context) | Direct match |
| Scalar | `WORD` (scalar context) | Direct match |
| Matrix | `WORD` (matrix context) | Direct match |

### Reference Location

Uses standard LSP `Location` type:

```typescript
interface Location {
  uri: string;      // file:// URI
  range: Range;     // Full range of the reference
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*



### Property 1: Symbol Identification and Search Completeness

*For any* document containing references to a symbol (local macro, global macro, program, variable, scalar, or matrix), when find-references is invoked on that symbol, the result SHALL contain all references to that symbol in the searched files.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 2: Empty Result for Invalid Position

*For any* cursor position that is not on a valid symbol (whitespace, comments, operators, etc.), find-references SHALL return an empty array.

**Validates: Requirements 1.7**

### Property 3: Include Declaration When Requested

*For any* symbol that has a definition, when `includeDeclaration` is `true`, the result SHALL contain the definition location.

**Validates: Requirements 2.1**

### Property 4: Exclude Declaration When Not Requested

*For any* symbol, when `includeDeclaration` is `false`, the result SHALL NOT contain the definition location (only usage references).

**Validates: Requirements 2.2**

### Property 5: Case-Sensitive Matching

*For any* two symbols with names that differ only in case (e.g., `myVar` vs `myvar`), find-references SHALL treat them as distinct symbols and return only exact case matches.

**Validates: Requirements 4.5**

### Property 6: Deterministic Ordering

*For any* set of references, the results SHALL be sorted first by file URI (ascending lexicographic), then by line number (ascending), then by character position (ascending).

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 7: Workspace Coverage

*For any* workspace, find-references SHALL search all files tracked by the WorkspaceIndexer and SHALL NOT search files not tracked by the indexer.

**Validates: Requirements 3.1, 3.2**

### Property 8: Fresh Content for Current Document

*For any* document with unsaved changes, find-references SHALL use the in-memory content from DocumentStore (not the disk content) when searching the current document.

**Validates: Requirements 3.3**

### Property 9: Macros Cross Embedded Contexts

*For any* macro reference (local or global), find-references SHALL include matches found within Mata and Python blocks, regardless of whether the search was initiated from Stata context or embedded context.

**Validates: Requirements 8.1, 8.3**

### Property 10: Non-Macros Excluded from Embedded Contexts

*For any* non-macro symbol (program, variable, scalar, matrix), find-references SHALL exclude matches found within Mata and Python blocks, and SHALL return empty when invoked from within an embedded block on a non-macro.

**Validates: Requirements 8.2, 8.4**

### Property 11: Complete Range Spans

*For any* reference in the results, the range SHALL span the complete symbol reference including delimiters (e.g., `` `name' `` for local macros, `$name` for global macros).

**Validates: Requirements 5.3**

## Error Handling

### Invalid Cursor Position

When the cursor is not on a recognizable symbol:
- Return empty `Location[]` array
- Do not throw errors or return null

### Missing Workspace Indexer

When workspace indexer is not available:
- Search only the current document
- Log a warning but continue operation

### File Read Errors

When a file cannot be read during search:
- Skip the file and continue with remaining files
- Do not fail the entire operation

### Cancellation

Support LSP cancellation token:
- Check cancellation between file scans
- Return partial results if cancelled mid-search

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Symbol identification tests**
   - Local macro at various positions within `` `name' ``
   - Global macro with `$name` and `${name}` syntax
   - Program name in definition and call positions
   - Cursor on whitespace, comments, operators

2. **Token matching tests**
   - MACRO_REF_LOCAL token extraction
   - MACRO_REF_GLOBAL token extraction
   - WORD token in command position
   - Case-sensitive matching

3. **Result ordering tests**
   - Multiple files with different URIs
   - Multiple references in same file
   - Multiple references on same line

4. **Embedded context tests**
   - Macro in Mata block
   - Macro in Python block
   - Non-macro in embedded block

### Property-Based Tests

Property tests verify universal properties across generated inputs. Each test runs minimum 100 iterations.

**Testing Framework**: fast-check (already used in the codebase)

**Test Configuration**:
- Minimum 100 iterations per property
- Each test tagged with: `Feature: find-references, Property N: {property_text}`

**Generator Strategy**:
- Generate random Stata source with known symbol placements
- Generate random cursor positions (valid and invalid)
- Generate random workspace configurations

### Integration Tests

1. **End-to-end LSP request/response**
   - Verify capability registration
   - Verify request routing
   - Verify response format

2. **Multi-file workspace search**
   - Create temporary workspace with multiple files
   - Verify cross-file reference detection

3. **Performance benchmarks**
   - Measure search time with varying file counts
   - Verify sub-500ms completion for 1000 files
