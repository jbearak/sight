# Design Document: Prefix Command Brace Block Indentation Fix

## Overview

This design addresses a false positive in the `IndentationDiagnosticAnalyzer` and incorrect behavior in the `SourcePreservingFormatter` where lines inside prefix command brace blocks (e.g., `capture { }`, `quietly { }`, `noisily { }`) are incorrectly flagged as "unnecessarily indented" and have their indentation removed by the formatter.

The root cause is that both the diagnostic analyzer and the formatter use an `is_block_node` method that only recognizes specific AST node types (`program`, `if`, `else`, `foreach`, `forvalues`, `while`, `frame`). Prefix command brace blocks are parsed as `command` nodes with `name: "{"`, which is not recognized as a block node.

## Architecture

The fix modifies two components:

1. `IndentationDiagnosticAnalyzer` in `src/providers/indentation-diagnostics.ts`
2. `IndentationAnalyzer` in `src/formatter/indentation-analyzer.ts`

Both components need to recognize `command` nodes with `name: "{"` as block nodes that increase indentation depth.

```
┌─────────────────────────────────────────────────────────────────┐
│                    IndentationDiagnosticAnalyzer                │
├─────────────────────────────────────────────────────────────────┤
│  is_block_node_type(node)                                       │
│    │                                                            │
│    ├─► Check for program, if, else, foreach, forvalues, while,  │
│    │   frame node types                                         │
│    │                                                            │
│    └─► NEW: Check for command nodes with name === "{"           │
│          (prefix command brace blocks)                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    IndentationAnalyzer (Formatter)              │
├─────────────────────────────────────────────────────────────────┤
│  is_block_node(node)                                            │
│    │                                                            │
│    ├─► Check for program, if, else, foreach, forvalues, while,  │
│    │   frame node types                                         │
│    │                                                            │
│    └─► NEW: Check for command nodes with name === "{"           │
│          (prefix command brace blocks)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Method: `is_block_node_type` (IndentationDiagnosticAnalyzer)

```typescript
/**
 * Check if a node is a block node that increases indentation depth.
 * Includes control flow blocks and prefix command brace blocks.
 */
private is_block_node_type(node: StataNode): boolean {
  // Standard control flow blocks
  if (node.type === 'program' ||
      node.type === 'if' ||
      node.type === 'else' ||
      node.type === 'foreach' ||
      node.type === 'forvalues' ||
      node.type === 'while' ||
      node.type === 'frame') {
    return true;
  }
  
  // Prefix command brace blocks (e.g., capture { }, quietly { })
  if (node.type === 'command' && node.name === '{') {
    return true;
  }
  
  return false;
}
```

### Modified Method: `is_block_node` (IndentationAnalyzer)

```typescript
private is_block_node(node: StataNode): boolean {
  // Standard control flow blocks
  if (node.type === 'program' ||
      node.type === 'if' ||
      node.type === 'else' ||
      node.type === 'foreach' ||
      node.type === 'forvalues' ||
      node.type === 'while' ||
      node.type === 'frame') {
    return true;
  }
  
  // Prefix command brace blocks (e.g., capture { }, quietly { })
  if (node.type === 'command' && node.name === '{') {
    return true;
  }
  
  return false;
}
```

### Modified Method: `compute_expected_depths` (IndentationDiagnosticAnalyzer)

The `compute_expected_depths` method needs to handle `command` nodes with `name: "{"` similarly to how it handles `ControlFlowNode` and `ProgramNode`. Since `command` nodes don't have a `body` property, we need to walk the AST differently for these nodes.

However, looking at the AST structure, prefix command brace blocks are parsed as single `command` nodes that span from the opening `{` to the closing `}`. The interior lines are not represented as child nodes in the AST.

This means we need a different approach: instead of relying on the AST's `body` property, we need to:
1. Detect when a line is inside a prefix command brace block by checking if it falls within the range of a `command` node with `name: "{"`
2. Compute the expected depth based on the nesting level of such blocks

### New Helper Method: `compute_brace_block_lines`

```typescript
/**
 * Compute a map of line numbers to their expected depth based on
 * prefix command brace blocks (command nodes with name === "{").
 * 
 * @param ast - The document's AST
 * @returns Map from line number to depth increase from brace blocks
 */
private compute_brace_block_depths(ast: StataAST): Map<number, number> {
  const brace_block_depths = new Map<number, number>();
  
  const walk_node = (node: StataNode, current_depth: number): void => {
    // Check if this is a prefix command brace block
    if (node.type === 'command' && node.name === '{') {
      const start_line = node.range.start.line;
      const end_line = node.range.end.line;
      
      // Lines inside the block (excluding start and end) get increased depth
      for (let line = start_line + 1; line < end_line; line++) {
        const existing_depth = brace_block_depths.get(line) ?? 0;
        brace_block_depths.set(line, Math.max(existing_depth, current_depth + 1));
      }
      
      // The closing brace line gets the same depth as the opening
      if (end_line !== start_line) {
        const existing_depth = brace_block_depths.get(end_line) ?? 0;
        brace_block_depths.set(end_line, Math.max(existing_depth, current_depth));
      }
    }
    
    // Recursively process child nodes (for nested blocks)
    // Note: command nodes don't have a body property, so we only recurse for block nodes
    if (this.is_block_node_type(node) && 'body' in node) {
      const block_node = node as ControlFlowNode | ProgramNode;
      for (const child of block_node.body) {
        walk_node(child, current_depth + 1);
      }
    }
  };
  
  for (const node of ast.nodes) {
    walk_node(node, 0);
  }
  
  return brace_block_depths;
}
```

## Data Models

No new data models are required. The fix uses the existing `StataNode` type and adds logic to recognize `command` nodes with `name: "{"` as block nodes.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Prefix Command Brace Block Depth Recognition

*For any* document with prefix command brace blocks (command nodes with `name: "{"`), the expected depth for lines inside the block should be one level deeper than the prefix command line.

**Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4**

### Property 2: No Unnecessary Indentation Diagnostic for Brace Block Contents

*For any* prefix command brace block with properly indented content (one level deeper than the prefix command), the `IndentationDiagnosticAnalyzer` should NOT emit an `UNNECESSARY_INDENTATION` diagnostic for lines inside the block.

**Validates: Requirements 2.1, 2.2**

### Property 3: Formatter Preserves Brace Block Indentation

*For any* document with prefix command brace blocks, formatting should preserve the indentation of lines inside the block (not remove or reduce it).

**Validates: Requirements 4.1, 4.2, 4.3**

## Error Handling

- If `document.ast` is empty or undefined, the fix falls back to existing behavior (no brace block depth adjustment).
- The fix is backward compatible: documents without prefix command brace blocks will behave exactly as before.

## Testing Strategy

### Unit Tests

1. Test that `capture { }` blocks are recognized as block nodes
2. Test that `quietly { }` blocks are recognized as block nodes
3. Test that `noisily { }` blocks are recognized as block nodes
4. Test nested prefix command brace blocks
5. Test that the formatter preserves indentation inside brace blocks

### Property-Based Tests

1. **Property 1**: Generate random documents with prefix command brace blocks and verify the expected depth is computed correctly
2. **Property 2**: Generate prefix command brace blocks with properly indented content and verify no `UNNECESSARY_INDENTATION` diagnostic is emitted
3. **Property 3**: Generate documents with prefix command brace blocks, format them, and verify indentation is preserved

### Regression Test

The test file `tests/repro_capture_block_indentation.test.ts` reproduces the exact bug and should pass after the fix.
