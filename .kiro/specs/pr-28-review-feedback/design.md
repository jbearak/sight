# Design Document: PR #28 Review Feedback Resolution

## Overview

This design addresses critical feedback from PR #28 reviewers (Amazon Q and CodeRabbit) regarding AST structure integrity, code quality, and test coverage. The PR introduced frame-prefixed command support but has several issues that need resolution before merging.

The core problems are:
1. **AST Structure Violation**: Colons (syntax tokens) are mixed into varlists (semantic data) for `unab` commands
2. **Missing Wildcard Support**: `parseCommandBody` doesn't handle wildcard operators (`*`, `?`)
3. **Incomplete Test Coverage**: Tests only run against AST formatter, not source-preserving formatter
4. **Code Duplication**: Frame prefix parsing logic is duplicated between `parseCommand` and `parseFrameBlock`
5. **Fragile Array Manipulation**: Pretty printer uses complex post-hoc array manipulation
6. **Test Generator Issues**: Manual identifier filtering instead of using shared generators

## Architecture

### Current State

**Parser (src/parser/index.ts)**:
- `parseUnabCommand`: Stores colon as an IdentifierNode in varlist (lines 1217-1226)
- `parseCommand`: Handles frame prefixes with wildcard support (lines 803-869)
- `parseCommandBody`: Missing wildcard operator handling (lines 1048-1061)
- `parseFrameBlock`: Duplicates frame prefix parsing logic (lines 2186-2321)

**Pretty Printer (src/pretty-printer/index.ts)**:
- `should_omit_space`: Handles colon spacing by checking for `:` in varlist (line 35)
- `printCommand`: Uses array manipulation to handle prefix brace blocks (lines 241-248)

**Types (src/types/index.ts)**:
- `CommandNode`: Has `varlist?: IdentifierNode[]` field
- `PrefixNode`: Has `has_colon?: boolean` field (line 208)

### Proposed Changes

#### 1. AST Structure Refactoring

**Add dedicated colon field to CommandNode**:
```typescript
export interface CommandNode {
  type: 'command';
  prefix?: PrefixNode[];
  name: string;
  fullName: string;
  varlist?: IdentifierNode[];
  has_colon_before_varlist?: boolean;  // NEW: For unab commands
  options?: OptionNode[];
  expression?: string;
  ifExpression?: string;
  inExpression?: string;
  body?: StataNode[];
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}
```

**Rationale**: This maintains clean separation between syntax (colon) and semantics (variable names). The `has_colon` field on `PrefixNode` handles prefix command colons (e.g., `frame name:`), while `has_colon_before_varlist` handles command-level colons (e.g., `unab macroname:`).

#### 2. Parser Refactoring

**Extract shared frame prefix parsing**:
```typescript
private parseFramePrefixedCommand(
  frame_prefix: PrefixNode,
  prefixes: PrefixNode[],
  startToken: Token
): CommandNode {
  // Shared logic for both parseCommand and parseFrameBlock
  // Handles: frame name: [prefix...] command [args]
}
```

**Update parseUnabCommand**:
- Remove colon from varlist
- Set `has_colon_before_varlist = true` when colon is present
- Keep varlist containing only variable names

**Update parseCommandBody**:
- Add wildcard operator detection (mirror parseCommand logic)
- Check for `OPERATOR` tokens with value `*` or `?`
- Treat wildcards as varlist items

#### 3. Pretty Printer Refactoring

**Simplify prefix brace block handling**:
- Replace post-hoc array manipulation with upfront format determination
- Use clear decision tree: standalone brace block vs prefix brace block vs regular command
- Remove fragile while loop that pops array elements

**Update should_omit_space**:
- Remove colon handling (no longer needed since colons won't be in varlists)
- Keep wildcard pattern handling

**Update printCommand**:
- Check `has_colon_before_varlist` field to emit colon for `unab` commands
- Emit colon between macro name and varlist when field is true

#### 4. Test Infrastructure Updates

**Dual formatter testing**:
- Use `for_each_formatter_mode_property()` from `tests/property/helpers/formatter-test-utils.ts`
- Run most tests in both AST and source-preserving modes
- Both formatters normalize indentation and handle structural elements
- Use `skip_for_mode()` sparingly for AST-specific normalization tests
- Update test files:
  - `tests/property/ast-formatter-prefix-command-spacing.prop.test.ts`
  - `tests/property/pretty-printer-frame-block-deletion.prop.test.ts`

**Test generator updates**:
- Replace manual identifier filtering with `arbitrary_non_reserved_identifier()`
- Import from `tests/property/generators/index.ts`
- Apply to all varlist and macro name generation

## Components and Interfaces

### Modified Types

**CommandNode** (src/types/index.ts):
- Add `has_colon_before_varlist?: boolean` field
- Maintains backward compatibility (optional field)

### Modified Parser Methods

**parseUnabCommand** (src/parser/index.ts):
- Input: `commandToken: Token, prefixes: PrefixNode[]`
- Output: `CommandNode` with `has_colon_before_varlist` set
- Changes: Remove colon from varlist, set dedicated field

**parseCommandBody** (src/parser/index.ts):
- Input: `commandToken: Token, prefixes: PrefixNode[]`
- Output: `CommandNode`
- Changes: Add wildcard operator detection

**parseFramePrefixedCommand** (src/parser/index.ts) - NEW:
- Input: `frame_prefix: PrefixNode, prefixes: PrefixNode[], startToken: Token`
- Output: `CommandNode`
- Purpose: Shared frame prefix parsing logic

### Modified Pretty Printer Methods

**printCommand** (src/pretty-printer/index.ts):
- Changes: Check `has_colon_before_varlist` to emit colon
- Simplify prefix brace block handling

**should_omit_space** (src/pretty-printer/index.ts):
- Changes: Remove colon handling (line 35)

### Test Helper Usage

**for_each_formatter_mode_property** (tests/property/helpers/formatter-test-utils.ts):
- Wraps property tests to run in both formatter modes
- Provides `mode` parameter to test function
- Creates appropriate formatter config for each mode

## Data Models

### AST Node Changes

**Before** (unab command):
```typescript
{
  type: 'command',
  name: 'unab',
  varlist: [
    { name: 'myvar', range: {...} },
    { name: ':', range: {...} },      // Syntax token in semantic field!
    { name: 'var1', range: {...} },
    { name: 'var2', range: {...} }
  ]
}
```

**After** (unab command):
```typescript
{
  type: 'command',
  name: 'unab',
  has_colon_before_varlist: true,     // Dedicated syntax field
  varlist: [
    { name: 'myvar', range: {...} },  // Macro name
    { name: 'var1', range: {...} },   // Only variable names
    { name: 'var2', range: {...} }
  ]
}
```

### Wildcard Operator Handling

**Frame-prefixed command with wildcards**:
```typescript
// Input: frame myframe: summarize var*
{
  type: 'command',
  prefix: [
    {
      type: 'prefix',
      name: 'frame',
      varlist: ['myframe'],
      has_colon: true
    }
  ],
  name: 'summarize',
  varlist: [
    { name: 'var', range: {...} },
    { name: '*', range: {...} }       // Wildcard preserved
  ]
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Varlist Purity
*For any* parsed command, the varlist should contain only IdentifierNodes with variable names or wildcard operators, never syntax tokens like colons.
**Validates: Requirements 5.3, 11.2**

### Property 2: Colon Field Consistency
*For any* `unab` command with a colon, the `has_colon_before_varlist` field should be true and the varlist should not contain a colon token.
**Validates: Requirements 11.2, 11.3**

### Property 3: Wildcard Preservation in Frame Commands
*For any* frame-prefixed command containing wildcard operators, parsing then formatting should preserve the wildcards in their original positions.
**Validates: Requirements 1.2, 1.3**

### Property 4: Dual Formatter Correctness
*For any* valid Stata source code, both AST mode and source-preserving mode should produce correctly indented output with preserved structural elements (commands, prefixes, varlists, options).
**Validates: Requirements 2.1, 2.2**

### Property 5: Frame Prefix Parsing Equivalence
*For any* frame-prefixed command, parsing via `parseCommand` or `parseFrameBlock` should produce equivalent AST structures.
**Validates: Requirements 4.1, 4.2, 4.4**

### Property 6: Unab Round Trip
*For any* `unab` command, parsing then pretty-printing should preserve the colon and varlist structure.
**Validates: Requirements 11.3, 11.4**

### Property 7: Wildcard Operator Detection
*For any* command body containing `*` or `?` operators, `parseCommandBody` should treat them as varlist items.
**Validates: Requirements 1.1, 1.4**

### Property 8: Reserved Identifier Exclusion
*For any* generated test identifier in varlist positions, it should not be a reserved keyword like `if`, `in`, or `by`.
**Validates: Requirements 3.1, 3.2**

### Property 9: AST Structure Integrity
*For any* CommandNode, if `has_colon_before_varlist` is true, the varlist should not contain any IdentifierNode with `name === ':'`.
**Validates: Requirements 8.1, 8.2**

### Property 10: Prefix Brace Block Format Determinism
*For any* prefix command brace block, the pretty printer should determine the correct format upfront without post-hoc array manipulation.
**Validates: Requirements 6.1, 6.4**

## Error Handling

### Parser Errors

**Missing colon in unab**:
- Current: Adds error, continues parsing
- Change: Set `has_colon_before_varlist = false`, continue parsing
- Rationale: Graceful degradation

**Invalid wildcard context**:
- Detection: Wildcard operator in non-varlist position
- Handling: Treat as regular operator, let semantic analysis handle
- Rationale: Parser focuses on syntax, not semantics

### Pretty Printer Errors

**Missing has_colon_before_varlist field**:
- Detection: `unab` command without field (backward compatibility)
- Handling: Check if first varlist item after macro name is `:`
- Fallback: Emit colon if found in varlist (legacy behavior)
- Rationale: Maintains compatibility with old ASTs

**Malformed prefix brace block**:
- Detection: Prefix with body but name !== '{'
- Handling: Format as regular command, ignore body
- Rationale: Defensive programming

## Testing Strategy

### Dual Testing Approach

**Unit Tests**:
- Specific examples of unab commands with/without colons
- Frame-prefixed commands with wildcards
- Edge cases: empty varlists, missing colons, nested prefixes

**Property Tests**:
- Generate random commands with wildcards
- Generate random unab commands
- Generate random frame-prefixed commands
- Run all tests in both formatter modes

### Test Configuration

**Minimum 100 iterations per property test**
**Dual-mode execution for all formatter tests**

### Test File Updates

**ast-formatter-prefix-command-spacing.prop.test.ts**:
- Use `for_each_formatter_mode_property()` for all tests
- Most tests run in both modes:
  - Prefix colon spacing (both formatters handle this)
  - Varlist preservation (structural)
  - Wildcard preservation (structural)
  - Comma spacing (both formatters normalize this)
- Use `skip_for_mode('source-preserving')` only if specific tests verify AST-only normalization
- Replace manual identifier filtering with `arbitrary_non_reserved_identifier()`
- Add semantic tests for AST structure

**pretty-printer-frame-block-deletion.prop.test.ts**:
- Use `for_each_formatter_mode_property()` for all tests
- Most tests run in both modes:
  - Frame block preservation (structural)
  - Nested block structure (structural)
  - Prefix command brace block preservation (structural)
  - Indentation levels (both formatters normalize indentation)
- Use `skip_for_mode('source-preserving')` only if specific tests verify AST-only behavior
- Use `arbitrary_non_reserved_identifier()` for frame names
- Add tests for prefix brace block format determination

**Rationale**: Both formatters normalize indentation and should handle structural elements correctly. Use `skip_for_mode()` sparingly, only for tests that verify AST-specific normalization that source-preserving intentionally doesn't perform.

### Semantic Test Examples

```typescript
// Test: Varlist purity
fc.assert(
  fc.property(
    arbitrary_unab_command(),
    (source) => {
      const ast = parse(source);
      const command = find_command_node(ast);
      const has_colon_in_varlist = command.varlist?.some(v => v.name === ':');
      expect(has_colon_in_varlist).toBe(false);
    }
  ),
  { numRuns: 100 }
);

// Test: Colon field consistency
fc.assert(
  fc.property(
    arbitrary_unab_command_with_colon(),
    (source) => {
      const ast = parse(source);
      const command = find_command_node(ast);
      expect(command.has_colon_before_varlist).toBe(true);
      expect(command.varlist?.some(v => v.name === ':')).toBe(false);
    }
  ),
  { numRuns: 100 }
);
```

## Implementation Notes

### Migration Strategy

1. **Phase 1**: Add `has_colon_before_varlist` field to CommandNode (backward compatible)
2. **Phase 2**: Update parser to set field and remove colon from varlist
3. **Phase 3**: Update pretty printer to check field (with fallback for old ASTs)
4. **Phase 4**: Extract shared frame prefix parsing logic
5. **Phase 5**: Add wildcard support to parseCommandBody
6. **Phase 6**: Update tests to use dual-mode helpers and shared generators
7. **Phase 7**: Simplify pretty printer array manipulation

### Backward Compatibility

**Old ASTs** (with colon in varlist):
- Pretty printer checks for colon in varlist as fallback
- Formats correctly even without `has_colon_before_varlist` field

**New ASTs** (with dedicated field):
- Pretty printer prefers `has_colon_before_varlist` field
- Cleaner separation of concerns

### Code Comments

**Parser**:
- Document why `has_colon_before_varlist` is set
- Explain wildcard operator detection logic
- Document shared frame prefix parsing strategy

**Pretty Printer**:
- Explain prefix brace block format determination
- Document fallback logic for backward compatibility
- Clarify expected array state at each step

## Design Decisions

### Why dedicated field instead of special varlist item?

**Pros**:
- Clean separation between syntax and semantics
- Downstream consumers get pure variable lists
- Easier to reason about AST structure
- Follows existing pattern (`has_colon` on PrefixNode)

**Cons**:
- Adds another optional field to CommandNode
- Requires migration of existing code

**Decision**: Use dedicated field. The benefits of clean AST structure outweigh the cost of an additional field.

### Why extract shared frame prefix parsing?

**Pros**:
- Single source of truth for frame prefix logic
- Easier to maintain and test
- Reduces code duplication

**Cons**:
- Requires refactoring two methods
- Slightly more complex call sites

**Decision**: Extract shared logic. The maintenance benefits justify the refactoring cost.

### Why simplify pretty printer array manipulation?

**Pros**:
- Easier to understand and maintain
- Less fragile (no assumptions about array state)
- Clearer intent

**Cons**:
- Requires rewriting existing logic
- May be slightly more verbose

**Decision**: Simplify. Code clarity is more important than brevity.

### Why selective dual-mode formatter testing?

**Current AGENTS.md guidance**: "All formatter tests MUST run against both formatter implementations"

**Formatter design philosophies**:
- **AST formatter**: Rebuilds code from AST, normalizes all formatting (spacing, indentation)
- **Source-preserving formatter**: Preserves original tokens/spacing where possible, but **does normalize indentation**

**Proposed approach**:
- **Indentation tests** run in both modes: both formatters normalize indentation
- **Token spacing tests** run in both modes: both should preserve correct spacing
- **Exact whitespace tests** may need `skip_for_mode()`: source-preserving may keep original spacing in some contexts

**Pros**:
- Tests what both formatters guarantee: correct indentation and structure
- Respects that source-preserving formatter also normalizes indentation
- Uses existing `skip_for_mode()` helper only when truly needed

**Cons**:
- Requires understanding which formatting aspects are normalized by both formatters

**Decision**: Run most tests in both modes. Use `skip_for_mode()` sparingly, only for tests that verify AST-specific normalization behavior that source-preserving intentionally doesn't do.

**Recommendation**: Update AGENTS.md to clarify that both formatters normalize indentation, and `skip_for_mode()` should be used only for AST-specific normalization tests.
