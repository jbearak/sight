# Requirements Document

## Introduction

This feature adds trailing whitespace removal to the Stata LSP formatter. When a user invokes "Format Document", any needless trailing whitespace at the end of lines should be deleted. This improves code cleanliness and consistency, aligning with common coding standards that discourage trailing whitespace.

## Glossary

- **Formatter**: The LSP component that reformats Stata source code when the user invokes "Format Document"
- **Trailing_Whitespace**: Space or tab characters that appear after the last non-whitespace character on a line, before the newline
- **Token_Reconstructor**: The component that rebuilds source code from tokens, applying indentation and spacing adjustments
- **Source_Preserving_Formatter**: The default formatter mode that preserves original source structure while applying formatting rules

## Requirements

### Requirement 1: Remove Trailing Whitespace on Format

**User Story:** As a developer, I want trailing whitespace removed when I format my document, so that my code is clean and follows common coding standards.

#### Acceptance Criteria

1. WHEN the Formatter processes a line with trailing whitespace, THE Formatter SHALL remove all trailing space and tab characters from that line
2. WHEN the Formatter processes a line with no trailing whitespace, THE Formatter SHALL leave the line unchanged (aside from other formatting rules)
3. WHEN the Formatter processes an empty line (containing only whitespace), THE Formatter SHALL produce an empty line with no whitespace
4. WHEN the Formatter processes a line ending with a string literal that contains trailing spaces, THE Formatter SHALL preserve the spaces inside the string literal

### Requirement 2: Preserve Semantic Content

**User Story:** As a developer, I want the formatter to only remove truly needless whitespace, so that my code's meaning is preserved.

#### Acceptance Criteria

1. WHEN the Formatter removes trailing whitespace, THE Formatter SHALL preserve all non-whitespace content on the line
2. WHEN the Formatter removes trailing whitespace, THE Formatter SHALL preserve the line structure (number of lines remains the same)
3. WHEN the Formatter processes continuation lines (lines ending with `///`), THE Formatter SHALL remove trailing whitespace after the continuation marker

### Requirement 3: Apply to Both Formatter Modes

**User Story:** As a developer, I want trailing whitespace removal to work regardless of which formatter mode I use, so that I get consistent behavior.

#### Acceptance Criteria

1. WHEN the Source_Preserving_Formatter formats a document, THE Formatter SHALL remove trailing whitespace from all lines
2. WHEN the AST Formatter formats a document, THE Formatter SHALL remove trailing whitespace from all lines
