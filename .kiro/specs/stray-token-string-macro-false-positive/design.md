# Design Document: Stray Token String Macro False Positive Fix

## Overview

This design addresses false positive diagnostics in the stray token detection feature where macro references inside string literals are incorrectly flagged as stray tokens. The fix modifies the parser's state machine to track string literal context and suppress stray token detection for tokens that are part of a string.

## Architecture

The fix is localized to the `parseQualifierExpressionWithStrayDetection` method in `src/parser/index.ts`. The existing state machine tracks expression states (INITIAL, AFTER_OPERAND, AFTER_COMPARE, AFTER_RHS) but doesn't account for string literal boundaries.

### Current Flow (Buggy)

```
"x == 1 & y == "`macro'""
         ↓
Lexer produces: WORD, OPERATOR, NUMBER, OPERATOR, WORD, OPERATOR, STRING("), MACRO_REF_LOCAL, STRING(")
         ↓
Parser state machine:
  - WORD(y) → AFTER_OPERAND
  - OPERATOR(==) → AFTER_COMPARE  
  - STRING(") → AFTER_RHS
  - MACRO_REF_LOCAL → AFTER_RHS, but isValidAfterComparison returns false → ERROR!
```

### Proposed Flow (Fixed)

```
"x == 1 & y == "`macro'""
         ↓
Lexer produces: WORD, OPERATOR, NUMBER, OPERATOR, WORD, OPERATOR, STRING("), MACRO_REF_LOCAL, STRING(")
         ↓
Parser state machine with string context tracking:
  - WORD(y) → AFTER_OPERAND
  - OPERATOR(==) → AFTER_COMPARE
  - STRING(") → AFTER_RHS, enter string context (quote-only STRING)
  - MACRO_REF_LOCAL → in string context, skip stray token check
  - STRING(") → exit string context
```

## Components and Interfaces

### Modified Component: `parseQualifierExpressionWithStrayDetection`

Add a boolean flag `in_string_context` to track whether we're inside a string literal that was opened by a delimiter-only STRING token.

```typescript
private parseQualifierExpressionWithStrayDetection(
  qualifier_type: 'if' | 'in',
  stop_at_in: boolean,
  check_empty: boolean
): string {
  // ... existing code ...
  
  // NEW: Track string context for embedded macro handling
  // This handles both double-quoted ("...") and compound (`"..."') strings
  let in_string_context = false;
  
  while (!this.isAtEnd()) {
    const token = this.peek();
    
    // ... existing paren tracking ...
    
    // NEW: Track string context
    // A STRING token that is just a delimiter indicates entering/exiting
    // a string with embedded macros
    if (this.isStringDelimiterOnly(token)) {
      in_string_context = !in_string_context;
    }
    
    // Stray token detection - skip if in string context
    if (current_state === 'AFTER_RHS' && 
        token.type !== 'LPAREN' && 
        token.type !== 'RPAREN' &&
        !in_string_context) {  // NEW: Skip check when in string context
      // ... existing stray token detection ...
    }
    
    // ... rest of existing code ...
  }
}
```

### New Helper Method: `isStringDelimiterOnly`

```typescript
/**
 * Check if a STRING token is just a string delimiter (opening or closing).
 * This indicates a string with embedded macros, where the lexer splits
 * the string into delimiter + macro + delimiter tokens.
 * 
 * Stata string delimiters:
 * - Double-quoted: " (opening), " (closing)
 * - Compound: `" (opening), "' (closing)
 * - Nested compound: `"`" (opening), "'"' (closing), etc.
 * 
 * A STRING token is delimiter-only if it matches one of:
 * - Simple double-quote: " (serves as both opening and closing)
 * - Compound opening: `"
 * - Compound closing: "'
 * - Nested compound opening: `"`", `"`"`", etc.
 * - Nested compound closing: "'"', "'"'"', etc.
 */
private isStringDelimiterOnly(token: Token): boolean {
  if (token.type !== 'STRING') {
    return false;
  }
  
  const value = token.value;
  
  // Check for simple double-quote delimiter (both opening and closing)
  if (value === '"') {
    return true;
  }
  
  // Check for compound string opening delimiter: `"
  if (value === '`"') {
    return true;
  }
  
  // Check for compound string closing delimiter: "'
  if (value === `"'`) {
    return true;
  }
  
  // Check for nested compound string delimiters
  // Opening: `"`", `"`"`", etc. (pattern: (`")+)
  // Closing: "'"', "'"'"', etc. (pattern: ("')+)
  const opening_pattern = /^(`")+$/;
  const closing_pattern = /^("')+$/;
  
  if (opening_pattern.test(value) || closing_pattern.test(value)) {
    return true;
  }
  
  return false;
}
```

## Data Models

No new data models required. The fix uses a simple boolean flag for string context tracking.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: String Literal Macro Suppression

*For any* valid condition expression containing a string literal with embedded macro references (local or global), the parser SHALL NOT emit any STRAY_TOKEN_IN_CONDITION diagnostics for tokens within the string literal.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Stray Token Detection Preservation

*For any* condition expression containing a genuine stray token (an identifier after a comparison that is not part of a string literal and is not a logical operator), the parser SHALL emit a STRAY_TOKEN_IN_CONDITION diagnostic.

**Validates: Requirements 3.1, 3.2**

### Property 3: Split Literal Detection Preservation

*For any* condition expression containing a split literal pattern (e.g., `. 5` instead of `.5`), the parser SHALL emit a SPLIT_LITERAL_IN_CONDITION diagnostic.

**Validates: Requirements 3.3**

## Error Handling

The fix is defensive:
- If the string context flag gets out of sync (e.g., unbalanced quotes), the worst case is that some stray tokens inside malformed strings might not be detected
- This is acceptable because malformed strings will likely produce other parse errors
- The flag is reset at the start of each qualifier expression parse

## Testing Strategy

### Unit Tests

- Test the exact case from the bug report: `x == 1 & program == "\`program'" & level == "births"`
- Test global macro in string: `x == 1 & y == "$macro"`
- Test multiple string comparisons: `x == "\`a'" & y == "\`b'"`
- Test simple strings (no embedded macros): `x == "hello" & y == "world"`
- Regression tests for existing stray token detection

### Property-Based Tests

- Library: fast-check (already in project)
- Minimum iterations: 100 per property
- Tag format: `**Feature: stray-token-string-macro-false-positive, Property N: {property_text}**`

**Property Test 1: String Literal Macro Suppression**
- Generate random condition expressions with string literals containing embedded macros
- Verify no STRAY_TOKEN_IN_CONDITION diagnostics are emitted

**Property Test 2: Stray Token Detection Preservation**
- Generate random condition expressions with genuine stray tokens (outside strings)
- Verify STRAY_TOKEN_IN_CONDITION diagnostics are emitted

**Property Test 3: Split Literal Detection Preservation**
- Generate random condition expressions with split literal patterns
- Verify SPLIT_LITERAL_IN_CONDITION diagnostics are emitted
