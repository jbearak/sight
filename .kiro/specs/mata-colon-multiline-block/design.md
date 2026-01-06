# Design Document: mata: Multiline Block Detection

## Overview

This design addresses a bug in the Stata lexer where `mata:` followed by a newline is incorrectly treated as a single-line inline expression (`MATA_INLINE`) instead of a multi-line block start (`MATA_START`). The fix modifies the lexer's `scanWord` function to look ahead after consuming `mata:` to determine whether content follows on the same line.

The key insight is that `mata:` has two valid use cases:
1. **Inline**: `mata: expression` - executes a single Mata expression and returns to Stata
2. **Block**: `mata:` followed by newline - starts a multi-line Mata block that ends with `end`

Currently, the lexer always treats `mata:` as inline. This design adds lookahead logic to distinguish between the two cases.

## Architecture

The change is localized to the lexer (`src/lexer/index.ts`). No changes are needed to the parser, context tracker, or other components because:

1. The parser already handles both `MATA_START` and `MATA_INLINE` tokens correctly
2. The context tracker already handles both token types correctly
3. The lexer already has the infrastructure for pushing/popping language contexts

```
┌─────────────────────────────────────────────────────────────────┐
│                         Lexer                                    │
│                                                                  │
│  scanWord() detects "mata" or "python"                          │
│       │                                                          │
│       ▼                                                          │
│  Check for colon (:)                                            │
│       │                                                          │
│       ├─── No colon ──► MATA_START (existing behavior)          │
│       │                                                          │
│       ▼                                                          │
│  Consume colon, then lookahead                                  │
│       │                                                          │
│       ├─── Content on same line ──► MATA_INLINE (no context)    │
│       │                                                          │
│       └─── Only whitespace/newline ──► MATA_START + push context│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Component: StataLexer.scanWord()

The `scanWord` method in `src/lexer/index.ts` will be modified to add lookahead logic after detecting `mata:` or `python:`.

**Current behavior:**
```typescript
if (this.peek() === ':') {
  this.advance(); // consume the colon
  const full_value = value + ':';
  // Always returns MATA_INLINE without pushing context
  return {
    type: 'MATA_INLINE',
    value: full_value,
    range: this.makeRange(startLine, startColumn, this.line, this.column),
  };
}
```

**New behavior:**
```typescript
if (this.peek() === ':') {
  this.advance(); // consume the colon
  const full_value = value + ':';
  
  // Lookahead: check if there's content on the same line after the colon
  // (whitespace and comments don't count as content)
  if (this.is_only_whitespace_or_comment_until_newline()) {
    // mata: followed by newline/comment = block start
    this.push_context(LanguageContext.MATA);
    this.state.embedded_block_start_line = startLine;
    return {
      type: 'MATA_START',
      value: full_value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  } else {
    // mata: followed by content = inline expression
    return {
      type: 'MATA_INLINE',
      value: full_value,
      range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
  }
}
```

### New Helper Method: is_only_whitespace_or_comment_until_newline()

A new private method will be added to check if the rest of the current line contains only whitespace or comments:

```typescript
/**
 * Check if the rest of the current line contains only whitespace or comments.
 * Used to determine if mata:/python: should start a block or be inline.
 * Returns true if only whitespace/comments (or nothing) remains until newline/EOF.
 * 
 * Examples that return true (block mode):
 *   - "mata:\n"           (nothing after colon)
 *   - "mata:   \n"        (only whitespace)
 *   - "mata: // comment\n" (whitespace + comment)
 *   - "mata:/* comment */\n" (whitespace + block comment)
 * 
 * Examples that return false (inline mode):
 *   - "mata: x = 5\n"     (code after colon)
 *   - "mata: x = 5 // comment\n" (code + comment)
 */
private is_only_whitespace_or_comment_until_newline(): boolean {
  let my_pos = this.position;
  
  while (my_pos < this.source.length) {
    const my_char = this.source[my_pos];
    
    if (my_char === '\n' || my_char === '\r') {
      // Reached end of line - only whitespace/comments found
      return true;
    }
    
    if (my_char === ' ' || my_char === '\t') {
      // Skip whitespace
      my_pos++;
      continue;
    }
    
    // Check for // line comment
    if (my_char === '/' && my_pos + 1 < this.source.length && this.source[my_pos + 1] === '/') {
      // Rest of line is a comment - treat as block mode
      return true;
    }
    
    // Check for /* block comment */
    if (my_char === '/' && my_pos + 1 < this.source.length && this.source[my_pos + 1] === '*') {
      // Skip the block comment
      my_pos += 2; // Skip /*
      while (my_pos + 1 < this.source.length) {
        if (this.source[my_pos] === '*' && this.source[my_pos + 1] === '/') {
          my_pos += 2; // Skip */
          break;
        }
        if (this.source[my_pos] === '\n') {
          // Block comment spans to next line - treat as block mode
          return true;
        }
        my_pos++;
      }
      continue;
    }
    
    // Check for * line comment (only valid at statement boundary, which we're at after mata:)
    if (my_char === '*') {
      // Rest of line is a comment - treat as block mode
      return true;
    }
    
    // Found non-whitespace, non-comment content
    return false;
  }
  
  // Reached EOF - treat as end of line
  return true;
}
```

## Data Models

No changes to data models are required. The existing token types (`MATA_START`, `MATA_INLINE`, `PYTHON_START`, `PYTHON_INLINE`) and language context enum (`LanguageContext.MATA`, `LanguageContext.PYTHON`) are sufficient.



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Colon-Newline Block Start Detection

*For any* embedded language keyword (`mata` or `python`) followed by a colon and then only whitespace or comments until a newline (or EOF), the lexer should emit a `*_START` token (not `*_INLINE`) and push the corresponding language context onto the context stack.

**Validates: Requirements 1.1, 1.3, 1.4, 3.1, 3.3, 3.4**

### Property 2: Colon-Content Inline Detection

*For any* embedded language keyword (`mata` or `python`) followed by a colon and then non-whitespace, non-comment content on the same line, the lexer should emit a `*_INLINE` token and NOT push any language context onto the context stack.

**Validates: Requirements 1.2, 2.1, 2.2, 2.3, 3.2**

### Property 3: Block Termination with end

*For any* embedded language context (Mata or Python) started by the colon-newline syntax, when `end` appears at a statement boundary (start of line or after statement terminator, with only whitespace/comments following), the lexer should emit an `END_*` token and pop the language context.

**Validates: Requirements 4.1, 4.2**

### Property 4: Non-Boundary end Preservation

*For any* `end` keyword that appears with non-whitespace/non-comment content following it on the same line, the lexer should emit a `WORD` token and NOT pop any language context.

**Validates: Requirements 4.3**

### Property 5: Embedded Content Tokenization

*For any* content inside an embedded language block (started by colon-newline syntax), strings, comments, braces, and macro references should be tokenized according to the embedded language rules, preserving Stata string interpolation syntax (`` `macro' ``) as macro reference tokens.

**Validates: Requirements 5.1, 5.2, 5.3**

## Error Handling

### Unclosed Blocks

When `mata:` or `python:` starts a block (followed by newline) but no `end` is encountered before EOF:
- The lexer continues tokenizing until EOF
- The context stack will have an unclosed context
- The context tracker will emit an "Unclosed mata/python block" diagnostic

This is existing behavior that remains unchanged.

### Malformed Input

When `mata:` or `python:` is followed by invalid content:
- The lexer treats it as inline if any non-whitespace content follows
- Invalid Mata/Python syntax is tokenized as `EMBEDDED_CONTENT` or appropriate token types
- Syntax errors are handled by downstream components (parser, analyzer)

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples:

1. **Inline examples**: `mata: x = 5`, `python: print("hello")`
2. **Block examples**: `mata:\n  code\nend`, `python:\n  code\nend`
3. **Whitespace variations**: `mata:   \n`, `mata:\t\n`
4. **Prefix commands**: `capture mata: x = 5`, `quietly python: x = 1`
5. **The skipped test case**: Unskip and verify it passes

### Property-Based Tests

Property-based tests will use fast-check to generate random inputs and verify the properties above. Each property test should run at least 100 iterations.

**Test file**: `tests/property/mata-colon-multiline-block.prop.test.ts`

**Generators needed**:
- `arbitrary_whitespace()`: Generates random whitespace (spaces, tabs)
- `arbitrary_mata_expression()`: Generates valid single-line Mata expressions
- `arbitrary_python_expression()`: Generates valid single-line Python expressions
- `arbitrary_embedded_content()`: Generates multi-line embedded content

**Property test annotations**:
- Each test must reference its design document property
- Tag format: `Feature: mata-colon-multiline-block, Property N: <property_text>`

### Existing Test Unskip

The test in `tests/property/ast-formatter-string-literal-preservation.prop.test.ts`:
```typescript
it.skip('should preserve embedded Mata block with string literals (lexer limitation)', () => {
```

Will be changed to:
```typescript
it('should preserve embedded Mata block with string literals', () => {
```

This test validates that the formatter correctly preserves string literals in Mata blocks started with `mata:` syntax.
