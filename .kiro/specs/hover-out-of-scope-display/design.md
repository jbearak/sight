# Design Document: Hover Out-of-Scope Display

## Overview

This feature enhances the HoverProvider to display out-of-scope symbols with a clear "(out of scope)" indicator instead of returning no match and falling through to display unrelated symbols. When a user hovers over a local macro reference like `` `country_name' `` that is out-of-scope, the hover will show:

```
**Local Macro:** `country_name` (out of scope)

Source: dhs/import_metadata_for_survey_checks.do, line 23
```

This provides clear feedback about why the symbol is not accessible rather than showing confusing information about an unrelated variable.

## Architecture

The change is localized to the `HoverProvider` class in `src/providers/hover.ts`. The existing infrastructure for tracking out-of-scope symbols (`ResolvedScope.out_of_scope_symbols`) and detecting reference types (`get_reference_type_from_context`) is already in place.

### Current Flow

```
collect_all_symbol_matches()
  ├── Check if reference is out-of-scope → return [] (empty)
  ├── Check local macros → add match
  ├── Check global macros → add match
  ├── Check programs → add match
  ├── Check scalars → add match
  ├── Check matrices → add match
  └── Check variables → add match
```

### New Flow

```
collect_all_symbol_matches()
  ├── Check if reference is out-of-scope
  │   └── If yes → return [out-of-scope match with indicator]
  ├── Check local macros → add match
  ├── Check global macros → add match
  ├── Check programs → add match
  ├── Check scalars → add match
  ├── Check matrices → add match
  └── Check variables → add match
```

## Components and Interfaces

### Modified Method: `collect_all_symbol_matches`

The method will be modified to return an out-of-scope symbol match instead of an empty array when the reference type matches an out-of-scope symbol.

```typescript
private collect_all_symbol_matches(
    document: DocumentState,
    position: Position,
    word: string,
    workspace_symbols?: SymbolTable,
    resolved_scope?: ResolvedScope,
    workspace_root?: string
): SymbolMatch[] {
    const reference_type = this.get_reference_type_from_context(document, position, word);
    
    // Check for out-of-scope symbol matching the reference type
    const out_of_scope_match = this.get_out_of_scope_hover(
        word, reference_type, resolved_scope, document.uri, workspace_root
    );
    if (out_of_scope_match) {
        return [out_of_scope_match];
    }

    // Continue with existing logic for in-scope symbols...
}
```

### New Method: `get_out_of_scope_hover`

A new private method to generate hover content for out-of-scope symbols.

```typescript
private get_out_of_scope_hover(
    word: string,
    reference_type: 'local_macro' | 'global_macro' | 'other' | null,
    resolved_scope?: ResolvedScope,
    current_uri?: string,
    workspace_root?: string
): SymbolMatch | null {
    if (!resolved_scope || !reference_type || reference_type === 'other') {
        return null;
    }

    const out_of_scope = resolved_scope.out_of_scope_symbols.find(s => s.name === word);
    if (!out_of_scope) {
        return null;
    }

    // Match reference type to symbol type
    if (reference_type === 'local_macro' && out_of_scope.type !== 'local') {
        return null;
    }
    if (reference_type === 'global_macro' && out_of_scope.type !== 'global') {
        return null;
    }

    // Generate hover content with "(out of scope)" indicator
    const type_label = out_of_scope.type === 'local' ? 'Local Macro' : 'Global Macro';
    const source_link = this.format_source_link(out_of_scope.source_uri, current_uri || '', workspace_root);
    const line_info = `, line ${out_of_scope.defined_line + 1}`;
    const source_info = source_link
        ? `\n\nSource: ${source_link}${line_info}`
        : `\n\nDefined at: this file${line_info}`;

    return {
        type: reference_type === 'local_macro' ? 'local_macro' : 'global_macro',
        content: {
            kind: MarkupKind.Markdown,
            value: `**${type_label}:** \`${word}\` (out of scope)${source_info}`,
        },
    };
}
```

## Data Models

No new data models are required. The existing `OutOfScopeSymbol` interface provides all necessary information:

```typescript
interface OutOfScopeSymbol {
    name: string;
    type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix';
    source_uri: string;
    defined_line: number;
    call_site_line: number;
    reason: OutOfScopeReason;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Out-of-Scope Indicator Presence

*For any* local or global macro reference that matches an out-of-scope symbol, the hover content SHALL contain the text "(out of scope)". *For any* in-scope symbol, the hover content SHALL NOT contain "(out of scope)".

**Validates: Requirements 1.1, 2.1, 3.1**

### Property 2: Source Information Inclusion

*For any* out-of-scope macro displayed in hover, the hover content SHALL include the source file path and definition line number from the `OutOfScopeSymbol`.

**Validates: Requirements 1.2, 2.2**

### Property 3: No Fallthrough for Out-of-Scope Macros

*For any* local or global macro reference that matches an out-of-scope symbol, the hover SHALL return exactly one match of the corresponding macro type, even when other symbol types (variables, programs) with the same name exist.

**Validates: Requirements 1.3, 2.3**

### Property 4: Reference Type Matching

*For any* reference with local macro syntax (backtick-quote), the hover SHALL only check out-of-scope local macros. *For any* reference with global macro syntax ($ prefix), the hover SHALL only check out-of-scope global macros. *For any* bare identifier reference, the hover SHALL NOT display out-of-scope macro information.

**Validates: Requirements 4.1, 4.2, 4.3**

## Error Handling

- If `resolved_scope` is undefined, fall through to existing behavior (no out-of-scope check)
- If `out_of_scope_symbols` is empty, fall through to existing behavior
- If reference type is 'other' (bare identifier), fall through to existing behavior
- If out-of-scope symbol type doesn't match reference type, fall through to existing behavior

## Testing Strategy

### Unit Tests

Unit tests will verify:
- `get_out_of_scope_hover` returns correct content for local macros
- `get_out_of_scope_hover` returns correct content for global macros
- `get_out_of_scope_hover` returns null for bare identifiers
- `get_out_of_scope_hover` returns null when types don't match
- `collect_all_symbol_matches` returns out-of-scope match instead of empty array
- Integration with `get_hover` returns proper hover content

### Property-Based Tests

Property-based tests using fast-check will verify:
- Property 1: Out-of-scope indicator presence/absence
- Property 2: Source information inclusion
- Property 3: No fallthrough behavior
- Property 4: Reference type matching

Each property test will run minimum 100 iterations with randomly generated:
- Symbol names (valid Stata identifiers)
- Source URIs
- Definition line numbers
- Reference syntax contexts
