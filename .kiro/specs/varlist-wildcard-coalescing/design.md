# Design Document: Varlist Wildcard Coalescing

## Overview

This design addresses the issue where the Stata parser treats wildcard patterns like `var*` as two separate varlist items (`var` and `*`) instead of a single semantic unit. In Stata, `var*` means "all variables starting with 'var'" and should be parsed as a single VarlistItem.

The solution involves modifying the parser's varlist parsing logic to detect and coalesce adjacent WORD + wildcard tokens when they appear without intervening whitespace.

## Architecture

The change is localized to the parser component (`src/parser/index.ts`). No changes are needed to the lexer, as the current tokenization (separate WORD and OPERATOR tokens) is correct at the lexical level. The coalescing happens at the parsing level where semantic meaning is determined.

```
Lexer Output:  [WORD:"var"] [OPERATOR:"*"] [WORD:"other"]
                    ↓              ↓              ↓
Parser Logic:  ←── coalesce ──→        (separate)
                    ↓                       ↓
AST Output:    VarlistItem("var*")   VarlistItem("other")
```

## Components and Interfaces

### Modified Component: StataParser

The parser's varlist parsing logic exists in multiple locations:
1. `parseCommandBody()` - Main command body parsing (~line 980)
2. `parseCommand()` - Direct command parsing (similar logic)
3. Other varlist parsing contexts

#### Key Change: Wildcard Coalescing Logic

After adding a WORD token to the varlist, check if the next token is a wildcard (`*` or `?`) that immediately follows (no whitespace). If so, coalesce them.

```typescript
// Pseudocode for coalescing logic
function parseVarlistItem(): VarlistItem | null {
  if (!isVarlistToken()) return null;
  
  const word_token = advance();
  let name = word_token.value;
  let end_range = word_token.range.end;
  
  // Check for trailing wildcard(s) without whitespace
  while (isAdjacentWildcard(word_token, peek())) {
    const wildcard_token = advance();
    name += wildcard_token.value;
    end_range = wildcard_token.range.end;
  }
  
  return {
    name: name,
    range: {
      start: word_token.range.start,
      end: end_range
    }
  };
}

function isAdjacentWildcard(prev_token: Token, next_token: Token): boolean {
  // Check if next token is a wildcard
  if (next_token.type !== 'OPERATOR' && next_token.type !== 'WORD') return false;
  if (next_token.value !== '*' && next_token.value !== '?') return false;
  
  // Check adjacency: no whitespace between tokens
  // Adjacent means prev_token.range.end equals next_token.range.start
  return prev_token.range.end.line === next_token.range.start.line &&
         prev_token.range.end.character === next_token.range.start.character;
}
```

### Adjacency Detection

The key insight is that adjacency can be determined by comparing token ranges:
- If `prev_token.range.end` equals `next_token.range.start`, the tokens are adjacent
- If there's any gap (whitespace), they are not adjacent

This approach:
- Works without modifying the lexer
- Is precise (character-level comparison)
- Handles all whitespace types (spaces, tabs)

## Data Models

### VarlistItem (Existing - No Changes)

```typescript
interface IdentifierNode {
  name: string;
  range: Range;
}
```

The `name` field will now contain the full wildcard pattern (e.g., `"var*"`) instead of just the base name.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Wildcard Coalescing

*For any* WORD token immediately followed by one or more wildcard tokens (`*` or `?`) without whitespace, the parser SHALL produce a single VarlistItem with the combined name.

**Validates: Requirements 1.1, 1.2, 5.1, 5.2**

### Property 2: Range Correctness

*For any* coalesced wildcard pattern, the VarlistItem's range SHALL span from the start of the WORD token to the end of the last wildcard token.

**Validates: Requirements 1.3**

### Property 3: Whitespace Separation

*For any* WORD token followed by a wildcard token with intervening whitespace, the parser SHALL produce two separate VarlistItems.

**Validates: Requirements 1.4**

### Property 4: Multiple Pattern Independence

*For any* command containing N wildcard patterns (each being a WORD immediately followed by wildcards), the parser SHALL produce exactly N coalesced VarlistItems for those patterns.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 5: Expression Context Preservation

*For any* command with an assignment expression (containing `=`), wildcard operators appearing after the `=` SHALL NOT be coalesced with preceding tokens.

**Validates: Requirements 3.1, 3.2**

## Error Handling

This feature does not introduce new error conditions. The parser will:
- Continue to accept all previously valid Stata code
- Not reject any new patterns (coalescing is purely about AST representation)
- Maintain existing error handling for malformed commands

Edge cases:
- Empty varlist: No change (nothing to coalesce)
- Standalone `*` or `?`: Treated as before (single-token varlist item)
- `*` at line start: Continues to be parsed as comment (lexer handles this)

## Testing Strategy

### Property-Based Tests

Property-based tests will use fast-check to generate random inputs and verify the correctness properties hold across all cases.

**Test Configuration:**
- Minimum 100 iterations per property test
- Use fast-check for random input generation
- Tag format: **Feature: varlist-wildcard-coalescing, Property N: [property name]**

**Generator Strategy:**
- Generate valid Stata identifiers (letters, digits, underscores)
- Generate wildcard suffixes (`*`, `?`, `**`, `??`, `*?`, etc.)
- Generate commands with varying numbers of varlist items
- Generate mixed varlists (wildcards + regular variables)

### Unit Tests

Unit tests will cover specific examples and edge cases:

1. **Basic coalescing**: `describe var*` → single item `var*`
2. **Question mark**: `describe x?` → single item `x?`
3. **Multiple wildcards**: `describe var??` → single item `var??`
4. **Multiple patterns**: `rename old* new*` → two items `old*`, `new*`
5. **Mixed varlist**: `summarize var* other` → two items `var*`, `other`
6. **Whitespace separation**: `describe var *` → two items `var`, `*`
7. **Expression context**: `generate y = x*2` → expression contains `x*2`
8. **Underscore patterns**: `describe _*` → single item `_*`
9. **Complex pattern**: `describe my_var*` → single item `my_var*`

### Integration Tests

Verify end-to-end behavior:
- Formatter preserves wildcard patterns correctly
- Diagnostics work with wildcard patterns
- Completion provider handles wildcard patterns
