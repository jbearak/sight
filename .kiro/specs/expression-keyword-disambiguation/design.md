# Design Document

## Overview

This design addresses false positive parse errors when Stata keywords (like `program`, `local`, `if`) are used as variable names within expressions. The current parser incorrectly interprets these keywords as statement starters even when they appear in expression contexts (e.g., after operators like `==`, `&`, `|`).

The fix requires changes to the parser's command parsing logic to properly handle if-qualifiers and expression contexts, ensuring that keywords appearing after operators are treated as operands rather than statement keywords.

## Architecture

The implementation follows the existing LSP architecture:

```
Source Code → Lexer → Parser (modified) → Analyzer → Providers → LSP Response
```

The key change is in the Parser component (`src/parser/index.ts`), specifically in how commands with if-qualifiers are parsed.

### Current Behavior (Problem)

When parsing `count if _merge == 1 & program == "x"`:

1. Parser sees `count` → starts parsing command
2. Parser sees `if` → adds to varlist (incorrect - should recognize as if-qualifier)
3. Parser sees `_merge` → adds to varlist
4. Parser sees `==` → stops varlist parsing (operator)
5. Remaining tokens `1 & program == "x"` are left unparsed
6. Parser sees `program` as next statement → tries to parse as `program define`
7. Error: "Expected 'define' after 'program'"

### Proposed Behavior (Solution)

When parsing `count if _merge == 1 & program == "x"`:

1. Parser sees `count` → starts parsing command
2. Parser sees `if` → recognizes as if-qualifier, switches to expression parsing mode
3. Parser consumes entire expression `_merge == 1 & program == "x"` until statement terminator
4. `program` is treated as a variable within the expression, not a keyword

## Components and Interfaces

### Modified: StataParser.parseCommand()

The `parseCommand` method needs to detect if-qualifiers and parse the following expression completely.

```typescript
private parseCommand(): CommandNode {
  // ... existing prefix parsing ...
  
  const command_token = this.advance();
  const commandName = command_token.value;
  
  // Parse variable list until if/in qualifier or comma
  const varlist: IdentifierNode[] = [];
  while (!this.check('COMMA') && !this.isTrivia() && 
         !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
    
    // Check for if-qualifier
    if (this.checkWord('if') && !this.isInExpressionContext()) {
      break; // Stop varlist, will parse if-expression next
    }
    
    // Check for in-qualifier
    if (this.checkWord('in') && !this.isInExpressionContext()) {
      break;
    }
    
    // ... existing varlist parsing ...
  }
  
  // Parse if-qualifier expression
  let if_expression: string | undefined;
  if (this.checkWord('if')) {
    this.advance(); // consume 'if'
    if_expression = this.parseIfQualifierExpression();
  }
  
  // Parse in-qualifier
  let in_expression: string | undefined;
  if (this.checkWord('in')) {
    this.advance(); // consume 'in'
    in_expression = this.parseInQualifierExpression();
  }
  
  // ... rest of command parsing ...
}
```

### New: StataParser.parseIfQualifierExpression()

A new method to parse if-qualifier expressions, consuming all tokens until statement terminator, comma, or in-qualifier.

```typescript
private parseIfQualifierExpression(): string {
  let expression = '';
  let paren_depth = 0;
  
  while (!this.isAtEnd()) {
    const token = this.peek();
    
    // Track parenthesis depth
    if (token.type === 'LPAREN') paren_depth++;
    if (token.type === 'RPAREN') paren_depth--;
    
    // Stop conditions (only at top level)
    if (paren_depth === 0) {
      // Stop at comma (options follow)
      if (token.type === 'COMMA') break;
      
      // Stop at statement terminator
      if (token.type === 'STATEMENT_TERMINATOR') break;
      
      // Stop at 'in' qualifier (not inside parens)
      if (this.checkWord('in')) break;
    }
    
    // Stop at trivia (comments)
    if (this.isTrivia()) break;
    
    // Consume token as part of expression
    const tokenValue = this.advance().value;
    if (token.type === 'WHITESPACE') {
      expression += ' ';
    } else {
      expression += tokenValue;
    }
  }
  
  return expression.trim();
}
```

### Key Design Decisions

1. **If-qualifier detection**: The parser detects `if` as a qualifier when it appears after the command name and varlist, not at the start of a statement.

2. **Expression boundary**: If-qualifier expressions end at:
   - Statement terminator (newline in CR mode, semicolon in semicolon mode)
   - Comma (options follow)
   - `in` keyword (in-qualifier follows)
   - Comments (trivia)

3. **Keyword treatment in expressions**: Once in expression-parsing mode, all WORD tokens (including keywords like `program`, `local`, `if`) are treated as identifiers/variables.

4. **Parenthesis tracking**: The parser tracks parenthesis depth to avoid stopping at commas or `in` inside function calls.

## Data Models

### Extended CommandNode

The `CommandNode` type should be extended to include if-qualifier and in-qualifier expressions:

```typescript
interface CommandNode extends StataNode {
  type: 'command';
  prefix?: PrefixNode[];
  name: string;
  fullName: string;
  varlist?: IdentifierNode[];
  ifExpression?: string;      // NEW: if-qualifier expression
  inExpression?: string;      // NEW: in-qualifier expression
  options?: OptionNode[];
  expression?: string;
  range: Range;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Keyword Disambiguation in Expressions

*For any* Stata command with an if-qualifier containing a keyword (like `program`, `local`, `global`) as a variable name after an operator, the parser SHALL treat the keyword as a variable reference and NOT emit parse errors about missing keywords (e.g., "Expected 'define' after 'program'").

**Validates: Requirements 1.1, 1.2, 1.4, 3.3**

### Property 2: Expression Continuation After Operators

*For any* if-qualifier expression containing logical operators (`&`, `|`) or comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`), the parser SHALL continue parsing the expression after the operator and include all subsequent operands.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Expression Boundary Detection

*For any* command with an if-qualifier, the parser SHALL consume all tokens in the expression until reaching a statement terminator, comma (options), or `in` keyword (in-qualifier), whichever comes first.

**Validates: Requirements 1.3, 3.2**

### Property 4: No False Parse Errors for Keywords in Expressions

*For any* valid Stata code where keywords appear as variable names in expressions, the parser SHALL NOT emit errors like "Expected 'define' after 'program'", "Expected program name", or "Missing program name".

**Validates: Requirements 1.5**

### Property 5: Complex Expression Handling

*For any* if-qualifier expression with chained conditions (e.g., `a == 1 & b == 2 & c == 3`) or parenthesized sub-expressions (e.g., `(a == 1 | b == 2) & c == 3`), the parser SHALL correctly parse the entire expression as a single unit.

**Validates: Requirements 2.4, 2.5**

### Property 6: If-Qualifier vs If-Statement Distinction

*For any* occurrence of the `if` keyword, the parser SHALL correctly distinguish between:
- If-qualifier: `if` appearing after a command name (e.g., `count if x == 1`)
- If-statement: `if` appearing at statement start (e.g., `if x == 1 { ... }`)

**Validates: Requirements 3.1, 3.4**

## Error Handling

1. **Unbalanced parentheses**: If parentheses are unbalanced in an if-qualifier expression, emit a warning but continue parsing.

2. **Empty if-expression**: If `if` is followed immediately by a terminator or comma, emit a warning about missing expression.

3. **Recovery**: On parse errors within expressions, synchronize at the next statement terminator rather than at keywords.

## Testing Strategy

### Unit Tests

- Test `count if program == "x"` parses without errors
- Test `drop if _merge == 1 & program == "dhs"` parses correctly
- Test `list if local == 1` treats `local` as variable
- Test `replace x = 1 if global > 0` treats `global` as variable
- Test if-statement `if x == 1 { ... }` still works correctly
- Test chained conditions with multiple `&` and `|` operators
- Test parenthesized expressions

### Property-Based Tests

Property-based testing validates universal properties across many generated inputs. Each property test should run minimum 100 iterations.

**Test Configuration**:
- Use fast-check for property-based testing
- Minimum 100 iterations per property
- Tag format: **Feature: expression-keyword-disambiguation, Property N: description**

**Generators needed**:
- Random Stata keywords (`program`, `local`, `global`, `if`, `while`, etc.)
- Random operators (`==`, `!=`, `&`, `|`, `<`, `>`, etc.)
- Random variable names
- Random command names with if-qualifiers
- Random expression structures (simple, chained, parenthesized)
