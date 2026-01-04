# Design Document

## Overview

This design addresses two related bugs where the LSP incorrectly handles `else` blocks containing statements that start with macro references. The root cause is that the parser doesn't recognize macro references (`MACRO_REF_LOCAL` and `MACRO_REF_GLOBAL` tokens) as valid command names, causing such statements to be skipped during parsing.

When a statement like `` `custom_arg' "arg1" "arg2" `` appears inside an `else` block, the parser fails to parse it, resulting in:
1. The `else` node having an empty `body` array
2. The indentation analyzer having no depth information for those lines
3. False positive "unnecessarily indented" diagnostics
4. The formatter incorrectly removing indentation

## Architecture

The fix involves a single change to the parser's `parseStatement` method to recognize macro reference tokens as potential command names.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Parser                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  parseStatement()                        │    │
│  │                                                          │    │
│  │  Current flow:                                           │    │
│  │  ┌─────────┐                                             │    │
│  │  │  WORD   │ ──────────────────────► parseCommand()      │    │
│  │  └─────────┘                                             │    │
│  │  ┌─────────────────┐                                     │    │
│  │  │ MACRO_REF_LOCAL │ ──► skip (BUG!)                     │    │
│  │  └─────────────────┘                                     │    │
│  │                                                          │    │
│  │  Fixed flow:                                             │    │
│  │  ┌─────────┐                                             │    │
│  │  │  WORD   │ ──────────────────────► parseCommand()      │    │
│  │  └─────────┘                                             │    │
│  │  ┌─────────────────┐                                     │    │
│  │  │ MACRO_REF_LOCAL │ ──► parseMacroCommand() ◄── NEW     │    │
│  │  └─────────────────┘                                     │    │
│  │  ┌──────────────────┐                                    │    │
│  │  │ MACRO_REF_GLOBAL │ ──► parseMacroCommand() ◄── NEW    │    │
│  │  └──────────────────┘                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Parser Changes

The `parseStatement` method in `src/parser/index.ts` needs to handle `MACRO_REF_LOCAL` and `MACRO_REF_GLOBAL` tokens as potential command names.

```typescript
// In parseStatement(), add handling for macro references as commands
} else if (this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) {
  node = this.parseMacroCommand();
}
```

### New Method: parseMacroCommand

A new method to parse commands that start with macro references:

```typescript
private parseMacroCommand(): CommandNode {
  const startToken = this.peek();
  const macroToken = this.advance(); // consume macro reference
  
  // Parse arguments (similar to parseCommand varlist parsing)
  const varlist: IdentifierNode[] = [];
  
  while (!this.check('COMMA') && !this.isTrivia() && 
         !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
    if (this.check('WORD') || this.check('STRING') || 
        this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) {
      const argToken = this.advance();
      varlist.push({
        name: argToken.value,
        range: argToken.range,
      });
    } else {
      break;
    }
  }
  
  // Parse options after comma (if present)
  const options: OptionNode[] = [];
  if (this.check('COMMA')) {
    this.advance();
    // ... option parsing similar to parseCommand
  }
  
  return {
    type: 'command',
    name: macroToken.value,
    fullName: macroToken.value,
    varlist,
    options,
    range: this.makeRange(startToken.range.start, this.previous().range.end),
  };
}
```

## Data Models

No new data models are required. The existing `CommandNode` type is sufficient to represent macro-reference commands:

```typescript
interface CommandNode {
  type: 'command';
  name: string;           // The macro reference value, e.g., "`custom_arg'"
  fullName: string;       // Same as name for macro commands
  varlist?: IdentifierNode[];
  options?: OptionNode[];
  range: Range;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Macro reference command parsing

*For any* statement starting with a local or global macro reference followed by arguments, the parser SHALL produce a command node with the macro reference as the command name and the arguments captured in the varlist.

**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: Else block body completeness

*For any* else block containing statements (including macro-reference commands), the parser SHALL produce an else node with body.length equal to the number of statements in the block.

**Validates: Requirements 1.3**

### Property 3: Indentation depth computation for nested blocks

*For any* else block at nesting level N, the indentation analyzer SHALL compute expected depth N+1 for all lines inside the else block body.

**Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6**

### Property 4: No false positive diagnostics

*For any* correctly-indented code where actual indentation equals expected indentation (depth × indent_size), the indentation diagnostic analyzer SHALL NOT emit an unnecessary indentation diagnostic.

**Validates: Requirements 2.2**

### Property 5: Formatter indentation correctness

*For any* line inside an else block, the formatter SHALL produce indentation equal to (nesting_depth + 1) × indent_size spaces.

**Validates: Requirements 3.1, 3.2**

## Error Handling

### Parser Error Handling

- If a macro-reference command has no arguments, it should still be parsed as a valid command node with an empty varlist
- If parsing fails mid-statement, the parser should recover using the existing `synchronize()` mechanism

### Indentation Analyzer Error Handling

- If the AST is unavailable or malformed, fall back to brace-based depth tracking (existing behavior)
- If a line has no expected depth in the map, default to depth 0 (existing behavior)

## Testing Strategy

### Unit Tests

1. **Parser tests**: Verify macro-reference commands are parsed correctly
   - Local macro at start of statement
   - Global macro at start of statement
   - Macro command with string arguments
   - Macro command with mixed arguments
   - Macro command inside else block
   - Macro command inside nested blocks

2. **Indentation diagnostic tests**: Verify no false positives
   - Else block with macro-reference command (the original bug case)
   - Nested else blocks with macro commands
   - Else blocks inside programs
   - Else blocks inside mata blocks

3. **Formatter tests**: Verify correct indentation
   - Format else block with macro-reference command
   - Format nested structures with macro commands

### Property-Based Tests

Property tests should use fast-check to generate:
- Random macro names (valid Stata identifiers)
- Random argument lists (strings, words, macro references)
- Random nesting structures (programs, if/else, foreach, etc.)

Each property test should run minimum 100 iterations to ensure coverage.

**Test annotations**:
- `Feature: else-block-indentation-false-positive, Property 1: Macro reference command parsing`
- `Feature: else-block-indentation-false-positive, Property 2: Else block body completeness`
- `Feature: else-block-indentation-false-positive, Property 3: Indentation depth computation`
- `Feature: else-block-indentation-false-positive, Property 4: No false positive diagnostics`
- `Feature: else-block-indentation-false-positive, Property 5: Formatter indentation correctness`
