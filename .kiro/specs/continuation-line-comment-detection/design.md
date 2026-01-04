# Design Document: Continuation Line Comment Detection Fix

## Overview

This design addresses a false positive in the `IndentationDiagnosticAnalyzer` where continuation lines with trailing comments (e.g., `/// Formerly married`) are incorrectly flagged as unnecessarily indented. The root cause is that the current implementation uses string manipulation (`line.trim().endsWith('///')`) to detect continuation lines, which fails when there's comment text after the `///` marker.

The fix leverages the existing `CONTINUATION` token type from the lexer, which already correctly tokenizes `///` regardless of trailing comment text.

## Architecture

The fix modifies the `IndentationDiagnosticAnalyzer` class in `src/providers/indentation-diagnostics.ts` to use token-based continuation detection instead of string manipulation.

```
┌─────────────────────────────────────────────────────────────────┐
│                    IndentationDiagnosticAnalyzer                │
├─────────────────────────────────────────────────────────────────┤
│  analyze(document, config)                                      │
│    │                                                            │
│    ├─► compute_continuation_lines(tokens) ◄── NEW METHOD        │
│    │     Returns Set<number> of lines that are continuations    │
│    │                                                            │
│    ├─► find_unnecessary_indentation_issues(...)                 │
│    │     Uses continuation_lines set to skip checks             │
│    │                                                            │
│    ├─► find_block_indentation_issues(...)                       │
│    │     Uses continuation_lines set for is_continuation_line   │
│    │                                                            │
│    └─► get_statement_indentation(...)                           │
│          Uses continuation_lines set for trace-back             │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### New Method: `compute_continuation_lines`

```typescript
/**
 * Compute a set of line numbers that are continuation lines.
 * A line is a continuation if the previous line has a CONTINUATION token.
 * 
 * @param tokens - The document's tokens
 * @returns Set of 0-indexed line numbers that are continuation lines
 */
private compute_continuation_lines(tokens: Token[]): Set<number> {
  const continuation_lines = new Set<number>();
  
  for (const token of tokens) {
    if (token.type === 'CONTINUATION') {
      // The line AFTER the continuation token is a continuation line
      continuation_lines.add(token.range.start.line + 1);
    }
  }
  
  return continuation_lines;
}
```

### Modified Method: `analyze`

The `analyze` method will compute the continuation lines set once and pass it to the methods that need it:

```typescript
analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[] {
  // ... existing code ...
  
  // Compute continuation lines from tokens (NEW)
  const continuation_lines = this.compute_continuation_lines(document.tokens);
  
  for (const range of stataRanges) {
    // Pass continuation_lines to methods that need it
    diagnostics.push(...this.find_comment_indentation_issues(lines, range, block_comment_lines, indent_size));
    diagnostics.push(...this.find_block_indentation_issues(document, lines, range, block_comment_lines, indent_size, continuation_lines));
    
    const expected_depths = this.compute_expected_depths(document, range);
    diagnostics.push(...this.find_unnecessary_indentation_issues(document, lines, range, block_comment_lines, indent_size, expected_depths, continuation_lines));
  }
  
  return diagnostics;
}
```

### Modified Method: `should_skip_unnecessary_check`

Replace string-based continuation detection with set lookup:

```typescript
should_skip_unnecessary_check(
  line: string,
  lineIndex: number,
  lines: string[],
  block_comment_lines: Set<number>,
  continuation_lines: Set<number>  // NEW PARAMETER
): boolean {
  // ... existing checks ...
  
  // Skip continuation lines (using token-based detection)
  if (continuation_lines.has(lineIndex)) {
    return true;
  }
  
  return false;
}
```

### Modified Method: `get_statement_indentation`

Replace string-based continuation detection with set lookup:

```typescript
private get_statement_indentation(
  lines: string[], 
  lineIndex: number, 
  rangeStart: number, 
  indent_size: number,
  continuation_lines: Set<number>  // NEW PARAMETER
): number {
  let current_index = lineIndex;
  
  // Trace back through continuation lines to find the original statement
  while (current_index > rangeStart && continuation_lines.has(current_index)) {
    current_index--;
  }
  
  // Return the indentation of the original statement line
  return this.get_line_indentation(lines[current_index], indent_size);
}
```

### Modified Method: `is_continuation_line`

This method can be simplified or removed since we now use the set:

```typescript
private is_continuation_line(lineIndex: number, continuation_lines: Set<number>): boolean {
  return continuation_lines.has(lineIndex);
}
```

## Data Models

No new data models are required. The fix uses the existing `Token` type and adds a `Set<number>` for efficient continuation line lookup.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Continuation Line Recognition

*For any* document with `CONTINUATION` tokens, the line immediately following each `CONTINUATION` token should be included in the computed continuation lines set.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: No Unnecessary Indentation Diagnostic for Continuation Lines

*For any* continuation line (a line following a `CONTINUATION` token), the `IndentationDiagnosticAnalyzer` should NOT emit an `UNNECESSARY_INDENTATION` diagnostic for that line, regardless of its indentation level.

**Validates: Requirements 2.1, 2.2**

### Property 3: Trace-Back Through Continuations

*For any* chain of continuation lines, tracing back from any line in the chain should correctly identify the original statement's line (the first line that is not a continuation).

**Validates: Requirements 3.1, 3.2**

## Error Handling

- If `document.tokens` is empty or undefined, `compute_continuation_lines` returns an empty set, and the analyzer falls back to existing behavior (no continuation lines detected).
- The fix is backward compatible: documents without `///` will behave exactly as before.

## Testing Strategy

### Unit Tests

1. Test `compute_continuation_lines` with various token patterns
2. Test that continuation lines with trailing comments are correctly identified
3. Test trace-back through multi-line continuations

### Property-Based Tests

1. **Property 1**: Generate random documents with `CONTINUATION` tokens and verify the continuation lines set is computed correctly
2. **Property 2**: Generate continuation lines with various indentation levels and verify no `UNNECESSARY_INDENTATION` diagnostic is emitted
3. **Property 3**: Generate chains of continuation lines and verify trace-back correctness

### Regression Test

The existing test file `tests/repro_continuation_false_positive.test.ts` reproduces the exact bug and should pass after the fix.
