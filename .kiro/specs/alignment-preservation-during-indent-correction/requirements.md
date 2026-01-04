# Requirements Document

## Introduction

This feature addresses a complex interaction between two formatter behaviors: correcting incorrect indentation and preserving intentional alignment in continuation lines. When a code block is incorrectly indented (e.g., missing an indent level), the formatter must fix the base indentation while simultaneously preserving any intentional alignment patterns within continuation lines. The current implementation may strip alignment when adjusting indentation, resulting in less readable code.

This spec builds upon the `continuation-line-alignment-preservation` spec, extending it to handle the case where indentation correction and alignment preservation must work together.

## Glossary

- **Base_Indentation**: The indentation level determined by the code's nesting depth (e.g., inside an `if` block adds one indent level)
- **Indentation_Correction**: The process of adjusting a line's leading whitespace to match the correct base indentation for its nesting level
- **Continuation_Line**: A line that continues a statement from the previous line, indicated by `///` at the end of the preceding line
- **Intentional_Alignment**: User-applied formatting where code elements (operators, conditions) are vertically aligned across multiple lines for readability
- **Alignment_Offset**: The number of characters from the start of a line to an aligned element (e.g., the `&` operator)
- **Relative_Alignment**: The column position of aligned elements relative to the statement's starting position, which should be preserved even when base indentation changes
- **Formatter**: The Sight LSP code formatter component

## Requirements

### Requirement 1: Preserve Alignment When Correcting Indentation

**User Story:** As a Stata developer, I want the formatter to preserve my intentional operator alignment when it corrects incorrect block indentation, so that my code remains readable after formatting.

#### Acceptance Criteria

1. WHEN the Formatter corrects the base indentation of a statement with continuation lines, THE Formatter SHALL detect any intentional alignment patterns in those continuation lines
2. WHEN intentional alignment is detected and base indentation is being corrected, THE Formatter SHALL adjust the continuation line whitespace to maintain the relative alignment
3. WHEN a continuation line has an operator (`&`, `|`, etc.) aligned with operators on the previous line, THE Formatter SHALL preserve that column alignment relative to the statement start after indentation correction
4. THE Formatter SHALL apply the indentation correction delta to all lines in the continuation group while preserving internal alignment relationships

### Requirement 2: Calculate Alignment Offset Correctly

**User Story:** As a Stata developer, I want the formatter to correctly calculate how much whitespace to add or remove from continuation lines when fixing indentation, so that alignment is preserved.

#### Acceptance Criteria

1. WHEN the Formatter determines that a statement needs indentation correction of N spaces, THE Formatter SHALL apply the same N-space adjustment to all continuation lines in that statement
2. WHEN a continuation line has intentional alignment, THE Formatter SHALL add N spaces to the beginning of the line (where N is the indentation correction delta)
3. WHEN the indentation correction is negative (removing spaces), THE Formatter SHALL remove spaces from the beginning of continuation lines while ensuring alignment characters remain at their relative positions
4. IF removing spaces would destroy alignment (not enough leading whitespace), THEN THE Formatter SHALL preserve the minimum whitespace needed to maintain alignment

### Requirement 3: Handle Nested Block Indentation Correction

**User Story:** As a Stata developer, I want the formatter to correctly handle alignment preservation when fixing indentation in deeply nested blocks, so that complex code structures remain readable.

#### Acceptance Criteria

1. WHEN a statement with continuation lines is inside a nested block that needs indentation correction, THE Formatter SHALL correctly calculate the total indentation delta
2. WHEN multiple nesting levels need correction, THE Formatter SHALL apply the cumulative indentation delta to continuation lines
3. THE Formatter SHALL preserve alignment relationships regardless of how many nesting levels need correction
4. WHEN an outer block's indentation is corrected, THE Formatter SHALL propagate the correction to all inner blocks while preserving their internal alignments

### Requirement 4: Distinguish Between Alignment Types During Correction

**User Story:** As a Stata developer, I want the formatter to handle different types of alignment correctly when fixing indentation, so that all my alignment patterns are preserved.

#### Acceptance Criteria

1. WHEN correcting indentation for a statement with operator-aligned continuation lines, THE Formatter SHALL preserve the operator column positions relative to the statement
2. WHEN correcting indentation for a statement with condition-aligned continuation lines (after `if`), THE Formatter SHALL preserve the condition start positions relative to the statement
3. WHEN correcting indentation for a statement with expression-aligned continuation lines, THE Formatter SHALL preserve the expression alignment relative to the statement
4. THE Formatter SHALL handle mixed alignment types within the same file correctly

### Requirement 5: Maintain Idempotency

**User Story:** As a Stata developer, I want formatting to be idempotent even when alignment preservation and indentation correction interact, so that repeated formatting doesn't change my code.

#### Acceptance Criteria

1. WHEN the Formatter has corrected indentation and preserved alignment, formatting the result again SHALL produce identical output
2. THE Formatter SHALL not accumulate or lose whitespace on repeated formatting operations
3. WHEN alignment is preserved during indentation correction, subsequent format operations SHALL recognize the alignment and preserve it

### Requirement 6: Handle Edge Cases

**User Story:** As a Stata developer, I want the formatter to handle edge cases gracefully when alignment preservation and indentation correction interact.

#### Acceptance Criteria

1. WHEN a continuation line has no leading whitespace and indentation needs to be added, THE Formatter SHALL add the required whitespace while preserving any alignment
2. WHEN a continuation line's alignment would be destroyed by indentation removal, THE Formatter SHALL preserve minimum alignment whitespace
3. WHEN a statement spans multiple continuation lines with varying alignment patterns, THE Formatter SHALL handle each line according to its specific alignment
4. IF a continuation line has tabs mixed with spaces, THEN THE Formatter SHALL handle the mixed whitespace appropriately when adjusting indentation

