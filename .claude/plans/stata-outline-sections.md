# Plan: Backport VS Code Outline Section Support from Raven to Sight

## Summary

Add Stata code section detection to Sight's document symbol provider, enabling VS Code's Outline panel to display logical document sections extracted from structured comments. Adapted from Raven's R section detection with patterns derived from real-world Stata files in `~/repos/fertility_surveys`.

**Decisions:**
- Section names include number prefixes (e.g., `1.1 Time since last intercourse`)
- Detection uses line-by-line regex scan on raw `document.content` (not AST traversal) — both are O(n) and negligible vs lexing/parsing; line scan is simpler and catches all comments including orphaned ones at file boundaries
- Kiro specs go in `.kiro/specs/stata-outline-sections/`

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `.kiro/specs/stata-outline-sections/requirements.md` | Create | Requirements document |
| `.kiro/specs/stata-outline-sections/design.md` | Create | Design document |
| `.kiro/specs/stata-outline-sections/tasks.md` | Create | Task tracking |
| `src/providers/section-detector.ts` | Create | Section detection logic (patterns, validation, extraction) |
| `src/providers/symbols.ts` | Modify | Integrate sections into document symbols + hierarchy building |
| `tests/unit/section-detector.test.ts` | Create | Unit tests for section detection |
| `tests/unit/symbols.test.ts` | Modify | Add section-related symbol tests |
| `tests/property/section-detection.prop.test.ts` | Create | PBTs for section detection |
| `tests/property/section-hierarchy.prop.test.ts` | Create | PBTs for section hierarchy |
| `tests/property/generators/sections.ts` | Create | fast-check generators for section comments |

---

## Requirements

### Requirement 1: Single-Line Section Detection

**User Story:** As a Stata developer, I want section-marking comments to appear in the document outline, so I can navigate large .do files by logical sections.

**Acceptance Criteria:**

1. WHEN a comment matches a single-line section pattern with a trailing delimiter (4+ of `-`, `=`, `*`, `+`), THE section detector SHALL create a section entry with `SymbolKind.Module`
2. THE section detector SHALL support both comment styles:
   - Slash-style: `// Section Name ----`
   - Star-style: `* Section Name ----`
3. THE section name SHALL be the text content between the comment marker and the trailing delimiter, with leading/trailing whitespace trimmed
4. THE section's `selectionRange` SHALL span only the section comment line
5. THE section's `range` SHALL span from the comment line to the line before the next section (or end of file)

### Requirement 2: Banner-Style Section Detection

**User Story:** As a Stata developer, I want multi-line banner comments to appear in the outline, since this is a common pattern for organizing .do files.

**Acceptance Criteria:**

1. WHEN a 3-line comment block has delimiter lines above and below a name line, THE section detector SHALL detect it as a banner section
2. THE section detector SHALL support these banner delimiter types:
   - Dash banners: `// --------` / `// Name` / `// --------`
   - Asterisk banners: `***...***` / `* Name *` / `***...***`
   - Slash banners: `///...///` / `// Name //` / `///...///`
   - Equals banners: `// ========` / `// Name` / `// ========`
3. Delimiter lines above and below SHALL use the same character type but need NOT match in length
4. THE banner range SHALL span all 3 lines; the `selectionRange` SHALL be the name line only
5. Banner sections SHALL default to heading level 1

### Requirement 3: Starred Inline Section Detection

**User Story:** As a Stata developer, I want inline starred section markers like `*** SECTION NAME ***` to appear in the outline.

**Acceptance Criteria:**

1. WHEN a star comment has text surrounded by 2+ asterisks on each side (e.g., `*** Section Name ***`), THE section detector SHALL detect it as a section
2. THE section name SHALL be the text between the leading and trailing asterisk groups, trimmed
3. Starred inline sections SHALL default to heading level 1

### Requirement 4: Numbered Section Detection

**User Story:** As a Stata developer, I want numbered section comments like `* 1. Setup` or `* 1.1 Analysis` to appear in the outline with proper hierarchy.

**Acceptance Criteria:**

1. WHEN a comment starts with a number pattern (e.g., `1.`, `1.1`, `1.1.1`, `2.10.1`), THE section detector SHALL detect it as a numbered section
2. THE heading level SHALL be derived from the numbering depth: `1.` = level 1, `1.1` = level 2, `1.1.1` = level 3
3. THE section name SHALL include the number prefix (e.g., `1.1 Time since last intercourse`)
4. Both comment styles SHALL be supported: `* 1. Name` and `// 1. Name`

### Requirement 5: Decorative Separator Rejection

**User Story:** As a Stata developer, I want decorative separator lines to be excluded from the outline, so it remains clean and navigable.

**Acceptance Criteria:**

1. WHEN a comment line consists only of delimiter characters (`*`, `-`, `=`, `+`, `/`, `#`) and/or whitespace, THE section detector SHALL NOT detect it as a section
2. Lines like `////////////////////////////////////////////////////////////////////////////////`, `*************************************************************`, `// ==================`, `// --------` SHALL be rejected
3. THE rejection SHALL apply as a post-match validation step after pattern matching

### Requirement 6: Section Range Computation (Level-Aware)

**User Story:** As a Stata developer, I want parent sections to span over child subsections, so the outline hierarchy reflects the logical code structure.

**Acceptance Criteria:**

1. WHEN computing the end line for a section at level N, THE range SHALL end at the line before the next section at level ≤ N
2. WHEN no subsequent section at level ≤ N exists, THE range SHALL extend to the last line of the document
3. THE section's `selectionRange` SHALL remain unchanged during range computation

### Requirement 7: Section Hierarchy Nesting

**User Story:** As a Stata developer, I want sections to nest hierarchically in the outline based on their heading levels.

**Acceptance Criteria:**

1. Sections with higher heading levels (2, 3, ...) SHALL nest as children of the preceding section with a lower heading level
2. Non-section symbols (programs, macros, etc.) within a section's range SHALL nest as children of the deepest containing section
3. Symbols before any section SHALL remain at the root level

### Requirement 8: Backward Compatibility

**User Story:** As a Sight user, I want existing outline behavior to be preserved.

**Acceptance Criteria:**

1. ALL existing symbol tests SHALL continue to pass without modification
2. Programs, macros, scalars, matrices, and embedded blocks SHALL continue to appear in the outline
3. Local macros SHALL continue to nest under their containing programs
4. Section symbols SHALL appear alongside existing symbols in file order

---

## Design

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Document Symbol Flow                        │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  SymbolProvider.get_document_symbols(document)                │
│           │                                                    │
│           ├── 1. Build existing symbols (programs, macros...) │
│           │       (current logic, unchanged)                  │
│           │                                                    │
│           ├── 2. Extract sections from document content       │
│           │       └── SectionDetector.extract_sections()      │
│           │           ├── Phase 1: Single-line detection      │
│           │           ├── Phase 2: Banner detection           │
│           │           ├── Phase 3: Starred inline detection   │
│           │           ├── Phase 4: Numbered section detection │
│           │           └── Phase 5: Merge, sort, deduplicate   │
│           │                                                    │
│           ├── 3. Compute section ranges (level-aware)         │
│           │       └── compute_section_ranges()                │
│           │                                                    │
│           ├── 4. Nest sections hierarchically                 │
│           │       └── nest_in_sections()                      │
│           │                                                    │
│           └── 5. Merge section tree with existing symbols     │
│               └── merge_symbols_with_sections()               │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
/** Delimiter character types for banner detection */
export type DelimiterKind = 'dash' | 'asterisk' | 'slash' | 'equals' | 'plus';

/** How a section was detected */
export type SectionDetectionType = 'single_line' | 'banner' | 'starred_inline' | 'numbered';

/** Intermediate section representation before hierarchy building */
export interface RawSection {
    name: string;
    level: number;              // 1, 2, 3... for hierarchy nesting
    range: Range;               // Full extent (section start to computed end)
    selection_range: Range;     // The comment line(s) only
    detection_type: SectionDetectionType;
}
```

### Component: SectionDetector (`src/providers/section-detector.ts`)

**Exports:**
- `extract_sections(content: string, line_offsets: number[]): RawSection[]`
- `is_delimiter_only(s: string): boolean` (exported for testing)
- `classify_delimiter_line(line: string): DelimiterKind | null` (exported for testing)
- `extract_banner_name(line: string): string | null` (exported for testing)

**Single-line section patterns:**

Slash-style: `^\s*//\s+(\S.+?)\s+(-{4,}|={4,}|\*{4,}|\+{4,})\s*$`
Star-style: `^\s*\*\s+(\S.+?)\s+(-{4,}|={4,}|\+{4,})\s*$`

Note: Star-style excludes `*{4,}` as trailing delimiter to avoid ambiguity with starred inline pattern.

**Banner detection algorithm:**
1. After single-line detection, iterate lines looking for 3-line patterns
2. For line `i` (from 1 to len-2), check:
   - Line `i-1`: `classify_delimiter_line()` returns `kind_top`
   - Line `i+1`: `classify_delimiter_line()` returns `kind_bottom`
   - `kind_top === kind_bottom` (delimiter types match)
   - Line `i`: `extract_banner_name()` returns non-empty, non-delimiter-only name
   - Lines `i-1`, `i`, `i+1` are not already consumed by single-line detection
3. Banner range spans all 3 lines; selectionRange = name line; level = 1

**`classify_delimiter_line(line: string): DelimiterKind | null`:**
- Identifies if a line is a pure delimiter line (comment line consisting entirely of a single repeated delimiter character 4+)
- Handles forms:
  - `****...****` (all asterisks)
  - `///...///` (all slashes)
  - `// ========...` (slash-comment + one delimiter type 4+)
  - `* --------...` (star-comment + one delimiter type 4+)

**`extract_banner_name(line: string): string | null`:**
- Strips leading comment markers (`//`, `*`) and whitespace
- Strips trailing delimiter chars and whitespace
- Returns null if result is empty or `is_delimiter_only()`

**Starred inline pattern:** `^\s*(\*{2,})\s+(\S.+?)\s+(\*{2,})\s*$`
- 2+ asterisks on each side, text in middle
- Text must pass `is_delimiter_only()` rejection

**Numbered section pattern:** `^\s*(?:\*|//)\s+(\d+(?:\.\d+)*\.?)\s+(\S.+)$`
- Captures number prefix (group 1) and rest of name (group 2)
- Level = count of number groups: `1.` → 1, `1.1` → 2, `1.1.1` → 3
- Full section name = `${number_prefix} ${rest_of_name}`

**Delimiter-only rejection:**
```typescript
const DELIMITER_CHARS = new Set(['*', '-', '=', '+', '/', '#']);

export function is_delimiter_only(s: string): boolean {
    if (s.length === 0) return true;
    return [...s].every(c => c === ' ' || c === '\t' || DELIMITER_CHARS.has(c));
}
```

**`extract_sections()` orchestration:**
1. Run single-line detection → collect sections + consumed line set
2. Run banner detection (skip consumed lines) → collect + add to consumed set
3. Run starred inline detection (skip consumed lines) → collect + add to consumed set
4. Run numbered section detection (skip consumed lines) → collect
5. Merge all, sort by start line, deduplicate overlapping ranges (first detection wins)

### Component: Hierarchy Integration (in `src/providers/symbols.ts`)

**`compute_section_ranges(sections: RawSection[], line_count: number): void`**
- Stack-based O(n) algorithm backported from Raven's `HierarchyBuilder::compute_section_ranges()`
- Sort sections by start line
- For each section at level N:
  - Pop stack entries with level ≥ N, setting their end line to `current_start - 1`
  - Push current section onto stack
- After loop: remaining stack entries extend to `line_count - 1` (EOF)
- Preserves `selection_range` unchanged

**`nest_in_sections(sections: RawSection[], existing_symbols: DocumentSymbol[]): DocumentSymbol[]`**
- Convert sections to `DocumentSymbol` with `kind: SymbolKind.Module`, `children: []`
- Build section hierarchy: sections at level N+1 nest under preceding section at level N (stack-based)
- Insert existing symbols into deepest containing section by checking `range` containment
- Symbols not inside any section remain at root level
- Preserve existing program→local-macro nesting (local macros stay under their programs, the program-with-children nests into the section)

**Integration into `get_document_symbols()`:**
After the existing symbol extraction (unchanged), add:
```typescript
// Extract and integrate sections
const my_sections = extract_sections(document.content, document.line_offsets);
if (my_sections.length > 0) {
    const my_line_count = get_line_count(document);
    compute_section_ranges(my_sections, my_line_count);
    return nest_in_sections(my_sections, symbols);
}
return symbols; // No sections: return existing symbols unchanged
```

### Correctness Properties

| # | Property | Validates |
|---|----------|-----------|
| 1 | Delimiter-only rejection: `is_delimiter_only(s)` returns true ↔ all chars are delimiters/whitespace | Req 5 |
| 2 | Section detection consistency: matched lines with non-delimiter names produce sections | Req 1, 2, 3, 4 |
| 3 | Range containment: `selectionRange` is always within `range` for every section | Req 1.4, 2.4 |
| 4 | Level-aware range end lines: section at level N ends before next section at level ≤ N | Req 6 |
| 5 | Symbol nesting correctness: symbols within section ranges appear as descendants | Req 7 |
| 6 | Selection range preservation: `compute_section_ranges` doesn't modify `selectionRange` | Req 6.3 |
| 7 | Input order independence: section ranges are identical regardless of initial sort order | Req 6 |
| 8 | Existing symbols preserved: all programs/macros still appear after section integration | Req 8 |
| 9 | Numbered section level derivation: number group count matches heading level | Req 4.2 |

---

## Tasks

- [ ] 1. Create Kiro specs
  - [ ] 1.1 Create `.kiro/specs/stata-outline-sections/requirements.md`
  - [ ] 1.2 Create `.kiro/specs/stata-outline-sections/design.md`
  - [ ] 1.3 Create `.kiro/specs/stata-outline-sections/tasks.md`

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
  - [ ] 3.1 Add `compute_section_ranges()` in `src/providers/symbols.ts` — stack-based, level-aware (backport from Raven)
  - [ ] 3.2 Add `nest_in_sections()` — build section hierarchy by level + insert existing symbols into containing sections
  - [ ] 3.3 Integrate into `get_document_symbols()`: extract → compute ranges → nest → merge → sort

- [ ] 4. Write unit tests
  - [ ] 4.1 Create `tests/unit/section-detector.test.ts`:
    - `is_delimiter_only()` tests: delimiter-only → true, mixed → false, empty → true
    - Single-line: slash-style (`// Name ----`) and star-style (`* Name ----`) with each delimiter type
    - Banner: each delimiter type, mismatched types (rejected), name extraction
    - Starred inline: valid patterns, decorative-only (rejected)
    - Numbered sections: `1.`, `1.1`, `1.1.1`, level derivation correctness
    - Decorative rejection: `///...`, `***...`, `// ====`, `// ----`
    - Real-world patterns from `~/repos/fertility_surveys` (verbatim examples)
  - [ ] 4.2 Add section range computation tests in `tests/unit/symbols.test.ts`:
    - Single section → extends to EOF
    - Same-level sections → each ends before next
    - Nested levels → parent range spans children
    - Mixed levels → level-aware ranges
  - [ ] 4.3 Add section hierarchy integration tests in `tests/unit/symbols.test.ts`:
    - Sections appear alongside programs/macros
    - Symbols nest under containing sections
    - Local-macro-under-program nesting preserved when program is inside a section
    - File-order sorting with sections interleaved

- [ ] 5. Write property-based tests
  - [ ] 5.1 Create `tests/property/generators/sections.ts`:
    - `arbitrary_section_comment()`: generates valid section comments across all pattern types
    - `arbitrary_delimiter_only_line()`: generates decorative separator lines
    - `arbitrary_numbered_section()`: generates numbered section comments with varying depth
    - `arbitrary_document_with_sections()`: generates documents mixing sections with Stata code
  - [ ] 5.2 Create `tests/property/section-detection.prop.test.ts`:
    - **Property 1**: Delimiter-only validation correctness (Req 5)
    - **Property 2**: Section detection consistency (Req 1-4)
    - **Property 3**: Range containment invariant (Req 1.4, 2.4)
    - **Property 9**: Numbered section level derivation (Req 4.2)
  - [ ] 5.3 Create `tests/property/section-hierarchy.prop.test.ts`:
    - **Property 4**: Level-aware range end lines (Req 6)
    - **Property 5**: Symbol nesting correctness (Req 7)
    - **Property 6**: Selection range preservation (Req 6.3)
    - **Property 7**: Input order independence / confluence (Req 6)
    - **Property 8**: Existing symbols preserved after section integration (Req 8)

- [ ] 6. Run all tests and verify
  - [ ] 6.1 Run `bun run test` — all existing + new tests pass
  - [ ] 6.2 Verify no type errors: `bun run typecheck`

## Key Reusable Code

| Function | Location | Purpose |
|----------|----------|---------|
| `get_line_text(doc, line)` | `src/utils/line-utils.ts` | O(1) line text access |
| `get_line_count(doc)` | `src/utils/line-utils.ts` | Document line count |
| `compute_line_offsets(content)` | `src/utils/line-utils.ts` | Build line offset index |
| `is_position_in_range()` | `src/providers/symbols.ts` | Position containment check |
| `find_containing_program()` | `src/providers/symbols.ts` | Program nesting logic |
| `calculate_range_size()` | `src/providers/symbols.ts` | Range size for smallest-container |
| `parse_and_analyze()` | `tests/property/helpers/document-utils.ts` | Test doc state builder |
| `arbitrary_comment()` | `tests/property/generators/primitives.ts` | Comment generator base |

## Verification

1. **Automated**: `bun run test` — all existing + new tests pass
2. **Type check**: `bun run typecheck` — no type errors
3. **Manual**: Create test .do file with mixed section patterns, verify Outline panel
4. **Real-world**: Open `~/repos/fertility_surveys` .do files, verify sections detected
