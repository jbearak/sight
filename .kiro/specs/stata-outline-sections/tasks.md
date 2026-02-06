# Implementation Plan: Stata Outline Section Detection

## Tasks

- [ ] 1. Create Kiro specs
  - [x] 1.1 Create `.kiro/specs/stata-outline-sections/requirements.md`
  - [x] 1.2 Create `.kiro/specs/stata-outline-sections/design.md`
  - [x] 1.3 Create `.kiro/specs/stata-outline-sections/tasks.md`

- [ ] 2. Implement SectionDetector
  - [ ] 2.1 Create `src/providers/section-detector.ts` with `RawSection` interface, `DelimiterKind` type, `SectionDetectionType` type
  - [ ] 2.2 Implement `is_delimiter_only()` helper
  - [ ] 2.3 Implement single-line section detection (slash-style and star-style regex patterns)
  - [ ] 2.4 Implement `classify_delimiter_line()` and `extract_banner_name()` helpers
  - [ ] 2.5 Implement banner-style section detection (3-line patterns with matching delimiters)
  - [ ] 2.6 Implement starred inline section detection (`*** Name ***` pattern)
  - [ ] 2.7 Implement numbered section detection with level derivation from number depth
  - [ ] 2.8 Implement `extract_sections()` orchestrator: run all detectors, merge, sort, deduplicate

- [ ] 3. Implement hierarchy building
  - [ ] 3.1 Add `compute_section_ranges()` in `src/providers/symbols.ts` — stack-based, level-aware
  - [ ] 3.2 Add `nest_in_sections()` — build section hierarchy by level + insert existing symbols
  - [ ] 3.3 Integrate into `get_document_symbols()`: extract → compute ranges → nest → merge → sort

- [ ] 4. Write unit tests
  - [ ] 4.1 Create `tests/unit/section-detector.test.ts`
  - [ ] 4.2 Add section range computation tests in `tests/unit/symbols.test.ts`
  - [ ] 4.3 Add section hierarchy integration tests in `tests/unit/symbols.test.ts`

- [ ] 5. Write property-based tests
  - [ ] 5.1 Create `tests/property/generators/sections.ts`
  - [ ] 5.2 Create `tests/property/section-detection.prop.test.ts` (Properties 1, 2, 3, 9)
  - [ ] 5.3 Create `tests/property/section-hierarchy.prop.test.ts` (Properties 4, 5, 6, 7, 8)

- [ ] 6. Run all tests and verify
  - [ ] 6.1 Run `bun run test` — all existing + new tests pass
  - [ ] 6.2 Verify no type errors: `bun run typecheck`
