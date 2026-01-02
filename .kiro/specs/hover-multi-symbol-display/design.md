# Design Document: Hover Multi-Symbol Display

## Overview

This design enhances the `HoverProvider` class to display information for all matching symbol types when an identifier matches multiple categories, and extends variable hover support to include cross-file resolution with clickable source links.

The current implementation uses a precedence-based approach where symbol lookups short-circuit on the first match. This design modifies the approach to collect all matches first, then format them appropriately based on the number of matches.

## Architecture

The enhancement follows the existing hover provider architecture with minimal changes:

```
get_hover()
    ├── get_word_at_position()
    ├── Check option/subcommand/delimiter context (unchanged)
    ├── collect_all_symbol_matches() [NEW]
    │   ├── get_macro_match() → MacroMatch | null
    │   ├── get_program_match() → ProgramMatch | null
    │   ├── get_scalar_matrix_match() → ScalarMatrixMatch | null
    │   └── get_variable_match() → VariableMatch | null [ENHANCED]
    ├── format_multi_symbol_hover() [NEW]
    │   ├── Single match → existing format (no heading)
    │   └── Multiple matches → sectioned format with headings
    └── Fallback to command database (unchanged)
```

## Components and Interfaces

### New Types

```typescript
interface SymbolMatch {
    type: 'local_macro' | 'global_macro' | 'program' | 'scalar' | 'matrix' | 'variable';
    content: MarkupContent;
}
```

### Modified Methods

#### `get_hover()` - Main Entry Point

The main method will be refactored to:
1. Collect all symbol matches into an array
2. If multiple matches exist, format with section headings
3. If single match exists, return existing format
4. If no matches, fall back to command database

#### `get_variable_hover()` - Enhanced

Current signature:
```typescript
private get_variable_hover(document: DocumentState, word: string): MarkupContent | null
```

New signature:
```typescript
private get_variable_hover(
    document: DocumentState,
    word: string,
    workspace_symbols?: SymbolTable,
    resolved_scope?: ResolvedScope,
    workspace_root?: string
): MarkupContent | null
```

The method will:
1. Check `resolved_scope.symbols.variables` first
2. Fall back to `document.symbols.variables`
3. Fall back to `workspace_symbols.variables`
4. Format with source link using `format_source_link()`

#### `collect_all_symbol_matches()` - New Method

```typescript
private collect_all_symbol_matches(
    document: DocumentState,
    position: Position,
    word: string,
    workspace_symbols?: SymbolTable,
    resolved_scope?: ResolvedScope,
    workspace_root?: string
): SymbolMatch[]
```

Collects matches from all symbol categories in order:
1. Local macros
2. Global macros
3. Programs
4. Scalars
5. Matrices
6. Variables

#### `format_multi_symbol_hover()` - New Method

```typescript
private format_multi_symbol_hover(matches: SymbolMatch[]): MarkupContent
```

Formats the collected matches:
- Single match: returns the content directly (no heading)
- Multiple matches: adds markdown headings for each section

### Display Order

When multiple symbols match, they are displayed in this order:
1. **Local Macro** - Most specific scope
2. **Global Macro** - Broader scope
3. **Program** - User-defined command
4. **Scalar** - Stata scalar
5. **Matrix** - Stata matrix
6. **Variable** - Dataset variable

### Heading Format

For multi-symbol display, each section uses a markdown heading:

```markdown
### Local Macro
**Local Macro:** `name`
Source: [path/to/file.do](file:///path/to/file.do), line 42

---

### Variable
**Variable:** `name`
Type: `float`
Label: Variable description
Source: [data/load.do](file:///data/load.do), line 15
```

## Data Models

No new data models are required. The existing `SymbolTable`, `MacroSymbol`, `VariableSymbol`, `ScalarSymbol`, `MatrixSymbol`, and `ProgramSymbol` interfaces are sufficient.

The `VariableSymbol` interface already contains all necessary fields:
```typescript
interface VariableSymbol {
    name: string;
    location: { uri: string; range: Range };
    sourceUri: string;
    type?: string;
    label?: string;
    source: 'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename';
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Multi-Symbol Display Completeness and Ordering

*For any* identifier that matches symbols in N different categories (where N > 1), the hover output SHALL contain exactly N sections, each with a markdown heading, displayed in the order: Local Macro, Global Macro, Program, Scalar, Matrix, Variable.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Single Symbol Display Preserves Format

*For any* identifier that matches exactly one symbol category, the hover output SHALL NOT contain section headings (### markers), preserving the existing single-symbol format.

**Validates: Requirements 1.4**

### Property 3: Variable Lookup Precedence

*For any* variable name that exists in multiple sources (resolved_scope, document.symbols, workspace_symbols), the hover provider SHALL use the value from resolved_scope if available, otherwise document.symbols if available, otherwise workspace_symbols.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 4: Variable Source Link Consistency

*For any* variable symbol with a sourceUri different from the current document, the hover output SHALL contain a clickable markdown link in the same format used for macros, programs, scalars, and matrices.

**Validates: Requirements 2.2, 4.1**

## Error Handling

### Missing Symbol Information

- If a symbol exists in the symbol table but has missing optional fields (e.g., `type`, `label`, `definition_line`), display available information gracefully
- Use "unknown" for missing type, "none" for missing label
- Omit line number from source info if `definition_line` is undefined

### Invalid URIs

- If `sourceUri` cannot be parsed, display it as plain text in backticks
- If `sourceUri` is empty or undefined, display "unknown source"

### Cross-File Resolution Failures

- If `resolved_scope` resolution fails, fall back to workspace_symbols and document.symbols
- Log resolution errors but don't fail the hover request

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. **Single symbol hover** - Verify existing behavior is preserved for each symbol type
2. **Multi-symbol hover** - Verify correct formatting when 2, 3, or all 6 symbol types match
3. **Variable cross-file lookup** - Verify precedence: resolved_scope > workspace_symbols > document.symbols
4. **Source link formatting** - Verify markdown link format for variables matches other symbols
5. **Edge cases** - Empty symbol tables, missing optional fields, special characters in paths

### Property-Based Tests

Property tests will use fast-check to verify universal properties:

1. **Multi-symbol completeness** - Generate random combinations of symbol types with same name, verify all appear in output
2. **Ordering invariant** - Generate multi-symbol scenarios, verify section order is always correct
3. **Single symbol format** - Generate single-symbol scenarios, verify no section headings
4. **Lookup precedence** - Generate scenarios with same variable in multiple sources, verify correct source is used

### Test Configuration

- Property tests: minimum 100 iterations
- Test framework: Bun test with fast-check
- Tag format: **Feature: hover-multi-symbol-display, Property N: {property_text}**
