# Requirements Document

## Introduction

This feature adds Stata code section detection to Sight's document symbol provider, enabling VS Code's Outline panel to display logical document sections extracted from structured comments. Adapted from Raven's R section detection (commit fa0feea+) with patterns derived from real-world Stata files.

Stata developers commonly organize large .do files using structured comment patterns — dash separators, banner-style multi-line comments, starred section markers, and numbered outlines. This feature detects these patterns and presents them as collapsible, hierarchical entries in the Outline panel alongside existing symbols (programs, macros, scalars, matrices, embedded blocks).

## Glossary

- **Section_Detector**: The component responsible for identifying Stata code sections from structured comments in source files (`src/providers/section-detector.ts`)
- **Single_Line_Section**: A comment line with a trailing delimiter (4+ of `-`, `=`, `*`, `+`) that marks a section boundary (e.g., `// Section Name ----`)
- **Banner_Section**: A 3-line comment block with delimiter lines above and below a name line (e.g., `// ====` / `// Name` / `// ====`)
- **Starred_Inline_Section**: A star comment with text surrounded by 2+ asterisks on each side (e.g., `*** SECTION NAME ***`)
- **Numbered_Section**: A comment starting with a decimal-numbered prefix (e.g., `* 1.1 Analysis`) where heading level derives from numbering depth
- **Delimiter_Characters**: The set of characters used in decorative separators: `*`, `-`, `=`, `+`, `/`, `#`
- **Decorative_Separator**: A comment line consisting only of Delimiter_Characters used for visual separation, not as a section marker
- **Section_Level**: An integer (1, 2, 3, ...) representing heading depth. Non-numbered sections default to level 1; numbered sections derive level from number group count
- **Section_Range**: The LSP `Range` of a section symbol, spanning from the section comment line to the computed end line
- **RawSection**: The intermediate representation of a detected section before hierarchy building

## Requirements

### Requirement 1: Single-Line Section Detection

**User Story:** As a Stata developer, I want section-marking comments to appear in the document outline, so I can navigate large .do files by logical sections.

#### Acceptance Criteria

1. WHEN a comment matches a single-line section pattern with a trailing delimiter (4+ of `-`, `=`, `*`, `+`), THE Section_Detector SHALL create a section entry with `SymbolKind.Module`
2. THE Section_Detector SHALL support both comment styles:
   - Slash-style: `// Section Name ----`
   - Star-style: `* Section Name ----`
3. THE section name SHALL be the text content between the comment marker and the trailing delimiter, with leading/trailing whitespace trimmed
4. THE section's `selectionRange` SHALL span only the section comment line
5. THE section's `range` SHALL span from the comment line to the line before the next section (or end of file)

### Requirement 2: Banner-Style Section Detection

**User Story:** As a Stata developer, I want multi-line banner comments to appear in the outline, since this is a common pattern for organizing .do files.

#### Acceptance Criteria

1. WHEN a 3-line comment block has delimiter lines above and below a name line, THE Section_Detector SHALL detect it as a Banner_Section
2. THE Section_Detector SHALL support these banner delimiter types:
   - Dash banners: `// --------` / `// Name` / `// --------`
   - Asterisk banners: `***...***` / `* Name *` / `***...***`
   - Slash banners: `///...///` / `// Name //` / `///...///`
   - Equals banners: `// ========` / `// Name` / `// ========`
3. Delimiter lines above and below SHALL use the same character type but need NOT match in length
4. THE banner range SHALL span all 3 lines; the `selectionRange` SHALL be the name line only
5. Banner sections SHALL default to heading level 1

### Requirement 3: Starred Inline Section Detection

**User Story:** As a Stata developer, I want inline starred section markers like `*** SECTION NAME ***` to appear in the outline.

#### Acceptance Criteria

1. WHEN a star comment has text surrounded by 2+ asterisks on each side (e.g., `*** Section Name ***`), THE Section_Detector SHALL detect it as a Starred_Inline_Section
2. THE section name SHALL be the text between the leading and trailing asterisk groups, trimmed
3. Starred inline sections SHALL default to heading level 1

### Requirement 4: Numbered Section Detection

**User Story:** As a Stata developer, I want numbered section comments like `* 1. Setup` or `* 1.1 Analysis` to appear in the outline with proper hierarchy.

#### Acceptance Criteria

1. WHEN a comment starts with a number pattern (e.g., `1.`, `1.1`, `1.1.1`, `2.10.1`), THE Section_Detector SHALL detect it as a Numbered_Section
2. THE heading level SHALL be derived from the numbering depth: `1.` = level 1, `1.1` = level 2, `1.1.1` = level 3
3. THE section name SHALL include the number prefix (e.g., `1.1 Time since last intercourse`)
4. Both comment styles SHALL be supported: `* 1. Name` and `// 1. Name`

### Requirement 5: Decorative Separator Rejection

**User Story:** As a Stata developer, I want decorative separator lines to be excluded from the outline, so it remains clean and navigable.

#### Acceptance Criteria

1. WHEN a comment line consists only of Delimiter_Characters (`*`, `-`, `=`, `+`, `/`, `#`) and/or whitespace, THE Section_Detector SHALL NOT detect it as a section
2. Lines like `////////////////////////////////////////////////////////////////////////////////`, `*************************************************************`, `// ==================`, `// --------` SHALL be rejected
3. THE rejection SHALL apply as a post-match validation step after pattern matching

### Requirement 6: Section Range Computation (Level-Aware)

**User Story:** As a Stata developer, I want parent sections to span over child subsections, so the outline hierarchy reflects the logical code structure.

#### Acceptance Criteria

1. WHEN computing the end line for a section at Section_Level N, THE range SHALL end at the line before the next section at Section_Level less than or equal to N
2. WHEN no subsequent section at Section_Level less than or equal to N exists, THE range SHALL extend to the last line of the document
3. THE section's `selectionRange` SHALL remain unchanged during range computation

### Requirement 7: Section Hierarchy Nesting

**User Story:** As a Stata developer, I want sections to nest hierarchically in the outline based on their heading levels.

#### Acceptance Criteria

1. Sections with higher heading levels (2, 3, ...) SHALL nest as children of the preceding section with a lower heading level
2. Non-section symbols (programs, macros, etc.) within a section's Section_Range SHALL nest as children of the deepest containing section
3. Symbols before any section SHALL remain at the root level

### Requirement 8: Backward Compatibility

**User Story:** As a Sight user, I want existing outline behavior to be preserved.

#### Acceptance Criteria

1. ALL existing symbol tests SHALL continue to pass without modification
2. Programs, macros, scalars, matrices, and embedded blocks SHALL continue to appear in the outline
3. Local macros SHALL continue to nest under their containing programs
4. Section symbols SHALL appear alongside existing symbols in file order
