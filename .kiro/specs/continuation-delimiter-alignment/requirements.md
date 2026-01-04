# Requirements Document

## Introduction

This feature fixes the formatter's handling of tab-to-space conversion to preserve visual alignment of continuation line delimiters (`///`). When code uses tabs to align `///` markers at a consistent column, converting tabs to spaces must account for tab stop positions rather than using a fixed replacement width.

## Glossary

- **Formatter**: The LSP component that reformats Stata source code when the user invokes "Format Document"
- **Continuation_Delimiter**: The `///` marker that indicates a line continues on the next line
- **Tab_Stop**: A column position that tabs expand to (typically every 8 characters, or configurable)
- **Visual_Column**: The column position as displayed on screen, accounting for tab expansion
- **Token_Reconstructor**: The component that rebuilds source code from tokens, applying indentation and spacing adjustments

## Requirements

### Requirement 1: Preserve Visual Alignment When Converting Tabs to Spaces

**User Story:** As a developer, I want the formatter to preserve the visual alignment of my `///` delimiters when converting tabs to spaces, so that my code maintains its intended visual structure.

#### Acceptance Criteria

1. WHEN the Formatter converts tabs to spaces in spacing between tokens, THE Formatter SHALL expand each tab to the next tab stop position rather than a fixed number of spaces
2. WHEN the Formatter processes a line with `///` aligned using tabs, THE Formatter SHALL produce output where the `///` appears at the same visual column as in the original
3. WHEN the Formatter processes multiple lines with `///` aligned at the same visual column using tabs, THE Formatter SHALL produce output where all `///` markers remain aligned at the same visual column

### Requirement 2: Respect Tab Stop Configuration

**User Story:** As a developer, I want the formatter to use my configured tab width when calculating tab expansion, so that the output matches my editor settings.

#### Acceptance Criteria

1. WHEN the Formatter expands tabs to spaces, THE Formatter SHALL use the configured `indent_size` as the tab stop interval
2. WHEN no tab stop configuration is provided, THE Formatter SHALL default to 4-character tab stops

### Requirement 3: Handle Mixed Tab and Space Indentation

**User Story:** As a developer, I want the formatter to correctly handle lines that mix tabs and spaces, so that visual alignment is preserved regardless of the original whitespace composition.

#### Acceptance Criteria

1. WHEN the Formatter processes spacing that contains both tabs and spaces, THE Formatter SHALL calculate the visual column by treating each tab as expanding to the next tab stop
2. WHEN the Formatter outputs the converted spacing, THE Formatter SHALL produce the correct number of spaces to reach the same visual column

