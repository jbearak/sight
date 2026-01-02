# Design Document

## Overview

This design addresses a false positive diagnostic where nested Stata macro references like `` `one`two'' `` or `${one${two}}` are incorrectly flagged as "Invalid character in macro name". The fix adds detection logic to recognize nested macro patterns within macro reference tokens and suppress the invalid character diagnostic for these valid Stata constructs.

The core insight is that the current `has_invalid_macro_char()` function checks if the extracted macro name contains only `[A-Za-z0-9_]` characters. For nested macros, the extracted content includes backticks, apostrophes, `$`, and `{`/`}` characters from the inner macro references, which fail this check. The solution is to detect nested macro patterns before applying the invalid character check.

## Architecture

The fix is localized to the `Analyzer` class in `src/analyzer/index.ts`. No changes are needed to the lexer, parser, or other components.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Analyzer                                 │
│                                                                  │
│  Token (MACRO_REF_LOCAL or MACRO_REF_GLOBAL)                    │
│       │                                                          │
│       ▼                                                          │
│  extract_local_macro_name() / extract_global_macro_name()       │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ is_stored_result_reference() ──► Skip if stored result  │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ contains_nested_macro() ──► Skip if nested macro  [NEW] │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  has_invalid_macro_char() ──► Emit diagnostic if invalid        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### New Method: `contains_nested_macro()`

A new private method will be added to the `Analyzer` class to detect nested macro patterns.

```typescript
/**
 * Check if a macro name content contains nested macro references.
 * Nested macros use backtick-apostrophe pairs for locals or ${} for globals.
 * 
 * Examples of nested patterns:
 * - `one`two'' → content is "one`two'" (contains nested local)
 * - ${one${two}} → content is "one${two}" (contains nested global)
 * - ${one`two'} → content is "one`two'" (contains nested local in global)
 * - $one`two' → content is "one`two'" (contains nested local in unbraced global)
 * 
 * @param content The extracted macro name content (without outer delimiters)
 * @returns true if the content contains nested macro syntax
 */
private contains_nested_macro(content: string): boolean {
    // Check for nested local macro: backtick followed eventually by apostrophe
    if (content.includes('`') && content.includes("'")) {
        return true;
    }
    
    // Check for nested braced global macro: ${...}
    if (content.includes('${') && content.includes('}')) {
        return true;
    }
    
    // Check for nested unbraced global macro: $identifier
    // Match $[A-Za-z_][A-Za-z0-9_]* pattern
    if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(content)) {
        return true;
    }
    
    return false;
}
```

### Modified Token Processing Flow

The existing token processing in `collect_token_diagnostics()` will be updated to check for nested macros before checking for invalid characters:

```typescript
if (token.type === 'MACRO_REF_LOCAL') {
    const macro_name = this.extract_local_macro_name(token.value);
    
    // Skip stored result references like `r(values)' - they are valid Stata syntax
    if (macro_name && this.is_stored_result_reference(macro_name)) {
        continue;
    }
    
    // Skip nested macro references - they contain valid macro syntax characters
    if (macro_name && this.contains_nested_macro(macro_name)) {
        continue;
    }
    
    // Check for invalid characters in local macro reference
    if (macro_name && this.has_invalid_macro_char(macro_name)) {
        diagnostics.push({
            message: 'Invalid character in macro name',
            range: token.range,
            code: StataDiagnosticCode.INVALID_MACRO_CHAR,
            severity: 'error',
        });
        continue;
    }
    // ... rest of processing
}
```

Similar changes for `MACRO_REF_GLOBAL` tokens.

## Data Models

No new data models are required. The fix uses the existing `Token` type and diagnostic structures.



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Nested Local Macro Detection

*For any* local macro reference containing balanced backtick-apostrophe pairs at any nesting depth (1 to N levels), the `contains_nested_macro()` function SHALL return `true`.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Nested Global Macro Detection

*For any* braced global macro reference containing nested macro syntax (inner braced globals `${...}`, local macros `` `...' ``, or unbraced globals `$name`), the `contains_nested_macro()` function SHALL return `true`.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Nested Macro Diagnostic Suppression

*For any* macro reference (local or global) that contains nested macro syntax, the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 1.4, 2.4**

### Property 4: Non-Nested Invalid Character Detection

*For any* macro reference that does NOT contain nested macro syntax and contains characters outside `[A-Za-z0-9_]`, the Analyzer SHALL produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 3.1**

### Property 5: No Duplicate Diagnostics for Unbalanced Macros

*For any* macro reference with unbalanced delimiters (unmatched backticks/apostrophes or braces), the system SHALL produce at most one diagnostic (from the lexer), and the Analyzer SHALL NOT produce an additional "Invalid character in macro name" diagnostic.

**Validates: Requirements 4.1, 4.2, 4.3**

## Error Handling

1. **Unbalanced nesting**: The lexer already handles unbalanced backticks/apostrophes by emitting "Incomplete macro expression: expected closing quote". The analyzer should not add redundant diagnostics.

2. **Empty macro names**: If `extract_local_macro_name()` or `extract_global_macro_name()` returns `null` or empty string, skip all validation (existing behavior).

3. **Stored result references**: The existing `is_stored_result_reference()` check runs before the nested macro check, so stored results like `` `r(values)' `` are handled correctly.

## Testing Strategy

### Property-Based Tests

Property-based tests will use `fast-check` to generate random nested macro patterns and verify the correctness properties.

**Generators needed:**
- `arbitrary_nested_local_macro(depth: number)`: Generates nested local macros like `` `a`b`c''' ``
- `arbitrary_nested_global_macro()`: Generates nested braced globals like `${a${b}}`
- `arbitrary_mixed_nested_macro()`: Generates mixed nesting like `${a`b'}`
- `arbitrary_invalid_macro_char()`: Generates invalid characters (dots, spaces, etc.)

**Test configuration:**
- Minimum 100 iterations per property test
- Tag format: **Feature: nested-macro-invalid-char-false-positive, Property N: description**

### Unit Tests

Unit tests will cover specific examples from the requirements:
- `` `foo.bar' `` → should produce diagnostic
- `` `my var' `` → should produce diagnostic
- `${foo.bar}` → should produce diagnostic
- `${my var}` → should produce diagnostic
- `` `one`two'' `` → should NOT produce diagnostic
- `${one${two}}` → should NOT produce diagnostic
