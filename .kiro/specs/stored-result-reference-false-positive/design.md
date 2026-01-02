# Design Document: Stored Result Reference False Positive Fix

## Overview

This design addresses a false positive diagnostic where Stata stored result references like `` `r(values)' `` are incorrectly flagged as "Invalid character in macro name". The fix adds detection logic to recognize stored result function patterns (`r()`, `e()`, `c()`, `s()`) within local macro reference tokens and suppress the invalid character diagnostic for these valid Stata constructs.

## Architecture

The fix is localized to the Analyzer component (`src/analyzer/index.ts`), specifically in the `collect_undefined_macro_diagnostics` method. A new helper method `is_stored_result_reference` will be added to detect stored result patterns before the invalid character check is applied.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Analyzer.collect_undefined_macro_diagnostics │
├─────────────────────────────────────────────────────────────────┤
│  For each MACRO_REF_LOCAL token:                                │
│    1. Extract macro name from `name' format                     │
│    2. NEW: Check if is_stored_result_reference(name)            │
│       - If yes: skip invalid char check                         │
│       - If no: proceed with has_invalid_macro_char check        │
│    3. Check for undefined macro (existing logic)                │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Component: Analyzer

**File:** `src/analyzer/index.ts`

**New Method:**

```typescript
/**
 * Check if a macro reference content represents a stored result reference.
 * Stored results use patterns: r(name), e(name), c(name), s(name)
 * Also handles nested macros and matrix subscripts.
 * 
 * @param content - The content between backtick and apostrophe (e.g., "r(values)")
 * @returns true if this is a stored result reference pattern
 */
private is_stored_result_reference(content: string): boolean {
    // Pattern: single lowercase letter (r/e/c/s) followed by parentheses
    // The content inside parentheses can contain:
    // - Valid identifier chars [A-Za-z0-9_]
    // - Nested macro references (backticks and apostrophes)
    // - Matrix subscripts [...]
    
    // Match: r(...), e(...), c(...), s(...)
    // Case-sensitive: Stata requires lowercase r/e/c/s
    // Allow anything inside parentheses (nested macros, subscripts)
    const stored_result_pattern = /^[recs]\(.*\)(\[.*\])?$/;
    return stored_result_pattern.test(content);
}
```

**Modified Method:** `collect_undefined_macro_diagnostics`

```typescript
if (token.type === 'MACRO_REF_LOCAL') {
    const macro_name = this.extract_local_macro_name(token.value);
    
    // Skip invalid char check for stored result references
    if (macro_name && this.is_stored_result_reference(macro_name)) {
        // Stored result references like `r(values)' are valid
        // Skip both invalid char check and undefined macro check
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
    
    // ... existing undefined macro check
}
```

## Data Models

No new data models are required. The fix uses the existing `Token` type and diagnostic structures.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Stored Result References Are Not Flagged

*For any* stored result function prefix (`r`, `e`, `c`, `s`) and *for any* valid identifier, when wrapped in backtick-apostrophe syntax (e.g., `` `r(identifier)' ``), the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Non-Stored-Result Invalid Characters Are Flagged

*For any* local macro reference that does NOT match a stored result pattern and contains characters outside `[A-Za-z0-9_]`, the Analyzer SHALL produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Nested Macros in Stored Results Are Not Flagged

*For any* stored result reference containing nested macro syntax (backticks and apostrophes within the parentheses), the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 3.1, 3.2**

### Property 4: Matrix Subscripts in Stored Results Are Not Flagged

*For any* stored result reference followed by matrix subscript syntax (`[...]`), the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 4.1, 4.2**

## Error Handling

1. **Malformed stored result syntax**: If a reference starts with `r(`, `e(`, `c(`, or `s(` but has unbalanced parentheses, the regex will not match and the reference will be treated as a regular macro reference (potentially flagged for invalid chars).

2. **Case sensitivity**: The stored result pattern is case-sensitive—only lowercase `r()`, `e()`, `c()`, `s()` are valid. Uppercase variants like `R()` will be treated as regular macro references and flagged for invalid characters.

3. **Empty parentheses**: References like `` `r()' `` will match the pattern and not be flagged, which is correct as Stata allows this syntax.

## Testing Strategy

### Property-Based Tests

Use `fast-check` to generate test cases:

1. **Property 1 Test**: Generate random valid identifiers, combine with each stored result prefix, wrap in backtick-apostrophe, analyze, and verify no INVALID_MACRO_CHAR diagnostic.

2. **Property 2 Test**: Generate random strings containing invalid characters (dots, spaces, special chars) that don't match stored result patterns, wrap in backtick-apostrophe, analyze, and verify INVALID_MACRO_CHAR diagnostic is produced.

3. **Property 3 Test**: Generate stored result references with nested macro patterns, analyze, and verify no INVALID_MACRO_CHAR diagnostic.

4. **Property 4 Test**: Generate stored result references with matrix subscript patterns, analyze, and verify no INVALID_MACRO_CHAR diagnostic.

### Unit Tests

Specific examples to verify:
- `` `r(values)' `` → no diagnostic
- `` `e(N)' `` → no diagnostic
- `` `c(current_date)' `` → no diagnostic
- `` `s(macros)' `` → no diagnostic
- `` `r(table)[1,1]' `` → no diagnostic
- `` `foo.bar' `` → INVALID_MACRO_CHAR diagnostic
- `` `my var' `` → INVALID_MACRO_CHAR diagnostic

### Test Configuration

- Property tests: minimum 100 iterations
- Tag format: **Feature: stored-result-reference-false-positive, Property N: [property text]**
