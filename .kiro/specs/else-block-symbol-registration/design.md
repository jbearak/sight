# Design Document: Else Block Symbol Registration

## Overview

This design addresses a bug in the semantic analyzer where macro definitions inside `else` blocks are not registered in the symbol table. The fix is straightforward: add `else` to the list of control flow node types handled in the `process_node` method.

## Architecture

The fix involves a single-line change to the `process_node` method in `src/analyzer/index.ts`. The existing `process_control_flow` method already handles all control flow nodes correctly - it simply calls `build_symbols` on the node's body. The bug is that `else` nodes are not being routed to this method.

### Current Code Flo: variable label s607cw

```
process_node(node) → switch(node.type)
  ├── 'if' → process_control_flow(node) → build_symbols(node.body) ✓
  ├── 'while' → process_control_flow(node) → build_symbols(node.body) ✓
  ├── 'frame' → process_control_flow(node) → build_symbols(node.body) ✓
  ├── 'else' → default (no-op) ✗ BUG!
  └── default → (no symbol processing)
```

### Fixed Code Flow

```
process_node(node) → switch(node.type)
  ├── 'if' → process_control_flow(node) → build_symbols(node.body) ✓
  ├── 'else' → process_control_flow(node) → build_symbols(node.body) ✓ FIXED
  ├── 'while' → process_control_flow(node) → build_symbols(node.body) ✓
  ├── 'frame' → process_control_flow(node) → build_symbols(node.body) ✓
  └── default → (no symbol processing)
```

## Components and Interfaces

### Modified Component: SemanticAnalyzer

**File**: `src/analyzer/index.ts`

**Method**: `process_node`

**Change**: Add `'else'` case to the switch statement alongside `'if'`, `'while'`, and `'frame'`.

```typescript
case 'if':
case 'else':  // ADD THIS LINE
case 'while':
case 'frame':
    this.process_control_flow(node, symbols, current_scope, all_scopes);
    break;
```

## Data Models

No changes to data models are required. The existing `ControlFlowNode` type already includes `else` as a valid node type, and the `is_control_flow` type guard already recognizes `else` nodes.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Property 1: Else block macro registration
*For any* Stata source containing a macro definition inside an `else` block, analyzing the source SHALL result in that macro being present in the symbol table's localMacros (for `local`) or globalMacros (for `global`).
**Validates: Requirements 1.1, 1.2**

Property 2: No false positives for else-defined macros
*For any* Stata source where a macro is defined in an `else` block and referenced after the block, analyzing the source SHALL NOT produce an "undefined macro" diagnostic for that reference.
**Validates: Requirements 1.3**

Property 3: Nested else block processing
*For any* Stata source with nested control flow inside an `else` block (e.g., `else { if { local x = 1 } }`), analyzing the source SHALL register all macros defined at any nesting level.
**Validates: Requirements 1.4**

Property 4: Extended macro function registration in else blocks
*For any* Stata source with an extended macro function definition inside an `else` block (e.g., `else { local x: variable label varname }`), analyzing the source SHALL register the macro in the symbol table with its extendedFunction property populated.
**Validates: Requirements 1.5**

Property 5: Parity between if and else branches
*For any* Stata source with macro definitions in both `if` and `else` branches, analyzing the source SHALL register macros from both branches in the symbol table.
**Validates: Requirements 2.1, 2.2**

## Error Handling

No new error handling is required. The existing `process_control_flow` method handles all edge cases (empty bodies, nested structures, etc.).

## Testing Strategy

### Unit Tests
- Test macro definition in simple `else` block
- Test macro definition in nested `else` block
- Test extended macro function in `else` block
- Test both `if` and `else` branches defining macros

### Property-Based Tests
- Generate random Stata code with `else` blocks containing macro definitions
- Verify all macros are registered in the symbol table
- Verify no false positive diagnostics are emitted

### Testing Framework
- Use Bun's built-in test runner with fast-check for property-based testing
- Minimum 100 iterations per property test
