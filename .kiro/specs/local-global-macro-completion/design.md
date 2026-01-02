# Design Document: Local vs. Global Macro Completion Filtering

## Overview

This design fixes the macro completion filtering in the LSP to correctly distinguish between local and global macros based on the prefix character used. Currently, the completion provider suggests local macros when the dollar sign (`$`) prefix is used, and incorrectly classifies local macros as globals in completion suggestions. The fix ensures that:

- Local macros (`` ` ``) are only suggested when backtick is the prefix
- Global macros (`$`) are only suggested when dollar sign is the prefix
- Completion items correctly label macros as "local macro" or "global macro"
- The filtering is based purely on prefix, not definition order

## Architecture

The completion filtering system has three main components:

```
┌─────────────────────────────────────────────────────────────┐
│ Context Detection (detect_completion_context)               │
│ - Identifies macro context (local vs global) based on prefix │
│ - Returns CompletionContext with scope: 'local' | 'global'   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Completion Provider (get_macro_completions)                 │
│ - Filters macros from symbol table by scope                 │
│ - Applies prefix matching (case-insensitive)                │
│ - Generates completion items with correct labels            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Symbol Table (SymbolTable)                                  │
│ - localMacros: Map<string, MacroSymbol>                     │
│ - globalMacros: Map<string, MacroSymbol>                    │
│ - Analyzer correctly classifies macros by scope             │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Context Detection (detect_completion_context)

The `detect_macro_context` function already correctly identifies whether we're in a local or global macro context by examining the text before the cursor:

- **Local macro context**: Unmatched backtick (`` ` ``) in the text
- **Global macro context**: Dollar sign (`$`) or `${` in the text

This function returns `{ type: 'macro', scope: 'local' | 'global' }`.

**Current behavior**: ✓ Correct - already distinguishes local vs global

### 2. Completion Provider (get_macro_completions)

The `get_macro_completions` method receives the scope from context detection and filters macros accordingly:

```typescript
private get_macro_completions(
    scope: 'local' | 'global',
    document: DocumentState,
    position: Position,
    symbols: SymbolTable,
    resolved_scope?: ResolvedScope
): CompletionItem[] {
    const prefix = this.get_macro_prefix(document, position, scope);
    const prefix_lower = prefix.toLowerCase();
    const the_completions: CompletionItem[] = [];

    // Get the correct macro map based on scope
    const the_macros = scope === 'local'
        ? symbols.localMacros
        : symbols.globalMacros;

    // Filter and generate completions
    for (const [name, macro] of the_macros) {
        // Prefix matching
        if (!(prefix === '' || name.toLowerCase().startsWith(prefix_lower))) {
            continue;
        }

        // Generate completion item with correct label
        const detail = `${scope} macro`;  // "local macro" or "global macro"
        
        the_completions.push({
            label: name,
            kind: CompletionItemKind.Variable,
            detail,
            // ... other fields
        });
    }

    return the_completions;
}
```

**Current issue**: The method correctly filters by scope, but the detail field may not always say "local macro" or "global macro" consistently.

**Fix**: Ensure the detail field always uses the format `"${scope} macro"` where scope is either "local" or "global".

### 3. Symbol Table (SymbolTable)

The analyzer correctly populates two separate maps:
- `localMacros`: Map of local macros (defined with `local` keyword)
- `globalMacros`: Map of global macros (defined with `global` keyword)

**Current behavior**: ✓ Correct - analyzer properly classifies macros

## Data Models

### CompletionContext

```typescript
type CompletionContext =
    | { type: 'command' }
    | { type: 'option'; command: string }
    | { type: 'macro'; scope: 'local' | 'global' }  // Scope is already correct
    | { type: 'variable' }
    | { type: 'program' }
    | { type: 'fallback' };
```

### MacroSymbol (from SymbolTable)

```typescript
interface MacroSymbol {
    name: string;
    value?: string;
    sourceUri: string;
    location?: {
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    };
    definition_line?: number;
    // ... other fields
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Backtick Prefix Returns Only Local Macros

*For any* document with local and global macros, when the user types a backtick (`` ` ``) followed by a prefix, all returned completion items shall be local macros, and no global macros shall be returned.

**Validates: Requirements 1.5, 1.6**

### Property 2: Dollar Prefix Returns Only Global Macros

*For any* document with local and global macros, when the user types a dollar sign (`$`) followed by a prefix, all returned completion items shall be global macros, and no local macros shall be returned.

**Validates: Requirements 2.6, 2.7**

### Property 3: Local Macros Labeled as "local macro"

*For any* local macro in the completion results, the detail field shall contain the text "local macro".

**Validates: Requirements 3.1, 3.3**

### Property 4: Global Macros Labeled as "global macro"

*For any* global macro in the completion results, the detail field shall contain the text "global macro".

**Validates: Requirements 3.2, 3.4**

### Property 5: Backtick Filtering Independent of Definition Order

*For any* document where a global macro is defined before a local macro with the same name, when the user types a backtick (`` ` ``) followed by the prefix, the completion provider shall return only the local macro.

**Validates: Requirements 1.4, 4.1**

### Property 6: Dollar Filtering Independent of Definition Order

*For any* document where a local macro is defined before a global macro with the same name, when the user types a dollar sign (`$`) followed by the prefix, the completion provider shall return only the global macro.

**Validates: Requirements 2.5, 4.2**

### Property 7: Shadowing Respects Scope Rules

*For any* document where a local macro shadows a global macro with the same name, when the user types a backtick (`` ` ``) the local macro is suggested, and when the user types a dollar sign (`$`) the global macro is suggested.

**Validates: Requirements 4.3**

### Property 8: Analyzer Classifies Local Macros Correctly

*For any* macro definition with the `local` keyword, the analyzer shall place it in the symbol table's `localMacros` map, not in `globalMacros`.

**Validates: Requirements 5.1, 5.3**

### Property 9: Analyzer Classifies Global Macros Correctly

*For any* macro definition with the `global` keyword, the analyzer shall place it in the symbol table's `globalMacros` map, not in `localMacros`.

**Validates: Requirements 5.2, 5.3**

## Error Handling

### Mixed Local and Global Definitions

When both a local and global macro with the same name exist:
- Backtick prefix (`` ` ``) → return only the local macro
- Dollar prefix (`$`) → return only the global macro
- No filtering errors or warnings

### Undefined Macros

If a macro is referenced but not defined:
- No completion suggestions for that macro
- Diagnostic warning issued by analyzer (separate concern)

### Empty Prefix

If the user types just the prefix character with no name:
- Return all macros of the appropriate scope
- Sort alphabetically

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Local macro filtering**: Verify backtick prefix returns only local macros
2. **Global macro filtering**: Verify dollar prefix returns only global macros
3. **Mixed definitions**: Verify correct filtering when both local and global exist
4. **Order independence**: Verify filtering works regardless of definition order
5. **Label correctness**: Verify detail field contains "local macro" or "global macro"
6. **Empty prefix**: Verify all macros of scope are returned when prefix is empty
7. **Case-insensitive matching**: Verify prefix matching is case-insensitive

### Property-Based Tests

Property-based tests use fast-check to verify universal properties across many generated inputs:

1. **Property 1**: Generate documents with local/global macros, verify backtick filtering
2. **Property 2**: Generate documents with local/global macros, verify dollar filtering
3. **Property 3**: Generate local macros, verify "local macro" label
4. **Property 4**: Generate global macros, verify "global macro" label
5. **Property 5**: Generate documents with global-then-local definitions, verify backtick filtering
6. **Property 6**: Generate documents with local-then-global definitions, verify dollar filtering
7. **Property 7**: Generate macro definitions, verify analyzer classification

### Test Configuration

- Property tests: minimum 100 iterations per property
- Use fast-check for property-based testing
- Tag format: `Feature: local-global-macro-completion, Property N: {property_text}`

## Implementation Notes

### No Changes Needed to Analyzer

The analyzer already correctly classifies macros as local or global. No changes needed to `src/analyzer/index.ts`.

### No Changes Needed to Context Detection

The `detect_macro_context` function already correctly identifies local vs global context. No changes needed to `detect_completion_context`.

### Changes Needed to Completion Provider

The main change is in `src/providers/completion.ts`:

1. Verify that `get_macro_completions` always uses the correct macro map based on scope
2. Ensure the detail field consistently uses the format `"${scope} macro"`
3. Add unit tests to verify the filtering behavior
4. Add property-based tests to verify universal properties

### No Changes to Symbol Table

The `SymbolTable` interface already has separate `localMacros` and `globalMacros` maps. No changes needed.

