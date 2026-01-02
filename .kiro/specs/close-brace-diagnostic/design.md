# Design Document: Close Brace Diagnostic

## Overview

This design adds diagnostics to detect Stata's brace placement rules in the parser. The implementation extends the existing parser to emit errors when braces are incorrectly placed, leveraging the already-defined error codes `BRACE_NOT_ALONE` (3002) and `BRACE_ELSE_SAME_LINE` (3001).

The key insight is that brace validation requires line-awareness during parsing - we need to know whether tokens are on the same line as braces to detect violations.

## Architecture

The brace validation logic will be added to the parser (`src/parser/index.ts`) since:
1. The parser already handles brace-delimited blocks (if, else, foreach, forvalues, while)
2. The parser has access to token ranges which include line numbers
3. The error codes are already defined as `ParseErrorCode` values

```
Tokens → Parser → AST + ParseErrors (including brace placement errors)
                      ↓
              DiagnosticsProvider → LSP Diagnostics
```

## Components and Interfaces

### Parser Extensions

The parser will be extended with helper methods for brace validation:

```typescript
class StataParser {
  // Existing methods...
  
  /**
   * Check if two tokens are on the same line.
   */
  private are_on_same_line(token1: Token, token2: Token): boolean;
  
  /**
   * Check if there are non-trivia tokens after the given position on the same line.
   * Returns the first non-trivia token if found, null otherwise.
   */
  private find_code_after_on_same_line(start_pos: number, line: number): Token | null;
  
  /**
   * Check if there are non-trivia tokens before the given position on the same line.
   * Returns the last non-trivia token if found, null otherwise.
   */
  private find_code_before_on_same_line(end_pos: number, line: number): Token | null;
  
  /**
   * Validate open brace placement and emit diagnostics if invalid.
   * Called when consuming an LBRACE token.
   */
  private validate_open_brace(brace_token: Token): void;
  
  /**
   * Validate close brace placement and emit diagnostics if invalid.
   * Called when consuming an RBRACE token.
   */
  private validate_close_brace(brace_token: Token): void;
}
```

### New Error Code

A new error code is needed for open brace placement:

```typescript
export enum ParseErrorCode {
  // Existing codes...
  BRACE_ELSE_SAME_LINE = 3001,
  BRACE_NOT_ALONE = 3002,
  // New code for open brace alone on line
  OPEN_BRACE_ALONE = 3004,
  // New code for code after open brace
  CODE_AFTER_OPEN_BRACE = 3006,
}
```

### Diagnostic Messages

| Error Code | Message |
|------------|---------|
| BRACE_NOT_ALONE (code after) | "code follows on the same line as close brace" |
| BRACE_NOT_ALONE (code before) | "close brace must be alone on its line" |
| BRACE_ELSE_SAME_LINE | "else must appear on a separate line from close brace" |
| OPEN_BRACE_ALONE | "open brace must be on the same line as the condition" |
| CODE_AFTER_OPEN_BRACE | "code after open brace may be silently ignored" |

## Data Models

No new data models are required. The existing `ParseError` interface is sufficient:

```typescript
interface ParseError {
  message: string;
  range: Range;
  code: ParseErrorCode;
}
```

The `Range` will be computed based on the violation type:
- Code after close brace: from `}` to end of offending code
- Code before close brace: from start of offending code to `}`
- `} else` on same line: from `}` to `else`
- Open brace alone: just the `{` token
- Code after open brace: from `{` to end of offending code

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Close Brace Not Alone Detection

*For any* Stata document containing a closing brace `}` with non-trivia tokens on the same line (either before or after the brace), the parser SHALL emit a diagnostic with code `BRACE_NOT_ALONE` (3002).

**Validates: Requirements 1.1, 2.1**

### Property 2: Valid Close Brace Placement

*For any* Stata document containing a closing brace `}` that is alone on its line (only whitespace/comments before and after), the parser SHALL NOT emit a `BRACE_NOT_ALONE` diagnostic.

**Validates: Requirements 1.2, 1.3, 2.2**

### Property 3: Else Same Line Detection

*For any* Stata document containing `} else` on the same line, the parser SHALL emit a diagnostic with code `BRACE_ELSE_SAME_LINE` (3001).

**Validates: Requirements 3.1**

### Property 4: Valid Else Placement

*For any* Stata document containing `}` on one line and `else` on the following line, the parser SHALL NOT emit a `BRACE_ELSE_SAME_LINE` diagnostic.

**Validates: Requirements 3.2**

### Property 5: Open Brace Alone Detection

*For any* Stata document containing an opening brace `{` that is alone on its line (not on the same line as a condition), the parser SHALL emit a diagnostic with code `OPEN_BRACE_ALONE`.

**Validates: Requirements 4.1**

### Property 6: Valid Open Brace Placement

*For any* Stata document containing an opening brace `{` on the same line as the condition (e.g., `if (1 == 1) {`), the parser SHALL NOT emit an `OPEN_BRACE_ALONE` diagnostic.

**Validates: Requirements 4.2**

### Property 7: Code After Open Brace Detection

*For any* Stata document containing an opening brace `{` followed by non-trivia tokens on the same line, the parser SHALL emit a warning diagnostic with code `CODE_AFTER_OPEN_BRACE`.

**Validates: Requirements 5.1, 5.4**

### Property 8: Diagnostic Range Accuracy

*For any* brace placement diagnostic, the range SHALL accurately span the relevant tokens:
- For code after close brace: from `}` to end of offending code
- For code before close brace: from start of offending code to `}`
- For `} else`: from `}` to `else`
- For open brace alone: the `{` token
- For code after open brace: from `{` to end of offending code

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

## Error Handling

### Edge Cases

1. **Nested braces**: Each brace is validated independently. Inner braces follow the same rules.

2. **Braces in strings**: The lexer handles string tokenization, so braces inside strings are not seen as LBRACE/RBRACE tokens.

3. **Braces in comments**: Similarly, braces in comments are part of comment tokens.

4. **Multiple violations on one line**: Each violation generates its own diagnostic. For example, `} else {di 3}` would generate:
   - BRACE_ELSE_SAME_LINE for `} else`
   - CODE_AFTER_OPEN_BRACE for `{di 3`
   - BRACE_NOT_ALONE for `3}`

5. **Empty blocks**: `if (1) { }` - the `}` is alone on its conceptual "content", but if on same line as `{`, both braces have issues.

6. **Continuation lines**: Lines joined by `///` are treated as separate lines for brace validation purposes, matching Stata's behavior.

## Testing Strategy

### Unit Tests

Unit tests will cover specific examples and edge cases:

1. Valid brace placement (no diagnostics)
2. Code after close brace (BRACE_NOT_ALONE)
3. Code before close brace (BRACE_NOT_ALONE)
4. `} else` on same line (BRACE_ELSE_SAME_LINE)
5. Open brace alone on line (OPEN_BRACE_ALONE)
6. Code after open brace (CODE_AFTER_OPEN_BRACE)
7. Nested blocks with violations
8. Multiple violations in one document
9. Braces in strings (no false positives)
10. Braces in comments (no false positives)

### Property-Based Tests

Property-based tests will use fast-check to verify the correctness properties:

1. Generate random valid Stata blocks → verify no brace diagnostics
2. Generate blocks with `}` followed by code → verify BRACE_NOT_ALONE emitted
3. Generate blocks with code before `}` → verify BRACE_NOT_ALONE emitted
4. Generate if/else with `} else` on same line → verify BRACE_ELSE_SAME_LINE emitted
5. Generate blocks with `{` alone on line → verify OPEN_BRACE_ALONE emitted
6. Generate blocks with code after `{` → verify CODE_AFTER_OPEN_BRACE emitted

Each property test will run minimum 100 iterations.

**Test Configuration:**
- Framework: Jest with fast-check
- Tag format: `Feature: close-brace-diagnostic, Property N: <property_text>`
