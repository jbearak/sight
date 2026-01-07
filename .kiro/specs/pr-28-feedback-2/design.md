# Design Document

## Overview

This design addresses critical bugs and semantic issues identified in PR feedback. The solution involves fixing a broken `apply_edits` function that loses multiple text edits, consolidating duplicate test utilities, correcting frame prefix parsing semantics, and fixing code style violations.

## Architecture

The solution follows a multi-pronged approach:

1. **Test Utility Consolidation**: Create shared implementations of common test utilities in `tests/property/helpers/`
2. **Parser Semantic Fix**: Update the `PrefixNode` type and frame prefix parsing logic to use semantically correct fields
3. **Code Style Compliance**: Update parameter naming and line length violations to match project standards

## Components and Interfaces

### Shared Test Utilities

**Location**: `tests/property/helpers/text-edit-utils.ts`

```typescript
export interface TextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

export function apply_edits(source: string, edits: TextEdit[]): string;
export function find_command_nodes(nodes: StataNode[]): CommandNode[];
```

The `apply_edits` function will implement the correct multi-edit algorithm:
1. Sort edits in reverse order (by line, then by character) to avoid index shifting
2. Apply each edit by splitting the source into before/after segments
3. Reconstruct the source with the new text

### Updated PrefixNode Interface

**Location**: `src/types/index.ts`

```typescript
export interface PrefixNode {
  type: 'prefix';
  name: string;
  fullName: string;
  varlist?: string[];        // For by-prefixes with variable lists
  frameName?: string;        // For frame prefixes with frame names
  has_colon?: boolean;
  range: Range;
}
```

### Parser Updates

**Location**: `src/parser/index.ts`

The frame prefix parsing logic will be updated to:
1. Store frame names in the `frameName` field instead of `varlist`
2. Leave `varlist` undefined for frame prefixes
3. Update all callers to read from the correct field

## Data Models

### TextEdit Processing Algorithm

The multi-edit application follows this algorithm:

```
1. If edits.length === 0: return source unchanged
2. If edits.length === 1: return edits[0].newText (optimization)
3. Sort edits by position (reverse order to avoid index shifting):
   - Primary sort: line number (descending)
   - Secondary sort: character position (descending)
4. For each edit in sorted order:
   - Split source into: before_range + edit_range + after_range
   - Replace edit_range with edit.newText
   - Reconstruct: before_range + edit.newText + after_range
5. Return final result
```

### Frame Prefix Semantic Model

```
Frame Prefix: "frame myframe: command args"
├── PrefixNode
│   ├── name: "frame"
│   ├── frameName: "myframe"  ← NEW: dedicated field
│   └── varlist: undefined    ← CHANGED: no longer used
└── CommandNode (the actual command)

By Prefix: "by var1 var2: command args"  
├── PrefixNode
│   ├── name: "by"
│   ├── varlist: ["var1", "var2"]  ← UNCHANGED: correct usage
│   └── frameName: undefined       ← NEW: not used for by-prefixes
└── CommandNode (the actual command)
```

## Correctness Properties

Now I'll analyze the acceptance criteria for testability using the prework tool:
*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing the acceptance criteria, I identified several properties that can be combined for more comprehensive testing:

- Properties 1.1, 1.3, and 1.4 can be combined into a comprehensive multi-edit application property
- Properties 3.1 and 3.2 can be combined into a single frame prefix parsing property
- Properties 3.3 and 3.5 can be combined into a comprehensive prefix parsing property

### Correctness Properties

**Property 1: Multi-edit application correctness**
*For any* source text and any set of non-overlapping TextEdit objects, applying all edits should produce a result where each edit's newText appears at the correct position in the final output
**Validates: Requirements 1.1, 1.3, 1.4**

**Property 2: Frame prefix parsing semantics**
*For any* valid frame prefix command (e.g., "frame myframe: command"), the parser should create a PrefixNode with frameName set to the frame identifier and varlist undefined or empty
**Validates: Requirements 3.1, 3.2**

**Property 3: By-prefix parsing preservation**
*For any* valid by-prefix command with variable lists, the parser should create a PrefixNode with varlist containing the variables and frameName undefined
**Validates: Requirements 3.3, 3.5**

**Property 4: Shared utility consistency**
*For any* AST structure, the shared find_command_nodes function should return the same results as the original implementations across all test files
**Validates: Requirements 4.4**

## Error Handling

### TextEdit Application Errors

- **Invalid ranges**: If a TextEdit has invalid range coordinates (negative positions, end before start), the function should skip that edit and continue with others
- **Out-of-bounds ranges**: If a TextEdit references positions beyond the source text length, clamp to valid boundaries
- **Overlapping edits**: Sort edits in reverse order to prevent index shifting issues

### Parser Error Handling

- **Malformed frame syntax**: If frame prefix syntax is incomplete (missing colon, missing frame name), fall back to regular command parsing
- **Type safety**: Ensure all PrefixNode field access is properly typed to prevent runtime errors

## Testing Strategy

### Dual Testing Approach

The implementation will use both unit tests and property-based tests:

**Unit Tests**:
- Specific examples of multi-edit scenarios (empty edits, single edit, multiple non-overlapping edits)
- Edge cases for frame prefix parsing (missing colon, empty frame name)
- Regression tests for existing by-prefix functionality
- Integration tests for parser callers using the new frameName field

**Property-Based Tests**:
- Universal properties across all inputs using fast-check library
- Minimum 100 iterations per property test
- Each property test tagged with: **Feature: pr-feedback-fixes, Property {number}: {property_text}**

**Property Test Configuration**:
- Use fast-check as the property-based testing library
- Configure tests to run minimum 100 iterations for comprehensive coverage
- Tag each test with the corresponding design document property

**Testing Framework**: The existing Bun test framework will be used, with fast-check for property-based testing.

### Test Organization

- Shared utilities will be thoroughly tested in isolation
- Integration tests will verify that existing test files work with the new shared utilities
- Parser tests will verify both frame prefix and by-prefix functionality
- Regression tests will ensure no existing functionality is broken