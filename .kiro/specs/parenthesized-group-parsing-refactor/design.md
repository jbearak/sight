# Design Document

## Overview

This design addresses the code duplication issue in the Stata parser where LPAREN (parenthesized group) handling logic is duplicated between `parseCommand` and `parseCommandBody` methods. The solution extracts the shared logic into a single private method `parseParenthesizedGroup` that both methods can call, ensuring consistent behavior and reducing maintenance burden.

## Architecture

The refactoring follows a simple extraction pattern:

```
Before:
┌─────────────────┐     ┌──────────────────┐
│  parseCommand   │     │ parseCommandBody │
│  ┌───────────┐  │     │  ┌───────────┐   │
│  │ LPAREN    │  │     │  │ LPAREN    │   │
│  │ handling  │  │     │  │ handling  │   │
│  │ (inline)  │  │     │  │ (inline)  │   │
│  └───────────┘  │     │  └───────────┘   │
└─────────────────┘     └──────────────────┘

After:
┌─────────────────┐     ┌──────────────────┐
│  parseCommand   │     │ parseCommandBody │
│       │         │     │        │         │
└───────┼─────────┘     └────────┼─────────┘
        │                        │
        └────────┬───────────────┘
                 │
                 ▼
        ┌────────────────────────┐
        │ parseParenthesizedGroup│
        │   (shared method)      │
        └────────────────────────┘
```

## Components and Interfaces

### New Method: `parseParenthesizedGroup`

```typescript
/**
 * Parse a parenthesized group from the token stream.
 * Assumes the current token is LPAREN.
 * Handles nested parentheses and preserves spacing between word-like tokens.
 * 
 * @returns IdentifierNode with the parenthesized content including surrounding parens,
 *          or null if the parenthesized group is empty/whitespace-only
 */
private parseParenthesizedGroup(): IdentifierNode | null {
    const paren_start = this.advance(); // consume (
    const paren_parts: string[] = [];
    let paren_depth = 1;
    let last_was_word = false;
    
    while (!this.isAtEnd() && paren_depth > 0) {
        if (this.check('LPAREN')) {
            paren_depth++;
            paren_parts.push(this.advance().value);
            last_was_word = false;
        } else if (this.check('RPAREN')) {
            paren_depth--;
            if (paren_depth > 0) {
                paren_parts.push(this.advance().value);
            }
            last_was_word = false;
        } else {
            const current_is_word = this.check('WORD') ||
                this.check('NUMBER') || 
                this.check('MACRO_REF_LOCAL') ||
                this.check('MACRO_REF_GLOBAL');
            // Add space between consecutive word-like tokens
            if (last_was_word && current_is_word) {
                paren_parts.push(' ');
            }
            paren_parts.push(this.advance().value);
            last_was_word = current_is_word;
        }
    }
    
    const paren_content = paren_parts.join('');
    const paren_end_pos = this.check('RPAREN')
        ? this.peek().range.end
        : this.previous().range.end;
    
    if (this.check('RPAREN')) {
        this.advance(); // consume closing paren
    }
    
    // Return null for empty/whitespace-only content
    if (!paren_content.trim()) {
        return null;
    }
    
    return {
        name: `(${paren_content})`,
        range: this.makeRange(paren_start.range.start, paren_end_pos),
    };
}
```

### Modified Methods

#### `parseCommand` (lines ~895-938)

Replace the inline LPAREN handling block with a call to `parseParenthesizedGroup`:

```typescript
// Before (inline):
} else if (this.check('LPAREN')) {
    // Handle parenthesized groups (e.g., getmata (var1 var2)=matrix)
    // ... 30+ lines of inline code ...
}

// After (delegated):
} else if (this.check('LPAREN')) {
    const paren_node = this.parseParenthesizedGroup();
    if (paren_node) {
        varlist.push(paren_node);
    }
}
```

#### `parseCommandBody` (lines ~1145-1185)

Replace the inline LPAREN handling block with a call to `parseParenthesizedGroup`:

```typescript
// Before (inline):
} else if (this.check('LPAREN')) {
    // Handle parenthesized groups (e.g., frame myframe: command (xy)=m)
    // ... 30+ lines of inline code ...
}

// After (delegated):
} else if (this.check('LPAREN')) {
    const paren_node = this.parseParenthesizedGroup();
    if (paren_node) {
        varlist.push(paren_node);
    }
}
```

## Data Models

No new data models are required. The existing `IdentifierNode` interface is used:

```typescript
interface IdentifierNode {
    name: string;      // The parenthesized content with surrounding parens
    range: Range;      // Source location from opening to closing paren
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Nested Parenthesis Depth Tracking

*For any* parenthesized group with N levels of nesting (where N >= 1), the parser SHALL correctly track depth and produce content that includes exactly N-1 pairs of inner parentheses.

For example:
- `(a)` → content is `(a)` (0 inner pairs)
- `((a))` → content is `((a))` (1 inner pair)
- `(((a b)))` → content is `(((a b)))` (2 inner pairs)

**Validates: Requirements 1.3, 4.2**

### Property 2: Word Token Spacing Preservation

*For any* parenthesized group containing two or more consecutive word-like tokens (WORD, NUMBER, MACRO_REF_LOCAL, MACRO_REF_GLOBAL), the parser SHALL insert exactly one space between each pair of consecutive word-like tokens.

For example:
- `(var1 var2)` → content preserves the space as `(var1 var2)`
- `(a b c)` → content is `(a b c)` with single spaces

**Validates: Requirements 1.4**

### Property 3: Parsing Consistency After Refactoring

*For any* valid Stata command with parenthesized groups (including those with assignment expressions, macro references, and operators), parsing SHALL produce an AST where the varlist contains the parenthesized content with surrounding parentheses, and any subsequent assignment expression is correctly captured.

For example:
- `cmd (var1)` → varlist contains `(var1)`
- `cmd (xy)=m` → varlist contains `(xy)`, expression is `m`
- `cmd (`var')` → varlist contains the macro reference

**Validates: Requirements 2.3, 3.3, 4.1, 4.3, 5.3, 5.4**

### Property 4: Direct vs Frame-Prefixed Equivalence

*For any* command with parenthesized groups, parsing as a direct command (e.g., `cmd (var)`) and as a frame-prefixed command (e.g., `frame f: cmd (var)`) SHALL produce equivalent varlist content.

This ensures the shared `parseParenthesizedGroup` method behaves identically regardless of the calling context.

**Validates: Requirements 4.4**

## Error Handling

### Unclosed Parentheses

When an LPAREN is encountered but no matching RPAREN is found before end-of-file or statement terminator:
- The method returns the content collected so far
- No explicit error is raised (matches current behavior)
- The range ends at the last token consumed

### Empty Parentheses

When `()` is encountered:
- The method returns `null` (empty content after trim)
- The calling code skips adding to varlist
- This matches current behavior where empty parens are not added

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Basic parenthesized group**: `cmd (var1)` → varlist contains `(var1)`
2. **Multiple variables**: `cmd (var1 var2 var3)` → varlist contains `(var1 var2 var3)`
3. **Nested parentheses**: `cmd ((a b))` → varlist contains `((a b))`
4. **With assignment**: `cmd (xy)=m` → varlist contains `(xy)`, expression is `m`
5. **Empty parentheses**: `cmd ()` → varlist does not contain empty item
6. **Unclosed parentheses**: `cmd (var1` → graceful handling
7. **With macro references**: `cmd (`var')` → varlist contains macro reference

### Property-Based Tests

Property tests verify universal properties across many generated inputs:

1. **Consistency property**: Generate random commands with parenthesized groups, verify AST equivalence between direct and frame-prefixed parsing
2. **Nesting property**: Generate nested parentheses at various depths, verify correct depth tracking
3. **Spacing property**: Generate multiple word tokens, verify spacing is preserved

**Test Configuration**:
- Minimum 100 iterations per property test
- Use existing `arbitrary_non_reserved_identifier()` generator
- Tag format: **Feature: parenthesized-group-parsing-refactor, Property N: description**

### Regression Tests

The existing property tests in `tests/property/frame-prefixed-parenthesized-varlist.prop.test.ts` serve as regression tests to ensure the refactoring does not change behavior.
