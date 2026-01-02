# Design Document: Cross-File Forward Reference Fix

## Overview

This design addresses a bug where forward reference warnings are incorrectly suppressed when cross-file awareness directives are present. The fix modifies the `DiagnosticsProvider` to distinguish between symbols defined in the current file versus symbols defined in parent files when deciding whether to suppress undefined macro diagnostics.

## Architecture

The fix is localized to the `DiagnosticsProvider` class in `src/providers/diagnostics.ts`. No changes are required to the `SemanticAnalyzer` or `ScopeResolver` components.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Document Processing                       │
├─────────────────────────────────────────────────────────────────┤
│  DocumentStore → SemanticAnalyzer → DiagnosticsProvider         │
│                                           │                      │
│                                           ▼                      │
│                                    ScopeResolver                 │
│                                           │                      │
│                                           ▼                      │
│                              is_symbol_defined_in_scope()        │
│                                           │                      │
│                                           ▼                      │
│                              [NEW] Check sourceUri vs            │
│                                    current document URI          │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### DiagnosticsProvider (Modified)

The `is_symbol_defined_in_scope` method will be modified to accept an additional parameter for the current document URI and to check the symbol's `sourceUri` before suppressing diagnostics.

```typescript
/**
 * Check if a symbol is defined in the resolved scope AND comes from a different file.
 * Only symbols from different files should suppress undefined symbol diagnostics.
 * Symbols from the same file should preserve forward reference detection.
 */
private is_symbol_defined_in_scope(
    symbol_name: string,
    symbols: SymbolTable,
    diagnostic_code: number,
    current_document_uri: string  // NEW parameter
): boolean
```

### Logic Change

Current behavior:
```typescript
if (this.is_symbol_defined_in_scope(symbol_name, resolved_scope.symbols, my_diagnostic.code)) {
    continue; // Skip - symbol is defined
}
```

New behavior:
```typescript
if (this.is_symbol_defined_in_scope(symbol_name, resolved_scope.symbols, my_diagnostic.code, document.uri)) {
    continue; // Skip - symbol is defined in a DIFFERENT file
}
```

The method will:
1. Look up the symbol in the appropriate map (localMacros, globalMacros, etc.)
2. Check if the symbol's `sourceUri` matches the current document URI
3. Return `true` only if the symbol exists AND comes from a different file
4. Return `false` if the symbol doesn't exist OR comes from the same file

## Data Models

No changes to data models are required. The existing `MacroSymbol` interface already includes `sourceUri`:

```typescript
interface MacroSymbol {
    name: string;
    scope: 'local' | 'global';
    location: { uri: string; range: Range };
    sourceUri: string;  // Already exists - used for this fix
    // ... other fields
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Forward references to same-file symbols produce warnings with cross-file directives

*For any* file with cross-file directives and *for any* local macro defined in that file, if the macro is referenced before its definition line, the diagnostics provider should emit an undefined macro warning.

**Validates: Requirements 1.1**

### Property 2: Non-forward references to same-file symbols do not produce warnings

*For any* file with cross-file directives and *for any* local macro defined in that file, if the macro is referenced after its definition line, the diagnostics provider should NOT emit an undefined macro warning.

**Validates: Requirements 1.2**

### Property 3: Cross-file symbols suppress undefined macro warnings

*For any* file with cross-file directives and *for any* macro defined in a parent file (via `@lsp-included-by` for locals or either directive for globals), references to that macro should NOT produce undefined macro warnings.

**Validates: Requirements 2.1, 2.2**

### Property 4: Undefined macros in string literals produce warnings

*For any* file and *for any* macro reference within a string literal (e.g., `di "`apple'"`), if the macro is undefined, the diagnostics provider should emit an undefined macro warning.

**Validates: Requirements 3.1, 3.2**

### Property 5: Out-of-scope symbols from parent files produce appropriate diagnostics

*For any* file with cross-file directives and *for any* symbol defined in a parent file after the call site, the diagnostics provider should emit an out-of-scope diagnostic (when configured).

**Validates: Requirements 4.1**

## Error Handling

No new error handling is required. The fix only changes the decision logic for suppressing diagnostics; it does not introduce new failure modes.

Edge cases:
- If `sourceUri` is undefined on a symbol, treat it as same-file (conservative approach)
- If the document URI cannot be determined, fall back to existing behavior (suppress if symbol exists)

## Testing Strategy

### Unit Tests

Unit tests will verify the specific behavior of `is_symbol_defined_in_scope`:
- Symbol from different file returns `true`
- Symbol from same file returns `false`
- Missing symbol returns `false`
- Symbol with undefined `sourceUri` returns `false`

### Property-Based Tests

Property-based tests will use fast-check to verify the correctness properties across many generated inputs:
- Generate random macro names and file structures
- Verify forward reference detection is preserved with cross-file directives
- Verify cross-file symbol suppression works correctly
- Minimum 100 iterations per property test

Each property test will be tagged with:
- **Feature: cross-file-forward-reference-fix, Property N: [property description]**
- **Validates: Requirements X.Y**

### Integration Tests

Integration tests will verify end-to-end behavior:
- Create temporary files with cross-file directives
- Open documents via DocumentStore
- Verify diagnostics are correctly filtered
