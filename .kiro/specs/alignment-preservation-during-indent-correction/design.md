# Design Document: Alignment Preservation During Indent Correction

## Overview

This design addresses the interaction between two formatter behaviors: correcting incorrect indentation and preserving intentional alignment in continuation lines. The core insight is that when a code block needs indentation correction, the formatter must apply the same indentation delta to continuation lines while preserving their internal alignment relationships.

The current implementation has a gap: when `preserve_whitespace` is set for aligned continuation lines, the formatter preserves the **original** whitespace verbatim. However, when the statement's base indentation is incorrect, the continuation lines need their whitespace **adjusted** by the same delta as the base line, not preserved as-is.

### The Problem

Consider this incorrectly indented code (missing one indent level inside an `if` block):

```stata
if condition {
replace mistimed = 0 if v367 != . & v367 != 2 & v367 != 9 			///
                                              & cm_lastbirth == cm_birth
}
```

The `&` on line 3 is aligned with the `&` between `v367 != 2` and `v367 != 9` on line 2.

The current formatter:
1. Correctly detects the `replace` statement needs +4 spaces (one indent level)
2. Detects the continuation line has alignment (the `&` operators are aligned)
3. **Incorrectly** preserves the original whitespace on the continuation line

Result (wrong):
```stata
if condition {
    replace mistimed = 0 if v367 != . & v367 != 2 & v367 != 9 			///
                                              & cm_lastbirth == cm_birth
}
```

The continuation line didn't get the +4 spaces, so the `&` is no longer aligned.

Expected result:
```stata
if condition {
    replace mistimed = 0 if v367 != . & v367 != 2 & v367 != 9 			///
                                                  & cm_lastbirth == cm_birth
}
```

The continuation line got +4 spaces, preserving the `&` alignment.

### The Solution

Instead of a binary `preserve_whitespace` flag, we need to:
1. Calculate the **indentation delta** (difference between current and correct indentation)
2. Apply that delta to continuation lines while preserving their **relative** alignment

## Architecture

The solution modifies the existing formatter pipeline to track and apply indentation deltas:

```
Source Code → Lexer → Parser → Analyzer → Formatter → Output
                                              ↓
                                    ┌─────────────────────┐
                                    │ Alignment Detector  │
                                    │ (existing)          │
                                    └─────────────────────┘
                                              ↓
                                    ┌─────────────────────┐
                                    │ Indentation Analyzer│
                                    │ (modified: track    │
                                    │  delta per line)    │
                                    └─────────────────────┘
                                              ↓
                                    ┌─────────────────────┐
                                    │ Token Reconstructor │
                                    │ (modified: apply    │
                                    │  delta to aligned)  │
                                    └─────────────────────┘
```

### Key Design Decisions

1. **Delta-Based Adjustment**: Instead of preserving original whitespace verbatim, calculate the indentation delta and apply it to continuation lines.

2. **Relative Alignment Preservation**: The column position of aligned elements relative to the statement start is preserved, not the absolute column position.

3. **Per-Statement Delta Calculation**: Each statement's continuation lines receive the same delta as the statement's first line.

4. **Backward Compatibility**: When no indentation correction is needed (delta = 0), behavior is identical to current implementation.

## Components and Interfaces

### Extended IndentationInfo

The `IndentationInfo` interface is extended to track the indentation delta:

```typescript
interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
    preserve_whitespace: boolean;
    /** NEW: The indentation delta to apply (positive = add spaces, negative = remove) */
    indent_delta: number;
    /** NEW: The original indentation in spaces (for delta calculation) */
    original_indent: number;
}
```

### Modified IndentationAnalyzer

The `IndentationAnalyzer` is modified to calculate deltas:

```typescript
class IndentationAnalyzer {
    analyze(
        ast: StataAST, 
        tokens?: Token[],
        alignment_info?: Map<number, ContinuationGroup>,
        original_source?: string  // NEW: needed for delta calculation
    ): Map<number, IndentationInfo>;
    
    /**
     * Calculate the indentation delta for a line.
     * @param line - The line number
     * @param original_source - The original source code
     * @param target_indent_level - The correct indentation level
     * @param indent_size - Spaces per indent level
     * @returns The delta in spaces (positive = add, negative = remove)
     */
    private calculate_indent_delta(
        line: number,
        original_source: string,
        target_indent_level: number,
        indent_size: number
    ): number;
}
```

### Modified TokenReconstructor

The `TokenReconstructor` is modified to apply deltas to aligned lines:

```typescript
class TokenReconstructor {
    reconstruct(
        tokens: Token[],
        line_indents: Map<number, IndentationInfo>,
        config: FormatterConfig,
        original_source: string
    ): string;
    
    /**
     * Apply indentation delta to a line's whitespace.
     * @param original_whitespace - The original leading whitespace
     * @param delta - The number of spaces to add (positive) or remove (negative)
     * @param config - Formatter configuration
     * @returns The adjusted whitespace string
     */
    private apply_indent_delta(
        original_whitespace: string,
        delta: number,
        config: FormatterConfig
    ): string;
}
```

### Modified ContinuationGroup

The `ContinuationGroup` interface is extended to track the base line's delta:

```typescript
interface ContinuationGroup {
    start_line: number;
    continuation_lines: number[];
    has_alignment: boolean;
    aligned_lines: Set<number>;
    /** NEW: The indentation delta from the statement's first line */
    base_delta: number;
}
```

## Data Models

### IndentationDelta

Represents the indentation adjustment needed for a line:

```typescript
interface IndentationDelta {
    /** The line number */
    line: number;
    /** Original indentation in spaces */
    original_spaces: number;
    /** Target indentation in spaces */
    target_spaces: number;
    /** The delta (target - original) */
    delta: number;
}
```

### AlignedLineAdjustment

Represents how to adjust an aligned continuation line:

```typescript
interface AlignedLineAdjustment {
    /** The line number */
    line: number;
    /** Original leading whitespace */
    original_whitespace: string;
    /** The delta to apply from the base statement */
    delta: number;
    /** The adjusted whitespace */
    adjusted_whitespace: string;
}
```

## Algorithm

### Delta Calculation

For each statement with continuation lines:

1. **Calculate base delta**: Compare the statement's first line's current indentation to its correct indentation
   ```
   base_delta = (correct_indent_level * indent_size) - original_indent_spaces
   ```

2. **Propagate to continuations**: Apply the same delta to all continuation lines in the group

3. **Adjust whitespace**: For each continuation line:
   ```
   new_whitespace = original_whitespace + delta_spaces (if delta > 0)
   new_whitespace = original_whitespace[delta:] (if delta < 0, with bounds checking)
   ```

### Whitespace Adjustment

When applying a positive delta (adding spaces):
```typescript
function apply_positive_delta(original: string, delta: number): string {
    return ' '.repeat(delta) + original;
}
```

When applying a negative delta (removing spaces):
```typescript
function apply_negative_delta(original: string, delta: number): string {
    const spaces_to_remove = Math.abs(delta);
    // Count leading spaces in original
    const leading_spaces = original.match(/^ */)?.[0].length ?? 0;
    // Remove up to spaces_to_remove, but preserve alignment if not enough
    const actual_remove = Math.min(spaces_to_remove, leading_spaces);
    return original.substring(actual_remove);
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Alignment Preservation with Indentation Correction

*For any* Stata source code where:
- A statement has continuation lines with intentional alignment (operators at same column)
- The statement's base indentation is incorrect (needs correction)

Formatting SHALL:
- Apply the indentation correction to the statement's first line
- Apply the same indentation delta to all continuation lines
- Preserve the relative column positions of aligned elements

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 2: Indentation Delta Application

*For any* Stata source code where a statement with continuation lines needs indentation correction of N spaces (positive or negative), formatting SHALL apply the same N-space adjustment to all continuation lines in that statement, preserving their internal alignment relationships.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Nested Block Indentation Correction

*For any* Stata source code with nested blocks where one or more nesting levels have incorrect indentation, formatting SHALL:
- Calculate the cumulative indentation delta for each nesting level
- Apply the correct total delta to statements at each level
- Propagate the delta to continuation lines while preserving alignment

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 4: Alignment Type Preservation

*For any* Stata source code with continuation lines containing:
- Operator alignment (`&`, `|`, etc. at same column)
- Condition alignment (conditions after `if` at same column)
- Expression alignment (continuation aligned with expression start)

Formatting with indentation correction SHALL preserve the relative column positions for all alignment types.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 5: Idempotency

*For any* Stata source code, formatting the code twice SHALL produce the same result as formatting once:
```
format(format(code)) == format(code)
```

This holds regardless of whether indentation correction and alignment preservation interact.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 6: Mixed Alignment Handling

*For any* Stata source code containing multiple statements with different alignment patterns (some with operator alignment, some with condition alignment, some without alignment), formatting SHALL handle each statement independently according to its specific alignment pattern.

**Validates: Requirements 6.3**

## Error Handling

### Insufficient Whitespace for Negative Delta

When a negative delta would remove more spaces than available:
- Remove only the available leading spaces
- Log a warning (debug level)
- The alignment may shift, but the code remains valid

### Mixed Tabs and Spaces

When continuation lines have mixed tabs and spaces:
- Convert tabs to spaces using `indent_size` for calculation
- Apply delta in spaces
- Output uses the configured `indent_style`

### Empty Continuation Lines

When a continuation line is empty or whitespace-only:
- Apply the delta to whatever whitespace exists
- If the line is truly empty, add the delta as leading spaces

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all valid inputs

### Property-Based Testing Configuration

- **Library**: fast-check (already used in the project)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: alignment-preservation-during-indent-correction, Property {number}: {property_text}`

### Test Categories

#### Property Tests

1. **Alignment Preservation with Indentation Correction**
   - Generate Stata code with aligned continuation lines and incorrect base indentation
   - Format the code
   - Assert: relative column positions of aligned elements are preserved
   - Assert: base indentation is corrected

2. **Indentation Delta Application**
   - Generate Stata code with known incorrect indentation (e.g., missing N spaces)
   - Format the code
   - Assert: all continuation lines received the same N-space adjustment

3. **Nested Block Indentation Correction**
   - Generate deeply nested Stata code with incorrect indentation at various levels
   - Format the code
   - Assert: cumulative deltas are correctly calculated and applied
   - Assert: alignment within each statement is preserved

4. **Alignment Type Preservation**
   - Generate Stata code with different alignment types (operator, condition, expression)
   - Add incorrect indentation
   - Format the code
   - Assert: each alignment type is preserved correctly

5. **Idempotency**
   - Generate random Stata code with continuation lines
   - Format once, then format again
   - Assert: second format produces identical output

6. **Mixed Alignment Handling**
   - Generate files with multiple statements having different alignment patterns
   - Format the code
   - Assert: each statement is handled according to its specific pattern

#### Unit Tests

1. **Basic Delta Application**
   ```stata
   // Before (missing 4 spaces)
   if condition {
   replace x = 1 if a == 1 ///
                  & b == 2
   }
   
   // After
   if condition {
       replace x = 1 if a == 1 ///
                      & b == 2
   }
   ```

2. **Negative Delta (Over-indented)**
   ```stata
   // Before (4 extra spaces)
   if condition {
           replace x = 1 if a == 1 ///
                          & b == 2
   }
   
   // After
   if condition {
       replace x = 1 if a == 1 ///
                      & b == 2
   }
   ```

3. **Nested Block Correction**
   - Multiple nesting levels with incorrect indentation
   - Verify cumulative delta is applied correctly

4. **Edge Case: No Leading Whitespace**
   - Continuation line starts at column 0
   - Verify spaces are added correctly

5. **Edge Case: Insufficient Whitespace for Removal**
   - Continuation line has fewer spaces than delta requires
   - Verify graceful handling

### Formatter Mode Coverage

All tests MUST run against both formatter implementations:
- Source-preserving formatter
- AST formatter

Use the dual-mode test helpers from `tests/property/helpers/formatter-test-utils.ts`.
