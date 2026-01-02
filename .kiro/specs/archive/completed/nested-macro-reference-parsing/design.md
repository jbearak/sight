# Design Document: Nested Macro Reference Parsing

## Overview

This design addresses a bug in the Stata LSP lexer where nested local macro references like `` `path`i'' `` are incorrectly flagged as "Unclosed string literal" errors. The fix involves modifying the `scanLocalMacroRef` method in the lexer to track nesting depth by counting backticks and matching them with closing single quotes.

In Stata, local macro references use backtick (`` ` ``) as the opening delimiter and single quote (`'`) as the closing delimiter. Macros can be nested, where an inner macro is expanded first to form part of the outer macro's name:

```stata
local i 5
local path5 "/data/file.dta"
local result `path`i''  // Expands to `path5' which expands to "/data/file.dta"
```

## Architecture

The change is localized to the lexer component (`src/lexer/index.ts`), specifically the `scanLocalMacroRef` method. No changes are needed to the parser, analyzer, or other components.

```
Source Code → Lexer (modified) → Parser → Analyzer → Providers
                ↑
                └── scanLocalMacroRef now tracks nesting depth
```

## Components and Interfaces

### Modified Component: StataLexer.scanLocalMacroRef

**Current Implementation:**
```typescript
private scanLocalMacroRef(startLine: number, startColumn: number): Token {
    // Consume until closing '
    while (this.peek() !== "'" && !this.isAtEnd()) {
        const my_char = this.peek();
        if (my_char === '\n') {
            // emit error
            break;
        }
        this.advance();
    }
    if (this.peek() === "'") {
        this.advance(); // consume closing '
    }
    // return token
}
```

**Problem:** The current implementation stops at the first single quote, which incorrectly terminates nested macro references early.

**New Implementation:**
```typescript
private scanLocalMacroRef(startLine: number, startColumn: number): Token {
    let nesting_depth = 1;  // Start at 1 for the initial backtick
    
    while (nesting_depth > 0 && !this.isAtEnd()) {
        const my_char = this.peek();
        
        if (my_char === '\n') {
            // Incomplete macro - emit error
            break;
        }
        
        if (my_char === '`') {
            nesting_depth++;
            this.advance();
            continue;
        }
        
        if (my_char === "'") {
            nesting_depth--;
            this.advance();
            continue;
        }
        
        this.advance();
    }
    
    // Emit error if not properly closed
    if (nesting_depth > 0) {
        // emit incomplete macro error
    }
    
    // return token with complete value
}
```

### Interface: No Changes

The public interface of the lexer remains unchanged. The `tokenize` method continues to return `LexerResult` with the same structure. The only difference is that nested macro references now produce correct tokens.

## Data Models

No new data models are required. The existing `Token` type with `type: 'MACRO_REF_LOCAL'` is sufficient.

**Token structure (unchanged):**
```typescript
interface Token {
    type: TokenType;  // 'MACRO_REF_LOCAL' for local macro references
    value: string;    // Complete text including delimiters
    range: Range;     // Source location
}
```

**Example token for `` `path`i'' ``:**
```typescript
{
    type: 'MACRO_REF_LOCAL',
    value: "`path`i''",
    range: { start: { line: 0, col: 0 }, end: { line: 0, col: 10 } }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Token Completeness for Nested Macro References

*For any* valid nested local macro reference (a string starting with backtick, containing zero or more nested backtick-quote pairs, and ending with matching closing quotes), the lexer SHALL produce exactly one `MACRO_REF_LOCAL` token whose value equals the complete input string.

**Validates: Requirements 1.4, 2.1, 4.1, 5.1, 5.2, 5.3**

### Property 2: Nesting Depth Invariant

*For any* valid nested local macro reference, the number of backticks in the token value SHALL equal the number of single quotes in the token value.

**Validates: Requirements 4.2**

### Property 3: Error Detection for Incomplete Macros

*For any* incomplete nested local macro reference (where a newline or EOF is encountered before all nesting levels are closed), the lexer SHALL emit exactly one error with code `UNBALANCED_QUOTES`.

**Validates: Requirements 3.1, 3.2**

### Property 4: No False Positives for Valid Macros

*For any* valid nested local macro reference, the lexer SHALL emit zero errors.

**Validates: Requirements 3.3**

## Error Handling

### Error Conditions

1. **Newline before closure**: When a newline is encountered while `nesting_depth > 0`
   - Emit error: "Incomplete macro expression: expected closing quote"
   - Error code: `LexerErrorCode.UNBALANCED_QUOTES`
   - Continue lexing from the newline

2. **EOF before closure**: When end-of-file is reached while `nesting_depth > 0`
   - Emit error: "Incomplete macro expression: expected closing quote"
   - Error code: `LexerErrorCode.UNBALANCED_QUOTES`
   - Return token with partial value

3. **Excessive nesting depth** (optional safeguard): When `nesting_depth > 100`
   - Emit warning: "Deeply nested macro reference (depth > 100)"
   - Continue processing normally

### Error Recovery

The lexer should be resilient and continue processing after encountering errors. For incomplete macros:
- Emit the error diagnostic
- Return a token with whatever value was accumulated
- Continue lexing from the current position (newline or EOF)

## Testing Strategy

### Unit Tests

Unit tests should cover specific examples and edge cases:

1. **Simple macro references** (regression): `` `name' ``, `` `my_var' ``, `` `var1' ``
2. **Single-level nesting**: `` `path`i'' ``
3. **Multi-level nesting**: `` `a`b`c''' ``
4. **Content after inner macro**: `` `var`j'_suffix' ``
5. **Incomplete macros**: `` `path`i' `` (missing one quote), `` `name `` (no closing quote)
6. **Empty macro name**: `` `' ``
7. **Macro at end of line**: `` `name'\n ``

### Property-Based Tests

Property-based tests should verify the correctness properties using generated inputs:

1. **Generator for valid nested macro references**: Generate strings with balanced backticks and quotes at various nesting depths (0-10)
2. **Generator for incomplete macro references**: Generate strings with unbalanced delimiters
3. **Test Property 1**: For all generated valid macros, verify single token with complete value
4. **Test Property 2**: For all generated valid macros, verify backtick count equals quote count
5. **Test Property 3**: For all generated incomplete macros, verify error is emitted
6. **Test Property 4**: For all generated valid macros, verify no errors

### Test Configuration

- Property-based tests: minimum 100 iterations per property
- Use `fast-check` library for property-based testing
- Tag format: **Feature: nested-macro-reference-parsing, Property N: [property text]**
