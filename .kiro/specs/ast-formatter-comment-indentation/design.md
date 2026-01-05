# Design Document: AST Formatter Comment Indentation Fix

## Overview

This design addresses a bug in the AST formatter (PrettyPrinter) where leading trivia (comments) are printed at the beginning of the line without respecting the current indentation scope. The fix ensures that comments inside nested structures are indented to match their logical scope depth.

## Architecture

The fix is localized to the `PrettyPrinter` class in `src/pretty-printer/index.ts`. The change is minimal: modify the `printLeadingTrivia` method to prepend the current indentation string before each comment.

```
┌─────────────────────────────────────────────────────────────┐
│                      PrettyPrinter                          │
├─────────────────────────────────────────────────────────────┤
│  current_indent: number  ← tracks nesting depth             │
├─────────────────────────────────────────────────────────────┤
│  printNode()                                                │
│    ├── printLeadingTrivia() ← FIX: add getIndent() call    │
│    ├── print<NodeType>()                                    │
│    └── printTrailingTrivia() ← unchanged (no indent)        │
├─────────────────────────────────────────────────────────────┤
│  getIndent(): string  ← returns indent for current_indent   │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Component: PrettyPrinter.printLeadingTrivia()

**Current Implementation (buggy):**
```typescript
private printLeadingTrivia(node: StataNode): string {
    // ... validation ...
    const the_parts: string[] = [];
    for (const my_trivia of trivia_node.leadingTrivia) {
        the_parts.push(this.printTrivia(my_trivia));  // No indentation!
        the_parts.push(this.getStatementTerminator());
    }
    return the_parts.join('');
}
```

**Fixed Implementation:**
```typescript
private printLeadingTrivia(node: StataNode): string {
    // ... validation ...
    const the_parts: string[] = [];
    for (const my_trivia of trivia_node.leadingTrivia) {
        the_parts.push(this.getIndent());  // ADD: Apply current indentation
        the_parts.push(this.printTrivia(my_trivia));
        the_parts.push(this.getStatementTerminator());
    }
    return the_parts.join('');
}
```

### Unchanged Component: PrettyPrinter.printTrailingTrivia()

Trailing trivia should remain unchanged - it already correctly adds a space separator without indentation, keeping comments on the same line as the statement.

## Data Models

No new data models are required. The fix uses existing infrastructure:

- `current_indent: number` - Already tracks the nesting depth
- `getIndent(): string` - Already generates the correct indentation string
- `TriviaNode` - Existing type for comments

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Leading Comment Indentation Matches Scope Depth

*For any* AST with comments at nesting depth N, when formatted with the AST formatter, each leading comment SHALL have exactly N levels of indentation applied.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 4.1**

### Property 2: Trailing Comments Remain Inline

*For any* statement with trailing comments, when formatted with the AST formatter, the trailing comment SHALL appear on the same line as the statement, preceded by a space (not indentation).

**Validates: Requirements 3.1, 3.2**

### Property 3: Cross-Formatter Comment Indentation Consistency

*For any* Stata source code with comments, when formatted with both the AST formatter and source-preserving formatter, the comment indentation levels (number of indent units) SHALL be equivalent.

**Validates: Requirements 4.2**

## Error Handling

No new error handling is required. The fix is a simple addition to existing logic:

- If `leadingTrivia` is empty or undefined, the method returns early (existing behavior)
- If `current_indent` is 0, `getIndent()` returns an empty string (correct for top-level)
- The fix cannot introduce new failure modes

## Testing Strategy

### Unit Tests

Unit tests should verify specific examples:

1. Comment at top level (depth 0) - no indentation
2. Comment inside single `if` block (depth 1) - one level of indentation
3. Comment inside nested `foreach`/`if` (depth 2) - two levels of indentation
4. Multiple leading comments before a statement - all same indentation
5. Trailing comment - remains on same line with space

### Property-Based Tests

Property tests should use fast-check to verify universal properties:

1. **Property 1**: Generate random ASTs with comments at various depths, format with AST formatter, verify indentation matches depth
2. **Property 2**: Generate statements with trailing comments, verify they remain inline
3. **Property 3**: Generate code with comments, format with both formatters, compare indentation levels

**Configuration:**
- Minimum 100 iterations per property test
- Use existing AST generators from `tests/property/generators/`
- Tag format: `Feature: ast-formatter-comment-indentation, Property N: <description>`

### Dual Formatter Testing

Per project guidelines, formatter tests must run against both formatter implementations. Use the dual-mode test helpers:

```typescript
import { for_each_formatter_mode_property } from './helpers/formatter-test-utils';

for_each_formatter_mode_property(
    'should indent leading comments to match scope depth',
    fc.tuple(arbitrary_nesting_depth(), arbitrary_comment()),
    (mode, [depth, comment]) => {
        // Test logic
    }
);
```
