# Design Document: gettoken Macro Creation

## Overview

This design adds support for the Stata `gettoken` command in the semantic analyzer. The `gettoken` command extracts the first token from a string macro and optionally stores the remainder in a second macro. The implementation follows the existing patterns for macro-creating commands like `args`, `unab`, and `tempvar`.

## Architecture

The implementation extends the existing `SemanticAnalyzer` class in `src/analyzer/index.ts` by adding a new extraction method `extract_gettoken_macros` that is called from `process_command` when a `gettoken` command is encountered.

```
┌─────────────────────────────────────────────────────────────┐
│                    SemanticAnalyzer                          │
├─────────────────────────────────────────────────────────────┤
│  process_command(node)                                       │
│    ├── cmd_name === 'gettoken'                              │
│    │   └── extract_gettoken_macros(node, symbols, scope)    │
│    ├── cmd_name === 'args'                                  │
│    │   └── extract_args_macros(...)                         │
│    ├── cmd_name === 'unab'                                  │
│    │   └── extract_unab_macro(...)                          │
│    └── ... other commands                                   │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Component: SemanticAnalyzer

**Location:** `src/analyzer/index.ts`

**New Method:**
```typescript
/**
 * Extract macros from gettoken command.
 * gettoken extracts the first token from a string and optionally stores the remainder.
 * Syntax: gettoken macname1 [macname2] : macname3 [, options]
 * 
 * @param node - The command node for gettoken
 * @param symbols - The symbol table to update
 * @param current_scope - The current scope info
 * @param node_index - The preorder traversal index for forward reference detection
 */
private extract_gettoken_macros(
    node: CommandNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    node_index: number
): void
```

**Modified Method:** `process_command`
- Add case for `cmd_name === 'gettoken'` to call `extract_gettoken_macros`

### Parsing Strategy

The `gettoken` command has the syntax:
```
gettoken macname1 [macname2] : macname3 [, options]
```

The parser already handles `gettoken` as a regular command. The varlist will contain the tokens before the colon. We need to:

1. Find the colon separator in the command's raw tokens or expression
2. Extract macro names before the colon (1 or 2 names)
3. Register each extracted name as a local macro

**Implementation approach:**
- Use `node.varlist` to get the macro names before the colon
- The parser treats tokens before `:` as the varlist
- If varlist has 1 element: single output macro (macname1)
- If varlist has 2 elements: two output macros (macname1, macname2)

## Data Models

No new data models are required. The implementation uses existing types:

- `MacroSymbol` - Represents a local macro in the symbol table
- `CommandNode` - The AST node for the gettoken command
- `ScopeInfo` - Tracks the current scope (program or dofile)
- `SymbolTable` - Contains all defined symbols

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Single Output Macro Registration

*For any* valid `gettoken macname1 : macname3` command with a valid identifier `macname1`, analyzing the code SHALL result in `macname1` being registered as a local macro in the symbol table.

**Validates: Requirements 1.1, 2.1, 2.2**

### Property 2: Two Output Macro Registration

*For any* valid `gettoken macname1 macname2 : macname3` command with valid identifiers `macname1` and `macname2`, analyzing the code SHALL result in both `macname1` and `macname2` being registered as local macros in the symbol table.

**Validates: Requirements 1.2, 2.3**

### Property 3: Options Do Not Interfere

*For any* valid `gettoken` command with options (e.g., `parse()`, `quotes`, `qed()`, `match()`, `bind`), the macro names before the colon SHALL still be correctly extracted and registered.

**Validates: Requirements 2.4**

### Property 4: No Warning for Post-Definition References

*For any* code where a `gettoken` command defines a macro and that macro is referenced after the `gettoken` command, the analyzer SHALL NOT emit an "undefined local macro" warning for that reference.

**Validates: Requirements 1.3**

### Property 5: Warning for Pre-Definition References

*For any* code where a macro is referenced before a `gettoken` command that defines it, the analyzer SHALL emit an "undefined local macro" warning for that forward reference.

**Validates: Requirements 1.4**

### Property 6: Correct Scope Assignment

*For any* `gettoken` command, whether inside a program definition or at the do-file level, the created macros SHALL be registered in the appropriate local scope (program scope or dofile scope).

**Validates: Requirements 3.1, 3.2**

### Property 7: Definition Position Tracking

*For any* macro created by `gettoken`, the `definition_index` and `definition_line` fields SHALL be set to the position of the `gettoken` command, enabling correct forward reference detection.

**Validates: Requirements 3.3**

## Error Handling

The implementation handles edge cases gracefully:

1. **Empty varlist**: If `gettoken` has no varlist (malformed command), no macros are registered
2. **Invalid identifiers**: If a macro name is not a valid identifier (e.g., contains macro references like `` `name' ``), it is skipped
3. **Missing colon**: The parser handles this; the analyzer only processes what the parser provides

## Testing Strategy

### Property-Based Tests

Property-based tests will use fast-check to generate random valid Stata code and verify the properties hold:

- **Test file:** `tests/property/gettoken-macro-creation.prop.test.ts`
- **Minimum iterations:** 100 per property
- **Generator:** Create generators for valid macro names and gettoken command variations

### Unit Tests

Unit tests will cover specific examples and edge cases:

- **Test file:** `tests/unit/gettoken-macro-creation.test.ts`
- Single output macro: `gettoken first : input`
- Two output macros: `gettoken first rest : input`
- With options: `gettoken first : input, parse(" ")`
- Inside program: `program test ... gettoken ... end`
- Forward reference detection
- Edge cases: empty varlist, invalid identifiers
