# Design Document: Continuation Line Parenthesis Tracking

## Overview

This design addresses a false positive diagnostic issue where the LSP incorrectly reports "Unbalanced parentheses: missing closing parenthesis" when parentheses span across line continuations using `///`. The root cause is that several parser methods stop parsing at `CONTINUATION` tokens (via `isTrivia()`) or `STATEMENT_TERMINATOR` tokens without properly handling the continuation case, causing premature parenthesis balance checks.

### Problem Analysis

The issue occurs in multiple parser methods:

1. **`parseExpression()`** (lines 2140-2188): Stops at trivia (which includes `CONTINUATION`) without continuing to parse the next line
2. **`parseIfStatement()`** (lines 1556-1605): Correctly handles continuations before `STATEMENT_TERMINATOR` but the condition parsing loop may still exit early
3. **`parseQualifierExpressionWithStrayDetection()`** (lines 2208-2364): Correctly handles `CONTINUATION` tokens by skipping them and the following `STATEMENT_TERMINATOR`

The fix needs to ensure all expression-parsing methods properly continue parsing across `///` continuations.

### Example

```stata
if (this & (that | ///
    also))
```

Currently, when the parser encounters `///` on line 1, it may stop parsing and check parenthesis balance, finding 2 open parens and 0 close parens, triggering the false positive.

## Architecture

The fix involves modifying the parser's expression-parsing methods to:

1. Not treat `CONTINUATION` as a stop condition
2. When encountering `STATEMENT_TERMINATOR`, check if it was preceded by a `CONTINUATION` token
3. If so, skip the terminator and continue parsing the next line
4. Only check parenthesis balance after the entire logical line has been parsed

### Affected Methods

| Method | Current Behavior | Required Change |
|--------|------------------|-----------------|
| `parseExpression()` | Stops at `isTrivia()` which includes `CONTINUATION` | Skip `CONTINUATION` and following `STATEMENT_TERMINATOR`, continue parsing |
| `parseIfStatement()` | Handles continuation before `STATEMENT_TERMINATOR` | Ensure continuation tokens themselves are handled in the loop |
| `parseWhileStatement()` | Similar to `parseIfStatement()` | Same fix pattern |
| `parse_macro_def()` | Stops at `isTrivia()` | Skip `CONTINUATION` and following `STATEMENT_TERMINATOR` |

## Components and Interfaces

### Modified Parser Methods

#### `parseExpression()` Changes

```typescript
parseExpression(): string {
  let expression = '';
  let paren_depth = 0;
  const start_pos = this.current;

  while (!this.isAtEnd()) {
    const token = this.peek();

    // Handle continuation tokens - skip them and continue parsing
    if (token.type === 'CONTINUATION') {
      this.advance(); // consume continuation
      // Skip the following statement terminator if present
      if (this.check('STATEMENT_TERMINATOR')) {
        this.advance();
      }
      continue;
    }

    // Track parenthesis depth
    if (token.type === 'LPAREN') {
      paren_depth++;
    } else if (token.type === 'RPAREN') {
      paren_depth--;
      if (paren_depth < 0) {
        this.addError('Unbalanced parentheses: unexpected closing parenthesis', 
          token.range, ParseErrorCode.UNBALANCED_PARENTHESES);
        paren_depth = 0;
      }
    }

    // Stop at top-level comma, statement terminator, or qualifier keywords
    if (paren_depth === 0) {
      if (token.type === 'COMMA' || token.type === 'STATEMENT_TERMINATOR') {
        break;
      }
      if (token.type === 'WORD' && (token.value === 'if' || token.value === 'in')) {
        break;
      }
    }

    // Stop at comments (but not continuations - handled above)
    if (token.type === 'COMMENT_LINE' || token.type === 'COMMENT_BLOCK') {
      break;
    }

    const tokenValue = this.advance().value;
    if (token.type === 'WHITESPACE') {
      expression += ' ';
    } else {
      expression += tokenValue;
    }
  }

  // Check for unbalanced parentheses (only after entire logical line parsed)
  if (paren_depth > 0) {
    const end_pos = this.current > 0 ? this.previous().range : this.peek().range;
    this.addError('Unbalanced parentheses: missing closing parenthesis', 
      end_pos, ParseErrorCode.UNBALANCED_PARENTHESES);
  }

  return expression.trim();
}
```

#### `parse_macro_def()` Changes

Similar pattern - handle `CONTINUATION` tokens explicitly before the trivia check:

```typescript
while (!this.check('STATEMENT_TERMINATOR') && !this.isAtEnd() && !this.isTrivia()) {
  const token = this.peek();
  
  // Handle continuation tokens - skip them and continue parsing
  if (token.type === 'CONTINUATION') {
    this.advance(); // consume continuation
    // Skip the following statement terminator if present
    if (this.check('STATEMENT_TERMINATOR')) {
      this.advance();
    }
    continue;
  }
  
  // ... rest of existing logic
}
```

### Helper Method

Consider adding a helper method to standardize continuation handling:

```typescript
/**
 * Skip continuation token and its following statement terminator.
 * Returns true if a continuation was skipped, false otherwise.
 */
private skipContinuation(): boolean {
  if (this.check('CONTINUATION')) {
    this.advance(); // consume continuation
    if (this.check('STATEMENT_TERMINATOR')) {
      this.advance(); // skip newline after continuation
    }
    return true;
  }
  return false;
}
```

## Data Models

No new data models required. The existing token types and parser error codes are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Parenthesis Balance Across Continuations

*For any* valid Stata expression with balanced parentheses that spans multiple physical lines via `///` continuations, the parser SHALL NOT emit an unbalanced parenthesis diagnostic.

**Validates: Requirements 1.1, 1.2**

### Property 2: Genuine Unbalanced Parentheses Detection

*For any* Stata expression with genuinely unbalanced parentheses (missing opener or closer even after all continuations are resolved), the parser SHALL emit exactly one unbalanced parenthesis diagnostic per unmatched parenthesis.

**Validates: Requirements 1.3, 1.4**

### Property 3: Diagnostic Position Accuracy

*For any* unbalanced parenthesis diagnostic emitted for a multi-line expression, the diagnostic range SHALL reference the position of the unmatched parenthesis token.

**Validates: Requirements 2.1, 2.2**

### Property 4: All Bracket Types Across Continuations

*For any* valid Stata expression with balanced brackets (parentheses, square brackets, or curly braces) that spans multiple physical lines via `///` continuations, the parser SHALL NOT emit an unbalanced bracket diagnostic for that bracket type.

**Validates: Requirements 3.1, 3.2, 3.3**

## Error Handling

1. **Continuation at end of file**: If a `///` continuation appears at the end of file without a following line, the parser should handle this gracefully (the lexer already handles this case).

2. **Nested continuations**: Multiple consecutive continuation lines should all be handled correctly.

3. **Mixed content after continuation**: Content after `///` on the same line is part of the continuation comment and should be ignored.

## Testing Strategy

### Property-Based Tests

Use fast-check to generate:
- Random balanced expressions with continuations at various points
- Random unbalanced expressions to verify detection still works
- Expressions with mixed bracket types
- Deeply nested expressions spanning many continuation lines

### Unit Tests

Specific test cases:
- Simple `if (a | /// \n b)` pattern
- Nested `if ((a & (b | /// \n c)) | d)`
- Multiple continuations `if (a /// \n | b /// \n | c)`
- Genuinely unbalanced `if (a | /// \n b` (missing closer)
- Square brackets `gen x = y[1 /// \n + 2]`
- Mixed brackets `if (a[1 /// \n ] & b)`

### Integration Tests

Test with real-world Stata code patterns that use continuations in complex expressions.
