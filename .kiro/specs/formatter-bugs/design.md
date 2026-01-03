# Design Document: Formatter Bug Fixes

## Overview

The Sight LSP formatter has critical bugs that corrupt Stata source code. The root cause is the lossy AST reconstruction approach: the parser extracts semantic components but discards original source text, and the pretty-printer attempts to reconstruct code from these components, losing spacing, operators, and entire node types.

This design proposes a **source-preserving formatter** that maintains the original source text while applying targeted formatting transformations (indentation, comment alignment). This approach ensures the formatter cannot corrupt code while still providing useful formatting capabilities.

## Architecture

### Current Architecture (Problematic)

```
Source → Lexer → Parser → AST → PrettyPrinter → Reconstructed Source
                              ↑
                        (lossy - loses spacing, operators, etc.)
```

### Proposed Architecture (Source-Preserving)

```
Source → Lexer → Tokens → SourcePreservingFormatter → Formatted Source
                    ↓
              Parser → AST (for structure analysis only)
```

The key insight is that the **tokens preserve the original source text** (each token has a `value` field with the exact source text). By working at the token level and only modifying whitespace/indentation, we can format code without corrupting it.

## Components and Interfaces

### Bug Analysis: Current Implementation Issues

The current implementation has two critical bugs:

**Bug 1: Text Duplication**
The `TokenReconstructor` incorrectly handles spacing after applying indentation. When at line start:
1. It applies new indentation (e.g., 4 spaces)
2. It sets `current_column` to the indent length (4)
3. When processing the next token at column N, it tries to preserve "spacing" from column 4 to N
4. But this grabs actual content from the original line, not just whitespace

**Fix**: After applying indentation at line start, skip directly to the token's column position without trying to preserve intermediate spacing. The indentation replaces all leading whitespace.

**Bug 2: Comment Un-indentation**
The `IndentationAnalyzer` only processes AST nodes, but comments are trivia attached to nodes, not nodes themselves. Comments inside blocks don't get indentation entries.

**Fix**: Process trivia (comments) attached to AST nodes and assign them the same indentation level as their parent node. Also process standalone comment tokens that appear between statements.

### SourcePreservingFormatter

A new formatter class that operates on tokens rather than AST reconstruction.

```typescript
interface FormatterConfig {
    indent_size: number;
    indent_style: 'spaces' | 'tabs';
}

interface FormattingContext {
    indent_level: number;
    in_continuation: boolean;
    continuation_indent: number;
}

class SourcePreservingFormatter {
    constructor(config: FormatterConfig);
    
    /**
     * Format document by adjusting indentation while preserving source text.
     * Returns the formatted source string.
     */
    format(
        tokens: Token[],
        ast: StataAST,
        line_offsets: number[]
    ): string;
    
    /**
     * Compute the correct indentation for a given line based on AST structure.
     */
    private compute_line_indent(
        line_number: number,
        ast: StataAST,
        context: FormattingContext
    ): number;
    
    /**
     * Reconstruct source from tokens, adjusting only leading whitespace.
     */
    private reconstruct_with_indent(
        tokens: Token[],
        line_indents: Map<number, number>
    ): string;
}
```

### IndentationAnalyzer

Analyzes AST structure to determine correct indentation levels.

```typescript
interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
}

class IndentationAnalyzer {
    /**
     * Analyze AST to compute indentation for each line.
     */
    analyze(ast: StataAST): Map<number, IndentationInfo>;
    
    /**
     * Walk AST nodes and track nesting depth.
     */
    private walk_node(
        node: StataNode,
        current_depth: number,
        result: Map<number, IndentationInfo>
    ): void;
}
```

### TokenReconstructor

Reconstructs source from tokens while applying indentation changes.

```typescript
class TokenReconstructor {
    /**
     * Reconstruct source from tokens, applying indentation adjustments.
     * Preserves all token values exactly - only modifies leading whitespace.
     */
    reconstruct(
        tokens: Token[],
        line_indents: Map<number, number>,
        config: FormatterConfig
    ): string;
    
    /**
     * Generate indentation string for given level.
     */
    private make_indent(level: number, config: FormatterConfig): string;
}
```

## Data Models

### Token Stream Processing

The formatter processes tokens in order, tracking:
- Current line number
- Whether we're at the start of a line (for indentation)
- Continuation state (for continuation line indentation)

```typescript
interface TokenProcessingState {
    current_line: number;
    at_line_start: boolean;
    in_continuation: boolean;
    output_parts: string[];
}
```

### Indentation Tracking

```typescript
interface BlockInfo {
    type: 'program' | 'if' | 'else' | 'foreach' | 'forvalues' | 'while' | 'frame';
    start_line: number;
    end_line: number;
    depth: number;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Syntax Statement Preservation

*For any* program containing a syntax statement, formatting SHALL produce output that contains the syntax statement with all arguments and options intact.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Token Content Preservation

*For any* valid Stata source, formatting SHALL produce output where every non-whitespace token appears in the same order with identical content.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Operator Spacing Preservation

*For any* expression containing comparison or logical operators, formatting SHALL produce output where the operators and their operands are separated by appropriate whitespace.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 4: String Literal Preservation

*For any* string literal (compound or double-quoted), formatting SHALL produce output where the string content is identical to the original, with no spurious spaces inside delimiters.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

### Property 5: Parenthesis Content Preservation

*For any* parenthesized expression, formatting SHALL produce output where no spurious spaces are added immediately after opening parentheses or before closing parentheses.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 6: Comment Indentation Correctness

*For any* comment within a code block, formatting SHALL produce output where the comment is indented to match the block's indentation level.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 7: Macro Reference Preservation

*For any* local macro reference, formatting SHALL produce output where the macro reference has no spurious internal spaces.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 8: Continuation Line Preservation

*For any* statement with continuation markers (`///` or `/**/`), formatting SHALL produce output that preserves the line breaks at continuation points.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 9: Block Indentation Correctness

*For any* code block (program, if, foreach, forvalues, while), formatting SHALL produce output where:
- Block contents are indented by the configured indent size
- Nested blocks have cumulative indentation
- Closing delimiters align with opening statements
- Continuation lines are indented one level past the statement start

**Validates: Requirements 9.1, 9.2, 9.3, 9.4**

### Property 10: Output Validity

*For any* valid Stata source, formatting SHALL produce syntactically valid Stata code, or return no edits if formatting would corrupt the code.

**Validates: Requirements 10.1, 10.2, 10.3**

### Property 11: No Text Duplication

*For any* valid Stata source, formatting SHALL produce output where each line's non-whitespace content appears exactly once, with no duplicated text fragments.

**Validates: Requirements 11.1, 11.2, 11.3**

### Property 12: Trivia Indentation Correctness

*For any* comment (line or block) appearing inside a code block, formatting SHALL produce output where the comment is indented to match the block's indentation level.

**Validates: Requirements 12.1, 12.2, 12.3**

## Error Handling

### Graceful Degradation

If the formatter encounters any situation where it cannot guarantee correct output:
1. Log a warning with details
2. Return an empty array of TextEdits (no changes)
3. Never return edits that would corrupt the source

### Error Scenarios

| Scenario | Handling |
|----------|----------|
| Parse errors in source | Return no edits |
| Malformed tokens | Return no edits |
| Inconsistent AST structure | Return no edits |
| Token reconstruction mismatch | Return no edits |

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:
- Syntax statement formatting
- Merge command with multiple variables
- If-qualifier with comparison operators
- Compound string literals
- Nested block indentation
- Continuation line handling

### Property-Based Tests

Property-based tests verify universal properties across generated inputs using fast-check:

1. **Token preservation property**: For all valid Stata sources, formatting preserves all non-whitespace tokens in order
2. **String content property**: For all string literals, formatting preserves exact string content
3. **Block indentation property**: For all nested blocks, indentation increases by indent_size per level
4. **Continuation property**: For all continuation lines, line breaks are preserved
5. **Round-trip validity property**: For all valid sources, formatted output is also valid

### Test Configuration

- Property tests: minimum 100 iterations per property
- Test tag format: **Feature: formatter-bugs, Property {number}: {property_text}**
- Testing framework: fast-check (already used in project)

### Integration Tests

Integration tests verify end-to-end formatting behavior:
- Format a real Stata file with various constructs
- Verify no semantic changes to the code
- Verify indentation is corrected
- Verify continuation lines are preserved
