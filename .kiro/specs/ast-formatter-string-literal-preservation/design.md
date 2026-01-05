# Design Document: AST Formatter String Literal Preservation

## Overview

This design addresses bugs in the AST formatter (PrettyPrinter) where string literals are corrupted during formatting. The issues include:

1. **Delimiter deletion**: Opening delimiters (`` `" ``) being stripped from compound strings
2. **String deletion**: Entire string literals being deleted from output
3. **Spacing corruption**: `format_expression_spacing()` modifying content inside strings
4. **Extended function spacing**: Space after operators being removed in macro extended functions

The root cause is that `format_expression_spacing()` is being called on values that contain string literals, and the function's protected region detection isn't working correctly in all cases.

## Architecture

### Current Flow

```
Source Code → Lexer → Parser → AST → PrettyPrinter → Output
                                          ↓
                              format_expression_spacing()
                                          ↓
                              (corrupts string content)
```

### Target Flow

```
Source Code → Lexer → Parser → AST → PrettyPrinter → Output
                                          ↓
                              format_expression_spacing()
                                          ↓
                              (preserves string content exactly)
```

## Components and Interfaces

### Affected Components

1. **PrettyPrinter** (`src/pretty-printer/index.ts`)
   - `printStringLiteral()` - Prints string literal nodes
   - `printMacroDef()` - Calls `format_expression_spacing()` on macro values
   - `printCommand()` - Calls `format_expression_spacing()` on expressions
   - `printControlFlow()` - Calls `format_expression_spacing()` on conditions
   - `printOption()` - Calls `format_expression_spacing()` on option arguments

2. **Expression Spacing** (`src/pretty-printer/expression-spacing.ts`)
   - `find_protected_regions()` - Identifies regions to preserve
   - `format_expression_spacing()` - Applies spacing rules

### Key Interfaces

```typescript
// StringLiteralNode - represents a string in the AST
interface StringLiteralNode {
  type: 'string';
  quoteStyle: 'simple' | 'compound';
  value: string;  // Content WITHOUT delimiters
  range: Range;
}

// ProtectedRegion - regions to skip during spacing
interface ProtectedRegion {
  start: number;
  end: number;
  type: 'string' | 'nested_macro' | 'compound_string';
}
```

## Data Models

### String Literal Representation

The `StringLiteralNode.value` field contains the string content WITHOUT delimiters:
- For `"hello"`, value is `hello`
- For `` `"hello"' ``, value is `hello`

The `printStringLiteral()` method adds delimiters back:
```typescript
if (node.quoteStyle === 'compound') {
    return `\`"${node.value}"'`;  // Adds `" and "'
} else {
    return `"${node.value}"`;     // Adds " and "
}
```

### Expression Content

Expressions stored in AST nodes (e.g., `CommandNode.expression`, `MacroDefNode.value`) are raw strings that may contain:
- String literals with delimiters
- Macro references
- Operators
- Identifiers



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: String Delimiter Preservation

*For any* string literal (simple or compound), when formatted by the AST formatter, the output SHALL include the correct opening and closing delimiters:
- Simple strings: opening `"` and closing `"`
- Compound strings: opening `` `" `` and closing `` "' ``

**Validates: Requirements 1.1, 1.2, 1.5, 7.1, 7.2, 7.3**

### Property 2: String Content Preservation

*For any* string literal containing macro references (`` `macro' ``, `$macro`) or operators (`+`, `-`, `*`, `/`), when formatted by the AST formatter, the content inside the string SHALL remain unchanged with no added or removed spaces.

**Validates: Requirements 1.3, 1.4, 3.2, 3.3**

### Property 3: Round-Trip Preservation

*For any* valid Stata source containing string literals (including compound strings with embedded macros, strings in control flow conditions, strings in display commands, and standalone strings), parsing then formatting SHALL produce output where all string literals are identical to the original.

**Validates: Requirements 1.6, 3.1, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3**

### Property 4: Extended Function Spacing Preservation

*For any* macro extended function definition (e.g., `local x : list a - b`), when formatted by the AST formatter, the spacing around operators in the function arguments SHALL be preserved exactly as in the original.

**Validates: Requirements 2.4**

### Property 5: Expression Context Distinction

*For any* AST containing both expression nodes and string literal nodes, the AST formatter SHALL apply expression spacing rules only to expression contexts (ifExpression, inExpression, assignment, non-string option arguments) and NOT to string literal content.

**Validates: Requirements 2.1, 2.2, 2.3**

## Error Handling

### Invalid AST Nodes

If a `StringLiteralNode` has an undefined or null `value`:
- Return empty string with appropriate delimiters (`""` or `` `"' ``)
- Do not throw an exception

### Malformed Protected Regions

If `find_protected_regions()` encounters malformed string delimiters:
- Return partial regions found so far
- Continue processing remaining content
- Log a warning for debugging

## Testing Strategy

### Dual-Mode Testing

All formatter tests MUST run against both formatter implementations:
- **AST Formatter** (PrettyPrinter) - the component being fixed
- **Source-Preserving Formatter** - should already work correctly

Use the dual-mode test helpers from `tests/property/helpers/formatter-test-utils.ts`:
- `for_each_formatter_mode_property()` - Runs property tests for each mode
- `create_formatter_config(mode)` - Creates config for a specific mode

### Unit Tests

Unit tests should cover the specific failing examples from the requirements:

1. **Concrete Test Case** - The exact input/output from the bug report
2. **Macro Extended Function** - `local macro : other_macro - another_macro`
3. **Strings in Control Flow** - `if "`myvar'" == "value" { ... }`
4. **Strings to User Programs** - `my_program \`"\`complex_string'"' "simple_string"`
5. **Multi-line Compound Strings** - Compound strings spanning multiple lines
6. **Embedded Mata Block** - Mata block containing string literals with macros

### Property-Based Tests

Property tests should use fast-check with minimum 100 iterations per property:

1. **String Delimiter Preservation** - Generate random string content, verify delimiters
2. **String Content Preservation** - Generate strings with macros/operators, verify no changes
3. **Round-Trip Preservation** - Generate valid Stata source, parse, format, compare strings
4. **Extended Function Spacing** - Generate extended macro defs, verify spacing preserved
5. **Expression Context Distinction** - Generate mixed AST, verify correct spacing application

### Test Annotations

Each property test must be annotated with:
```typescript
// Feature: ast-formatter-string-literal-preservation, Property N: [Property Title]
// Validates: Requirements X.Y, X.Z
```

## Implementation Approach

### Phase 1: Investigate Root Cause

1. Add debug logging to `printStringLiteral()` to verify it's being called
2. Add debug logging to `format_expression_spacing()` to see what content it receives
3. Trace the flow for the concrete test case to identify where corruption occurs

### Phase 2: Fix String Literal Preservation

Based on investigation, likely fixes:

**Option A: Improve Protected Region Detection**
- Enhance `find_protected_regions()` to correctly identify all string boundaries
- Ensure compound string delimiters are properly matched

**Option B: Skip Expression Spacing for String Values**
- Detect when a value is purely a string literal
- Skip `format_expression_spacing()` call entirely for such values

**Option C: Fix AST Node Creation**
- Ensure parser creates proper `StringLiteralNode` for standalone strings
- Ensure `value` field contains content without delimiters

### Phase 3: Fix Extended Function Spacing

- Preserve original spacing in `extendedFunction.args`
- Do not apply expression spacing to extended function arguments

### Phase 4: Add Tests

1. Add unit tests for concrete test cases
2. Add property tests for each correctness property
3. Ensure all tests run in dual-mode
