# Design Document: Workspace Symbol Completeness

## Overview

This design addresses a bug in the workspace symbol provider where variables, scalars, matrices, and local macros from the workspace index are not included in workspace symbol search results. The fix involves adding iteration loops over the missing symbol types in the `get_workspace_symbols()` method, following the same pattern already used for programs and global macros.

## Architecture

The workspace symbol feature follows this data flow:

```
Workspace Files → Indexer → SymbolTable → SymbolProvider → LSP Response
                              ↓
                    Open Documents → SymbolProvider
```

The `WorkspaceIndexer` scans workspace files and builds a `SymbolTable` containing all symbol types (programs, local macros, global macros, variables, scalars, matrices). The `SymbolProvider.get_workspace_symbols()` method receives this merged symbol table and should iterate over all symbol types to build the response.

Currently, the method only iterates over `programs` and `globalMacros` from the workspace index, while `variables`, `scalars`, `matrices`, and `localMacros` are only checked from open documents.

## Components and Interfaces

### SymbolProvider (Modified)

The `get_workspace_symbols()` method in `src/providers/symbols.ts` will be modified to add iteration over the missing symbol types from the workspace index.

**Current Implementation:**
```typescript
get_workspace_symbols(
    query: string,
    all_documents: DocumentState[],
    workspace_symbols?: SymbolTable
): SymbolInformation[]
```

**Changes Required:**
1. Add loop over `workspace_symbols.variables`
2. Add loop over `workspace_symbols.scalars`
3. Add loop over `workspace_symbols.matrices`
4. Add loop over `workspace_symbols.localMacros`

### SymbolInformation Format

Each symbol type maps to a specific `SymbolKind` and `containerName`:

| Symbol Type | SymbolKind | containerName |
|-------------|------------|---------------|
| Program | `Function` | `'Program'` |
| Global Macro | `Variable` | `'Global Macro'` |
| Local Macro | `Variable` | `'Local Macro'` |
| Variable | `Field` | `'Variable'` |
| Scalar | `Variable` | `'Scalar'` |
| Matrix | `Variable` | `'Matrix'` |

### Existing Patterns

The existing code for programs and global macros provides the pattern to follow:

```typescript
// Check programs
for (const [name, program] of workspace_symbols.programs) {
    if (program.name.toLowerCase().includes(lower_query)) {
        symbols.push({
            name: program.name,
            kind: SymbolKind.Function,
            location: {
                uri: program.sourceUri,
                range: program.location.range,
            },
            containerName: 'Program',
        });
    }
}

// Check global macros
for (const [name, macro] of workspace_symbols.globalMacros) {
    if (name.toLowerCase().includes(lower_query)) {
        symbols.push({
            name: `${name}`,
            kind: SymbolKind.Variable,
            location: {
                uri: macro.sourceUri,
                range: macro.location.range,
            },
            containerName: 'Global Macro',
        });
    }
}
```

## Data Models

No changes to data models are required. The existing `SymbolTable` interface already contains all the necessary symbol maps:

```typescript
export interface SymbolTable {
  programs: Map<string, ProgramSymbol>;
  localMacros: Map<string, MacroSymbol>;
  globalMacros: Map<string, MacroSymbol>;
  variables: Map<string, VariableSymbol>;
  scalars: Map<string, ScalarSymbol>;
  matrices: Map<string, MatrixSymbol>;
}
```

The `WorkspaceIndexer.get_all_symbols()` method already merges all symbol types from indexed files, so the data is available - it just needs to be used.



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the acceptance criteria can be consolidated into three testable properties:

### Property 1: All Matching Symbols Included

*For any* workspace symbol table containing programs, global macros, local macros, variables, scalars, and matrices, and *for any* query string, all symbols whose names contain the query (case-insensitive) SHALL appear in the workspace symbol search results.

**Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1, 5.2**

### Property 2: Correct Symbol Format Per Type

*For any* symbol returned from workspace symbol search, the SymbolInformation SHALL have:
- Programs: kind=Function, containerName='Program'
- Global Macros: kind=Variable, containerName='Global Macro'
- Local Macros: kind=Variable, name with backtick-quote syntax, containerName='Local Macro'
- Variables: kind=Field, containerName='Variable'
- Scalars: kind=Variable, containerName='Scalar'
- Matrices: kind=Variable, containerName='Matrix'

**Validates: Requirements 1.2, 2.2, 3.2, 4.2**

### Property 3: Case-Insensitive Query Matching

*For any* symbol name and *for any* query that is a case-variant substring of that name, the symbol SHALL appear in the search results.

**Validates: Requirements 6.1**

## Error Handling

This is a straightforward bug fix with minimal error handling requirements:

1. **Null/Undefined Workspace Symbols**: The existing guard `if (workspace_symbols)` already handles the case where no workspace index is available.

2. **Empty Symbol Maps**: Iterating over empty maps is safe and produces no results.

3. **Missing Symbol Properties**: The existing code pattern accesses `sourceUri` and `location.range` which are required fields in the symbol interfaces.

## Testing Strategy

### Unit Tests

Unit tests should verify:
1. Variables from workspace index appear in results
2. Scalars from workspace index appear in results
3. Matrices from workspace index appear in results
4. Local macros from workspace index appear in results
5. Existing program and global macro support is preserved
6. Empty query returns all symbols
7. Non-matching query returns empty results

### Property-Based Tests

Property-based tests using fast-check should implement the three correctness properties:

1. **Property 1 Test**: Generate random symbol tables and queries, verify all matching symbols appear
   - Minimum 100 iterations
   - Tag: **Feature: workspace-symbol-completeness, Property 1: All Matching Symbols Included**

2. **Property 2 Test**: Generate random symbols, verify returned format matches expected per type
   - Minimum 100 iterations
   - Tag: **Feature: workspace-symbol-completeness, Property 2: Correct Symbol Format Per Type**

3. **Property 3 Test**: Generate symbols and case-variant queries, verify case-insensitive matching
   - Minimum 100 iterations
   - Tag: **Feature: workspace-symbol-completeness, Property 3: Case-Insensitive Query Matching**

### Test Configuration

- Use fast-check for property-based testing (already used in the codebase)
- Each property test runs minimum 100 iterations
- Tests should use the existing test helpers in `tests/property/generators/`
