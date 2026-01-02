# Design Document: Quoted Path Parsing Fix

## Overview

This design addresses a bug in the Stata LSP parser where STRING tokens (quoted paths) are not captured in the `varlist` of `CommandNode`. The fix is minimal: extend the varlist parsing loop in `parseCommand()` to also accept STRING tokens alongside WORD and MACRO_REF tokens.

## Architecture

The fix is localized to a single method in the parser:

```
src/parser/index.ts
└── StataParser.parseCommand()
    └── varlist parsing loop (line ~656)
```

No new components are needed. The change is a one-line modification to the token type check.

## Components and Interfaces

### Modified Component: StataParser.parseCommand()

**Current Implementation (Bug):**
```typescript
// Parse variable list (stop at comma, statement terminator, or comment)
const varlist: IdentifierNode[] = [];
while ((this.check('WORD') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) && !this.check('COMMA') && !this.isTrivia()) {
  const varToken = this.advance();
  varlist.push({
    name: varToken.value,
    range: varToken.range,
  });
}
```

**Fixed Implementation:**
```typescript
// Parse variable list (stop at comma, statement terminator, or comment)
// Include STRING tokens to capture quoted paths in do/run/include commands
const varlist: IdentifierNode[] = [];
while ((this.check('WORD') || this.check('STRING') || this.check('MACRO_REF_LOCAL') || this.check('MACRO_REF_GLOBAL')) && !this.check('COMMA') && !this.isTrivia()) {
  const varToken = this.advance();
  varlist.push({
    name: varToken.value,
    range: varToken.range,
  });
}
```

The only change is adding `|| this.check('STRING')` to the condition.

### Affected Downstream Components

1. **ForwardScopeResolver**: Will now receive quoted paths in `CommandNode.varlist`, enabling correct path resolution with `@lsp-working-directory`

2. **Analyzer**: The `extract_forward_calls()` method already handles quoted paths by stripping quotes - no changes needed

## Data Models

No changes to data models. The existing `IdentifierNode` and `CommandNode` interfaces are sufficient:

```typescript
interface IdentifierNode {
  name: string;  // Will contain the full quoted string, e.g., `"path/to/file.do"`
  range: Range;
}

interface CommandNode {
  type: 'command';
  name: string;
  varlist?: IdentifierNode[];  // Now includes STRING tokens
  // ...
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: All Argument Token Types Captured in Varlist

*For any* command with any combination of WORD, STRING, MACRO_REF_LOCAL, and MACRO_REF_GLOBAL tokens before a comma or statement terminator, all tokens should be captured in the varlist in the order they appear.

**Validates: Requirements 1.1, 1.5, 2.1, 3.1, 3.2**

### Property 2: Comma Boundary Respected

*For any* command with arguments followed by a comma and options, the varlist should contain only the tokens before the comma, and options should be parsed separately.

**Validates: Requirements 3.3**

### Property 3: Quoted Path Integration with Working Directory

*For any* `do`, `run`, or `include` command with a quoted path and an `@lsp-working-directory` directive, the path should be resolved relative to the specified working directory.

**Validates: Requirements 4.1**

## Error Handling

No new error handling is needed. The parser already handles:
- Malformed strings (lexer emits error)
- Missing files (ForwardScopeResolver emits diagnostic)
- Invalid paths (existing path resolution logic)

## Testing Strategy

### Property-Based Tests

Property-based tests will use `fast-check` with minimum 100 iterations per property.

**Property 1 Test**: Generate random commands with various token combinations (WORD, STRING, MACRO_REF) and verify all are captured in varlist.

**Property 2 Test**: Generate commands with arguments and options, verify comma boundary is respected.

**Property 3 Test**: Generate `do`/`run`/`include` commands with quoted paths and working directory directives, verify path resolution.

### Unit Tests

Unit tests will cover specific examples:
- `do "path/to/file.do"` → varlist contains `"path/to/file.do"`
- `run "scripts/helper.do"` → varlist contains `"scripts/helper.do"`
- `include "lib/utils.do"` → varlist contains `"lib/utils.do"`
- `` do `"path with spaces.do"' `` → varlist contains compound quoted path
- `do myfile.do` → varlist contains `myfile.do` (regression)
- `do "file.do", option` → varlist contains only `"file.do"`, options parsed separately

### Integration Tests

Verify end-to-end behavior with `@lsp-working-directory`:
- Script with `@lsp-working-directory: "subdir"` and `do "helper.do"` resolves to `subdir/helper.do`
