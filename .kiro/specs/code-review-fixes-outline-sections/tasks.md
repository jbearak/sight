# Implementation Plan: Code Review Fixes for Outline Sections

## Overview

Address 11 CodeRabbit review comments on PR #69. Changes span the section generator, section detector, symbol provider, property tests, and spec documents.

## Tasks

- [x] 1. Fix fast-check determinism in section generator
  - [x] 1.1 Refactor `arbitrary_section_list()` in `tests/property/generators/sections.ts` to generate inter-section gaps as a proper fast-check arbitrary paired with section entries in `fc.tuple`, replacing the `fc.sample()` call inside `.map()`
    - Create `my_gap_gen = fc.array(fc.integer({ min: 3, max: 10 }), { minLength: my_count, maxLength: my_count })`
    - Pair with section entries: `fc.tuple(fc.tuple(...my_section_gens), my_gap_gen)`
    - In `.map()`, iterate with index and use `my_gaps[my_i]` instead of `fc.sample()`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Write property test for generator determinism
    - **Property 1: Generator determinism**
    - **Validates: Requirements 1.1, 1.2**
    - Add test in `tests/property/section-detection.prop.test.ts` or a new file verifying that `arbitrary_section_list()` produces identical output for the same seed

- [x] 2. Refactor section detector and symbol provider
  - [x] 2.1 Hoist four regex literals to module level in `src/providers/section-detector.ts`
    - Add `ALL_ASTERISK_PATTERN`, `ALL_SLASH_PATTERN`, `SLASH_DELIM_PATTERN`, `STAR_DELIM_PATTERN` as module-level constants
    - Update `classify_delimiter_line()` to reference the hoisted constants
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Fix JSDoc for `line_offsets` parameter in `extract_sections()` in `src/providers/section-detector.ts`
    - Change "byte offset" to "character offset" in the `@param line_offsets` doc
    - _Requirements: 3.1_

  - [x] 2.3 Add named constant `LSP_EOL_CHARACTER` in `src/providers/symbols.ts` and replace both `2147483647` occurrences in `compute_section_ranges()`
    - _Requirements: 4.1, 4.2_

  - [x] 2.4 Remove redundant `_range` field from augmented section type in `src/providers/symbols.ts`
    - Change type from `DocumentSymbol & { _level: number; _range: Range }` to `DocumentSymbol & { _level: number }`
    - Remove `_range: s.range` from the section symbol creation in `nest_in_sections()`
    - Update `find_deepest_containing_section()` to use `range` instead of `_range`
    - Update `strip_internal_fields()` to only strip `_level`
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 3. Optimize symbol-to-section assignment
  - [x] 3.1 Replace `find_deepest_containing_section()` flat scan with stack-based single-pass algorithm in `nest_in_sections()` in `src/providers/symbols.ts`
    - Both sections and symbols are sorted by start line
    - Use a stack of active section indices, push sections as their start line is reached, pop when their range ends
    - Assign each symbol to the top of the stack (deepest active section)
    - Remove the now-unused `find_deepest_containing_section()` function
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 3.2 Write property test for single-pass equivalence
    - **Property 2: Single-pass equivalence to flat-scan**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Model-based test comparing optimized output to reference flat-scan implementation

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Refactor property tests
  - [x] 5.1 Extract `is_selection_contained()` helper in `tests/property/section-detection.prop.test.ts` and use it in all three sub-property checks of Property 3
    - _Requirements: 9.1, 9.2_

  - [x] 5.2 Replace `.find()` callback with `Map<number, Range>` lookup in Property 6 of `tests/property/section-hierarchy.prop.test.ts`
    - Build `my_original_sel_by_line` Map keyed by start line before calling `compute_section_ranges()`
    - Use `my_original_sel_by_line.get(my_cloned[my_i].range.start.line)` instead of `.find()`
    - _Requirements: 10.1_

- [x] 6. Fix spec documents and task status
  - [x] 6.1 Add `text` language identifier to bare fenced code blocks in `.kiro/specs/stata-outline-sections/design.md` and `.claude/plans/stata-outline-sections.md`
    - _Requirements: 8.1, 8.2_

  - [x] 6.2 Update `.kiro/specs/stata-outline-sections/tasks.md` to mark all implemented tasks and subtasks as complete
    - Mark tasks 2.1-2.8, 3.1-3.3, 4.1-4.3, 5.1-5.3, 6.1-6.2 as `[x]`
    - Mark parent tasks 1-6 as `[x]`
    - _Requirements: 7.1, 7.2_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Existing property tests (Properties 1-9 from original spec) must continue to pass after all changes
- The single-pass optimization (task 3.1) is the most complex change — verify carefully with existing tests before proceeding
- `calculate_range_size()` is also used by `find_containing_program()` — do NOT remove it, only remove `find_deepest_containing_section()`
