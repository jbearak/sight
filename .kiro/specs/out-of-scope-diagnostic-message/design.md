# Design Document: Out-of-Scope Diagnostic Message Fix

## Overview

This design addresses a bug where local macros excluded due to inheritance rules (done-by/run-by boundaries) incorrectly display a diagnostic message about being "defined after the call site" instead of explaining that "local macros are not inherited via do/run".

The root cause is that during scope resolution, the same symbol can be added to `out_of_scope_symbols` multiple times with different reasons:
1. During recursive resolution, `filter_by_call_site()` may add an entry with reason `'after_call_site'`
2. After recursion, when stripping locals at done-by boundaries, `apply_inheritance_rules()` adds entries with reason `'inheritance_excludes_locals'`

The `find()` call in `DiagnosticsProvider` returns the first match, which may have the wrong reason.

## Architecture

The fix involves modifying the `ScopeResolver` to deduplicate `out_of_scope_symbols` entries, prioritizing `'inheritance_excludes_locals'` over `'after_call_site'`. This ensures the diagnostic message accurately reflects why the symbol is inaccessible.

### Component Changes

1. **ScopeResolver** (`src/scope-resolver/index.ts`):
   - Add deduplication logic when adding entries to `out_of_scope`
   - When stripping locals after recursion, remove any existing `'after_call_site'` entries for those symbols

2. **DiagnosticsProvider** (`src/providers/diagnostics.ts`):
   - No changes needed if deduplication is done in ScopeResolver
   - The existing message generation logic already handles both reasons correctly

3. **HoverProvider** (`src/providers/hover.ts`):
   - Check if the symbol has an out-of-scope diagnostic before collecting symbol matches
   - If the symbol is out-of-scope, return null to let the diagnostic be the primary information
   - This prevents confusing hover content that shows unrelated symbols with the same name

## Components and Interfaces

### ScopeResolver Changes

```typescript
/**
 * Add out-of-scope symbols with deduplication.
 * If a symbol already exists with reason 'after_call_site' and we're adding
 * with reason 'inheritance_excludes_locals', replace the existing entry.
 * 
 * Priority: inheritance_excludes_locals > after_call_site
 */
private add_out_of_scope_symbols(
    out_of_scope: OutOfScopeSymbol[],
    new_symbols: OutOfScopeSymbol[]
): void {
    for (const new_symbol of new_symbols) {
        const existing_index = out_of_scope.findIndex(s => s.name === new_symbol.name);
        
        if (existing_index === -1) {
            // No existing entry, add new one
            out_of_scope.push(new_symbol);
        } else if (new_symbol.reason === 'inheritance_excludes_locals' && 
                   out_of_scope[existing_index].reason === 'after_call_site') {
            // Replace after_call_site with inheritance_excludes_locals
            out_of_scope[existing_index] = new_symbol;
        }
        // Otherwise keep existing entry (same reason or existing has higher priority)
    }
}
```

### Call Sites to Update

1. Line ~876: `out_of_scope.push(...excluded_locals)` → `this.add_out_of_scope_symbols(out_of_scope, excluded_locals)`
2. Line ~882: `out_of_scope.push(...my_out_of_scope)` → `this.add_out_of_scope_symbols(out_of_scope, my_out_of_scope)`
3. Line ~914: `out_of_scope.push(...excluded_locals)` → `this.add_out_of_scope_symbols(out_of_scope, excluded_locals)`

### HoverProvider Changes

The hover provider needs to be smarter about what symbol info to show based on the syntax context of the reference:

```typescript
/**
 * Determine the expected symbol type from the syntax context at position.
 * Returns the symbol type being referenced, or null if ambiguous.
 */
private get_reference_type_from_context(
    document: DocumentState,
    position: Position,
    word: string
): 'local_macro' | 'global_macro' | 'other' | null {
    // Check the characters before the word to determine reference type
    // Local macro: `word' (backtick before, single quote after)
    // Global macro: $word or ${word}
    // Other: bare identifier (could be variable, program, scalar, matrix)
    
    const line = document.content.split('\n')[position.line];
    const word_start = position.character;
    
    // Check for local macro syntax: `word'
    if (word_start > 0 && line[word_start - 1] === '`') {
        return 'local_macro';
    }
    
    // Check for global macro syntax: $word or ${word}
    if (word_start > 0 && line[word_start - 1] === '$') {
        return 'global_macro';
    }
    if (word_start > 1 && line.substring(word_start - 2, word_start) === '${') {
        return 'global_macro';
    }
    
    return 'other';
}

/**
 * Check if a symbol reference is out-of-scope for its specific type.
 */
private is_reference_out_of_scope(
    word: string,
    reference_type: 'local_macro' | 'global_macro' | 'other' | null,
    resolved_scope?: ResolvedScope
): boolean {
    if (!resolved_scope || !reference_type) {
        return false;
    }
    
    const out_of_scope = resolved_scope.out_of_scope_symbols.find(s => s.name === word);
    if (!out_of_scope) {
        return false;
    }
    
    // Check if the out-of-scope symbol type matches the reference type
    if (reference_type === 'local_macro' && out_of_scope.type === 'local') {
        return true;
    }
    if (reference_type === 'global_macro' && out_of_scope.type === 'global') {
        return true;
    }
    
    return false;
}
```

In `collect_all_symbol_matches()`, filter based on reference type when out-of-scope:
```typescript
// If this is a local macro reference that's out-of-scope, only show local macro info (none)
// Don't fall back to showing variable/program info
const reference_type = this.get_reference_type_from_context(document, position, word);
if (this.is_reference_out_of_scope(word, reference_type, resolved_scope)) {
    // Return empty matches - let the diagnostic be the primary info
    return [];
}
```

## Data Models

No changes to data models. The existing `OutOfScopeSymbol` interface and `OutOfScopeReason` type are sufficient:

```typescript
export type OutOfScopeReason = 'after_call_site' | 'inheritance_excludes_locals';

export interface OutOfScopeSymbol {
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

### Property 1: Out-of-Scope Reason Prioritization

*For any* symbol that appears in `out_of_scope_symbols`, if the symbol could be excluded for multiple reasons (both `'after_call_site'` and `'inheritance_excludes_locals'`), the entry SHALL have reason `'inheritance_excludes_locals'`.

**Validates: Requirements 1.2, 2.1, 2.2**

### Property 2: Correct Message for Inheritance-Excluded Locals

*For any* local macro that is excluded due to a done-by/run-by boundary (reason `'inheritance_excludes_locals'`), the diagnostic message SHALL contain "local macros are not inherited via do/run" and SHALL NOT contain "after the call site".

**Validates: Requirements 1.1, 3.2**

### Property 3: Correct Message for After-Call-Site Symbols

*For any* symbol that is excluded because it's defined after the call site (reason `'after_call_site'`), the diagnostic message SHALL contain "after the call site (line N)" where N is the 1-indexed call site line number.

**Validates: Requirements 3.1**

### Property 4: No Duplicate Out-of-Scope Entries

*For any* resolved scope, each symbol name SHALL appear at most once in `out_of_scope_symbols`.

**Validates: Requirements 2.1**

### Property 5: Hover Suppression for Out-of-Scope Macro References

*For any* local macro reference (`` `name' ``) where the local macro is out-of-scope, the HoverProvider SHALL NOT display information about variables, globals, or other symbol types with the same name.

**Validates: Requirements 4.1, 4.4**

### Property 6: Hover Preservation for Valid References

*For any* symbol reference that is NOT out-of-scope, the HoverProvider SHALL display all matching symbol information as before (no change in behavior).

**Validates: Requirements 4.3**

## Error Handling

- If `add_out_of_scope_symbols` receives an empty array, it should be a no-op
- The deduplication logic should handle edge cases where the same symbol is added multiple times with the same reason (keep first entry)

## Testing Strategy

### Unit Tests

1. Test `add_out_of_scope_symbols` helper function:
   - Adding to empty array
   - Adding new symbol (no existing entry)
   - Replacing `after_call_site` with `inheritance_excludes_locals`
   - Keeping `inheritance_excludes_locals` when adding `after_call_site`
   - Keeping first entry when adding same reason

2. Test diagnostic message generation:
   - Message format for `inheritance_excludes_locals` reason
   - Message format for `after_call_site` reason

### Property-Based Tests

1. **Property 1**: Generate random file hierarchies with done-by -> included-by chains, resolve scope, verify out_of_scope entries have correct reason priority
2. **Property 2**: Generate random local names, create inheritance-excluded scenarios, verify diagnostic message format
3. **Property 3**: Generate random symbols defined after call site, verify diagnostic message includes correct line number
4. **Property 4**: Generate random scope resolution scenarios, verify no duplicate entries in out_of_scope_symbols

### Integration Tests

1. End-to-end test with the exact scenario from the bug report:
   - `survey.do` defines `local country_name`
   - `bh_vars.do` uses `@lsp-included-by: survey.do`
   - `bircmc.do` uses `@lsp-done-by: bh_vars.do` and references `country_name`
   - Verify diagnostic message says "local macros are not inherited via do/run"
