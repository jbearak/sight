# Design Document: Varlist Parsing Consolidation

## Overview

This design describes the refactoring of the Stata parser to eliminate ~100 lines of duplicated varlist/expression/qualifier/option parsing logic in `parseCommand` by delegating to the existing `parseCommandBody` method. This follows the pattern already established by `parseFramePrefixedCommand`.

## Architecture

### Current State (Duplicated Logic)

```
parseCommand (lines ~760-970)
├── Prefix parsing
├── Special cases: unab → parseUnabCommand
├── Special cases: args → parseArgsCommand  
├── Special cases: frame prefix → parseFramePrefixedCommand → parseCommandBody
└── Standard commands: DUPLICATED varlist/option parsing (~100 lines)
    ├── File path coalescing
    ├── Varlist parsing loop (with parenthesized groups, wildcards)
    ├── Expression parsing (after =)
    ├── If-qualifier parsing
    ├── In-qualifier parsing
    └── Option parsing (after comma)

parseCommandBody (lines ~1060-1190)
└── Same varlist/option parsing logic (used only by parseFramePrefixedCommand)
```

### Target State (Consolidated Logic)

```
parseCommand
├── Prefix parsing
├── Special cases: unab → parseUnabCommand
├── Special cases: args → parseArgsCommand
├── Special cases: frame prefix → parseFramePrefixedCommand → parseCommandBody
└── Standard commands → parseCommandBody (DELEGATED)

parseCommandBody
└── Single implementation of varlist/option parsing
```


## Components and Interfaces

### Modified Component: `parseCommand`

The `parseCommand` method will be simplified to delegate to `parseCommandBody` after handling special cases:

```typescript
private parseCommand(): CommandNode {
  const start_token = this.peek();
  // ... existing prefix parsing (unchanged) ...
  
  const command_token = this.advance();
  const commandName = command_token.value;

  // Special handling for unab command (unchanged)
  if (commandName === 'unab') {
    return this.parseUnabCommand(command_token, prefixes);
  }

  // Special handling for args command (unchanged)
  if (commandName === 'args') {
    return this.parseArgsCommand(command_token, prefixes);
  }

  // Special handling for frame prefix (unchanged)
  if (commandName === 'frame' && this.check('WORD')) {
    // ... existing frame prefix detection ...
    if (is_frame_prefix) {
      return this.parseFramePrefixedCommand(frame_prefix, prefixes, start_token);
    }
  }

  // CHANGE: Delegate to parseCommandBody instead of duplicating logic
  return this.parseCommandBody(command_token, prefixes, start_token);
}
```

### Unchanged Component: `parseCommandBody`

The `parseCommandBody` method remains unchanged. It already contains the complete implementation for:
- File path coalescing for file commands
- Varlist parsing with parenthesized groups (via `parseParenthesizedGroup`)
- Wildcard operator handling (* and ?)
- Expression parsing (after =)
- If/in qualifier parsing
- Option parsing with arguments

## Data Models

No changes to data models. The `CommandNode` AST structure remains identical.


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: AST Equivalence for Standard Commands

*For any* valid Stata command that is not a special case (unab, args, frame prefix), parsing SHALL produce a correct AST with proper varlist, expression, qualifiers, and options.

**Validates: Requirements 1.4, 2.1**

### Property 2: Special Command Preservation

*For any* special command (unab, args, or frame-prefixed command), the parser SHALL continue to use the dedicated parsing methods and produce correct AST output.

**Validates: Requirements 1.2, 1.3**

## Error Handling

No changes to error handling. The refactoring preserves all existing error paths since `parseCommandBody` already handles all error cases.

## Testing Strategy

### Regression Testing

The primary validation is that existing tests continue to pass:
- Existing unit tests in `tests/unit/parser/`
- Existing property tests including `frame-prefixed-parenthesized-varlist.prop.test.ts`
- Parser roundtrip tests

### Property-Based Tests

Use fast-check to verify correctness properties:

1. **Standard Command Parsing**: Generate random valid commands, verify AST structure is correct
2. **Special Command Parsing**: Generate unab, args, and frame-prefixed commands, verify correct parsing

### Test Configuration

- Minimum 100 iterations per property test
- Use existing generators from `tests/property/generators/`
- Tag format: **Feature: varlist-parsing-consolidation, Property N: description**
