# Design Document: Extended Macro Functions Recognition

## Overview

This design addresses the recognition of Stata's extended macro functions in macro definitions. The LSP currently fails to recognize macros defined using extended macro function syntax (e.g., `local name: list a - b`), causing false positive "Undefined local macro" warnings.

The fix requires changes to two components:
1. **Parser**: Recognize and parse extended macro function syntax
2. **Analyzer**: Register macros defined via extended functions in the symbol table

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Extended Macro Flow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │    Lexer     │───▶│    Parser    │───▶│    Analyzer      │   │
│  │              │    │              │    │                  │   │
│  │ • Tokenize   │    │ • Detect :   │    │ • Register       │   │
│  │   local/     │    │   after name │    │   macro in       │   │
│  │   global     │    │ • Parse func │    │   symbol table   │   │
│  │              │    │   and args   │    │ • Check refs     │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Parser Enhancement

**Current Behavior:** The parser recognizes `local name value` and `local name = expr` but not `local name: function args`.

**Solution:** Extend `parse_macro_def()` to detect the colon after the macro name and parse the extended function syntax.

```typescript
// In parser/index.ts

private parse_macro_def(): MacroDefNode | null {
    const scope_token = this.advance(); // 'local' or 'global'
    const scope = scope_token.value.toLowerCase() as 'local' | 'global';
    
    // Get macro name
    if (!this.check('WORD')) {
        return null;
    }
    const name_token = this.advance();
    const name = name_token.value;
    
    // Check for extended macro function syntax: local name: function args
    if (this.check('COLON')) {
        return this.parse_extended_macro_def(scope, name, scope_token, name_token);
    }
    
    // ... existing logic for = and direct value assignment
}

private parse_extended_macro_def(
    scope: 'local' | 'global',
    name: string,
    scope_token: Token,
    name_token: Token
): MacroDefNode {
    this.advance(); // consume ':'
    
    // Parse function name
    const func_name = this.check('WORD') ? this.advance().value : '';
    
    // Parse function arguments (rest of line)
    const func_args = this.consume_rest_of_statement();
    
    return {
        type: 'macro_def',
        scope,
        name,
        value: `: ${func_name} ${func_args}`.trim(),
        extendedFunction: {
            name: func_name,
            args: func_args,
        },
        range: this.make_range(scope_token, this.previous()),
    };
}
```

### 2. AST Node Extension

**Current MacroDefNode:**
```typescript
interface MacroDefNode {
    type: 'macro_def';
    scope: 'local' | 'global';
    name: string;
    value?: string;
    range: Range;
}
```

**Extended MacroDefNode:**
```typescript
interface MacroReference {
    name: string;           // The macro name being referenced
    range: Range;           // Position in the source for diagnostics/completions
}

interface ExtendedMacroFunction {
    name: string;           // e.g., 'list', 'word', 'subinstr'
    args: string;           // e.g., 'a - b', 'count string'
    macroRefs: MacroReference[]; // Macro references with positions
}

interface MacroDefNode {
    type: 'macro_def';
    scope: 'local' | 'global';
    name: string;
    value?: string;
    extendedFunction?: ExtendedMacroFunction;
    range: Range;
}
```

### 3. Analyzer Enhancement

**Current Behavior:** The analyzer's `process_macro_def()` already registers macros in the symbol table. No changes needed for basic registration.

**Enhancement for Macro Reference Checking:** Extract macro references from extended function arguments.

```typescript
// In analyzer/index.ts

private process_macro_def(
    node: MacroDefNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo
): void {
    // Existing registration logic (unchanged)
    const macro_symbol: MacroSymbol = {
        name: node.name,
        scope: node.scope,
        location: { uri: this.uri, range: node.range },
        sourceUri: this.uri,
        value: node.value,
        containingScope: current_scope.type,
    };

    if (node.scope === 'local') {
        current_scope.localMacros.set(node.name, macro_symbol);
        symbols.localMacros.set(node.name, macro_symbol);
    } else {
        symbols.globalMacros.set(node.name, macro_symbol);
    }
    
    // NEW: Extract and store macro references from extended function args
    if (node.extendedFunction) {
        const arg_refs = this.extract_macro_refs_from_extended_args(
            node.extendedFunction
        );
        macro_symbol.extendedFunctionRefs = arg_refs;
    }
}

private extract_macro_refs_from_extended_args(
    ext_func: ExtendedMacroFunction
): MacroReference[] {
    const refs: MacroReference[] = [];
    
    // For list functions, the arguments are macro names
    if (ext_func.name === 'list') {
        // Binary operations: "a - b", "a & b", "a | b"
        const binary_match = ext_func.args.match(/^(\w+)\s*[-&|]\s*(\w+)$/);
        if (binary_match) {
            refs.push(
                { name: binary_match[1], range: /* computed from position */ },
                { name: binary_match[2], range: /* computed from position */ }
            );
        }
        
        // Unary operations: "sizeof a", "sort a", "uniq a", "dups a", "clean a"
        const unary_match = ext_func.args.match(/^(sizeof|sort|uniq|dups|clean)\s+(\w+)$/);
        if (unary_match) {
            refs.push({ name: unary_match[2], range: /* computed from position */ });
        }
        
        // posof: 'posof "item" in a'
        const posof_match = ext_func.args.match(/^posof\s+"[^"]*"\s+in\s+(\w+)$/);
        if (posof_match) {
            refs.push({ name: posof_match[1], range: /* computed from position */ });
        }
    }
    
    // For subinstr: "local macname" or "global macname"
    if (ext_func.name === 'subinstr') {
        const subinstr_match = ext_func.args.match(/^(local|global)\s+(\w+)/);
        if (subinstr_match) {
            refs.push({ name: subinstr_match[2], range: /* computed from position */ });
        }
    }
    
    // For length: "local macname" or "global macname"
    if (ext_func.name === 'length') {
        const length_match = ext_func.args.match(/^(local|global)\s+(\w+)/);
        if (length_match) {
            refs.push({ name: length_match[2], range: /* computed from position */ });
        }
    }
    
    return refs;
}
```

## Data Models

### Extended Macro Function Types

```typescript
// Known extended macro function categories
type ListFunction = 
    | 'list'      // list operations: a - b, a & b, a | b, sizeof, posof, sort, uniq, dups, clean

type StringFunction =
    | 'word'      // word count, word # of
    | 'subinstr'  // string substitution
    | 'length'    // string/macro length
    | 'piece'     // string piece extraction

type PropertyFunction =
    | 'type'      // variable type
    | 'format'    // variable format
    | 'label'     // variable/value/data label
    | 'variable'  // variable label (alias)
    | 'value'     // value label (alias)
    | 'data'      // data label

type OtherFunction =
    | 'display'   // display expression result
    | 'permname'  // generate permissible name
    | 'tempvar'   // generate tempvar name
    | 'tempfile'  // generate tempfile name

type ExtendedFunctionName = 
    | ListFunction 
    | StringFunction 
    | PropertyFunction 
    | OtherFunction;
```

### Macro Reference Extraction Patterns

```typescript
// Patterns for extracting macro references from extended function args
const LIST_BINARY_OPS = /^(\w+)\s*[-&|]\s*(\w+)$/;  // a - b, a & b, a | b
const LIST_UNARY_OPS = /^(sizeof|sort|uniq|dups|clean)\s+(\w+)$/;
const LIST_POSOF = /^posof\s+"[^"]*"\s+in\s+(\w+)$/;
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*



### Property 1: Extended Macro Definition Recognition

*For any* valid macro name and extended macro function syntax (`local name: function args` or `global name: function args`), the analyzer SHALL register the macro in the symbol table and subsequent uses of that macro SHALL NOT produce "Undefined macro" warnings.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: List Function Operations

*For any* list operation (`list a - b`, `list a & b`, `list a | b`, `list sizeof a`, `list posof "x" in a`, `list sort a`, `list uniq a`, `list dups a`, `list clean a`), the macro being defined SHALL be recognized and registered in the symbol table.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

### Property 3: Other Extended Macro Function Recognition

*For any* extended macro function outside of list operations (including `word count`, `word # of`, `subinstr`, `type`, `format`, `label`, `variable label`, `value label`, `data label`, `display`, `length`, `piece`, `permname`, `tempvar`, `tempfile`), the macro being defined SHALL be recognized and registered in the symbol table.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15**

### Property 4: Macro Reference Validation in Extended Arguments

*For any* extended macro function that references other macros in its arguments (e.g., `local c: list a - b` where `a` and `b` are macro references), the analyzer SHALL check if those referenced macros are defined and report "Undefined macro" warnings for any that are not defined, while correctly recognizing the macro being defined (`c` in this case).

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8**

### Property 5: Completion Support for Extended Function Arguments

*For any* cursor position within extended macro function arguments (after `local name: list `, after `local name: list a - `, etc.), the completion provider SHALL suggest defined local macros that match the typed prefix.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 6: Parser AST Structure

*For any* extended macro function syntax, the parser SHALL produce a MacroDefNode with the `extendedFunction` property containing the function name, arguments, and positions of macro references within the arguments.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4**

## Error Handling

### Graceful Degradation

When the parser encounters ambiguous or malformed extended macro syntax:
1. **Missing function name**: Treat as regular macro definition with empty value
2. **Unrecognized function**: Still register the macro, just don't extract arg references
3. **Malformed arguments**: Register macro, skip reference extraction

### Error Recovery

```typescript
// Example: Recovering from malformed extended macro syntax
private parse_extended_macro_def(...): MacroDefNode {
    try {
        // Attempt to parse function and args
        return this.parse_extended_function_details(...);
    } catch (error) {
        // Fall back to treating rest of line as value
        return {
            type: 'macro_def',
            scope,
            name,
            value: this.consume_rest_of_statement(),
            range: this.make_range(scope_token, this.previous()),
        };
    }
}
```

## Testing Strategy

### Unit Tests

1. **Parser tests** for extended macro function syntax recognition
2. **Analyzer tests** for macro registration from extended functions
3. **Diagnostic tests** for correct warning behavior

### Property-Based Tests

Using fast-check to generate:
1. Random macro names with extended function syntax
2. Random list operations with defined/undefined macro references
3. Various whitespace patterns in extended syntax

### Integration Test

The `survey.do` fixture file contains `local constructed_vars: list all_vars - raw_vars` which should no longer produce an undefined macro warning for `constructed_vars` after this fix.

### Test Configuration

- Property tests: minimum 100 iterations per property
- Tag format: **Feature: extended-macro-functions, Property N: [property_text]**
- Testing framework: Jest with fast-check

