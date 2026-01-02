# Design Document: Single Quote String Fix

## Overview

This design addresses a bug in the Stata LSP lexer where single-quoted text (`'word'`) is incorrectly tokenized as a string literal. In Stata, single quotes (apostrophes) are NOT string delimiters. The fix involves removing the `scanSingleQuotedString` method and treating standalone apostrophes as operators.

### Valid Stata String Syntax

| Syntax | Example | Description |
|--------|---------|-------------|
| Simple double quotes | `"hello"` | Standard string literal |
| Compound quotes | `` `"hello"' `` | Allows embedded double quotes |
| Nested compound | `` `"She said, "hi""' `` | Double quotes inside compound string |

### Invalid (Not Strings in Stata)

| Syntax | Example | Actual Meaning |
|--------|---------|----------------|
| Single quotes | `'word'` | NOT a string - apostrophes are operators |

## Architecture

The fix is localized to the lexer component (`src/lexer/index.ts`). No changes are needed to the parser, analyzer, or other components.

```
┌─────────────────────────────────────────────────────────────┐
│                        Lexer                                 │
├─────────────────────────────────────────────────────────────┤
│  scanToken()                                                 │
│    ├── char === '"'  → scanSimpleString()     ✓ Keep        │
│    ├── char === '`' && peek() === '"' → scanCompoundString() ✓ Keep │
│    ├── char === '`' → scanLocalMacroRef()     ✓ Keep        │
│    ├── char === "'" → scanSingleQuotedString() ✗ REMOVE     │
│    └── char === "'" → makeToken('OPERATOR')   ✓ NEW         │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified: StataLexer.scanToken()

Remove the branch that calls `scanSingleQuotedString` when encountering a single quote. Instead, treat the apostrophe as an operator.

**Before:**
```typescript
// Handle single-quoted strings
if (char === "'") {
  return this.scanSingleQuotedString(startLine, startColumn);
}
```

**After:**
```typescript
// Apostrophe is NOT a string delimiter in Stata
// It's used to close local macro references (`name') or as an operator
if (char === "'") {
  return this.makeToken('OPERATOR', char, startLine, startColumn);
}
```

### Removed: StataLexer.scanSingleQuotedString()

This method should be completely removed as it implements incorrect behavior.

### Modified: StataLexer.scanEmbeddedContent()

The same change applies to embedded content scanning (Mata/Python blocks):

**Before:**
```typescript
// Handle single-quoted strings
if (first_char === "'") {
  return this.scanSingleQuotedString(startLine, startColumn);
}
```

**After:**
```typescript
// Apostrophe is NOT a string delimiter in Stata
if (first_char === "'") {
  return this.makeToken('OPERATOR', first_char, startLine, startColumn);
}
```

## Data Models

No changes to data models. The `Token` type already supports `OPERATOR` tokens.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Standalone Apostrophe Tokenization

*For any* Stata source code containing a standalone apostrophe (not preceded by a backtick on the same logical token), the lexer SHALL tokenize the apostrophe as an OPERATOR token, never as a STRING token.

**Validates: Requirements 1.1, 1.2, 3.2**

### Property 2: Local Macro Reference Preservation

*For any* valid local macro reference (`` `name' `` where name is a valid identifier), the lexer SHALL tokenize it as a single MACRO_REF_LOCAL token containing both the opening backtick and closing apostrophe.

**Validates: Requirements 1.4, 3.1**

### Property 3: Valid String Literal Round-Trip

*For any* valid Stata string literal (simple `"..."` or compound `` `"..."' ``), tokenizing and extracting the string value SHALL preserve the original content, including any embedded apostrophes.

**Validates: Requirements 2.1, 2.2, 2.3, 3.3, 3.4**

### Property 4: No False Unclosed String Errors

*For any* Stata source code containing standalone apostrophes (not part of macro references), the lexer SHALL NOT report "unclosed string literal" errors for those apostrophes.

**Validates: Requirements 3.5**

## Error Handling

### Removed Error Conditions

The following error condition is removed:
- "Unclosed string literal" for standalone apostrophes

### Preserved Error Conditions

These existing error conditions remain unchanged:
- "Unclosed string literal" for unclosed double-quoted strings (`"hello`)
- "Unclosed string literal" for unclosed compound strings (`` `"hello ``)
- "Incomplete macro expression" for unclosed macro references (`` `name ``)

## Testing Strategy

### Property-Based Tests

Property-based tests will use `fast-check` to generate random inputs and verify the correctness properties hold across all inputs. Each test should run a minimum of 100 iterations.

| Property | Test File | Generator Strategy |
|----------|-----------|-------------------|
| Property 1 | `single-quote-tokenization.prop.test.ts` | Generate random words/identifiers, wrap in single quotes |
| Property 2 | `local-macro-reference.prop.test.ts` | Generate random valid macro names |
| Property 3 | `string-literal-roundtrip.prop.test.ts` | Generate random string content with embedded apostrophes |
| Property 4 | `no-false-string-errors.prop.test.ts` | Generate code with standalone apostrophes |

### Unit Tests

Unit tests will cover specific examples and edge cases:

1. **Basic single quote handling:**
   - `'word'` → OPERATOR, WORD, OPERATOR
   - `'` alone → OPERATOR
   - `''` (two apostrophes) → OPERATOR, OPERATOR

2. **Macro reference preservation:**
   - `` `name' `` → MACRO_REF_LOCAL
   - `` `' `` (empty) → MACRO_REF_LOCAL
   - `` `nested`inner'' `` → nested macro refs

3. **String literal preservation:**
   - `"it's"` → STRING containing apostrophe
   - `` `"it's"' `` → STRING containing apostrophe
   - `"don't"` → STRING containing apostrophe

4. **Error handling:**
   - `'word` (unclosed) → No error (apostrophe is just an operator)
   - `"word` (unclosed) → Error (unclosed string)

### Regression Tests

Add tests for the specific bug report:
- `'word'` should NOT be tokenized as a string
- `` `"The person stated, "some stuff""' `` should work correctly
