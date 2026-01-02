# Design Document

## Overview

This design addresses a false positive diagnostic where Stata expression evaluation macro syntax like `` `=uchar(65533)' `` is incorrectly flagged as "Invalid character in macro name". The fix adds detection logic to recognize expression evaluation patterns (macros starting with `=`) within local macro reference tokens and suppress the invalid character diagnostic for these valid Stata constructs.

In Stata, the `` `=expr' `` syntax evaluates an expression and substitutes the result as a string. This is a common pattern for inline expression evaluation and is valid Stata syntax.

## Architecture

The fix is localized to the `SemanticAnalyzer` class in `src/analyzer/index.ts`. The existing `detect_undefined_references` method already has several checks to skip invalid character diagnostics for special cases (stored results, nested macros, unbalanced macros). We add a new check for expression evaluation macros.

```
┌─────────────────────────────────────────────────────────────────┐
│                    detect_undefined_references                   │
├─────────────────────────────────────────────────────────────────┤
│  For each MACRO_REF_LOCAL token:                                │
│    1. Extract macro name content                                │
│    2. Skip if stored result reference (r/e/c/s)                 │
│    3. Skip if nested macro reference                            │
│    4. Skip if unbalanced macro expression                       │
│    5. NEW: Skip if expression evaluation (starts with =)        │
│    6. Check for invalid characters → produce diagnostic         │
│    7. Check for undefined macro → produce warning               │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Component: SemanticAnalyzer

**File:** `src/analyzer/index.ts`

**New Method:**

```typescript
/**
 * Check if a local macro content represents an expression evaluation.
 * Expression evaluation macros use the `=expr' syntax where the content
 * starts with '=' followed by any valid Stata expression.
 * 
 * Examples:
 * - `=1+2' → content is "=1+2" (arithmetic expression)
 * - `=uchar(65533)' → content is "=uchar(65533)" (function call)
 * - `=string(varname)' → content is "=string(varname)" (function call)
 * - `=`a' + `b'' → content is "=`a' + `b'" (expression with nested macros)
 * 
 * @param content The extracted macro name content (without outer delimiters)
 * @returns true if the content is an expression evaluation (starts with =)
 */
private is_expression_evaluation(content: string): boolean {
    return content.startsWith('=');
}
```

**Modified Method:** `detect_undefined_references`

Add a new check before the invalid character check:

```typescript
// Skip expression evaluation macros - they use `=expr' syntax
if (macro_name && this.is_expression_evaluation(macro_name)) {
    continue;
}
```

## Data Models

No new data models are required. The fix uses the existing token structure and diagnostic types.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Expression Evaluation Macros Are Not Flagged

*For any* local macro reference whose content starts with `=` (expression evaluation syntax), the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4**

### Property 2: Non-Expression Invalid Characters Are Flagged

*For any* local macro reference that does NOT start with `=` and contains characters outside `[A-Za-z0-9_]` (excluding stored results, nested macros, and unbalanced macros), the Analyzer SHALL produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 2.1, 2.2, 2.3**

## Error Handling

No new error handling is required. The fix simply adds a condition to skip diagnostic generation for a valid syntax pattern.

## Testing Strategy

### Unit Tests

- Test that `` `=uchar(65533)' `` produces no diagnostic (original bug case)
- Test that `` `=1+2' `` produces no diagnostic
- Test that `` `=string(varname)' `` produces no diagnostic
- Test that `` `foo.bar' `` still produces invalid character diagnostic
- Test that `` `my var' `` still produces invalid character diagnostic

### Property-Based Tests

Use fast-check to generate:
1. Random expressions after `=` and verify no invalid character diagnostic
2. Random invalid macro names (not starting with `=`) and verify diagnostic is produced

**Property Test Configuration:**
- Minimum 100 iterations per property test
- Use fast-check library for property-based testing
- Tag format: **Feature: expression-macro-false-positive, Property N: description**
