# Design Document: Extended Missing Value Tokenization

## Overview

This design addresses a bug where the Stata LSP incorrectly reports false positive "split literal" diagnostics for extended missing values (`.a` through `.z`). The root cause is that the lexer tokenizes `.a` as two separate tokens (`.` as WORD and `a` as WORD), which triggers the parser's split literal detection logic.

The fix involves updating the lexer to recognize extended missing values as single tokens, similar to how it already handles decimal numbers (`.5`).

## Architecture

The change is localized to the lexer (`src/lexer/index.ts`). No changes are needed to the parser's split literal detection logic - once the lexer correctly tokenizes extended missing values as single tokens, the parser will no longer see the pattern that triggers false positives.

```
Source: "if x == .a"

Before (bug):
  Lexer → [WORD:"if", WORD:"x", OPERATOR:"==", WORD:".", WORD:"a"]
  Parser → Sees "." followed by "a" → False positive split literal warning

After (fix):
  Lexer → [WORD:"if", WORD:"x", OPERATOR:"==", NUMBER:".a"]
  Parser → Sees NUMBER:".a" → No split literal warning
```

## Components and Interfaces

### Lexer Changes

The lexer's `scanToken()` method currently handles dots in two cases:
1. `.` followed by a digit → `scanNumber()` (e.g., `.5` becomes NUMBER)
2. `.` followed by anything else → falls through to `makeToken('WORD', ...)` (e.g., `.` becomes WORD)

We need to add a third case:
3. `.` followed by a single letter → handle as extended missing value or invalid word

#### Implementation Strategy

Modify the lexer to check for extended missing values after handling the dot character:

```typescript
// In scanToken(), after handling numbers:
if (this.isDigit(char) || (char === '.' && this.isDigit(this.peek()))) {
  return this.scanNumber(startLine, startColumn);
}

// NEW: Handle extended missing values (.a through .z)
if (char === '.' && this.isAlpha(this.peek())) {
  return this.scanExtendedMissingOrWord(startLine, startColumn);
}
```

#### New Method: `scanExtendedMissingOrWord()`

```typescript
private scanExtendedMissingOrWord(startLine: number, startColumn: number): Token {
  // At this point, we've consumed the '.' and peek() is a letter
  const next_char = this.peek();
  const after_next = this.peekNext();
  
  // Check if it's a single letter followed by non-alphanumeric
  if (this.isAlpha(next_char) && !this.isAlphaNumeric(after_next) && after_next !== '_') {
    this.advance(); // consume the letter
    const value = '.' + next_char;
    
    // Lowercase single letter = valid extended missing value (NUMBER)
    if (/^[a-z]$/.test(next_char)) {
      return this.makeToken('NUMBER', value, startLine, startColumn);
    }
    
    // Uppercase single letter = invalid (WORD, parser will report error)
    return this.makeToken('WORD', value, startLine, startColumn);
  }
  
  // Multiple letters after dot = consume all as single WORD token
  // e.g., ".ab", ".abc", ".Abc"
  while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
    this.advance();
  }
  
  const value = this.source.substring(
    this.position_to_offset(startLine, startColumn),
    this.position
  );
  return this.makeToken('WORD', value, startLine, startColumn);
}
```

### Parser Changes

No changes needed to the parser. The `detectSplitLiteral()` method will continue to work correctly because:
- Extended missing values (`.a`) are now single NUMBER tokens, not two separate tokens
- The split literal detection only triggers when it sees a WORD token with value `.` followed by another token

## Data Models

No new data models are needed. Extended missing values use the existing `NUMBER` token type, which is appropriate since they represent numeric values (missing data values in Stata's numeric system).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Extended Missing Value Tokenization (Lowercase)

*For any* lowercase letter `c` in `a` through `z`, when the lexer tokenizes the string `.c`, it SHALL produce a single NUMBER token with value `.c`.

**Validates: Requirements 1.1**

### Property 2: Uppercase Dot-Letter Sequences Produce WORD Tokens

*For any* uppercase letter `C` in `A` through `Z`, when the lexer tokenizes the string `.C`, it SHALL produce a single WORD token with value `.C` (not a NUMBER token, since only lowercase `.a`-`.z` are valid extended missing values).

**Validates: Requirements 1.2**

### Property 3: Whitespace Prevents Extended Missing Value Tokenization

*For any* letter `c`, when the lexer tokenizes the string `. c` (dot, whitespace, letter), it SHALL produce at least two tokens: a WORD token with value `.` and a WORD token with value `c`.

**Validates: Requirements 1.3**

### Property 4: Decimal Number Tokenization Preserved

*For any* digit `d` in `0` through `9`, when the lexer tokenizes the string `.d`, it SHALL produce a single NUMBER token with value starting with `.d`.

**Validates: Requirements 1.4**

### Property 5: Multi-Letter Dot Sequences Tokenization

*For any* string of two or more letters `s`, when the lexer tokenizes the string `.s`, it SHALL produce a single WORD token with value `.s`.

**Validates: Requirements 1.5**

### Property 6: No False Positive Split Literal for Extended Missing Values

*For any* lowercase letter `c` in `a` through `z`, when the parser processes code containing `.c` (without whitespace), it SHALL NOT emit any split literal diagnostic.

**Validates: Requirements 2.2, 3.1, 3.2**

### Property 7: Split Literal Detection for Whitespace-Separated Patterns

*For any* lowercase letter `c` in `a` through `z`, when the parser processes code containing `. c` (dot, whitespace, letter) in a comparison context, it SHALL emit a split literal diagnostic suggesting `.c`.

**Validates: Requirements 2.1**

## Error Handling

### Invalid Extended Missing Values

When the lexer encounters `.A` through `.Z` (uppercase) or `.ab` (multiple letters), it tokenizes them as WORD tokens. The parser/analyzer will report these as syntax errors in the appropriate context.

### Edge Cases

1. **System missing value (`.`)**: Continues to be tokenized as WORD (existing behavior)
2. **Decimal numbers (`.5`)**: Continue to be tokenized as NUMBER (existing behavior)
3. **Dot in other contexts**: Continues to be tokenized as WORD or OPERATOR depending on context

## Testing Strategy

### Unit Tests

Unit tests should cover specific examples and edge cases:

1. **Extended missing values**: `.a`, `.m`, `.z` → NUMBER tokens
2. **Invalid uppercase**: `.A`, `.M`, `.Z` → WORD tokens
3. **Multi-letter sequences**: `.ab`, `.abc`, `.Abc` → WORD tokens
4. **Whitespace separation**: `. a`, `. z` → separate tokens
5. **Decimal numbers**: `.5`, `.0`, `.9` → NUMBER tokens
6. **System missing**: `.` alone → WORD token
7. **Integration**: `if x == .a`, `replace x = .b` → no false positives

### Property-Based Tests

Property-based tests should verify universal properties across all inputs:

1. **Lowercase letter property**: All 26 lowercase letters produce NUMBER tokens
2. **Uppercase letter property**: All 26 uppercase letters produce WORD tokens
3. **Multi-letter property**: All multi-letter sequences produce single WORD tokens
4. **Whitespace property**: Whitespace always separates tokens
5. **No false positive property**: Extended missing values never trigger split literal warnings

### Test Configuration

- Minimum 100 iterations per property test
- Each property test must reference its design document property
- Tag format: **Feature: extended-missing-value-tokenization, Property {number}: {property_text}**
