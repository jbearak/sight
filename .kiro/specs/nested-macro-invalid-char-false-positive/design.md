# Design Document

## Overview

This design addresses two related issues with nested Stata macro references:

1. **Analyzer false positive** (original issue): Nested macro references like `` `one`two'' `` or `${one${two}}` were incorrectly flagged as "Invalid character in macro name" by the analyzer.

2. **Lexer tokenization bug** (newly discovered): The lexer's `scanGlobalMacroRef()` method doesn't track nested brace depth. When tokenizing `${one${two}}`, it stops at the first `}` (from the inner macro), leaving the outer `}` as an orphan token that triggers a parser error "unexpected closing brace - no matching opening brace".

The fix requires changes to both the lexer (brace-depth tracking) and the analyzer (nested macro detection).

## Architecture

The fix spans two components:

1. **Lexer** (`src/lexer/index.ts`): Update `scanGlobalMacroRef()` to track brace depth and backtick/apostrophe nesting
2. **Analyzer** (`src/analyzer/index.ts`): Add `contains_nested_macro()` to detect nested patterns and suppress invalid character diagnostics

```
┌─────────────────────────────────────────────────────────────────┐
│                         Lexer                                    │
│                                                                  │
│  scanGlobalMacroRef()                                           │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Track brace_depth for ${...} nesting              [FIX] │    │
│  │ Track local_depth for `...' nesting within braces [FIX] │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  Return complete MACRO_REF_GLOBAL token                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Analyzer                                 │
│                                                                  │
│  Token (MACRO_REF_LOCAL or MACRO_REF_GLOBAL)                    │
│       │                                                          │
│       ▼                                                          │
│  extract_local_macro_name() / extract_global_macro_name()       │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ is_stored_result_reference() ──► Skip if stored result  │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ contains_nested_macro() ──► Skip if nested macro        │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  has_invalid_macro_char() ──► Emit diagnostic if invalid        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Lexer Fix: Updated `scanGlobalMacroRef()`

The `scanGlobalMacroRef()` method needs to track both brace depth and local macro nesting:

```typescript
private scanGlobalMacroRef(startLine: number, startColumn: number): Token {
    if (this.peek() === '{') {
        // ${name} form - track nested braces and local macros
        this.advance(); // consume {
        let brace_depth = 1;
        let local_depth = 0;
        
        while (!this.isAtEnd() && brace_depth > 0) {
            const my_char = this.peek();
            
            // Stop at newline - incomplete macro syntax
            if (my_char === '\n') {
                const my_error: LexerError = {
                    message: 'Incomplete macro expression: expected \'}\' or closing quote',
                    range: this.makeRange(startLine, startColumn, this.line, this.column),
                    code: LexerErrorCode.UNBALANCED_QUOTES,
                };
                this.errors.push(my_error);
                break;
            }
            
            // Track local macro nesting
            if (my_char === '`') {
                local_depth++;
                this.advance();
                continue;
            }
            
            if (my_char === "'" && local_depth > 0) {
                local_depth--;
                this.advance();
                continue;
            }
            
            // Track brace nesting (only when not inside a local macro)
            if (my_char === '{' && local_depth === 0) {
                brace_depth++;
                this.advance();
                continue;
            }
            
            if (my_char === '}' && local_depth === 0) {
                brace_depth--;
                if (brace_depth > 0) {
                    this.advance();
                    continue;
                }
                // brace_depth == 0, consume final } and exit
                this.advance();
                break;
            }
            
            this.advance();
        }
        
        // If we reached EOF without closing all braces, emit diagnostic
        if (brace_depth > 0 && this.isAtEnd()) {
            const my_error: LexerError = {
                message: 'Incomplete macro expression: expected \'}\' or closing quote',
                range: this.makeRange(startLine, startColumn, this.line, this.column),
                code: LexerErrorCode.UNBALANCED_QUOTES,
            };
            this.errors.push(my_error);
        }
    } else {
        // $name form - unchanged
        while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
            this.advance();
        }
    }

    const value = this.source.substring(this.position_to_offset(startLine, startColumn), this.position);
    return {
        type: 'MACRO_REF_GLOBAL',
        value,
        range: this.makeRange(startLine, startColumn, this.line, this.column),
    };
}
```

### Analyzer: Method `contains_nested_macro()`

A private method in the `Analyzer` class to detect nested macro patterns:

```typescript
/**
 * Check if a macro name content contains nested macro references.
 * Nested macros use backtick-apostrophe pairs for locals or ${} for globals.
 * 
 * Examples of nested patterns:
 * - `one`two'' → content is "one`two'" (contains nested local)
 * - ${one${two}} → content is "one${two}" (contains nested global)
 * - ${one`two'} → content is "one`two'" (contains nested local in global)
 * - $one`two' → content is "one`two'" (contains nested local in unbraced global)
 * 
 * @param content The extracted macro name content (without outer delimiters)
 * @returns true if the content contains nested macro syntax
 */
private contains_nested_macro(content: string): boolean {
    // Check for nested local macro: backtick followed eventually by apostrophe
    if (content.includes('`') && content.includes("'")) {
        return true;
    }
    
    // Check for nested braced global macro: ${...}
    if (content.includes('${') && content.includes('}')) {
        return true;
    }
    
    // Check for nested unbraced global macro: $identifier
    // Match $[A-Za-z_][A-Za-z0-9_]* pattern
    if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(content)) {
        return true;
    }
    
    return false;
}
```

### Modified Token Processing Flow

The existing token processing in `collect_token_diagnostics()` checks for nested macros before checking for invalid characters:

```typescript
if (token.type === 'MACRO_REF_LOCAL') {
    const macro_name = this.extract_local_macro_name(token.value);
    
    // Skip stored result references like `r(values)' - they are valid Stata syntax
    if (macro_name && this.is_stored_result_reference(macro_name)) {
        continue;
    }
    
    // Skip nested macro references - they contain valid macro syntax characters
    if (macro_name && this.contains_nested_macro(macro_name)) {
        continue;
    }
    
    // Check for invalid characters in local macro reference
    if (macro_name && this.has_invalid_macro_char(macro_name)) {
        diagnostics.push({
            message: 'Invalid character in macro name',
            range: token.range,
            code: StataDiagnosticCode.INVALID_MACRO_CHAR,
            severity: 'error',
        });
        continue;
    }
    // ... rest of processing
}
```

Similar changes for `MACRO_REF_GLOBAL` tokens.

## Data Models

No new data models are required. The fix uses the existing `Token` type and diagnostic structures.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Nested Local Macro Detection

*For any* local macro reference containing balanced backtick-apostrophe pairs at any nesting depth (1 to N levels), the `contains_nested_macro()` function SHALL return `true`.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Nested Global Macro Detection

*For any* braced global macro reference containing nested macro syntax (inner braced globals `${...}`, local macros `` `...' ``, or unbraced globals `$name`), the `contains_nested_macro()` function SHALL return `true`.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Nested Macro Diagnostic Suppression

*For any* macro reference (local or global) that contains nested macro syntax, the Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 1.4, 2.4**

### Property 4: Non-Nested Invalid Character Detection

*For any* macro reference that does NOT contain nested macro syntax and contains characters outside `[A-Za-z0-9_]`, the Analyzer SHALL produce an "Invalid character in macro name" diagnostic.

**Validates: Requirements 3.1**

### Property 5: No Duplicate Diagnostics for Unbalanced Macros

*For any* macro reference with unbalanced delimiters (unmatched backticks/apostrophes or braces), the system SHALL produce at most one diagnostic (from the lexer), and the Analyzer SHALL NOT produce an additional "Invalid character in macro name" diagnostic.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 6: Lexer Brace-Depth Tracking

*For any* braced global macro reference containing nested braces like `${a${b}}` or `${a${b${c}}}`, the lexer SHALL return a single MACRO_REF_GLOBAL token containing the entire expression including all nested braces.

**Validates: Requirements 4.1, 4.3, 4.4**

### Property 7: Lexer Mixed Nesting

*For any* braced global macro reference containing nested local macros like `${a`b'}`, the lexer SHALL correctly track both brace depth and backtick/apostrophe nesting, returning a single complete token.

**Validates: Requirements 4.2**

## Error Handling

1. **Unbalanced nesting**: The lexer handles unbalanced backticks/apostrophes by emitting "Incomplete macro expression: expected closing quote". The analyzer should not add redundant diagnostics.

2. **Empty macro names**: If `extract_local_macro_name()` or `extract_global_macro_name()` returns `null` or empty string, skip all validation (existing behavior).

3. **Stored result references**: The existing `is_stored_result_reference()` check runs before the nested macro check, so stored results like `` `r(values)' `` are handled correctly.

## Testing Strategy

### Property-Based Tests

Property-based tests will use `fast-check` to generate random nested macro patterns and verify the correctness properties.

**Generators needed:**
- `arbitrary_nested_local_macro(depth: number)`: Generates nested local macros like `` `a`b`c''' ``
- `arbitrary_nested_global_macro()`: Generates nested braced globals like `${a${b}}`
- `arbitrary_mixed_nested_macro()`: Generates mixed nesting like `${a`b'}`
- `arbitrary_invalid_macro_char()`: Generates invalid characters (dots, spaces, etc.)

**Test configuration:**
- Minimum 100 iterations per property test
- Tag format: **Feature: nested-macro-invalid-char-false-positive, Property N: description**

### Unit Tests

Unit tests will cover specific examples from the requirements:
- `` `foo.bar' `` → should produce diagnostic
- `` `my var' `` → should produce diagnostic
- `${foo.bar}` → should produce diagnostic
- `${my var}` → should produce diagnostic
- `` `one`two'' `` → should NOT produce diagnostic
- `${one${two}}` → should NOT produce diagnostic
