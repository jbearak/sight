# Design Document: Inline Expression Evaluation

## Overview

This design addresses two improvements to Stata macro handling in the LSP:

1. **Inline equals-expression evaluation**: Properly recognize `` `=expression' `` syntax as inline expression evaluation rather than macro references, eliminating false positive undefined macro warnings.

2. **Extended macro function spacing**: Ensure the formatter preserves appropriate spacing around colons in macro assignments (e.g., `local x : type mpg`).

## Architecture

### Current State Analysis

The LSP already has partial support for inline expression evaluation:

1. **Lexer** (`src/lexer/index.ts`): The `scanLocalMacroRef` method tokenizes all `` `...` `` patterns as `MACRO_REF_LOCAL` tokens, including inline expressions like `` `=2+2' ``.

2. **Analyzer** (`src/analyzer/index.ts`): The `check_token_macro_references` method already has an `is_expression_evaluation` check that skips tokens where the content starts with `=`. This should prevent false positives.

3. **Formatter**: The pretty-printer already handles extended macro functions with proper spacing (` : ` with spaces around the colon).

### Issue Investigation

The user reports false positive warnings for inline expression evaluation. Let me trace the issue:

1. The `extract_local_macro_name` method extracts the content between `` ` `` and `'`
2. The `is_expression_evaluation` method checks if content starts with `=`
3. If content starts with `=`, the token is skipped

**Potential Issue**: The inline colon-expression syntax (`` `:function' ``) is NOT currently handled. While `` `=expr' `` is handled, `` `:type mpg' `` would be treated as an undefined macro reference.

### Design Decisions

#### Decision 1: Add Inline Colon-Expression Detection

Add a new method `is_inline_extended_function` to detect `` `:function' `` syntax:

```typescript
private is_inline_extended_function(content: string): boolean {
    return content.startsWith(':');
}
```

This mirrors the existing `is_expression_evaluation` pattern.

#### Decision 2: Token Type Distinction (Optional Enhancement)

For better semantic clarity, we could introduce distinct token types:
- `INLINE_EXPRESSION` for `` `=expr' ``
- `INLINE_EXTENDED_FUNCTION` for `` `:function' ``

However, this would require parser changes. For minimal impact, we'll keep the current approach of filtering in the analyzer.

#### Decision 3: Formatter Spacing for Extended Macro Functions

The current formatter already handles extended macro functions correctly in the pretty-printer:
```typescript
return `${this.getIndent()}${scope_keyword} ${node.name} : ${func.name}${args_part}`.trimEnd();
```

The source-preserving formatter should also preserve/normalize this spacing. We need to verify this works correctly.

## Components and Interfaces

### Modified Components

#### 1. SemanticAnalyzer (`src/analyzer/index.ts`)

Add inline extended function detection:

```typescript
/**
 * Check if a macro content represents an inline extended function.
 * Inline extended functions use `:function' syntax for inline evaluation.
 * 
 * Examples:
 * - `:type mpg' → content is ":type mpg" (type function)
 * - `:format price' → content is ":format price" (format function)
 * - `:variable label mpg' → content is ":variable label mpg" (variable label)
 * 
 * @param content The extracted macro name content (without outer delimiters)
 * @returns true if the content is an inline extended function (starts with :)
 */
private is_inline_extended_function(content: string): boolean {
    return content.startsWith(':');
}
```

Update `check_token_macro_references` to skip inline extended functions:

```typescript
// Skip inline extended function macros - they use `:function' syntax
if (macro_name && this.is_inline_extended_function(macro_name)) {
    continue;
}
```

### Unchanged Components

- **Lexer**: No changes needed. The lexer correctly tokenizes all `` `...` `` patterns.
- **Parser**: No changes needed. Extended macro functions in assignments are already parsed.
- **Pretty-Printer**: Already handles extended macro function spacing correctly.
- **Source-Preserving Formatter**: Should preserve original spacing.

## Data Models

No new data models required. The existing `Token` and `MacroDefNode` types are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Inline Expression No Warning

*For any* valid inline expression (either `` `=expression' `` or `` `:function args' ``), the analyzer SHALL NOT emit an undefined macro warning for that token.

This property consolidates the handling of both inline equals-expressions and inline colon-expressions, as they share the same semantic behavior: they are evaluated at expansion time and do not represent macro references that need to be defined.

**Validates: Requirements 1.2, 3.2**

### Property 2: Regular Macro Reference Warning Preserved

*For any* undefined local macro reference (`` `name' `` where name does not start with `=` or `:`), the analyzer SHALL emit an undefined macro warning.

This ensures that the inline expression detection does not accidentally suppress warnings for genuine undefined macro references.

**Validates: Requirements 2.2**

### Property 3: Nested Macro Validation in Inline Expressions

*For any* inline expression containing nested macro references (e.g., `` `=`n'+1' ``), the analyzer SHALL validate those nested macro references and emit warnings for undefined ones.

The outer inline expression is skipped, but any nested macro references within it must still be validated.

**Validates: Requirements 1.3**

### Property 4: Extended Macro Function Spacing

*For any* macro assignment with extended function syntax (e.g., `local x : type mpg`), the formatter SHALL preserve or produce a space before the colon.

This ensures that extended macro function assignments follow Stata conventions with proper spacing around the colon.

**Validates: Requirements 4.1, 4.3**

### Property 5: Prefix Command Spacing Preserved

*For any* prefix command with a colon (e.g., `quietly: display`), the formatter SHALL NOT add a space before the colon.

This ensures that the extended macro function spacing rule does not affect prefix command formatting.

**Validates: Requirements 4.2**

## Error Handling

### Malformed Inline Expressions

The lexer already handles malformed expressions gracefully:
- Unclosed expressions (missing `'`) emit a lexer error
- The analyzer skips tokens that start with `=` or `:` regardless of content validity

### Edge Cases

1. **Empty expression**: `` `=' `` - Skipped (starts with `=`)
2. **Empty function**: `` `:' `` - Skipped (starts with `:`)
3. **Nested expressions**: `` `=`a'+`b'' `` - Outer skipped, nested refs validated
4. **Mixed content**: `` `=:test' `` - Skipped (starts with `=`)

## Testing Strategy

### Unit Tests

1. Test `is_expression_evaluation` with various inputs (empty, valid expressions, edge cases)
2. Test `is_inline_extended_function` with various inputs (empty, valid functions, edge cases)
3. Test analyzer skips inline expressions correctly
4. Test formatter spacing for extended macro functions vs prefix commands

### Property-Based Tests

Property-based testing will be used to verify the correctness properties with minimum 100 iterations per test.

1. **Property 1 Test**: Generate random expressions and function names, wrap in `` `=...' `` or `` `:...' ``, verify no undefined macro warning is emitted
2. **Property 2 Test**: Generate random undefined macro names (not starting with `=` or `:`), verify warning is emitted
3. **Property 3 Test**: Generate expressions with nested macros (some defined, some undefined), verify nested refs are validated
4. **Property 4 Test**: Generate macro assignments with extended functions, verify space before colon
5. **Property 5 Test**: Generate prefix commands with colons, verify no space added before colon

### Test Framework

- Use `fast-check` for property-based testing (already in use)
- Minimum 100 iterations per property test
- Tag format: **Feature: inline-expression-evaluation, Property N: description**

### Test File Location

Property tests: `tests/property/inline-expression-evaluation.prop.test.ts`
