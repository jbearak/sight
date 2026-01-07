# Design Document

## Overview

This design addresses additional feedback from PR 28, focusing on parser improvements for frame-prefixed commands, test infrastructure enhancements, and code quality improvements. The solution ensures proper handling of parenthesized varlist groups in frame-prefixed commands and improves test consistency across the codebase.

The design includes five main components:
1. Parser enhancement for LPAREN handling in parseCommandBody
2. Dual formatter mode testing for prefix command spacing tests
3. Shared document state helper usage across test files
4. Frame prefix whitespace handling improvements
5. Code quality improvements through import cleanup and duplicate code removal

## Architecture

The changes follow the existing architecture patterns:

- **Parser Layer**: Enhance `parseCommandBody` to mirror LPAREN handling from `parseCommand`
- **Test Infrastructure**: Standardize on shared helpers from `tests/property/helpers/`
- **Formatter Testing**: Use dual-mode testing utilities for comprehensive coverage
- **Code Quality**: Remove duplicated implementations and unused imports

## Components and Interfaces

### 1. Parser Enhancement (parseCommandBody)

**Current Issue**: The `parseCommandBody` method in `src/parser/index.ts` (lines 1091-1147) omits handling for LPAREN tokens in its varlist loop, causing parenthesized varlist groups to be dropped for frame-prefixed commands.

**Solution**: Mirror the LPAREN branch from `parseCommand` (lines 895-935) inside `parseCommandBody`'s while loop.

**Interface Changes**: None - internal parser logic enhancement.

### 2. Dual Formatter Mode Testing

**Current Issue**: The property test in `ast-formatter-prefix-command-spacing.prop.test.ts` (lines 239-274) only exercises the AST formatter by calling `parseAndFormat` directly.

**Solution**: Replace `fc.property` invocation with `for_each_formatter_mode_property` and use `formatWithMode(source, mode)` to test both formatter implementations.

**Interface Changes**: 
- Test functions will receive `mode: FormatterMode` parameter
- Use `formatWithMode(source, mode)` instead of `parseAndFormat(source)`

### 3. Shared Document State Helper Usage

**Current Issue**: Multiple test files duplicate `create_document_state()` logic instead of using the shared helper from `tests/property/helpers/index.ts`.

**Affected Files**:
- `tests/property/unab-colon-field.prop.test.ts` (lines 24-66)
- `tests/property/pretty-printer-frame-block-deletion.prop.test.ts` (lines 28-85)

**Solution**: Import and use the shared `create_document_state` helper, removing local implementations.

### 4. Frame Prefix Whitespace Handling

**Current Issue**: In `src/parser/index.ts` (lines 1025-1085), `parseFramePrefixedCommand` assumes the next token after the frame prefix colon is immediately the command name, but doesn't handle whitespace tokens.

**Solution**: Add `skipTrivia()` call after consuming the colon or explicitly tolerate WHITESPACE tokens when checking for command tokens.

### 5. Code Quality Improvements

**Current Issue**: Unused imports and duplicate code across test files.

**Solution**: Remove unused imports (e.g., `for_each_formatter_mode` in `ast-formatter-prefix-command-spacing.prop.test.ts`) and consolidate duplicate implementations.

## Data Models

### Parser Enhancement Data Flow

```typescript
// Current parseCommandBody varlist loop (missing LPAREN handling)
while (!this.check('COMMA') && !this.isTrivia() && 
       !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
  if (this.checkWord('if') || this.checkWord('in')) break;
  
  // Missing: LPAREN handling
  if (is_varlist_token) {
    // ... existing logic
  } else if (this.check('OPERATOR') && this.peek().value === '=') {
    break;
  } else {
    break;
  }
}
```

```typescript
// Enhanced parseCommandBody with LPAREN handling
while (!this.check('COMMA') && !this.isTrivia() && 
       !this.check('STATEMENT_TERMINATOR') && !this.isAtEnd()) {
  if (this.checkWord('if') || this.checkWord('in')) break;
  
  // NEW: Add LPAREN handling (mirrored from parseCommand)
  if (this.check('LPAREN')) {
    // Handle parenthesized groups (e.g., frame myframe: command (xy)=m)
    const paren_start = this.advance(); // consume (
    const paren_parts = [];
    let paren_depth = 1;
    let last_was_word = false;
    
    while (!this.isAtEnd() && paren_depth > 0) {
      if (this.check('LPAREN')) {
        paren_depth++;
        paren_parts.push(this.advance().value);
        last_was_word = false;
      } else if (this.check('RPAREN')) {
        paren_depth--;
        if (paren_depth > 0) {
          paren_parts.push(this.advance().value);
        }
        last_was_word = false;
      } else {
        const current_is_word = this.check('WORD') ||
            this.check('NUMBER') || this.check('MACRO_REF_LOCAL') ||
            this.check('MACRO_REF_GLOBAL');
        if (last_was_word && current_is_word) {
          paren_parts.push(' ');
        }
        paren_parts.push(this.advance().value);
        last_was_word = current_is_word;
      }
    }
    
    const paren_content = paren_parts.join('');
    const paren_end_pos = this.check('RPAREN')
        ? this.peek().range.end
        : this.previous().range.end;
    if (this.check('RPAREN')) {
      this.advance(); // consume closing paren
    }
    
    if (paren_content.trim()) {
      varlist.push({
        name: `(${paren_content})`,
        range: this.makeRange(paren_start.range.start, paren_end_pos),
      });
    }
  } else if (is_varlist_token) {
    // ... existing logic
  } else if (this.check('OPERATOR') && this.peek().value === '=') {
    break;
  } else {
    break;
  }
}
```

### Test Infrastructure Data Models

```typescript
// Current pattern (duplicated across files)
function create_document_state(source: string): DocumentState {
  const lexer = new StataLexer();
  const lex_result = lexer.tokenize(source);
  const parser = new StataParser();
  const parse_result = parser.parse(lex_result.tokens);
  const context_tracker = new ContextTracker();
  context_tracker.initialize_from_tokens(lex_result.tokens);
  
  return {
    uri: 'file:///test.do',
    content: source,
    version: 1,
    ast: parse_result.ast,
    tokens: lex_result.tokens,
    line_offsets: lex_result.line_offsets,
    symbols: { /* ... */ },
    diagnostics: [],
    context_ranges: [],
    context_tracker,
    forward_calls: [],
  };
}

// Enhanced pattern (using shared helper)
import { create_document_state } from './helpers';
// Remove local implementation, use shared helper directly
```

### Dual Formatter Testing Data Models

```typescript
// Current pattern (AST formatter only)
fc.property(arbitrary, (data) => {
  const source = construct_source(data);
  const output = parseAndFormat(source); // Only AST formatter
  // assertions...
});

// Enhanced pattern (both formatters)
for_each_formatter_mode_property(
  'test description',
  arbitrary,
  (mode, data) => {
    const source = construct_source(data);
    const output = formatWithMode(source, mode); // Both formatters
    // identical assertions...
  }
);
```

## Correctness Properties

Now I'll analyze the acceptance criteria to determine which are testable as properties:

<function_calls>
<invoke name="prework">
<parameter name="featureName">pr-28-feedback-3

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following properties can be tested:

### Property 1: Frame-Prefixed Command Parenthesized Group Recognition
*For any* frame-prefixed command with parenthesized varlist groups, the parser should recognize and process LPAREN tokens in the varlist loop without dropping the parenthesized content.
**Validates: Requirements 1.1, 1.5**

### Property 2: Consistent Parenthesized Group Parsing
*For any* parenthesized varlist group, parsing logic should be consistent between parseCommand and parseCommandBody, producing equivalent AST nodes for the same input.
**Validates: Requirements 1.2, 1.3**

### Property 3: Post-Parenthesis Token Parsing
*For any* command with parenthesized groups followed by assignment operators and expressions, the parser should correctly parse the subsequent "=" and expression tokens without errors.
**Validates: Requirements 1.4**

### Property 4: Frame Prefix Whitespace Tolerance
*For any* frame-prefixed command with whitespace after the colon, the parser should skip trivia tokens appropriately and continue parsing without generating spurious errors.
**Validates: Requirements 4.1, 4.2, 4.5**

### Property 5: Frame Parsing Path Consistency
*For any* frame command that can be processed through different parsing paths (direct frame statements vs parseCommand special cases), the parsing results should be consistent.
**Validates: Requirements 4.4**

## Error Handling

### Parser Error Handling

1. **Malformed Parenthesized Groups**: If parentheses are unbalanced in frame-prefixed commands, the parser should generate appropriate error messages without crashing.

2. **Whitespace Handling Errors**: The parser should not generate spurious "Expected command name after frame prefix" errors when whitespace follows the frame prefix colon.

3. **Graceful Degradation**: If LPAREN handling fails, the parser should continue processing the rest of the command rather than stopping entirely.

### Test Infrastructure Error Handling

1. **Missing Shared Helpers**: If shared helpers are not available, tests should fail with clear error messages indicating the missing dependency.

2. **Formatter Mode Errors**: If an unsupported formatter mode is specified, the test infrastructure should provide clear error messages.

## Testing Strategy

### Dual Testing Approach

The testing strategy employs both unit tests and property-based tests:

- **Unit tests**: Verify specific examples, edge cases, and error conditions for parser enhancements and test infrastructure changes
- **Property tests**: Verify universal properties across all inputs for parser behavior and consistency

### Property-Based Testing Configuration

- **Minimum 100 iterations** per property test due to randomization
- Each property test references its design document property
- **Tag format**: **Feature: pr-28-feedback-3, Property {number}: {property_text}**

### Test Infrastructure Requirements

1. **Shared Helper Usage**: All tests must use shared helpers from `tests/property/helpers/` instead of duplicating document state creation logic.

2. **Dual Formatter Mode Testing**: Formatter-related tests must exercise both source-preserving and AST formatter modes using `for_each_formatter_mode_property`.

3. **Import Cleanup**: Remove unused imports and consolidate duplicate implementations across test files.

### Testing Patterns

#### Parser Enhancement Testing
```typescript
// Test LPAREN handling in frame-prefixed commands
for_each_formatter_mode_property(
  'should handle parenthesized groups in frame commands',
  fc.tuple(
    arbitrary_frame_name(),
    arbitrary_command_with_parenthesized_group()
  ),
  (mode, [frame_name, command]) => {
    const source = `frame ${frame_name}: ${command}`;
    const ast = parse(source);
    // Verify parenthesized group is not dropped
    expect(ast_contains_parenthesized_group(ast)).toBe(true);
  }
);
```

#### Whitespace Handling Testing
```typescript
// Test whitespace tolerance after frame prefix colon
fc.property(
  fc.tuple(
    arbitrary_frame_name(),
    arbitrary_whitespace(),
    arbitrary_command()
  ),
  ([frame_name, whitespace, command]) => {
    const source = `frame ${frame_name}:${whitespace}${command}`;
    const result = parse(source);
    // Should parse without spurious errors
    return result.errors.length === 0;
  }
);
```

#### Test Infrastructure Testing
```typescript
// Verify shared helper usage
import { create_document_state } from './helpers';

// Remove local implementations, use shared helper
const doc_state = create_document_state(source);
```

### Unit Testing Balance

- **Unit tests focus on**:
  - Specific examples of frame-prefixed commands with parenthesized groups
  - Integration points between parseCommand and parseCommandBody
  - Edge cases in whitespace handling
  - Test infrastructure refactoring verification

- **Property tests focus on**:
  - Universal properties of parser behavior across all frame-prefixed commands
  - Consistency between different parsing paths
  - Comprehensive input coverage through randomization

The dual approach ensures both concrete examples work correctly and general properties hold across all possible inputs.