# Design Document

## Overview

This design addresses a bug in the PrettyPrinter where frame blocks and prefix command brace blocks are deleted during formatting. The issue occurs because:

1. The `printControlFlow` method handles `if`, `else`, `foreach`, `forvalues`, and `while` nodes, but not `frame` nodes
2. The `printCommand` method doesn't check for or handle the optional `body` property that exists on CommandNode for prefix command brace blocks

The fix involves:
- Adding a `frame` case to the `printControlFlow` method
- Adding logic to `printCommand` to detect and handle CommandNode with a body property
- Ensuring both types of blocks follow the same formatting patterns as other control flow structures

## Architecture

The PrettyPrinter is located in `src/pretty-printer/index.ts` and is responsible for converting AST nodes back into formatted Stata source code. It maintains state for:
- Current indentation level
- Delimiter mode (cr vs semicolon)
- Print options (indent size, indent style, line width)

The printer uses a visitor pattern where `printNode` dispatches to specialized methods based on node type:
- `printCommand` for CommandNode
- `printControlFlow` for ControlFlowNode (if, else, foreach, forvalues, while, frame)
- `printProgram` for ProgramNode
- etc.

## Components and Interfaces

### Modified Methods

#### `printControlFlow(node: ControlFlowNode): string`

**Current behavior:**
- Handles `if`, `else`, `foreach`, `forvalues`, `while` via switch statement
- Does not handle `frame` type
- Returns empty string for unhandled types (causing deletion)

**New behavior:**
- Add `case 'frame':` to the switch statement
- Format as: `frame framename {`
- Use `node.frameName` property for the frame name
- Follow same body printing pattern as other control flow

#### `printCommand(node: CommandNode): string`

**Current behavior:**
- Prints prefix commands, command name, varlist, expression, qualifiers, options
- Does not check for or handle `body` property
- Returns single-line command string

**New behavior:**
- After printing command parts, check if `node.body` exists and has length > 0
- If body exists, this is a prefix command brace block:
  - Add ` {` to the command line
  - Add statement terminator
  - Increase indent
  - Print each statement in body
  - Decrease indent
  - Print closing brace
  - Return multi-line string
- If no body, return single-line command as before

### Data Models

No new data models needed. Using existing types:

```typescript
interface ControlFlowNode {
  type: 'if' | 'else' | 'foreach' | 'forvalues' | 'while' | 'frame';
  frameName?: string;  // Used for frame blocks
  body: StataNode[];
  // ... other properties
}

interface CommandNode {
  type: 'command';
  name: string;
  body?: StataNode[];  // For prefix command brace blocks
  // ... other properties
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Frame Block Preservation

*For any* valid frame block AST node (ControlFlowNode with type 'frame'), when formatted by the PrettyPrinter, the output should contain a frame block with the same frame name and all body statements preserved.

**Validates: Requirements 1.1, 1.3, 1.4**

### Property 2: Frame Block Format Correctness

*For any* valid frame block, the formatted output should follow the pattern `frame framename {` with the opening brace on the same line, body statements indented one level deeper, and closing brace on its own line at the original indentation level.

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 3: Frame Block Indentation

*For any* valid frame block, the body statements should be indented exactly one level deeper than the frame command line.

**Validates: Requirements 1.5, 2.3**

### Property 4: Prefix Command Brace Block Preservation

*For any* valid CommandNode with a body property, when formatted by the PrettyPrinter, the output should contain a brace block with the command name (or `{` for standalone blocks) and all body statements preserved.

**Validates: Requirements 3.1, 3.3, 3.4**

### Property 5: Prefix Command Brace Block Format Correctness

*For any* valid prefix command brace block, the formatted output should follow the pattern `command {` (or just `{` for standalone blocks) with the opening brace on the same line, body statements indented one level deeper, and closing brace on its own line at the original indentation level.

**Validates: Requirements 4.1, 4.2, 4.4**

### Property 6: Prefix Command Brace Block Indentation

*For any* valid prefix command brace block, the body statements should be indented exactly one level deeper than the command line.

**Validates: Requirements 3.5, 4.3**

### Property 7: Delimiter Mode Handling

*For any* frame block or prefix command brace block, the statement terminator after the closing brace should be a newline in cr mode and a semicolon followed by newline in semicolon mode.

**Validates: Requirements 2.5, 4.5, 5.4**

### Property 8: Control Flow Consistency

*For any* frame block, the indentation behavior should match the indentation behavior of if/foreach/while blocks (one level increase for body).

**Validates: Requirements 5.1, 5.2**

### Property 9: Trivia Preservation

*For any* frame block or prefix command brace block with leading or trailing trivia (comments), the formatted output should preserve all trivia in the same positions relative to the block.

**Validates: Requirements 5.3**

## Error Handling

The PrettyPrinter should handle edge cases gracefully:

1. **Empty body**: If a frame block or prefix command brace block has an empty body array, still output the braces with no content between them
2. **Missing frameName**: If a frame block node is missing the frameName property, use an empty string (though this shouldn't happen with valid AST)
3. **Nested blocks**: Properly track indentation level through nested frame blocks and prefix command blocks
4. **Mixed nesting**: Handle frame blocks inside prefix command blocks and vice versa

## Testing Strategy

### Unit Tests

Unit tests should verify specific examples and edge cases:

1. **Frame block examples**:
   - Simple frame block: `frame myframe { display "test" }`
   - Empty frame block: `frame myframe { }`
   - Frame block with multiple commands
   - Nested frame blocks

2. **Prefix command brace block examples**:
   - Simple capture block: `capture { display "test" }`
   - Quietly block: `quietly { gen x = 1 }`
   - Standalone brace block: `{ display "test" }`
   - Empty prefix block: `capture { }`
   - Nested prefix blocks

3. **Delimiter mode examples**:
   - Frame block in cr mode
   - Frame block in semicolon mode
   - Prefix block in both modes

4. **Trivia examples**:
   - Frame block with leading comment
   - Prefix block with trailing comment

### Property-Based Tests

Property tests should verify universal properties across all inputs:

1. **Property 1-9**: Implement each correctness property as a property-based test
2. **Test configuration**: Minimum 100 iterations per property test
3. **Generators**: Create generators for:
   - Random frame names (valid Stata identifiers)
   - Random command names for prefix blocks
   - Random statement bodies (1-5 statements)
   - Random nesting depths (1-3 levels)
4. **Tag format**: `Feature: pretty-printer-frame-block-deletion, Property N: {property_text}`

### Integration with Existing Tests

The fix should not break existing formatter tests:
- Run all existing property tests for the formatter
- Verify dual-mode formatter tests pass for both source-preserving and AST modes
- Check that frame block recognition tests still pass
- Verify prefix command brace block indentation tests still pass
