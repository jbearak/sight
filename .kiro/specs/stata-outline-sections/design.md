# Design Document: Stata Outline Section Detection

## Overview

This design adds Stata code section detection to Sight's document symbol provider, enabling VS Code's Outline panel to display logical document sections extracted from structured comments. The implementation introduces a new `SectionDetector` module that scans raw document content line-by-line for section patterns, and extends the existing `SymbolProvider` with hierarchy-building logic that nests sections and symbols into a tree.

The design is adapted from Raven's R section detection (Rust LSP for R), translated to TypeScript with Stata-specific patterns derived from analysis of real-world `.do` files.

## Architecture

```text
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
│           │       └── extract_sections(content, line_offsets) │
│           │           ├── Phase 1: Single-line detection      │
│           │           ├── Phase 2: Banner detection           │
│           │           ├── Phase 3: Starred inline detection   │
│           │           ├── Phase 4: Numbered section detection │
│           │           └── Phase 5: Merge, sort, deduplicate   │
│           │                                                    │
│           ├── 3. Compute section ranges (level-aware)         │
│           │       └── compute_section_ranges()                │
│           │                                                    │
│           ├── 4. Nest sections + symbols hierarchically       │
│           │       └── nest_in_sections()                      │
│           │                                                    │
│           └── 5. Sort and return                              │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. SectionDetector (`src/providers/section-detector.ts`)

New module responsible for detecting section comments in raw document content.

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

/** Main entry point: extract all sections from document content */
export function extract_sections(content: string, line_offsets: number[]): RawSection[];

/** Check if string consists only of delimiter chars and whitespace */
export function is_delimiter_only(s: string): boolean;

/** Classify a line as a delimiter line (for banner detection) */
export function classify_delimiter_line(line: string): DelimiterKind | null;

/** Extract section name from a banner middle line */
export function extract_banner_name(line: string): string | null;
```

### 2. Hierarchy Integration (added to `src/providers/symbols.ts`)

```typescript
/** Compute level-aware section ranges using stack-based algorithm */
export function compute_section_ranges(sections: RawSection[], line_count: number): void;

/** Nest sections hierarchically and insert existing symbols into sections */
export function nest_in_sections(
    sections: RawSection[],
    existing_symbols: DocumentSymbol[]
): DocumentSymbol[];
```

## Data Models

### Single-Line Section Patterns

Two regex patterns cover both Stata comment styles:

```text
Slash-style: ^\s*//\s+(\S.+?)\s+(-{4,}|={4,}|\*{4,}|\+{4,})\s*$
Star-style:  ^\s*\*\s+(\S.+?)\s+(-{4,}|={4,}|\+{4,})\s*$
```

Star-style excludes `*{4,}` as trailing delimiter to avoid ambiguity with starred inline.

Examples:
- `// Section Name ----` → name: "Section Name"
- `* Setup ====` → name: "Setup"
- `// Analysis ++++` → name: "Analysis"

### Banner Detection

Three-line pattern: delimiter / name / delimiter, where delimiters match in kind.

Delimiter line forms:
- `****...****` (all asterisks, 4+)
- `///...///` (all slashes, 4+)
- `// ========...` (slash-comment + repeated char 4+)
- `* --------...` (star-comment + repeated char 4+)

### Starred Inline Pattern

```text
^\s*(\*{2,})\s+(\S.+?)\s+(\*{2,})\s*$
```

Examples:
- `*** MARITAL STATUS ***` → name: "MARITAL STATUS"
- `** Quality Checks **` → name: "Quality Checks"

### Numbered Section Pattern

```text
^\s*(?:\*|//)\s+(\d+(?:\.\d+)*\.?)\s+(\S.+)$
```

Level derivation: count number groups separated by `.`
- `1.` → level 1
- `1.1` → level 2
- `1.1.1` → level 3
- `2.10.1` → level 3

### Delimiter-Only Rejection

```typescript
const DELIMITER_CHARS = new Set(['*', '-', '=', '+', '/', '#']);

export function is_delimiter_only(s: string): boolean {
    if (s.length === 0) return true;
    return [...s].every(c => c === ' ' || c === '\t' || DELIMITER_CHARS.has(c));
}
```

## Correctness Properties

### Property 1: Delimiter validation correctness

*For any* string `s`, `is_delimiter_only(s)` SHALL return `true` if and only if every character in `s` is either a Delimiter_Character or whitespace.

**Validates: Requirement 5.1, 5.2, 5.3**

### Property 2: Section detection consistency

*For any* comment line that matches a section pattern, `extract_sections()` SHALL include it in the result if and only if the extracted name contains at least one non-delimiter, non-whitespace character.

**Validates: Requirements 1.1-1.3, 2.1-2.4, 3.1-3.2, 4.1-4.4**

### Property 3: Range containment invariant

*For any* `RawSection`, `selection_range.start >= range.start` AND `selection_range.end <= range.end`.

**Validates: Requirements 1.4, 2.4**

### Property 4: Level-aware section range end lines

*For any* list of sections with arbitrary levels and start lines (sorted by start line), after `compute_section_ranges()`, each section at level N shall have its end line equal to `next_sibling_start_line - 1` where the next sibling is the first subsequent section with level ≤ N, or `line_count - 1` (EOF) if no such section exists.

**Validates: Requirements 6.1, 6.2**

### Property 5: Symbol nesting correctness

*For any* configuration of sections and non-section symbols, after `nest_in_sections()`, every non-section symbol whose start line falls within a section's computed range shall appear as a descendant of that section.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 6: Selection range preservation

*For any* list of sections, after `compute_section_ranges()`, the `selection_range` of every section shall be identical to its `selection_range` before the call.

**Validates: Requirement 6.3**

### Property 7: Input order independence (confluence)

*For any* list of sections, the computed section ranges after `compute_section_ranges()` shall be identical regardless of the initial ordering of sections in the input list.

**Validates: Requirement 6**

### Property 8: Existing symbols preserved

*For any* document with programs, macros, and sections, all programs and macros that appeared in the original symbol list shall appear somewhere in the output of `nest_in_sections()`.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 9: Numbered section level derivation

*For any* numbered section with number prefix containing N dot-separated groups, the derived level SHALL equal N.

**Validates: Requirement 4.2**

## Error Handling

### Empty Documents
- Documents with no content return empty section list. No error.

### Malformed Comments
- Partial pattern matches are silently ignored. No section is created.
- Lines that match structurally but fail `is_delimiter_only()` are silently skipped.

### Overlapping Detections
- If a line is consumed by an earlier detection phase (e.g., single-line), later phases skip it.
- Deduplication by start line ensures no duplicate sections.

## Testing Strategy

### Unit Tests
1. `is_delimiter_only()`: delimiter-only → true, mixed → false, empty → true
2. Single-line patterns: both comment styles with each delimiter type
3. Banner patterns: each delimiter type, mismatched types (rejected), name extraction
4. Starred inline: valid patterns, decorative-only (rejected)
5. Numbered sections: `1.`, `1.1`, `1.1.1`, level derivation
6. Decorative rejection: `///...`, `***...`, `// ====`, `// ----`
7. Real-world patterns from `~/repos/fertility_surveys` (verbatim examples)
8. Section range computation: single section, same-level, nested, mixed
9. Hierarchy integration: sections + programs, nesting, sort order

### Property-Based Tests
Each test runs minimum 100 iterations using fast-check.

- **Property 1**: Delimiter validation correctness
- **Property 2**: Section detection consistency
- **Property 3**: Range containment invariant
- **Property 4**: Level-aware range end lines
- **Property 5**: Symbol nesting correctness
- **Property 6**: Selection range preservation
- **Property 7**: Input order independence
- **Property 8**: Existing symbols preserved
- **Property 9**: Numbered section level derivation
