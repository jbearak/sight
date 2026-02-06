# Requirements Document

## Introduction

This feature addresses 10 code review comments from CodeRabbit on PR #69 (stata-outline-sections feature). The review identified a critical fast-check determinism bug, several code quality improvements, documentation fixes, and test refactoring opportunities.

## Glossary

- **Section_Generator**: The fast-check generator module for section property tests (`tests/property/generators/sections.ts`)
- **Section_Detector**: The section detection module (`src/providers/section-detector.ts`)
- **Symbol_Provider**: The document/workspace symbol provider (`src/providers/symbols.ts`)
- **Fast_Check_Pipeline**: The chain of fast-check arbitraries that produces deterministic, shrinkable random values
- **Inter_Section_Gap**: The number of lines between consecutive generated sections in `arbitrary_section_list()`
- **Delimiter_Classifier**: The `classify_delimiter_line()` function in Section_Detector
- **LSP_End_Of_Line_Sentinel**: The integer value `2147483647` (INT32_MAX) used by the LSP protocol to represent end-of-line
- **Section_Detection_Tests**: The property test file `tests/property/section-detection.prop.test.ts`
- **Section_Hierarchy_Tests**: The property test file `tests/property/section-hierarchy.prop.test.ts`
- **Outline_Sections_Spec**: The spec files under `.kiro/specs/stata-outline-sections/`

## Requirements

### Requirement 1: Fix fast-check determinism in section generator

**User Story:** As a developer running property tests, I want generated section lists to be deterministic and shrinkable, so that failing test cases can be reliably reproduced and minimized.

#### Acceptance Criteria

1. THE Section_Generator SHALL generate Inter_Section_Gap values as part of the Fast_Check_Pipeline rather than using `fc.sample()` inside a `.map()` callback
2. WHEN `arbitrary_section_list()` is called, THE Section_Generator SHALL produce identical output for the same random seed
3. WHEN a property test fails, THE Section_Generator SHALL support fast-check shrinking of Inter_Section_Gap values

### Requirement 2: Hoist regex literals to module level in section detector

**User Story:** As a developer maintaining the section detector, I want regex patterns to be defined at module level, so that they are not recreated on every function call and the code follows project conventions.

#### Acceptance Criteria

1. THE Section_Detector SHALL define all regex patterns used in Delimiter_Classifier as module-level constants
2. THE Delimiter_Classifier SHALL reference the module-level regex constants instead of creating inline regex objects
3. WHEN `classify_delimiter_line()` is called multiple times, THE Section_Detector SHALL reuse the same compiled regex objects

### Requirement 3: Fix JSDoc comment for line_offsets parameter

**User Story:** As a developer reading the section detector API, I want accurate documentation, so that I understand the parameter semantics correctly.

#### Acceptance Criteria

1. THE Section_Detector SHALL document the `line_offsets` parameter of `extract_sections()` as "character offset" instead of "byte offset"

### Requirement 4: Name the magic number sentinel in symbol provider

**User Story:** As a developer reading the symbol provider, I want sentinel values to be named constants, so that their purpose is immediately clear.

#### Acceptance Criteria

1. THE Symbol_Provider SHALL define a named constant for the LSP_End_Of_Line_Sentinel value `2147483647`
2. THE Symbol_Provider SHALL use the named constant in all locations where the sentinel value appears

### Requirement 5: Remove redundant _range field from section symbols

**User Story:** As a developer maintaining the symbol provider, I want the internal data structures to be minimal, so that there is no unnecessary complexity.

#### Acceptance Criteria

1. THE Symbol_Provider SHALL use the `range` property directly in `find_deepest_containing_section()` instead of a separate `_range` field
2. THE Symbol_Provider SHALL remove the `_range` field from the augmented section symbol type
3. THE `strip_internal_fields()` function SHALL remove only the `_level` tracking field

### Requirement 6: Optimize symbol-to-section assignment with single-pass merge

**User Story:** As a developer maintaining the symbol provider, I want symbol-to-section assignment to use an efficient algorithm, so that the implementation follows best practices for sorted interval containment.

#### Acceptance Criteria

1. THE Symbol_Provider SHALL assign symbols to their deepest containing section using a single-pass algorithm that exploits the sorted order of both sections and symbols
2. WHEN a symbol's start position falls within multiple nested sections, THE Symbol_Provider SHALL assign the symbol to the deepest (smallest range) containing section
3. THE optimized implementation SHALL produce identical results to the current flat-scan approach for all inputs
4. Symbols before any section SHALL remain at the root level

### Requirement 7: Update task checkboxes in outline sections spec

**User Story:** As a developer reviewing the spec, I want task statuses to reflect the actual implementation state, so that progress tracking is accurate.

#### Acceptance Criteria

1. WHEN all subtasks of a parent task are complete, THE tasks.md file SHALL mark the parent task as complete
2. THE tasks.md file SHALL mark all implemented tasks and subtasks as complete

### Requirement 8: Fix MD040 bare fenced code blocks in spec documents

**User Story:** As a developer maintaining spec documents, I want fenced code blocks to have language identifiers, so that markdown linting passes cleanly.

#### Acceptance Criteria

1. THE design.md file SHALL use a language identifier (e.g., `text`) on all fenced code blocks
2. THE `.claude/plans/stata-outline-sections.md` file SHALL use a language identifier on all fenced code blocks

### Requirement 9: Extract range-containment helper in section detection tests

**User Story:** As a developer maintaining property tests, I want duplicated logic to be extracted into a helper function, so that the tests are DRY and easier to maintain.

#### Acceptance Criteria

1. THE Section_Detection_Tests SHALL define a helper function for checking that a section's `selection_range` is contained within its `range`
2. THE Section_Detection_Tests SHALL use the helper function in all three sub-property checks of Property 3 (single-line, banner, mixed documents)

### Requirement 10: Fix .find() callback clarity in section hierarchy tests

**User Story:** As a developer reading the property tests, I want callback parameters to be used clearly, so that the code intent is obvious and not fragile.

#### Acceptance Criteria

1. THE Section_Hierarchy_Tests SHALL use a Map keyed by start line for looking up original selection ranges, instead of a `.find()` callback that ignores its element parameter
