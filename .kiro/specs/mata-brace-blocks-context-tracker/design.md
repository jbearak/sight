# Design Document: Mata Brace-Style Blocks in Context Tracker

## Overview

This design addresses the incomplete implementation of brace-style embedded blocks (`mata { ... }` and `python { ... }`) in the ContextTracker. While commit cd6ab1b updated the lexer and parser to handle these blocks, the ContextTracker's `initialize_from_tokens()` method still only recognizes `END_MATA` and `END_PYTHON` tokens as block closers, causing false "Unclosed mata block" diagnostics.

The fix requires updating `initialize_from_tokens()` to detect when a `MATA_START` or `PYTHON_START` token is followed by an `LBRACE` on the same line, and then track brace depth to find the matching `RBRACE` that closes the block.

## Architecture

The change is localized to the `ContextTracker` class in `src/context-tracker/index.ts`. No changes are needed to the lexer, parser, or other components.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Document Store                            │
│  ┌─────────┐    ┌────────┐    ┌─────────────────────────────┐   │
│  │  Lexer  │───▶│ Tokens │───▶│     Context Tracker         │   │
│  └─────────┘    └────────┘    │  initialize_from_tokens()   │   │
│                               │  ┌─────────────────────────┐│   │
│                               │  │ Brace-style detection   ││   │
│                               │  │ - Check LBRACE after    ││   │
│                               │  │   MATA_START/PYTHON_START│   │
│                               │  │ - Track brace depth     ││   │
│                               │  │ - Close on matching }   ││   │
│                               │  └─────────────────────────┘│   │
│                               └─────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified: ContextTracker.initialize_from_tokens()

The `initialize_from_tokens()` method will be updated to:

1. **Detect brace-style blocks**: After encountering a `MATA_START` or `PYTHON_START` token, look ahead for an `LBRACE` token on the same line
2. **Track brace depth**: When in a brace-style block, increment depth on `LBRACE`, decrement on `RBRACE`
3. **Close on matching brace**: When brace depth returns to 0, close the block using the `RBRACE` as the end delimiter
4. **Skip END_MATA/END_PYTHON in brace-style blocks**: The `end` command inside a brace-style block should not close the embedded context

### New State Variables

```typescript
// Inside initialize_from_tokens loop:
let my_is_brace_style = false;      // Whether current block is brace-style
let my_brace_depth = 0;             // Current brace nesting depth
let my_block_start_line: number | undefined;  // Line where block started
```

### Algorithm

```
FOR each token:
  IF token is MATA_START or PYTHON_START (not inline):
    Start new embedded block
    Record block start line
    Look ahead for LBRACE on same line:
      IF found: mark as brace-style, set brace_depth = 0
      ELSE: mark as traditional
  
  ELSE IF token is LBRACE:
    IF in brace-style block:
      IF brace_depth == 0 AND token on same line as block start:
        brace_depth = 1  // Opening brace of block
      ELSE:
        brace_depth++    // Nested brace
  
  ELSE IF token is RBRACE:
    IF in brace-style block AND brace_depth > 0:
      brace_depth--
      IF brace_depth == 0:
        Close block with RBRACE as end delimiter
        Reset brace-style state
  
  ELSE IF token is END_MATA or END_PYTHON:
    IF NOT in brace-style block:
      Close block with END token as end delimiter
```

## Data Models

No new data models are required. The existing `ContextRange` interface already supports storing the end delimiter command, which can be either `"end"` or `"}"`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Brace-style block closure

*For any* brace-style embedded block (mata or python) where the opening `{` appears on the same line as the keyword and a matching `}` exists, the Context_Tracker SHALL recognize the block as properly closed and NOT emit an "Unclosed block" diagnostic.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Traditional block closure

*For any* traditional embedded block (mata or python) that is closed with an `end` command, the Context_Tracker SHALL continue to recognize the block as properly closed.

**Validates: Requirements 1.4**

### Property 3: Nested brace handling

*For any* brace-style embedded block containing nested braces, the Context_Tracker SHALL correctly identify the outermost closing brace (when brace depth returns to 0) as the block terminator.

**Validates: Requirements 2.1**

### Property 4: Brace-style vs traditional detection

*For any* embedded block, IF the keyword is followed by `{` on the same line THEN it SHALL be treated as brace-style (closed by `}`), ELSE it SHALL be treated as traditional (closed by `end`).

**Validates: Requirements 3.1, 3.2**

### Property 5: Unclosed traditional block detection

*For any* traditional embedded block that is missing its `end` command, the Context_Tracker SHALL emit an "Unclosed mata/python block" diagnostic.

**Validates: Requirements 3.3**

### Property 6: Brace-style blocks inside programs

*For any* program definition containing a brace-style mata block, the Context_Tracker SHALL correctly identify the mata block as closed by `}` and the program as closed by `end`, emitting no unclosed block diagnostics.

**Validates: Requirements 4.1, 4.2**

## Error Handling

- **Unclosed brace-style block**: If a brace-style block reaches EOF without the closing `}`, emit "Unclosed mata/python block" diagnostic (same as traditional blocks)
- **Mismatched braces**: If brace depth goes negative (more `}` than `{`), the extra `}` is not part of the embedded block and should be ignored by the context tracker

## Testing Strategy

### Unit Tests

1. Test brace-style mata block detection and closure
2. Test brace-style python block detection and closure
3. Test nested braces within brace-style blocks
4. Test traditional blocks still work (regression)
5. Test brace-style blocks inside program definitions
6. Test unclosed brace-style blocks emit diagnostics
7. Test `{` on next line is NOT treated as brace-style

### Property-Based Tests

Use fast-check to generate:
- Random embedded block content
- Random nesting depths
- Random combinations of brace-style and traditional blocks
- Random program definitions with embedded blocks

Each property test should run minimum 100 iterations and be tagged with the property it validates.

**Testing Framework**: Bun test with fast-check for property-based testing (consistent with existing codebase).
