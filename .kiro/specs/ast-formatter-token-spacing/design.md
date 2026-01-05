# Design Document: AST Formatter Token Spacing

## Overview

This feature adds intelligent token spacing to the AST formatter (PrettyPrinter) to produce properly spaced output. Currently, when the parser builds expression strings by concatenating token values, no spaces are added between operators and operands, resulting in expressions like `y+z` instead of `y + z`.

The solution involves creating a token spacing utility that can be applied to expression strings in the PrettyPrinter. This utility will parse the expression and insert appropriate spaces based on token context, while preserving content inside string literals and nested macro references.

**Scope:** This feature applies only to the AST formatter (PrettyPrinter). The source-preserving formatter already works correctly and does not modify whitespace except at line boundaries.

## Architecture

The token spacing logic will be implemented as a standalone utility function that can be called by the PrettyPrinter when outputting expressions. This keeps the PrettyPrinter focused on AST traversal while delegating spacing decisions to a specialized module.

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  PrettyPrinter  │────▶│  Token Spacing Util  │────▶│  Spaced Output  │
│  (AST nodes)    │     │  (expression string) │     │  (formatted)    │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

## Components and Interfaces

### Token Spacing Utility

A new utility function `format_expression_spacing` will be added to the pretty-printer module:

```typescript
/**
 * Format an expression string with proper token spacing.
 * 
 * @param expression - The raw expression string (may have missing spaces)
 * @returns The expression with proper spacing applied
 */
function format_expression_spacing(expression: string): string
```

### Token Classification

The utility needs to classify tokens to determine spacing rules:

```typescript
type TokenCategory = 
  | 'binary_operator'      // +, -, *, /, ^, ==, !=, <, >, <=, >=, &, |, =
  | 'unary_operator'       // !, ~, unary -
  | 'open_paren'           // (
  | 'close_paren'          // )
  | 'open_bracket'         // [
  | 'close_bracket'        // ]
  | 'open_brace'           // {
  | 'close_brace'          // }
  | 'comma'                // ,
  | 'colon'                // :
  | 'keyword'              // of, in (in list context)
  | 'identifier'           // variable names, function names
  | 'number'               // numeric literals
  | 'string'               // string literals (skip content)
  | 'macro_ref'            // `name' (simple local macro)
  | 'nested_macro'         // `x`y'', ${`x'`y'} (skip content)
  | 'compound_string'      // `"..."' (skip content)
```

### Protected Content Detection

The utility must identify and skip content that should not be modified:

```typescript
/**
 * Regions of the expression that should not have spacing modified.
 * These include string literals, nested macros, and compound strings.
 */
interface ProtectedRegion {
  start: number;
  end: number;
  type: 'string' | 'nested_macro' | 'compound_string';
}

/**
 * Identify all protected regions in an expression.
 * Content within these regions is preserved exactly as-is.
 */
function find_protected_regions(expression: string): ProtectedRegion[]
```

Protected content patterns:
- Double-quoted strings: `"..."` 
- Compound strings: `` `"..."' ``
- Nested local macros: `` `x`y'' ``, `` `x`y`z''' ``
- Global macros with nested content: `${`x'`y'}`

Simple macro references like `` `x' `` are NOT protected - they are treated as single tokens and spacing can be added around them (e.g., `` `x'+`y' `` → `` `x' + `y' ``).

### Spacing Rules Engine

The spacing rules will be encoded as a decision function:

```typescript
interface SpacingDecision {
  space_before: boolean;
  space_after: boolean;
}

function get_spacing(
  current: TokenCategory,
  previous: TokenCategory | null,
  next: TokenCategory | null,
  context: SpacingContext
): SpacingDecision
```

### Context Tracking

Some spacing decisions depend on context:

```typescript
interface SpacingContext {
  in_function_call: boolean;      // After function name, before (
  in_extended_macro: boolean;     // Inside : ... syntax
  after_by_prefix: boolean;       // After by/bysort varlist
  at_expression_start: boolean;   // For unary operator detection
  after_operator: boolean;        // For unary operator detection
}
```

## Data Models

### Spacing Rules Table

The spacing rules can be represented as a lookup table:

| Current Token | Previous Token | Space Before | Space After | Notes |
|--------------|----------------|--------------|-------------|-------|
| binary_operator | any | yes | yes | +, -, *, /, ^, ==, etc. |
| unary_operator | start/operator | no | no | !, ~, unary - |
| open_paren | identifier | no | no | function call |
| open_paren | other | context | no | grouping |
| close_paren | any | no | context | |
| comma | any | no | yes | |
| open_bracket | any | no | no | subscript |
| close_bracket | any | no | context | |
| open_brace | any | yes | no | block delimiter |
| close_brace | any | no | no | |
| colon (extended) | any | yes | yes | in extended macro |
| colon (by-prefix) | any | no | yes | after by varlist |
| keyword (of/in) | any | yes | yes | in list expressions |

### Unary vs Binary Operator Detection

The minus operator requires special handling to distinguish unary from binary:

```typescript
function is_unary_minus(previous: TokenCategory | null): boolean {
  // Unary if at start or after operator/open delimiter
  return previous === null 
    || previous === 'binary_operator'
    || previous === 'unary_operator'
    || previous === 'open_paren'
    || previous === 'open_bracket'
    || previous === 'comma';
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 0: Protected Content Preservation

*For any* expression containing string literals, compound strings, or nested macro references, the formatted output SHALL preserve the exact content within these protected regions unchanged.

**Validates: Requirements 0.1, 0.2, 0.3**

### Property 1: Binary Operator Spacing

*For any* expression containing binary operators (+, -, *, /, ^, ==, !=, <, >, <=, >=, &, |, =), the formatted output SHALL have exactly one space before and after each binary operator.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Parenthesis Internal Spacing

*For any* expression containing parentheses, the formatted output SHALL NOT have a space immediately after an opening parenthesis or immediately before a closing parenthesis.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Comma Spacing

*For any* expression containing commas, the formatted output SHALL have exactly one space after each comma and no space before each comma.

**Validates: Requirements 3.1, 3.2**

### Property 4: Keyword Spacing

*For any* extended macro function containing the keywords "of" or "in", the formatted output SHALL have exactly one space before and after the keyword.

**Validates: Requirements 4.1, 4.2**

### Property 5: Bracket Spacing

*For any* expression containing square brackets (subscripts), the formatted output SHALL NOT have spaces immediately inside the brackets (no space after `[` or before `]`) and no space before the opening bracket.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 6: Colon Spacing

*For any* extended macro function containing a colon, the formatted output SHALL have spaces around the colon. *For any* by-prefix command, the colon SHALL have no space before it and one space after it.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 7: Curly Brace Spacing

*For any* control flow statement with curly braces, the formatted output SHALL have one space before the opening brace and no spaces immediately inside the braces.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 8: Unary Operator Spacing

*For any* expression containing unary operators (!, ~, or unary -), the formatted output SHALL NOT have a space between the operator and its operand.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 9: Bounds Safety

*For any* expression string including empty strings, single characters, and strings ending with special characters ($, ", backtick), the formatting utility SHALL complete without throwing array index errors.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 10: Case-Sensitive Keyword Matching

*For any* token that matches a keyword pattern, the formatting utility SHALL only classify it as a keyword if it matches exactly in lowercase (e.g., "of" and "in" are keywords, but "OF", "In", "OF" are not).

**Validates: Requirements 10.1, 10.2, 10.3**

## Error Handling

### Malformed Expressions

If the expression string is malformed (unbalanced delimiters, invalid tokens), the utility should:
1. Return the original expression unchanged
2. Not throw exceptions
3. Log a warning for debugging

### Edge Cases

- Empty expressions: Return empty string
- Whitespace-only expressions: Return trimmed result
- Already properly spaced: Return unchanged (idempotency)
- Nested structures: Handle recursively with proper context tracking
- Unbalanced quotes/macros: Preserve original to avoid corruption

## Testing Strategy

### Unit Tests

Unit tests will cover specific examples and edge cases:
- Empty and whitespace-only expressions
- Single-token expressions
- Expressions with only operators
- Deeply nested parentheses
- Mixed operator types
- Simple macro references in expressions (`` `x' + `y' ``)
- Nested macro references (preserved: `` `x`y'' ``)
- String literals containing operators (preserved: `"a + b"`)
- Compound strings (preserved: `` `"a + b"' ``)

### Property-Based Tests

Property tests will verify universal properties using fast-check:
- Each property test will run minimum 100 iterations
- Tests will generate random valid Stata expressions
- Each test will be tagged with the property it validates

**Test Configuration:**
- Framework: fast-check (already used in the project)
- Minimum iterations: 100 per property
- Tag format: `Feature: ast-formatter-token-spacing, Property N: <property_text>`

### Idempotency Testing

A critical property is that formatting should be idempotent:
- `format(format(expr)) === format(expr)`
- This ensures the formatter doesn't keep adding/removing spaces on repeated applications

### Existing Test Compatibility

The existing tests should continue to pass. This feature only affects the AST formatter (PrettyPrinter), not the source-preserving formatter. If any existing tests fail, it indicates either:
1. A bug in the implementation
2. Tests that were incorrectly asserting unspaced output

### Scope Limitation

This feature does NOT apply to the source-preserving formatter, which:
- Already handles whitespace correctly
- Only modifies whitespace at line boundaries (indentation)
- Preserves original expression formatting
