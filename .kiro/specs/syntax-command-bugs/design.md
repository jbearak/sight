# Design Document: Syntax Command Bug Fixes

## Overview

This design addresses two bugs in the Stata LSP's handling of the `syntax` command:

1. **Prefixed syntax parsing**: When `syntax` follows a prefix command like `qui`, it's incorrectly parsed as a regular command, causing `[if]` argument specifiers to be misinterpreted as control flow statements.

2. **Weight argument recognition**: The `[weight]` argument type and its variants are not recognized, causing false "undefined local macro" warnings.

## Architecture

The fix requires changes to two components:

```
┌─────────────────────────────────────────────────────────────┐
│                        Parser                                │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ parseCommand()  │───▶│ Check for 'syntax' after prefix │ │
│  │                 │    │ Route to parseSyntaxCommand()   │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ parse_argument_spec()                                   ││
│  │ - Add 'weight', 'fweight', 'fw', 'aweight', 'aw',      ││
│  │   'pweight', 'pw', 'iweight', 'iw' to standard_types   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       Analyzer                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ get_implicit_local_name()                               ││
│  │ - For weight types, return 'weight'                     ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ register_implicit_locals()                              ││
│  │ - For weight arguments, also register 'exp'             ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Component 1: Parser (`src/parser/index.ts`)

#### Change 1.1: Handle syntax command after prefix

In `parseCommand()`, after consuming prefix commands and before parsing as a regular command, check if the command name is `syntax` and route to `parseSyntaxCommand()`.

```typescript
// In parseCommand(), after prefix parsing and before regular command parsing:
const command_token = this.advance();
const commandName = command_token.value;

// Special handling for syntax command after prefix
if (commandName === 'syntax') {
  // Put the token back and delegate to parseSyntaxCommand
  this.current--;
  const syntax_node = this.parseSyntaxCommand();
  // Attach prefixes to the syntax node
  if (prefixes.length > 0) {
    syntax_node.prefix = prefixes;
    syntax_node.range = this.makeRange(startToken.range.start, syntax_node.range.end);
  }
  return syntax_node as unknown as CommandNode;
}
```

#### Change 1.2: Add weight types to standard_types

In `parse_argument_spec()`, extend the `standard_types` array to include weight argument types:

```typescript
const standard_types = [
  'varlist',
  'varname',
  'newvarname',
  'anything',
  'if',
  'in',
  'using',
  'name',
  'namelist',
  // Weight types
  'weight',
  'fweight', 'fw',
  'aweight', 'aw',
  'pweight', 'pw',
  'iweight', 'iw',
];
```

### Component 2: Analyzer (`src/analyzer/index.ts`)

#### Change 2.1: Map weight types to 'weight' implicit local

In `get_implicit_local_name()`, map all weight type variants to the canonical name 'weight':

```typescript
private get_implicit_local_name(arg: ArgumentSpec): string | null {
  if (arg.type === 'anything' && arg.name) {
    return arg.name;
  }
  
  // Weight types all create a 'weight' implicit local
  const weight_types = ['weight', 'fweight', 'fw', 'aweight', 'aw', 'pweight', 'pw', 'iweight', 'iw'];
  if (weight_types.includes(arg.type)) {
    return 'weight';
  }
  
  return arg.type;
}
```

#### Change 2.2: Register 'exp' for weight arguments

In `register_implicit_locals()`, when registering a weight argument, also register 'exp':

```typescript
private register_implicit_locals(
  signature: ProgramSignature,
  current_scope: ScopeInfo,
  symbols: SymbolTable,
  node_index: number
): void {
  const weight_types = ['weight', 'fweight', 'fw', 'aweight', 'aw', 'pweight', 'pw', 'iweight', 'iw'];
  
  for (const arg of signature.arguments) {
    const arg_name = this.get_implicit_local_name(arg);
    if (arg_name) {
      // Register the argument as implicit local
      const macro_symbol: MacroSymbol = {
        name: arg_name,
        scope: 'local',
        location: { uri: this.uri, range: arg.range },
        sourceUri: this.uri,
        containingScope: current_scope.type,
        definition_index: node_index,
        definition_line: arg.range.start.line,
      };
      current_scope.localMacros.set(arg_name, macro_symbol);
      symbols.localMacros.set(arg_name, macro_symbol);
      
      // For weight types, also register 'exp'
      if (weight_types.includes(arg.type)) {
        const exp_symbol: MacroSymbol = {
          name: 'exp',
          scope: 'local',
          location: { uri: this.uri, range: arg.range },
          sourceUri: this.uri,
          containingScope: current_scope.type,
          definition_index: node_index,
          definition_line: arg.range.start.line,
        };
        current_scope.localMacros.set('exp', exp_symbol);
        symbols.localMacros.set('exp', exp_symbol);
      }
    }
  }
  
  // ... rest of option registration unchanged
}
```

## Data Models

### ArgumentSpec Type Extension

The `ArgumentSpec` type in `src/types/index.ts` already supports arbitrary type strings. No changes needed to the type definition, but the parser will now produce ArgumentSpec objects with weight-related type values.

### SyntaxNode Prefix Support

The `SyntaxNode` type needs to support an optional `prefix` property to store prefix commands:

```typescript
export interface SyntaxNode extends BaseNode {
  type: 'syntax';
  signature: ProgramSignature;
  prefix?: PrefixNode[];  // Add this
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Prefixed syntax command parsing

*For any* program containing a syntax command preceded by any valid prefix command (quietly, capture, noisily, etc.), the parser should:
- Produce a SyntaxNode (not CommandNode) for the syntax statement
- Not produce any ControlFlowNode for `[if]` or `[in]` argument specifiers
- Not emit "Missing end for program definition" errors
- Correctly extract the program signature with all arguments and options

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Weight argument implicit locals

*For any* syntax command containing a weight argument type (weight, fweight, fw, aweight, aw, pweight, pw, iweight, iw), the analyzer should:
- Register 'weight' as an implicit local macro
- Register 'exp' as an implicit local macro
- Not emit "Undefined local macro" diagnostics for references to `weight` or `exp` after the syntax command

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

### Property 3: Regression - existing functionality preserved

*For any* syntax command (with or without prefix, with or without weight arguments), the parser should:
- Continue to recognize all existing argument types (varlist, varname, newvarname, anything, if, in, using, name, namelist, exp)
- Continue to correctly parse syntax options after the comma
- Produce valid SyntaxNode with correct signature

**Validates: Requirements 3.1, 3.2, 3.3**

## Error Handling

No new error conditions are introduced. The changes are additive:
- New weight types are recognized in addition to existing types
- Syntax commands after prefixes are now correctly routed

If an unrecognized argument type is encountered, the existing behavior (skip and continue) is preserved.

## Testing Strategy

### Unit Tests

1. **Parser tests** (`tests/unit/parser.test.ts`):
   - Test `qui syntax anything [if] [in]` produces SyntaxNode
   - Test `capture syntax varlist, option` produces SyntaxNode with prefix
   - Test `syntax [weight]` recognizes weight argument
   - Test all weight variants (fw, aw, pw, iw, fweight, aweight, pweight, iweight)

2. **Analyzer tests** (`tests/unit/analyzer.test.ts`):
   - Test weight argument registers both 'weight' and 'exp' locals
   - Test no undefined macro warnings for weight/exp references

### Property-Based Tests

Property tests should use fast-check to generate:
- Random prefix commands followed by syntax commands
- Random combinations of weight type variants
- Random argument and option combinations

Each property test should run minimum 100 iterations and reference the design document property it validates.

**Testing Framework**: Use Bun's built-in test runner with fast-check for property-based testing.
