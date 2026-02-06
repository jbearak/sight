# Implementation Plan: Stata Outline Section Detection

## Tasks

- [x] 1. Create Kiro specs
  - [x] 1.1 Create `.kiro/specs/stata-outline-sections/requirements.md`
  - [x] 1.2 Create `.kiro/specs/stata-outline-sections/design.md`
  - [x] 1.3 Create `.kiro/specs/stata-outline-sections/tasks.md`

- [x] 2. Implement SectionDetector
  - [x] 2.1 Create `src/providers/section-detector.ts` with `RawSection` interface, `DelimiterKind` type, `SectionDetectionType` type
  - [x] 2.2 Implement `is_delimiter_only()` helper
  - [x] 2.3 Implement single-line section detection (slash-style and star-style regex patterns)
  - [x] 2.4 Implement `classify_delimiter_line()` and `extract_banner_name()` helpers
  - [x] 2.5 Implement banner-style section detection (3-line patterns with matching delimiters)
  - [x] 2.6 Implement starred inline section detection (`*** Name ***` pattern)
  - [x] 2.7 Implement numbered section detection with level derivation from number depth
  - [x] 2.8 Implement `extract_sections()` orchestrator: run all detectors, merge, sort, deduplicate

- [x] 3. Implement hierarchy building
  - [x] 3.1 Add `compute_section_ranges()` in `src/providers/symbols.ts` — stack-based, level-aware
  - [x] 3.2 Add `nest_in_sections()` — build section hierarchy by level + insert existing symbols
  - [x] 3.3 Integrate into `get_document_symbols()`: extract → compute ranges → nest → merge → sort

- [x] 4. Write unit tests
  - [x] 4.1 Create `tests/unit/section-detector.test.ts`
  - [x] 4.2 Add section range computation tests in `tests/unit/symbols.test.ts`
  - [x] 4.3 Add section hierarchy integration tests in `tests/unit/symbols.test.ts`

- [x] 5. Write property-based tests
  - [x] 5.1 Create `tests/property/generators/sections.ts`
  - [x] 5.2 Create `tests/property/section-detection.prop.test.ts` (Properties 1, 2, 3, 9)
  - [x] 5.3 Create `tests/property/section-hierarchy.prop.test.ts` (Properties 4, 5, 6, 7, 8)

- [x] 6. Run all tests and verify
  - [x] 6.1 Run `bun run test` — all existing + new tests pass
  - [x] 6.2 Verify no type errors: `bun run typecheck`
