# Design Document: Document Symbols Enhancement

## Overview

This design enhances the `SymbolProvider.get_document_symbols()` method to include scalars and matrices in the document outline, and to hierarchically nest local macros under their containing programs. The changes are localized to `src/providers/symbols.ts` and leverage existing data structures in `SymbolTable`.

## Architecture

The enhancement follows the existing provider pattern:

```
DocumentState → SymbolProvider.get_document_symbols() → DocumentSymbol[]
```

The key change is transforming the flat list of symbols into a hierarchical structure where:
- Programs, globals, scalars, matrices, and embedded blocks remain top-level
- Local macros are nested under their containing program (if any)

```mermaid
graph TD
    A[DocumentState] --> B[get_document_symbols]
    B --> C[Build Program Symbols]
    C --> D[Collect Local Macros]
    D --> E{Macro inside program?}
    E -->|Yes| F[Add as program child]
    E -->|No| G[Add as top-level]
    B --> H[Add Scalars]
    B --> I[Add Matrices]
    B --> J[Add Globals]
    B --> K[Add Embedded Blocks]
    F --> L[DocumentSymbol[]]
    G --> L
    H --> L
    I --> L
    J --> L
    K --> L
```

## Components and Interfaces

### Modified: SymbolProvider.get_document_symbols()

The method signature remains unchanged:

```typescript
get_document_symbols(document: DocumentState): DocumentSymbol[]
```

#### Algorithm Changes

1. **Build program symbols first** with empty `children` arrays
2. **Process local macros** and assign to programs or top-level based on range containment
3. **Add scalars** from `document.symbols.scalars`
4. **Add matrices** from `document.symbols.matrices`
5. **Add globals** (unchanged)
6. **Add embedded blocks** (unchanged)

### New Helper: is_position_in_range()

```typescript
function is_position_in_range(position: Position, range: Range): boolean {
    // Returns true if position is within range (inclusive on both ends)
    // This matches the lexer/parser range semantics used throughout the codebase
    // A macro on the last line of a program body is considered inside the program
}
```

**Range Semantics**: Inclusive on both start and end to match existing codebase conventions. A position on the program's end line is considered inside the program.

### New Helper: find_containing_program()

```typescript
function find_containing_program(
    macro_range: Range,
    program_symbols: Map<string, { symbol: DocumentSymbol; range: Range }>
): DocumentSymbol | null {
    // Returns the program with smallest range that contains the macro
    // Returns null if no program contains the macro
}
```

### Program Range Source

**Preferred source**: Use AST program node ranges when available (via `document.ast.nodes` filtered for `type === 'program'`), as these are the most accurate. Fall back to `document.symbols.programs` ranges if AST is unavailable.

```typescript
// Prefer AST ranges for accuracy
const program_ranges = document.ast 
    ? extract_program_ranges_from_ast(document.ast.nodes)
    : extract_program_ranges_from_symbols(document.symbols.programs);
```

## Data Models

### DocumentSymbol Structure (LSP Standard)

```typescript
interface DocumentSymbol {
    name: string;
    detail?: string;
    kind: SymbolKind;
    range: Range;
    selectionRange: Range;
    children?: DocumentSymbol[];  // Used for nesting locals under programs
}
```

### Symbol Detail Strings

| Symbol Type | Detail String |
|-------------|---------------|
| Program | "Program" |
| Global Macro | "Global Macro" |
| Local Macro (explicit) | "Local Macro" |
| Local Macro (nested under program) | "Local Macro" |
| Scalar | "Scalar" |
| Matrix | "Matrix" |
| Embedded Block | "{Language} Block ({command})" |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Scalar symbols have correct kind and detail

*For any* document containing scalar definitions, all scalar symbols returned by get_document_symbols SHALL have SymbolKind.Variable and detail string "Scalar".

**Validates: Requirements 1.2, 1.3**

### Property 2: Matrix symbols have correct kind and detail

*For any* document containing matrix definitions, all matrix symbols returned by get_document_symbols SHALL have SymbolKind.Variable and detail string "Matrix".

**Validates: Requirements 2.2, 2.3**

### Property 3: URI filtering for scalars and matrices

*For any* document with scalars or matrices, get_document_symbols SHALL only include symbols where sourceUri matches the document URI.

**Validates: Requirements 1.4, 2.4**

### Property 4: Local macro containment and nesting

*For any* document with programs and local macros, a local macro whose definition range.start falls within a program's range SHALL appear in that program's children array, and a local macro outside all programs SHALL appear as a top-level symbol.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5**

### Property 5: All locals within programs are nested as children

*For any* program containing local macros (explicit or implicit), those locals SHALL appear as children of the program symbol with detail "Local Macro".

**Validates: Requirements 4.1, 4.2**

### Property 6: Existing symbol behavior preserved

*For any* document, get_document_symbols SHALL include programs with SymbolKind.Function, global macros as top-level symbols, and embedded blocks as top-level Module symbols.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

## Error Handling

### Edge Cases

1. **Empty SymbolTable**: Return empty array (existing behavior)
2. **No programs**: All local macros appear as top-level symbols
3. **Overlapping program ranges**: Assign macro to smallest containing program (defensive, shouldn't occur in valid Stata)
4. **Missing sourceUri**: Skip symbol (defensive)

### Defensive Checks

```typescript
// Skip symbols without matching URI
if (scalar.sourceUri !== document.uri) continue;

// Handle missing children array
if (!program_symbol.children) {
    program_symbol.children = [];
}
```

## Testing Strategy

### Unit Tests (Primary)

Unit tests verify specific examples and edge cases. These are the primary validation mechanism:

1. **Scalar inclusion**: Document with `scalar S = 1` returns symbol named "S" with detail "Scalar"
2. **Matrix inclusion**: Document with `matrix define M = (1)` returns symbol named "M" with detail "Matrix"
3. **Local nesting**: Document with program containing local returns local as child of program
4. **Top-level local**: Document with local outside program returns local at top level
5. **Boundary case**: Local macro defined on last line of program body is nested under program
6. **Mixed document**: Document with all symbol types returns correct hierarchy
7. **URI filtering**: Symbols from different URIs are excluded

### Property-Based Tests (Secondary)

Property tests provide additional confidence for containment logic:

1. **Property 4**: Generate documents with programs and locals, verify containment correctness

Each property test runs minimum 100 iterations. Tests are tagged with:
**Feature: document-symbols-enhancement, Property {N}: {property_text}**

Note: Properties 1-3, 5-6 are adequately covered by unit tests given the straightforward nature of the checks (kind, detail string, filtering). Property 4 (containment) benefits from property testing due to the range arithmetic involved.
