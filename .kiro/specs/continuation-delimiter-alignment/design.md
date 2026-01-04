# Design Document: Continuation Delimiter Alignment Preservation

## Overview

This feature fixes the formatter's tab-to-space conversion to preserve visual alignment. The current implementation replaces each tab with a fixed number of spaces, but tabs actually expand to the next tab stop position. This causes visually aligned `///` delimiters to become misaligned after formatting.

## Architecture

The fix modifies the `TokenReconstructor` class to use proper tab expansion when converting tabs to spaces:

```
Original: "code\t\t///"  (tabs at columns 4 and 8, /// at visual column 16)
Current:  "code        ///"  (8 spaces, /// at column 12 - WRONG)
Fixed:    "code            ///"  (12 spaces, /// at column 16 - CORRECT)
```

### Design Decision: Tab Expansion Algorithm

**Option 1: Calculate visual column and emit spaces (Chosen)**
- Walk through the original spacing character by character
- Track the visual column, expanding tabs to the next tab stop
- Emit the correct number of spaces to reach the same visual column
- Pros: Simple, correct, handles mixed tabs/spaces
- Cons: Slightly more computation than simple replacement

**Option 2: Regex-based positional replacement**
- Use regex to find tab positions and calculate replacement
- Pros: Potentially faster for simple cases
- Cons: Complex regex, harder to handle mixed whitespace

**Decision**: Use Option 1 for clarity and correctness.

## Components and Interfaces

### Modified Components

#### TokenReconstructor (`src/formatter/token-reconstructor.ts`)

Add a helper method to convert tabs to spaces while preserving visual column:

```typescript
/**
 * Convert tabs to spaces while preserving visual column alignment.
 * Each tab expands to the next tab stop (multiples of tab_width).
 * 
 * @param spacing - The original spacing string (may contain tabs and spaces)
 * @param start_column - The visual column where this spacing begins
 * @param tab_width - The tab stop interval (typically indent_size)
 * @returns Spaces that produce the same visual width
 */
private expand_tabs_to_spaces(
    spacing: string,
    start_column: number,
    tab_width: number
): string {
    let visual_column = start_column;
    
    for (const char of spacing) {
        if (char === '\t') {
            // Tab expands to next tab stop
            visual_column = Math.ceil((visual_column + 1) / tab_width) * tab_width;
        } else {
            visual_column += 1;
        }
    }
    
    // Return spaces to reach the same visual column
    const spaces_needed = visual_column - start_column;
    return ' '.repeat(spaces_needed);
}
```

Modify the spacing conversion in `reconstruct()` to use this helper instead of simple replacement:

```typescript
// Before (incorrect):
spacing = spacing.replace(/\t/g, ' '.repeat(config.indent_size));

// After (correct):
spacing = this.expand_tabs_to_spaces(spacing, state.current_column, config.indent_size);
```

### Interface Changes

No public interface changes. The `FormatterConfig.indent_size` is already used and will now also serve as the tab stop interval.

## Data Models

No new data models required.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Visual Column Preservation

*For any* string containing tabs (with or without spaces), and *for any* starting column, converting tabs to spaces using the `expand_tabs_to_spaces` function should produce a string of spaces that, when rendered, ends at the same visual column as the original string with tabs.

**Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2**

### Property 2: Tab Stop Configuration Respect

*For any* tab width configuration and *for any* string containing tabs, the tab expansion should use the configured tab width as the tab stop interval, producing different results for different tab widths.

**Validates: Requirements 2.1**

## Error Handling

The tab expansion is a pure string operation that cannot fail:
- Empty spacing string → returns empty string
- Spacing with no tabs → returns the original spacing (all spaces)
- Negative start_column → treated as 0 (defensive)
- Zero or negative tab_width → defaults to 4 (defensive)

## Testing Strategy

### Property-Based Tests

Use fast-check to verify:

1. **Visual column preservation**: Generate random spacing strings with tabs at various positions, convert to spaces, verify the visual width is preserved
2. **Tab stop configuration**: Generate spacing with tabs, convert with different tab widths, verify results differ appropriately

### Unit Tests

Specific examples:
- Tab at column 0 with tab_width=4 → 4 spaces
- Tab at column 2 with tab_width=4 → 2 spaces (to reach column 4)
- Tab at column 4 with tab_width=4 → 4 spaces (to reach column 8)
- Mixed: "a\tb" starting at column 0 with tab_width=4 → "a   b" (tab expands from col 1 to col 4)
- Multiple tabs: "\t\t" at column 0 with tab_width=4 → 8 spaces

### Dual Formatter Mode Testing

Tests should run against both formatter modes using dual-mode test helpers.

### Test Configuration

- Property tests: minimum 100 iterations
- Tag format: **Feature: continuation-delimiter-alignment, Property N: [property description]**

