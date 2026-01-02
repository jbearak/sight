# Design Document: forvalues Parsing Fix

## Overview

This design addresses a bug in the parser's `parseLoopStatement()` function where `forvalues` loops with `=` syntax are incorrectly parsed, causing false positive "open brace must be on the same line as the condition" diagnostics.

The root cause is a flawed condition that checks if the current token (the loop variable) has a value of `=`, `in`, or `of`, when it should check the next token after the loop variable.

## Architecture

The fix is localized to `src/parser/index.ts` in the `parseLoopStatement()` method. No architectural changes are required.

```
parseLoopStatement()
├── Consume loop keyword (foreach/forvalues)
├── Parse loop variable (WORD token)
├── Check for loop spec keyword/operator  ← BUG IS HERE
│   ├── For foreach: check for 'in' or 'of' (WORD)
│   └── For forvalues: check for '=' (OPERATOR)
├── Consume loop specification tokens until '{'
├── Parse body
└── Return ControlFlowNode
```

## Components and Interfaces

### Modified Component: Parser.parseLoopStatement()

**Current (Buggy) Logic:**
```typescript
// Parse loop specification
if (this.check('WORD') && (this.peek().value === 'in' || this.peek().value === 'of' || this.peek().value === '=')) {
  const specType = this.advance().value;
  // ... collect specification until {
}
```

**Problem:** 
- `this.check('WORD')` checks if current token type is WORD
- `this.peek().value` gets the current token's value
- For `forvalues b = 1/9 {`, after consuming `b`, current token is `=` (OPERATOR type)
- `check('WORD')` returns false, so the entire block is skipped

**Fixed Logic:**
```typescript
// Parse loop specification
// For forvalues: next token is '=' (OPERATOR)
// For foreach: next token is 'in' or 'of' (WORD)
const is_forvalues_spec = this.check('OPERATOR') && this.peek().value === '=';
const is_foreach_spec = this.check('WORD') && 
    (this.peek().value.toLowerCase() === 'in' || this.peek().value.toLowerCase() === 'of');

if (is_forvalues_spec || is_foreach_spec) {
  const specType = this.advance().value;
  // ... collect specification until {
}
```

**Key Changes:**
1. Separate the check for `forvalues` (OPERATOR `=`) from `foreach` (WORD `in`/`of`)
2. Use case-insensitive comparison for `in`/`of` to match Stata's behavior
3. Keep the rest of the loop spec collection logic unchanged

## Data Models

No changes to data models. The `ControlFlowNode` interface remains unchanged:

```typescript
interface ControlFlowNode {
  type: 'if' | 'else' | 'foreach' | 'forvalues' | 'while' | 'frame';
  condition?: string;
  loopVar?: string;
  loopSpec?: string;  // Will now be correctly populated for forvalues
  body: StataNode[];
  range: Range;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: forvalues Loop Spec Parsing

*For any* valid `forvalues` statement with syntax `forvalues var = start/end {`, the parser SHALL produce a ControlFlowNode with:
- `type` equal to `'forvalues'`
- `loopVar` containing the variable name
- `loopSpec` containing `= start/end`
- `body` array (possibly empty)

**Validates: Requirements 1.1, 1.2**

### Property 2: No False Positive Brace Diagnostic

*For any* `forvalues` statement where the opening brace `{` is on the same line as the `forvalues` keyword, the parser SHALL NOT emit a diagnostic with code `OPEN_BRACE_ALONE`.

**Validates: Requirements 1.3**

### Property 3: Single-Line Loop Parsing

*For any* single-line `forvalues` loop of the form `forvalues var = range { body }`, the parser SHALL correctly parse both the loop header and the body, producing a ControlFlowNode with non-empty `body` array.

**Validates: Requirements 1.4, 3.1**

### Property 4: foreach Regression

*For any* valid `foreach` statement with syntax `foreach var in list {` or `foreach var of varlist {`, the parser SHALL produce a ControlFlowNode with:
- `type` equal to `'foreach'`
- `loopVar` containing the variable name
- `loopSpec` containing the specification starting with `in` or `of`

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 5: Invalid Brace Placement Detection

*For any* `forvalues` statement where the opening brace `{` is on a different line than the `forvalues` keyword, the parser SHALL emit a diagnostic with code `OPEN_BRACE_ALONE`.

**Validates: Requirements 3.2**

### Property 6: Continuation Line Handling

*For any* `forvalues` statement with continuation lines (using `///`) in the specification, the parser SHALL correctly parse the complete specification across lines.

**Validates: Requirements 3.3**

## Error Handling

The fix does not introduce new error conditions. Existing error handling remains:

1. **Missing closing brace**: Parser emits "Missing closing brace for forvalues statement"
2. **Brace on separate line**: Parser emits "open brace must be on the same line as the condition" (code `OPEN_BRACE_ALONE`)
3. **Code after open brace**: Parser emits "code after open brace may be silently ignored" (code `CODE_AFTER_OPEN_BRACE`)

## Testing Strategy

### Unit Tests
- Test `forvalues b = 1/9 { }` parses without errors
- Test `forvalues b = 1/9 { display \`b' }` parses body correctly
- Test `foreach x in a b c { }` still works (regression)
- Test `foreach x of local mylist { }` still works (regression)

### Property-Based Tests
Using fast-check to generate:
- Random variable names (valid Stata identifiers)
- Random range specifications (start/end integers)
- Random body commands

Each property test should run minimum 100 iterations.

**Test File Location:** `tests/property/forvalues-parsing-fix.prop.test.ts`

**Property Test Configuration:**
- Framework: fast-check
- Minimum iterations: 100 per property
- Tag format: `Feature: forvalues-parsing-fix, Property N: description`
