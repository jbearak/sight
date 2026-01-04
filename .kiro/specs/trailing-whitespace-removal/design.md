# Design Document: Trailing Whitespace Removal

## Overview

This feature adds trailing whitespace removal to the Stata LSP formatter. The implementation modifies the `TokenReconstructor` class to strip trailing whitespace from each line as it builds the output. This approach ensures both formatter modes (source-preserving and AST) benefit from the change with minimal code duplication.

## Architecture

The trailing whitespace removal is implemented as a post-processing step in the output generation pipeline:

```
Tokens → TokenReconstructor → Line Assembly → Trailing Whitespace Removal → Output
```

For the AST formatter mode, the `PrettyPrinter` already generates clean output, but we add a final pass to ensure consistency.

### Design Decision: Where to Remove Trailing Whitespace

**Option 1: In TokenReconstructor**
- Modify `reconstruct()` to strip trailing whitespace when emitting newlines
- Pros: Single point of change, handles source-preserving mode
- Cons: Requires careful handling of inter-token spacing

**Option 2: Post-processing in CodeFormatter**
- Add a final `strip_trailing_whitespace()` pass after formatting
- Pros: Simple, works for both modes
- Cons: Extra string processing pass, less efficient

**Option 3: In PrettyPrinter for AST mode**
- Modify each print method to avoid trailing whitespace
- Pros: Clean output from the start
- Cons: Many places to change, doesn't help source-preserving mode

**Decision**: Use Option 2 (post-processing) for simplicity and consistency across both formatter modes. This ensures trailing whitespace is removed regardless of which formatter mode is used, with a single implementation point.

## Components and Interfaces

### Modified Components

#### CodeFormatter (`src/providers/formatter.ts`)

Add a private helper method to strip trailing whitespace from formatted output:

```typescript
/**
 * Remove trailing whitespace from each line in the content.
 * Preserves line structure (number of lines unchanged).
 */
private strip_trailing_whitespace(content: string): string {
    return content.split('\n').map(line => line.trimEnd()).join('\n');
}
```

Apply this helper in all formatting paths:
- `format_without_embedded_blocks()`
- `format_with_embedded_preservation()`
- `format_with_ast()`
- `format_with_comment_normalization()`

### Interface Changes

No public interface changes required. The formatter's output behavior changes, but the API remains the same.

## Data Models

No new data models required. The feature operates on string content.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: No Trailing Whitespace in Output

*For any* valid Stata source code and *for any* formatter mode (source-preserving or AST), after formatting, no line in the output should end with space or tab characters.

**Validates: Requirements 1.1, 1.3, 3.1, 3.2**

### Property 2: Non-Whitespace Content Preservation

*For any* valid Stata source code, after formatting, the non-whitespace content of each line should be preserved (when comparing trimmed lines, accounting for indentation changes).

**Validates: Requirements 2.1**

### Property 3: Line Count Preservation

*For any* valid Stata source code, after formatting, the number of lines in the output should equal the number of lines in the input.

**Validates: Requirements 2.2**

### Property 4: String Literal Content Preservation

*For any* Stata source code containing string literals with internal spaces (including trailing spaces within the string), after formatting, the string literal content should be unchanged.

**Validates: Requirements 1.4**

### Property 5: Continuation Line Trailing Whitespace Removal

*For any* Stata source code with continuation lines (lines ending with `///`) that have trailing whitespace after the continuation marker, after formatting, the trailing whitespace should be removed.

**Validates: Requirements 2.3**

## Error Handling

The trailing whitespace removal is a simple string operation that cannot fail. If the formatter itself fails (returns empty edits), no trailing whitespace removal is attempted.

Error scenarios:
- **Empty content**: Returns empty string (no lines to process)
- **Content with only whitespace lines**: Returns content with empty lines (whitespace removed)
- **Malformed input**: Handled by upstream formatter; trailing whitespace removal operates on whatever string is provided

## Testing Strategy

### Property-Based Tests

Use fast-check to generate random Stata code and verify the correctness properties:

1. **No trailing whitespace property**: Generate random code, optionally inject trailing whitespace, format, verify no trailing whitespace in output
2. **Content preservation property**: Generate random code, format, compare trimmed line content
3. **Line count preservation property**: Generate random code, count lines before/after formatting
4. **String literal preservation property**: Generate code with string literals containing spaces, format, verify string content unchanged
5. **Continuation line property**: Generate code with continuation lines and trailing whitespace, format, verify whitespace removed

### Unit Tests

Specific examples to verify:
- Line with trailing spaces: `"display 1   "` → `"display 1"`
- Line with trailing tabs: `"display 1\t\t"` → `"display 1"`
- Empty line with whitespace: `"   "` → `""`
- String literal with trailing space: `"display \"hello \""` → `"display \"hello \""`
- Continuation line: `"display /// \n  1"` → `"display ///\n  1"`

### Dual Formatter Mode Testing

All tests must run against both formatter modes using the dual-mode test helpers:
- `for_each_formatter_mode()` for unit tests
- `for_each_formatter_mode_property()` for property tests

### Test Configuration

- Property tests: minimum 100 iterations
- Tag format: **Feature: trailing-whitespace-removal, Property N: [property description]**
