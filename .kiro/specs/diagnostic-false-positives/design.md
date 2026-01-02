# Design Document: Diagnostic False Positives Fix

## Overview

This design addresses three categories of false positive diagnostics in the Stata LSP:

1. **Compound quote string parsing** - The lexer incorrectly interprets single quotes inside compound strings as closing delimiters
2. **Args command macro scope** - The analyzer doesn't handle forward references to macros defined by `args` commands
3. **Macro paths in do/run/include** - The forward scope resolver emits file-not-found warnings for paths containing macro references

## Architecture

The fix involves modifications to three existing components:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Lexer                                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ scanCompoundString()                                     │    │
│  │ - Fix: Only treat "' as closing delimiter               │    │
│  │ - Fix: Handle `name' macro refs inside compound strings │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Analyzer                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ extract_args_macros()                                    │    │
│  │ - Already registers macros correctly                     │    │
│  │ - Fix: Set definition_index to 0 for file-scope validity│    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ detect_forward_call()                                    │    │
│  │ - Already detects macro paths via has_macro flag         │    │
│  │ - Sets is_static: false for macro paths                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Forward Scope Resolver                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ resolve()                                                │    │
│  │ - Already filters to static_calls only                   │    │
│  │ - Non-static calls (macro paths) are skipped             │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Component 1: Lexer - Inline Mata/Python Context Handling

**File:** `src/lexer/index.ts`

**Current Issue:** When the lexer encounters `mata:` (inline Mata), it pushes the Mata context but never pops it. This causes all subsequent code to be parsed in Mata context, leading to incorrect tokenization and cascading errors.

**Root Cause Analysis:**
1. Lexer sees `mata:` → creates `MATA_INLINE` token and pushes Mata context
2. Subsequent tokens are scanned in Mata context (strings handled differently)
3. The context is never popped because there's no `end` statement for inline Mata
4. All code after `mata:` is incorrectly parsed as Mata code
5. This causes "unclosed string literal" errors because Mata string handling differs from Stata

**Fix:** For inline Mata/Python (`mata:` or `python:`), the lexer should NOT push the embedded language context. The inline command executes a single expression and returns to Stata context immediately.

```typescript
// In scanWord, when handling mata:
if (this.peek() === ':') {
  this.advance(); // consume the colon
  const full_value = value + ':';
  // FIX: Do NOT push context for inline mata/python
  // The inline command is a single expression, not a block
  return {
    type: 'MATA_INLINE',
    value: full_value,
    range: this.makeRange(startLine, startColumn, this.line, this.column),
  };
}
```

The context tracker already handles `MATA_INLINE` specially by marking `is_single_line: true`, so the higher-level components will work correctly once the lexer stops pushing context for inline commands.

### Component 2: Analyzer - Args Command Scope

**File:** `src/analyzer/index.ts`

**Current Issue:** The `extract_args_macros` function registers macros with `definition_index: node_index`, which means forward reference checking treats references before the `args` command as undefined.

**Root Cause Analysis:**
The analyzer uses `definition_index` to track where a macro is defined in the AST traversal order. References are checked against this index - if a reference appears before the definition index, it's flagged as a forward reference warning.

For `args` commands, this is incorrect because:
1. `args` is typically at the top of a program/file
2. The macros it defines should be valid throughout the entire scope
3. Unlike regular `local` definitions, `args` macros represent parameters passed in

**Fix:** Set `definition_index: 0` for macros defined by `args` command, making them valid from the start of the scope.

```typescript
private extract_args_macros(
    node: CommandNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    node_index: number
): void {
    if (node.varlist && node.varlist.length > 0) {
        for (const my_var_node of node.varlist) {
            const macro_name = my_var_node.name;
            
            const macro_symbol: MacroSymbol = {
                name: macro_name,
                scope: 'local',
                location: { uri: this.uri, range: my_var_node.range },
                sourceUri: this.uri,
                value: `__args_${macro_name}__`,
                containingScope: current_scope.type,
                // FIX: Use 0 instead of node_index to make args macros
                // valid from the start of the scope
                definition_index: 0,
                definition_line: 0,
            };

            current_scope.localMacros.set(macro_name, macro_symbol);
            symbols.localMacros.set(macro_name, macro_symbol);
        }
    }
}
```

## Data Models

No new data models are required. The fix uses existing structures:

- `MacroSymbol.definition_index`: Changed to `0` for args-defined macros
- `ForwardCall.is_static`: Already correctly set based on macro detection

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Inline Mata Context Isolation

*For any* code containing an inline Mata command (`mata: expression`), the lexer SHALL NOT change the language context for subsequent lines, and all code after the inline command SHALL be tokenized using Stata rules.

**Validates: Requirements 1.1, 1.3, 1.5**

### Property 2: Inline Python Context Isolation

*For any* code containing an inline Python command (`python: expression`), the lexer SHALL NOT change the language context for subsequent lines, and all code after the inline command SHALL be tokenized using Stata rules.

**Validates: Requirements 1.2, 1.3**

### Property 3: Full Mata Block Context

*For any* code containing a full Mata block (starting with `mata` on its own line), the lexer SHALL maintain Mata context until an `end` statement is encountered.

**Validates: Requirements 1.4**

### Property 4: Args Command Macro Scope

*For any* `args` command defining local macros, references to those macros anywhere in the containing scope (before or after the `args` command) SHALL NOT produce "undefined local macro" warnings.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 5: Undefined Macro Detection

*For any* local macro reference where no definition exists (via `args`, `local`, or other means), the analyzer SHALL emit an "undefined local macro" warning.

**Validates: Requirements 2.4**

### Property 6: Macro Path Diagnostic Suppression

*For any* `do`/`run`/`include` command where the path contains a macro reference (backtick or dollar sign character), the forward scope resolver SHALL NOT emit a "cannot read file" diagnostic.

**Validates: Requirements 3.1, 3.2**

### Property 7: Static Path File Checking

*For any* `do`/`run`/`include` command where the path is static (no macro references), the forward scope resolver SHALL check file existence and emit appropriate diagnostics for missing files.

**Validates: Requirements 3.3, 3.4**

## Error Handling

### Lexer Errors

- Unclosed compound strings: Emit error at the position where the string started
- Malformed macro references: Emit error and continue parsing

### Analyzer Warnings

- Undefined macros: Emit warning at the reference location
- Forward references to non-args macros: Continue to emit warnings (existing behavior)

### Forward Scope Resolver

- Missing static files: Emit "Cannot read file" warning
- Macro paths: Silently skip (no diagnostic)

## Testing Strategy

### Unit Tests

1. **Lexer compound string tests:**
   - Test `` `"`name'"` `` parses without error
   - Test `` `"text `macro' more"'` `` parses correctly
   - Test unclosed `` `"text `` emits error

2. **Analyzer args tests:**
   - Test `args x y z` registers three local macros
   - Test references before `args` don't produce warnings
   - Test undefined macros still produce warnings

3. **Forward scope resolver tests:**
   - Test macro paths are marked as non-static
   - Test non-static paths don't produce diagnostics

### Property-Based Tests

Using fast-check, implement property tests for each correctness property above. Each test should:
- Generate random valid inputs
- Run minimum 100 iterations
- Tag with property number for traceability

**Testing Framework:** Jest with fast-check for property-based testing

**Property Test Configuration:**
- Minimum 100 iterations per property
- Tag format: `Feature: diagnostic-false-positives, Property N: <description>`
