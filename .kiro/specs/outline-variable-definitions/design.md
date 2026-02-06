# Design Document: Outline Variable Definitions

## Overview

This feature extends the document outline (document symbols) in the Sight LSP to include variable definitions created via `gen` and `egen` commands. The implementation adds a new section to the existing `SymbolProvider.get_document_symbols()` method that iterates over the document's variable symbols and includes those with appropriate sources.

The change is minimal and follows the existing patterns used for other symbol types (scalars, matrices, global macros).

## Architecture

The feature integrates into the existing symbol provider architecture:

```
DocumentState.symbols.variables
        │
        ▼
┌─────────────────────────────────┐
│  SymbolProvider                 │
│  get_document_symbols()         │
│  ┌───────────────────────────┐  │
│  │ 1. Programs               │  │
│  │ 2. Global Macros          │  │
│  │ 3. Local Macros           │  │
│  │ 4. Scalars                │  │
│  │ 5. Matrices               │  │
│  │ 6. Variables (NEW)        │  │
│  │ 7. Embedded Blocks        │  │
│  │ 8. Section Integration    │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
        │
        ▼
   DocumentSymbol[]
```

## Components and Interfaces

### Modified Component: SymbolProvider

The `SymbolProvider` class in `src/providers/symbols.ts` will be extended with variable symbol extraction.

#### get_document_symbols() Changes

Add a new section between matrices and embedded blocks:

```typescript
// 6. Add variables (gen/egen only) - defined in this file
for (const [name, variable] of document.symbols.variables) {
    if (variable.sourceUri === document.uri) {
        // Only include gen and egen sources
        if (variable.source === 'gen' || variable.source === 'egen') {
            symbols.push({
                name: name,
                kind: SymbolKind.Field,
                range: variable.location.range,
                selectionRange: variable.location.range,
                detail: `Variable (${variable.source})`,
            });
        }
    }
}
```

#### get_workspace_symbols() Changes

The workspace symbols method already includes variables. No changes needed - it already iterates over `workspace_symbols.variables` and `document.symbols.variables` for open documents.

### Existing Interfaces Used

```typescript
// From src/types/index.ts
interface VariableSymbol {
    name: string;
    location: { uri: string; range: Range };
    sourceUri: string;
    type?: string;
    label?: string;
    source: 'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename' | 'confirm';
}
```

## Data Models

No new data models required. The feature uses existing:
- `VariableSymbol` from the symbol table
- `DocumentSymbol` from LSP types

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Variable Source Filtering

*For any* document with variables from multiple sources (gen, egen, input, confirm, rename, inferred, directive), the document symbols SHALL include exactly those variables where `source === 'gen'` or `source === 'egen'`, and exclude all others.

**Validates: Requirements 1.1, 1.2**

### Property 2: Variable Symbol Format

*For any* variable included in the document outline:
- The symbol kind SHALL be `SymbolKind.Field`
- The detail field SHALL match the pattern `Variable ({source})` where source is `gen` or `egen`
- The symbol name SHALL equal the variable name without any prefix or suffix decoration

**Validates: Requirements 1.3, 1.4, 1.5**

### Property 3: Document Order Preservation

*For any* document with multiple symbols (programs, macros, variables, etc.), the returned top-level symbols array SHALL be sorted by start position (line, then character).

**Validates: Requirements 2.1**

### Property 4: Section Nesting Consistency

*For any* document with sections and variables, variables defined within a section's range SHALL appear as children of that section, following the same nesting rules as other symbol types.

**Validates: Requirements 2.2**

## Error Handling

No new error conditions are introduced. The implementation follows defensive patterns:

1. **Missing sourceUri**: Skip variables where `sourceUri !== document.uri` (already handled by existing pattern)
2. **Unknown source**: Variables with sources other than `gen`/`egen` are silently excluded (by design)
3. **Missing location**: The analyzer guarantees all registered variables have valid locations

## Testing Strategy

### Unit Tests

1. **Source filtering test**: Create a document with variables from all source types, verify only gen/egen appear in outline
2. **Symbol kind test**: Verify all variable symbols have `SymbolKind.Field`
3. **Detail format test**: Verify detail strings match expected format
4. **Empty document test**: Verify no errors when document has no variables
5. **Mixed symbols test**: Verify variables appear alongside programs, macros, etc. in correct order

### Property-Based Tests

Property tests should use fast-check to generate:
- Random variable names
- Random source types
- Random document positions
- Documents with varying numbers of variables

Each property test should run minimum 100 iterations.

**Tag format**: `Feature: outline-variable-definitions, Property N: {property_text}`

### Integration Tests

1. **LSP request test**: Send `textDocument/documentSymbol` request, verify response includes variables
2. **Section nesting test**: Create document with sections and variables, verify correct hierarchy
3. **Workspace symbols test**: Verify variables appear in workspace symbol search results
