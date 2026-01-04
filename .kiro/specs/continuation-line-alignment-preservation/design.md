# Design Document: Continuation Line Alignment Preservation

## Overview

This design describes how the Stata formatter will detect and preserve purposeful alignment in continuation lines. The core principle is: **preserve purposeful alignment that meets quality criteria**. When a user has carefully aligned operators, conditions, or other elements across continuation lines in a way that demonstrates intentional formatting for readability, the formatter should recognize this effort and maintain it.

The implementation adds an alignment detection phase to both the source-preserving formatter and the AST formatter. This phase analyzes continuation line groups to identify alignment patterns that meet specific quality criteria before any indentation adjustments are made.

### Quality Criteria for Purposeful Alignment

Alignment is considered purposeful when it meets these criteria:

1. **Operator Alignment**: Operators (`&`, `|`, `==`, etc.) appear at the exact same column position across consecutive continuation lines
2. **Condition Alignment**: Conditions following an `if` qualifier start at the same column position across continuation lines
3. **Expression Alignment**: Continuation line content is aligned with the start of the expression on the first line (e.g., aligned with the right-hand side of an assignment)
4. **Consistency**: The alignment pattern is consistent across at least two continuation lines

When these criteria are NOT met, the formatter applies standard continuation indentation.

## Architecture

The alignment preservation feature integrates into the existing formatter pipeline:

```
Source Code → Lexer → Parser → Analyzer → Formatter → Output
                                              ↓
                                    ┌─────────────────────┐
                                    │ Alignment Detector  │
                                    │ (new component)     │
                                    └─────────────────────┘
                                              ↓
                                    ┌─────────────────────┐
                                    │ Indentation Analyzer│
                                    │ (modified)          │
                                    └─────────────────────┘
                                              ↓
                                    ┌─────────────────────┐
                                    │ Token Reconstructor │
                                    │ (modified)          │
                                    └─────────────────────┘
```

### Key Design Decisions

1. **Preserve by Default**: The `formatting.preserveAlignment` option defaults to `true`. Users who want strict indentation can disable it.

2. **Per-Statement Analysis**: Alignment detection operates on each statement's continuation lines independently. Alignment in one statement doesn't affect another.

3. **Whitespace Preservation**: When alignment is detected, the formatter preserves the exact original whitespace rather than recalculating it.

4. **Continuation Group Tracking**: Lines connected by `///` are grouped together for alignment analysis.

## Components and Interfaces

### AlignmentDetector (New Component)

A new module `src/formatter/alignment-detector.ts` that analyzes continuation line groups.

```typescript
/**
 * Represents a group of continuation lines belonging to a single statement.
 */
interface ContinuationGroup {
    /** The line number where the statement starts */
    start_line: number;
    /** Line numbers of all continuation lines in this group */
    continuation_lines: number[];
    /** Whether this group has detected alignment that should be preserved */
    has_alignment: boolean;
    /** Set of line numbers where alignment was detected */
    aligned_lines: Set<number>;
}

/**
 * Detects intentional alignment patterns in continuation lines.
 */
class AlignmentDetector {
    /**
     * Analyze tokens to find continuation groups and detect alignment.
     * @param tokens - The token stream
     * @param original_source - The original source code
     * @returns Map of line numbers to their continuation group info
     */
    analyze(tokens: Token[], original_source: string): Map<number, ContinuationGroup>;
    
    /**
     * Check if a specific line should preserve its original whitespace.
     * @param line - The line number to check
     * @returns true if the line's whitespace should be preserved
     */
    should_preserve_whitespace(line: number): boolean;
}
```

### Modified IndentationAnalyzer

The existing `IndentationAnalyzer` is modified to accept alignment information:

```typescript
interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
    preserve_whitespace: boolean;  // NEW: skip indentation adjustment
}

class IndentationAnalyzer {
    /**
     * Analyze AST and tokens to determine indentation levels.
     * @param ast - The parsed AST
     * @param tokens - The token stream
     * @param alignment_info - Optional alignment detection results
     */
    analyze(
        ast: StataAST, 
        tokens?: Token[],
        alignment_info?: Map<number, ContinuationGroup>
    ): Map<number, IndentationInfo>;
}
```

### Modified TokenReconstructor

The `TokenReconstructor` is modified to respect the `preserve_whitespace` flag:

```typescript
class TokenReconstructor {
    /**
     * Reconstruct source from tokens, applying indentation adjustments.
     * Lines marked with preserve_whitespace=true retain their original spacing.
     */
    reconstruct(
        tokens: Token[],
        line_indents: Map<number, IndentationInfo>,  // Changed from Map<number, number>
        config: FormatterConfig,
        original_source: string
    ): string;
}
```

### Modified SourcePreservingFormatter

The main formatter orchestrates the new alignment detection:

```typescript
class SourcePreservingFormatter {
    private alignment_detector: AlignmentDetector;
    
    format(
        tokens: Token[], 
        ast: StataAST, 
        line_offsets: number[], 
        original_source: string,
        config?: { preserve_alignment?: boolean }
    ): string;
}
```

### Configuration Schema

Addition to `.sight.json` schema:

```json
{
    "formatting": {
        "preserveAlignment": true
    }
}
```

## Data Models

### ContinuationGroup

Tracks a group of lines connected by `///` continuations:

```typescript
interface ContinuationGroup {
    /** Line where the statement begins */
    start_line: number;
    
    /** All continuation line numbers (lines after ///) */
    continuation_lines: number[];
    
    /** Whether alignment was detected in this group */
    has_alignment: boolean;
    
    /** Specific lines where alignment should be preserved */
    aligned_lines: Set<number>;
}
```

### AlignmentPattern

Represents a detected alignment pattern:

```typescript
interface AlignmentPattern {
    /** The column position where alignment occurs */
    column: number;
    
    /** The type of element aligned (operator, condition start, etc.) */
    element_type: 'operator' | 'condition' | 'other';
    
    /** Lines participating in this alignment */
    lines: number[];
}
```

### Extended IndentationInfo

The existing `IndentationInfo` is extended:

```typescript
interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
    
    /** NEW: If true, preserve original whitespace instead of applying indent */
    preserve_whitespace: boolean;
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The formatter detects purposeful alignment that meets quality criteria and preserves it. When alignment does not meet the quality criteria, standard continuation indentation is applied.

### Property 1: Aligned Operator Preservation

*For any* Stata source code where continuation lines have operators (`&`, `|`, etc.) at the exact same column position as the previous line (meeting the quality criteria for purposeful alignment), formatting with `preserveAlignment: true` SHALL preserve the original whitespace on those continuation lines.

Example of purposeful alignment (operators at same column):
```stata
replace y = x if z1 == 1 & z2 == 2 & z3 == 3 ///
                                             & z4 == 4
```

**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: Aligned Condition Preservation

*For any* Stata source code where continuation lines following an `if` qualifier have conditions aligned to start at the same column (meeting the quality criteria for purposeful alignment), formatting with `preserveAlignment: true` SHALL preserve the original whitespace on those continuation lines.

Example of purposeful alignment (conditions aligned after `if `):
```stata
replace y = x if z1 == 1 & 
                 z2 == 2 & 
                 z3 == 3 & ///
                 z4 == 4
```

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Expression Alignment Preservation

*For any* Stata source code where continuation line content is aligned with the start of the expression on the first line (e.g., aligned with the right-hand side of an assignment), formatting with `preserveAlignment: true` SHALL preserve the original whitespace on those continuation lines.

Example of purposeful alignment (continuation aligned with expression start):
```stata
gen x = y +  ///
        z
```

**Validates: Requirements 1.4**

### Property 4: Non-Purposeful Alignment Standard Indentation

*For any* Stata source code where continuation lines do NOT meet the quality criteria for purposeful alignment (operators not at same column, conditions not aligned, expression not aligned), formatting SHALL apply standard continuation indentation (base indent + 1 level).

**Validates: Requirements 2.4, 3.3**

### Property 5: Statement Isolation

*For any* Stata source code containing multiple statements with continuation lines, formatting SHALL analyze each statement's continuation lines independently. Alignment detection in one statement SHALL NOT affect another statement.

**Validates: Requirements 5.1, 5.4**

### Property 6: Disabled Mode Standard Indentation

*For any* Stata source code containing continuation lines, when formatted with `preserveAlignment: false`, continuation lines SHALL receive standard indentation (base indent level + 1) regardless of any alignment patterns.

**Validates: Requirements 6.3**

### Property 7: Configuration Default Value

*For any* formatter configuration that does not explicitly set `preserveAlignment`, the default value SHALL be `true`.

**Validates: Requirements 6.1**

## Error Handling

### Malformed Continuation Lines

If a `///` continuation marker appears at the end of a file without a following line:
- The formatter SHALL treat it as a regular line (no continuation group)
- No error SHALL be raised; the formatter degrades gracefully

### Empty Continuation Lines

If a continuation line is empty or contains only whitespace:
- The formatter SHALL preserve the empty/whitespace line as-is
- The line SHALL still be considered part of the continuation group

### Mixed Indentation (Tabs and Spaces)

If continuation lines use mixed tabs and spaces:
- The formatter SHALL preserve the exact original characters
- No normalization of tabs to spaces (or vice versa) SHALL occur on continuation lines when `preserveAlignment: true`

### Configuration Errors

If the `formatting.preserveAlignment` configuration value is not a boolean:
- The formatter SHALL use the default value (`true`)
- A warning SHALL be logged

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all valid inputs

### Property-Based Testing Configuration

- **Library**: fast-check (already used in the project)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: continuation-line-alignment-preservation, Property {number}: {property_text}`

### Test Categories

#### Property Tests

1. **Aligned Operator Preservation**
   - Generate Stata code with continuation lines where operators are at the same column
   - Format with `preserveAlignment: true`
   - Assert continuation line whitespace is unchanged

2. **Aligned Condition Preservation**
   - Generate Stata code with `if` conditions aligned to the same column across continuation lines
   - Format with `preserveAlignment: true`
   - Assert continuation line whitespace is unchanged

3. **Expression Alignment Preservation**
   - Generate Stata code with continuation lines aligned to expression start
   - Format with `preserveAlignment: true`
   - Assert continuation line whitespace is unchanged

4. **Non-Purposeful Alignment Standard Indentation**
   - Generate Stata code with continuation lines where operators/conditions do NOT meet quality criteria
   - Format with `preserveAlignment: true`
   - Assert continuation lines have standard indentation (base + 1)

5. **Statement Isolation**
   - Generate files with multiple statements, each with continuation lines
   - Some statements with alignment, some without
   - Assert each statement is processed independently

6. **Disabled Mode Standard Indentation**
   - Generate random Stata code with aligned continuation lines
   - Format with `preserveAlignment: false`
   - Assert continuation lines have standard indentation regardless of alignment

7. **Configuration Default**
   - Create formatter with no explicit `preserveAlignment` setting
   - Assert the effective value is `true`

#### Unit Tests

1. **Aligned Operators Example**
   ```stata
   replace y = x if z1 == 1 & z2 == 2 & z3 == 3 ///
                                                & z4 == 4
   ```
   - Verify formatting preserves the alignment (operator `&` at same column)

2. **Aligned Conditions After `if` Example**
   ```stata
   replace y = x if z1 == 1 & 
                    z2 == 2 & 
                    z3 == 3 & ///
                    z4 == 4
   ```
   - Verify formatting preserves the alignment (conditions start at same column)

3. **Expression Alignment Example**
   ```stata
   gen x = y +  ///
           z
   ```
   - Verify formatting preserves the alignment (continuation aligned with expression)

4. **Non-Aligned Continuation Example**
   ```stata
   replace y = x if z1 == 1 ///
       & z2 == 2
   ```
   - Verify standard indentation is applied (no alignment detected)

5. **Mixed Alignment in Single Statement**
   - Some continuation lines aligned, some not
   - Verify aligned lines preserved, non-aligned get standard indent

6. **Empty Continuation Line**
   - Continuation line with only whitespace
   - Verify appropriate handling

7. **Configuration from .sight.json**
   - Test reading `formatting.preserveAlignment` from config file

### Formatter Mode Coverage

All tests MUST run against both formatter implementations:
- Source-preserving formatter
- AST formatter

Use the dual-mode test helpers from `tests/property/helpers/formatter-test-utils.ts`.
