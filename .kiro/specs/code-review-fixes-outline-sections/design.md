# Design Document: Code Review Fixes for Outline Sections

## Overview

This design addresses 11 code review comments from CodeRabbit on PR #69. The changes span four files: the section generator (`tests/property/generators/sections.ts`), the section detector (`src/providers/section-detector.ts`), the symbol provider (`src/providers/symbols.ts`), and two property test files. Additionally, spec/plan markdown files need MD040 lint fixes and the tasks.md needs status updates.

The most impactful change is fixing the fast-check determinism bug in the section generator, which currently uses `fc.sample()` inside a `.map()` callback — breaking reproducibility and shrinking. The symbol provider also gets a structural improvement: removing the redundant `_range` field and replacing the O(S×N) flat-scan symbol assignment with a stack-based single-pass O(S+N) algorithm.

## Architecture

No architectural changes. All modifications are localized refactors within existing modules:

- **Section Generator**: Restructure the arbitrary pipeline to include gap generation
- **Section Detector**: Hoist regex constants, fix JSDoc
- **Symbol Provider**: Add named constant, remove `_range`, optimize `nest_in_sections`
- **Property Tests**: Extract helper, improve lookup clarity
- **Spec Documents**: Fix markdown lint, update task status

## Components and Interfaces

### 1. Section Generator Fix (`tests/property/generators/sections.ts`)

The `arbitrary_section_list()` function currently generates inter-section gaps using `fc.sample()` inside `.map()`. The fix restructures the pipeline:

**Before:**
```typescript
return fc.tuple(...my_section_gens).map((my_entries) => {
    // ...
    my_current_line += fc.sample(fc.integer({ min: 3, max: 10 }), 1)[0];
    // ...
});
```

**After:**
```typescript
const my_gap_gen = fc.array(
    fc.integer({ min: 3, max: 10 }),
    { minLength: my_count, maxLength: my_count }
);

return fc.tuple(
    fc.tuple(...my_section_gens), my_gap_gen
).map(([my_entries, my_gaps]) => {
    // ...
    my_current_line += my_gaps[my_i];
    // ...
});
```

The gap array is generated as a proper fast-check arbitrary, paired with the section entries in a single `fc.tuple`. This ensures gaps are controlled by the property seed and shrinkable.

### 2. Regex Hoisting (`src/providers/section-detector.ts`)

Four new module-level constants:

```typescript
const ALL_ASTERISK_PATTERN = /^\*{4,}$/;
const ALL_SLASH_PATTERN = /^\/{4,}$/;
const SLASH_DELIM_PATTERN = /^\/\/\s*([-=*+])\1{3,}\s*$/;
const STAR_DELIM_PATTERN = /^\*\s+([-=+])\1{3,}\s*$/;
```

`classify_delimiter_line()` references these instead of creating inline regex objects.

### 3. Named Constant (`src/providers/symbols.ts`)

```typescript
/** LSP end-of-line sentinel (max 32-bit signed int) */
const LSP_EOL_CHARACTER = 2147483647;
```

Replaces both occurrences in `compute_section_ranges()`.

### 4. Remove Redundant `_range` Field (`src/providers/symbols.ts`)

The augmented section type currently carries both `range` (from DocumentSymbol) and `_range` (identical reference). Since `compute_section_ranges()` runs before `nest_in_sections()`, the `range` property already has its final value. The `_range` field is removed:

**Before:**
```typescript
Array<DocumentSymbol & { _level: number; _range: Range }>
```

**After:**
```typescript
Array<DocumentSymbol & { _level: number }>
```

`find_deepest_containing_section()` uses `range` directly. `strip_internal_fields()` only strips `_level`.

### 5. Single-Pass Symbol Assignment (`src/providers/symbols.ts`)

Replace the O(S×N) flat-scan `find_deepest_containing_section()` with a stack-based single-pass algorithm in `nest_in_sections()`:

**Algorithm:**
1. Both sections and symbols are sorted by start line
2. Walk through symbols in order
3. Maintain a stack of "active" sections (sections whose range contains the current position)
4. For each symbol, pop sections from the stack whose range has ended, then assign to the top of the stack (deepest active section)

```typescript
// Single-pass symbol assignment using section stack
const my_section_idx_stack: number[] = [];
let my_next_section = 0;

for (const my_symbol of existing_symbols) {
    const my_sym_line = my_symbol.range.start.line;

    // Push sections that start at or before this symbol
    while (my_next_section < my_section_symbols.length &&
           my_section_symbols[my_next_section].range.start.line <= my_sym_line) {
        my_section_idx_stack.push(my_next_section);
        my_next_section++;
    }

    // Pop sections whose range has ended
    while (my_section_idx_stack.length > 0) {
        const my_top = my_section_idx_stack[my_section_idx_stack.length - 1];
        if (my_section_symbols[my_top].range.end.line < my_sym_line) {
            my_section_idx_stack.pop();
        } else {
            break;
        }
    }

    // Assign to deepest active section (top of stack)
    if (my_section_idx_stack.length > 0) {
        const my_deepest = my_section_idx_stack[my_section_idx_stack.length - 1];
        my_section_symbols[my_deepest].children!.push(my_symbol);
    } else {
        my_root_orphans.push(my_symbol);
    }
}
```

This replaces `find_deepest_containing_section()` entirely.

### 6. Range-Containment Helper (`tests/property/section-detection.prop.test.ts`)

Extract the duplicated range-containment check into a helper:

```typescript
function is_selection_contained(section: RawSection): boolean {
    const my_range = section.range;
    const my_sel = section.selection_range;
    if (my_sel.start.line < my_range.start.line) return false;
    if (my_sel.start.line === my_range.start.line &&
        my_sel.start.character < my_range.start.character) return false;
    if (my_sel.end.line > my_range.end.line) return false;
    if (my_sel.end.line === my_range.end.line &&
        my_sel.end.character > my_range.end.character) return false;
    return true;
}
```

### 7. Map-Based Lookup (`tests/property/section-hierarchy.prop.test.ts`)

Replace the `.find()` callback that ignores its element parameter with a `Map<number, Range>` keyed by start line:

```typescript
const my_original_sel_by_line = new Map(
    my_sections.map((my_s) => [
        my_s.range.start.line,
        {
            start: { ... },
            end: { ... },
        },
    ])
);
```

## Data Models

No new data models. The only structural change is removing `_range` from the augmented section symbol type in `nest_in_sections()`.

**Before:**
```typescript
Array<DocumentSymbol & { _level: number; _range: Range }>
```

**After:**
```typescript
Array<DocumentSymbol & { _level: number }>
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Most changes in this spec are structural refactors (regex hoisting, constant naming, documentation fixes, test cleanup) that don't alter functional behavior. The existing property tests (Properties 1-9 from the original outline-sections spec) already validate the functional contract. Two new properties are warranted:

### Property 1: Generator determinism

*For any* random seed, running `arbitrary_section_list()` twice with the same seed SHALL produce identical section lists (same names, levels, start lines, and detection types).

**Validates: Requirements 1.1, 1.2**

This property verifies that the generator fix eliminates the non-determinism caused by `fc.sample()`. We test this by generating sections with a fixed seed and comparing two runs.

### Property 2: Single-pass equivalence to flat-scan (model-based)

*For any* list of sections with computed ranges and any list of symbols sorted by position, the single-pass stack-based symbol assignment SHALL produce identical nesting results to the original flat-scan `find_deepest_containing_section()` approach.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4**

This is a model-based test: we keep the original flat-scan implementation as a reference and verify the optimized single-pass produces identical output for all generated inputs. Once confidence is established, the reference implementation can be removed.

## Error Handling

No new error handling needed. All changes are refactors that preserve existing error behavior:

- The generator fix doesn't introduce new failure modes
- Regex hoisting is a pure performance optimization
- The `_range` removal and single-pass optimization preserve the same edge case handling (empty sections, no sections, symbols outside all sections)

## Testing Strategy

### Dual Testing Approach

- **Existing property tests** (Properties 1-9 from original spec): Must continue to pass unchanged. These validate the functional contract that the refactors must preserve.
- **New Property 1** (generator determinism): Validates the fc.sample() fix using fast-check with fixed seeds.
- **New Property 2** (single-pass equivalence): Model-based test comparing optimized vs reference implementation.
- **Existing unit tests**: All section-detector and symbols unit tests must continue to pass.

### Property-Based Testing Configuration

- Library: fast-check (already in use)
- Minimum 100 iterations per property test
- Tag format: **Feature: code-review-fixes-outline-sections, Property {number}: {property_text}**
- Each correctness property is implemented by a single property-based test

### Test Modifications

1. **section-detection.prop.test.ts**: Extract `is_selection_contained()` helper, use in all three sub-property checks of Property 3. No behavioral change.
2. **section-hierarchy.prop.test.ts**: Replace `.find()` with `Map<number, Range>` lookup in Property 6. No behavioral change.
3. **generators/sections.ts**: Fix `arbitrary_section_list()` pipeline. Add determinism test.
