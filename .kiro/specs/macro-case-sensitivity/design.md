# Design Document: Macro Completion Prefix Filtering

## Overview

This design addresses macro completion prefix filtering in the Stata LSP. Currently, `get_macro_completions` returns all macros without filtering by the typed prefix. This change adds prefix extraction and filtering to provide more relevant completions.

## Architecture

The change is localized to the completion provider:

```
┌─────────────────────────────────────────────────────────────┐
│                    Document State                            │
│  ┌─────────────────┐                                        │
│  │  Symbol Table   │                                        │
│  │  - localMacros  │                                        │
│  │  - globalMacros │                                        │
│  └────────┬────────┘                                        │
└───────────┼─────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────┐
│                  Completion Provider                       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  get_macro_completions(scope, document, position)   │  │
│  │    1. Extract prefix from text before cursor        │  │
│  │    2. Filter macros by case-sensitive prefix match  │  │
│  │    3. Sort results alphabetically                   │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Method Signature

```typescript
// Current signature (no position parameter)
private get_macro_completions(
    scope: 'local' | 'global',
    document: DocumentState
): CompletionItem[];

// New signature (adds position for prefix extraction)
private get_macro_completions(
    scope: 'local' | 'global',
    document: DocumentState,
    position: Position
): CompletionItem[];
```

### New Helper Function

```typescript
/**
 * Extract the macro name prefix from text before cursor.
 * For local macros: text after last unmatched backtick
 * For global macros: text after $ or ${
 */
private get_macro_prefix(
    document: DocumentState,
    position: Position,
    scope: 'local' | 'global'
): string;
```

### Prefix Extraction Logic

For local macros (`` `prefix ``):
```typescript
function get_macro_prefix_local(text_before_cursor: string): string {
    // Find last unmatched backtick (not part of compound quote `")
    let backtick_count = 0;
    let apostrophe_count = 0;
    let last_backtick_pos = -1;
    
    for (let i = 0; i < text_before_cursor.length; i++) {
        const char = text_before_cursor[i];
        const next_char = text_before_cursor[i + 1] || '';
        
        if (char === '`' && next_char !== '"') {
            backtick_count++;
            last_backtick_pos = i;
        } else if (char === "'" && backtick_count > apostrophe_count) {
            apostrophe_count++;
        }
    }
    
    // If we have an unmatched backtick, extract prefix after it
    if (backtick_count > apostrophe_count && last_backtick_pos >= 0) {
        return text_before_cursor.substring(last_backtick_pos + 1);
    }
    
    return '';
}
```

For global macros (`$prefix` or `${prefix`):
```typescript
function get_macro_prefix_global(text_before_cursor: string): string {
    // Find last $ that starts a macro reference
    for (let i = text_before_cursor.length - 1; i >= 0; i--) {
        if (text_before_cursor[i] === '$') {
            const after_dollar = text_before_cursor.substring(i + 1);
            
            // Handle ${name} form
            if (after_dollar.startsWith('{')) {
                if (!after_dollar.includes('}')) {
                    return after_dollar.substring(1); // Skip the {
                }
                continue; // Closed brace, keep looking
            }
            
            // Handle $name form - check if still typing
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(after_dollar) || after_dollar === '') {
                return after_dollar;
            }
        }
    }
    return '';
}
```

### Filtering and Sorting

```typescript
private get_macro_completions(
    scope: 'local' | 'global',
    document: DocumentState,
    position: Position
): CompletionItem[] {
    const prefix = this.get_macro_prefix(document, position, scope);
    const prefix_lower = prefix.toLowerCase();
    const the_completions: CompletionItem[] = [];
    const the_macros = scope === 'local'
        ? document.symbols.localMacros
        : document.symbols.globalMacros;

    for (const [name, macro] of the_macros) {
        // Case-insensitive prefix match
        if (prefix === '' || name.toLowerCase().startsWith(prefix_lower)) {
            the_completions.push({
                label: name,
                kind: CompletionItemKind.Variable,
                detail: `${scope} macro`,
                documentation: macro.value ? `Value: ${macro.value}` : undefined,
                sortText: '0' + name,
            });
        }
    }

    // Sort alphabetically
    the_completions.sort((a, b) => a.label.localeCompare(b.label));

    return the_completions;
}
```

## Data Models

No new data models required. Uses existing `MacroSymbol` and `SymbolTable`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Prefix Matching Completions

*For any* document with defined macros and *for any* non-empty prefix string, all completion items returned by the Completion_Provider SHALL have names that start with the prefix (case-insensitive match).

**Validates: Requirements 1.1, 1.2**

### Property 2: Empty Prefix Returns All Macros

*For any* document with defined macros, when the prefix is empty, the Completion_Provider SHALL return all macros of the requested scope (local or global).

**Validates: Requirements 1.3, 1.4**

### Property 3: Completions Are Sorted Alphabetically

*For any* set of macro completions returned by the Completion_Provider, the items SHALL be sorted in ascending alphabetical order by name.

**Validates: Requirements 1.5**

### Property 4: No Match Returns Empty

*For any* prefix that does not match any defined macro names, the Completion_Provider SHALL return an empty list.

**Validates: Requirements 1.6**

## Error Handling

- If position is outside document bounds, return empty completions
- If document content is empty, return empty completions
- Malformed text (e.g., binary content) is handled gracefully by returning empty prefix

## Testing Strategy

### Unit Tests

Unit tests verify specific examples:

1. **Prefix extraction**:
   - `` `app `` → prefix `"app"`
   - `$MY` → prefix `"MY"`
   - `${data` → prefix `"data"`
   - Just `` ` `` → prefix `""`

2. **Filtering examples**:
   - Define `apple`, `apricot`, `banana`; type `` `a `` → returns `apple`, `apricot`
   - Define `apple`; type `` `A `` → returns `apple` (case-insensitive)
   - Define `Apple`, `apple`; type `` `a `` → returns both `Apple` and `apple`

3. **Sorting**:
   - Define `zebra`, `apple`, `mango`; type `` ` `` → returns `apple`, `mango`, `zebra`

### Property-Based Tests

Property tests use fast-check to verify universal properties. Each test runs minimum 100 iterations.

Test file: `tests/property/macro-completion-prefix.prop.test.ts`

- **Property 1**: Generate random macro sets and prefixes, verify all completions start with prefix
- **Property 2**: Generate random macro sets, verify empty prefix returns all
- **Property 3**: Generate random macro sets, verify alphabetical sorting
- **Property 4**: Generate prefixes that don't match any macros, verify empty result

### Test Configuration

- Property-based testing library: fast-check
- Minimum iterations: 100 per property
- Tag format: `Feature: macro-case-sensitivity, Property N: <property_text>`
