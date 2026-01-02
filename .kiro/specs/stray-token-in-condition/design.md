# Design Document: Stray Token Detection in Conditions

## Overview

This feature adds diagnostic detection for stray tokens that appear after comparison expressions in `if` and `in` qualifier conditions. The implementation extends the existing parser's `parseIfQualifierExpression()` and `parseInQualifierExpression()` methods to detect syntactically invalid token sequences that would cause Stata runtime errors.

The core insight is that after a complete comparison expression (e.g., `x == y`), only certain tokens are valid continuations:
- Logical operators (`&`, `|`)
- Closing parenthesis `)` (if inside parens)
- Opening brace `{` (for brace-style blocks like `if x == y { ... }`)
- Statement terminators (comma, newline, semicolon)
- The `in` keyword (for `if` qualifiers only)
- Comments (trivia)

Any other token (identifier, number, unexpected operator) is a stray token that indicates a syntax error.

## Architecture

The feature integrates into the existing parsing pipeline:

```
Source Code → Lexer → Parser → Diagnostics Provider → LSP Response
                        ↓
              parseIfQualifierExpression()
                        ↓
              Stray Token Detection (NEW)
                        ↓
              ParseError with STRAY_TOKEN_IN_CONDITION code
```

### Design Decision: Parser-Level Detection

We implement stray token detection in the parser rather than as a separate analyzer pass because:

1. The parser already tracks parenthesis depth and expression boundaries
2. Token-level analysis is needed to distinguish valid operators from stray tokens
3. Errors can be reported with precise token ranges
4. The existing `parseIfQualifierExpression()` method is the natural extension point

## Components and Interfaces

### Modified Component: StataParser

The `StataParser` class in `src/parser/index.ts` will be extended with:

1. **Enhanced `parseIfQualifierExpression()`**: Adds state machine to track expression structure and detect stray tokens after comparisons.

2. **Enhanced `parseInQualifierExpression()`**: Same enhancement for `in` qualifiers.

3. **New helper method `isComparisonOperator()`**: Identifies comparison operators (`==`, `!=`, `~=`, `<`, `>`, `<=`, `>=`).

4. **New helper method `isLogicalOperator()`**: Identifies logical operators (`&`, `|`).

5. **New helper method `isValidAfterComparison()`**: Determines if a token is valid after a comparison expression (includes `)`, `{`, `&`, `|`, terminators, `in`, trivia).

### Interface Changes

```typescript
// New error code in ParseErrorCode enum (src/types/index.ts)
export enum ParseErrorCode {
  // ... existing codes ...
  STRAY_TOKEN_IN_CONDITION = 3013,
}
```

### Expression State Machine

The parser tracks expression state to detect stray tokens:

```
States:
  INITIAL        - Start of expression or after logical operator
  AFTER_OPERAND  - After identifier, number, macro, or closing paren
  AFTER_COMPARE  - After comparison operator
  AFTER_RHS      - After right-hand side of comparison (CRITICAL STATE)
  
Transitions:
  INITIAL → AFTER_OPERAND (on identifier/number/macro/lparen)
  AFTER_OPERAND → AFTER_COMPARE (on comparison operator)
  AFTER_COMPARE → AFTER_RHS (on identifier/number/macro/lparen)
  AFTER_RHS → INITIAL (on logical operator & or |)
  AFTER_RHS → VALID_END (on ), {, comma, terminator, 'in', trivia)
  AFTER_RHS → ERROR (on identifier/number - STRAY TOKEN!)
  
Special cases:
  - Nested parentheses: opening ( resets to INITIAL inside, closing ) returns to AFTER_OPERAND
  - Negation (!, ~) resets to INITIAL
  - Arithmetic operators (+, -, *, /) transition AFTER_OPERAND → INITIAL (expect another operand)
  - Opening brace { is valid after comparison (brace-style blocks)
```

## Data Models

### Stray Token Diagnostic

```typescript
interface StrayTokenDiagnostic {
  message: string;           // "Unexpected token 'oops' after comparison expression"
  range: Range;              // Range of the stray token
  code: ParseErrorCode;      // STRAY_TOKEN_IN_CONDITION
  suggestion?: string;       // "Did you mean to use '&' or '|'?"
}
```

### Expression Context

```typescript
interface ExpressionParseContext {
  state: 'INITIAL' | 'AFTER_OPERAND' | 'AFTER_COMPARE' | 'AFTER_RHS';
  paren_depth: number;
  last_comparison_token?: Token;  // For error message context
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the acceptance criteria have been consolidated into five non-redundant properties:

### Property 1: Stray Token Detection After Comparison

*For any* condition expression containing a comparison (using any operator: `==`, `!=`, `~=`, `<`, `>`, `<=`, `>=`) followed by an identifier that is not a logical operator (`&`, `|`), the parser SHALL emit a STRAY_TOKEN_IN_CONDITION diagnostic.

This property covers both parenthesized (`if (x == y oops)`) and unparenthesized (`if x == y oops`) forms, and all comparison operators.

**Validates: Requirements 1.1, 1.2, 2.1, 2.2, 6.1, 6.2, 6.3, 6.4**

### Property 2: Valid Expression Acceptance

*For any* condition expression that is syntactically valid—including compound expressions with logical operators (`&`, `|`), arithmetic operators (`+`, `-`, `*`, `/`), negation (`!`, `~`), function calls, and nested parentheses—the parser SHALL NOT emit a stray token diagnostic.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3**

### Property 3: Diagnostic Message Quality

*For any* detected stray token, the diagnostic message SHALL:
1. Include the unexpected token text
2. Suggest possible fixes (e.g., "Did you mean to use '&' or '|'?")
3. Highlight only the stray token range, not the entire condition

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 4: Split Literal Detection

*For any* condition expression where tokens that could form a single literal are separated by whitespace, the parser SHALL emit a diagnostic suggesting they may have been intended as a single token. This includes:
- `. N` (dot space number) → suggests `.N` (decimal)
- `. a` through `. z` (dot space letter) → suggests `.a`-`.z` (extended missing value)
- `N .` (number space dot) → suggests `N.` or warns about stray dot
- `a .` (identifier space dot) → warns about potential split

**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

### Property 5: Continuation Line Handling

*For any* condition expression spanning multiple lines via `///` continuation, the parser SHALL correctly analyze the complete expression and detect stray tokens as if the expression were on a single line.

**Validates: Requirements 8.1, 8.2, 8.3**

## Error Handling

### Graceful Degradation

- If expression parsing encounters unexpected token sequences, continue parsing to find additional errors
- Don't let stray token detection interfere with other diagnostic collection
- Preserve existing unbalanced parenthesis detection

### Edge Cases

1. **Empty expressions**: Already handled by existing code
2. **Macro references in expressions**: Treat as operands (valid)
3. **Function calls**: Parenthesized expressions are valid operands
4. **String comparisons**: Same rules apply as numeric comparisons
5. **Missing values (`.`, `.a`-`.z`)**: Valid operands, but `. 9` is split literal

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required for comprehensive coverage:
- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs using fast-check

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Basic stray token cases**:
   - `if (x == y oops)` → diagnostic on `oops`
   - `if x == y oops` → diagnostic on `oops`
   - `replace x = y if z == 0 oops` → diagnostic on `oops`

2. **Valid compound expressions (no diagnostic)**:
   - `if (x == 1 & y == 2)`
   - `if (x == 1 | y == 2)`
   - `if (x + 1 == y)`
   - `if !(x == y)`

3. **Split literal cases**:
   - `if (x != . 9)` → diagnostic suggesting `.9`
   - `if (x != . a)` → diagnostic suggesting `.a` (extended missing)
   - `if (x != 9 .)` → diagnostic about potential split
   - `if (x != a .)` → diagnostic about potential split

4. **Multi-line with continuation** (specific test case from requirements):
   ```stata
   replace x = y if z1 == 0 & z2 == 0 & z3 == 0 & /// stuff
                       (x3 == 0 & z4 != 0 & z5 != . 9)
   ```

5. **Edge cases**:
   - Multiple stray tokens: `if (x == y foo bar)` → diagnostic on `foo`
   - Keyword as stray token: `if (x == y and)` → diagnostic on `and`
   - Function calls: `if (strlen(x) == 5)` → no diagnostic
   - Nested parentheses: `if ((x == 1) & (y == 2))` → no diagnostic

### Property-Based Tests

Property tests use fast-check to verify universal properties. Each property test must run minimum 100 iterations.

**Test Configuration**:
- Library: fast-check (already in project)
- Minimum iterations: 100 per property
- Tag format: `**Feature: stray-token-in-condition, Property N: {property_text}**`

**Property Test 1: Stray Token Detection**
- Generate: Random comparison expressions with any operator, followed by random identifier
- Verify: Parser emits STRAY_TOKEN_IN_CONDITION diagnostic
- Covers: Requirements 1.1, 2.1, 6.1-6.4

**Property Test 2: Valid Expression Acceptance**
- Generate: Random valid compound expressions with &, |, arithmetic, negation
- Verify: Parser does NOT emit stray token diagnostic
- Covers: Requirements 3.1, 3.4, 4.1

**Property Test 3: Diagnostic Message Quality**
- Generate: Random stray token scenarios
- Verify: Message contains token text, suggestion, and range matches token
- Covers: Requirements 5.1, 5.2, 5.3

**Property Test 4: Split Literal Detection**
- Generate: Expressions with split literal patterns (`. N`, `. a`, `N .`, `a .`)
- Verify: Diagnostic emitted with appropriate suggestion
- Covers: Requirements 7.1-7.6

**Property Test 5: Continuation Line Handling**
- Generate: Expressions with `///` continuations containing stray tokens
- Verify: Stray tokens still detected
- Covers: Requirements 8.1, 8.2
