# Design Document: Assignment Expression Parsing

## Overview

This feature fixes the parser to correctly handle commands that use assignment expression syntax: `command [type] newvar = expression [, options]`. The current parser stops parsing the varlist when it encounters an `=` operator, leaving the expression tokens to be incorrectly parsed as a new statement. The fix modifies `parseCommand()` to detect assignment syntax and consume the entire expression.

## Architecture

The change is localized to the parser's command parsing logic. No new components are needed.

```
Source: "egen max_bidx = max(bidx), by(id)"
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Parser.parseCommand()                                       │
│                                                             │
│ 1. Parse command name: "egen"                               │
│ 2. Parse varlist: ["max_bidx"]                              │
│ 3. Detect assignment: check for OPERATOR "="                │
│ 4. Parse expression: consume until top-level comma or EOL   │
│    - Track parenthesis depth for nested function calls      │
│    - "max(bidx)" is part of expression                      │
│ 5. Parse options after comma: "by(id)"                      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
CommandNode {
  type: 'command',
  name: 'egen',
  fullName: 'egen',
  varlist: [{name: 'max_bidx', ...}],
  expression: 'max(bidx)',  // NEW field
  options: [{name: 'by', argument: 'id', ...}],
  range: ...
}
```

## Components and Interfaces

### CommandNode Extension

Add optional `expression` field to `CommandNode` in `src/types/index.ts`:

```typescript
export interface CommandNode extends BaseNode {
  type: 'command';
  prefix?: PrefixNode[];
  name: string;
  fullName: string;
  varlist?: IdentifierNode[];
  expression?: string;  // NEW: for assignment expressions
  options?: OptionNode[];
  range: Range;
}
```

### Parser Changes

Update `parseCommand()` in `src/parser/index.ts` to detect and parse assignment expressions:

```typescript
// After parsing varlist, check for assignment operator
if (this.check('OPERATOR') && this.peek().value === '=') {
  this.advance(); // consume =
  
  // Parse expression until top-level comma or statement terminator
  const expression = this.parseExpression();
  // Store expression in command node
}
```

Add new method `parseExpression()`:

```typescript
private parseExpression(): string {
  let expression = '';
  let paren_depth = 0;
  
  while (!this.isAtEnd() && !this.isTrivia()) {
    // Stop at top-level comma (option separator)
    if (this.check('COMMA') && paren_depth === 0) {
      break;
    }
    
    // Stop at statement terminator
    if (this.check('STATEMENT_TERMINATOR')) {
      break;
    }
    
    // Track parenthesis depth
    if (this.check('LPAREN')) {
      paren_depth++;
    } else if (this.check('RPAREN')) {
      paren_depth--;
    }
    
    const token = this.advance();
    expression += token.value;
  }
  
  return expression.trim();
}
```

### Pretty Printer Changes

Update `printCommand()` in `src/pretty-printer/index.ts` to output expression:

```typescript
if (node.expression) {
  result += ' = ' + node.expression;
}
```

## Data Models

### CommandNode (updated)

| Field | Type | Description |
|-------|------|-------------|
| type | 'command' | Node type discriminator |
| prefix | PrefixNode[] | Optional prefix commands |
| name | string | Command name |
| fullName | string | Expanded command name |
| varlist | IdentifierNode[] | Variable list before `=` |
| expression | string | Expression after `=` (NEW) |
| options | OptionNode[] | Options after comma |
| range | Range | Source location |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Single Command Node for Assignment Syntax

*For any* valid command with assignment syntax `command varname = expression`, the parser SHALL produce exactly one CommandNode with no parse errors.

**Validates: Requirements 1.1, 1.4, 1.5**

### Property 2: Expression Token Handling

*For any* expression containing operators, function calls, or nested parentheses, the parser SHALL include all tokens as part of the expression field, stopping only at a top-level comma or statement terminator.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Option Separation at Top-Level Comma

*For any* command with assignment syntax followed by options `command var = expr, option(args)`, the parser SHALL correctly separate the expression from options, with commas inside parentheses treated as part of the expression.

**Validates: Requirements 1.2, 1.3, 2.5**

### Property 4: Variable Extraction Preservation

*For any* `gen` or `egen` command with assignment syntax, the analyzer SHALL extract the variable name from the varlist and register it in the symbol table.

**Validates: Requirements 3.1, 3.2**

### Property 5: Error Handling Without Cascading

*For any* malformed expression in assignment syntax, the parser SHALL report at most one error and not produce cascading "Expected command name" errors.

**Validates: Requirements 4.4**

## Error Handling

| Error Condition | Handling |
|-----------------|----------|
| Missing expression after `=` | Report error, continue parsing options |
| Unbalanced parentheses in expression | Report error, attempt to recover at comma/terminator |
| Invalid tokens in expression | Include in expression string, let downstream handle |

## Testing Strategy

### Property-Based Tests (fast-check)

1. **Single command property**: Generate random assignment commands, verify single CommandNode output with no errors.

2. **Expression handling property**: Generate expressions with operators, function calls, nested parens; verify all tokens captured.

3. **Option separation property**: Generate commands with expressions and options; verify correct separation.

4. **Variable extraction property**: Generate gen/egen commands; verify variable registration.

5. **Error handling property**: Generate malformed expressions; verify single error, no cascading.

### Unit Tests

- Parse `egen x = max(y)` → single command, expression = "max(y)"
- Parse `gen x = a + b * c` → single command, expression = "a + b * c"
- Parse `egen x = max(y), by(z)` → expression = "max(y)", options = [{name: "by", argument: "z"}]
- Parse `gen x = fcn(a, b, c)` → expression includes all args
- Parse `replace x = .` → expression = "."
- Parse `gen x = ""` → expression = '""'
