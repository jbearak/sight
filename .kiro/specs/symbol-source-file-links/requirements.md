---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature enhances the hover provider to display clickable file links for symbol source locations. When hovering over a symbol (macro, program, scalar, matrix) that is defined in another file, the source file path should be displayed as a clickable link that opens the file in VS Code when clicked. For same-file symbols, a plain "Defined at:" line is shown instead to avoid redundancy.

Note: Variables currently show their creation command (e.g., `gen`, `egen`) as "Source" rather than the file path. This feature focuses on symbols that already display file paths in hover.

## Glossary

- **Hover_Provider**: The LSP component that provides hover information when users hover over symbols in the editor
- **Source_URI**: The file URI where a symbol is defined (e.g., `file:///path/to/file.do`)
- **Clickable_Link**: A markdown link in hover content that VS Code can navigate to when clicked
- **Symbol**: A named entity in Stata code (macro, program, scalar, matrix)
- **Expansion**: The value of a macro (displayed with double-backtick escaping)

## Requirements

### Requirement 1: Clickable File Links in Hover

**User Story:** As a developer, I want to click on the source file path in hover information, so that I can quickly navigate to where a symbol is defined.

#### Acceptance Criteria

1. WHEN hovering over a symbol defined in another file, THE Hover_Provider SHALL display the source file path as a clickable markdown link
2. WHEN a user clicks on the source file link in hover, THE link SHALL open the source file in VS Code
3. WHEN the symbol is defined in the current file, THE Hover_Provider SHALL NOT display a redundant source link
4. THE Hover_Provider SHALL display the file path in a user-friendly format (relative path when possible)

### Requirement 2: Consistent Link Format Across Symbol Types

**User Story:** As a developer, I want consistent hover formatting across all symbol types, so that I have a predictable experience when exploring code.

#### Acceptance Criteria

1. WHEN hovering over a local macro from another file, THE Hover_Provider SHALL display a clickable source link
2. WHEN hovering over a global macro from another file, THE Hover_Provider SHALL display a clickable source link
3. WHEN hovering over a program from another file, THE Hover_Provider SHALL display a clickable source link
4. WHEN hovering over a scalar from another file, THE Hover_Provider SHALL display a clickable source link
5. WHEN hovering over a matrix from another file, THE Hover_Provider SHALL display a clickable source link

### Requirement 3: Link Format and Display

**User Story:** As a developer, I want the source link to be clearly visible and easy to understand, so that I know where the symbol comes from.

#### Acceptance Criteria

1. THE Hover_Provider SHALL format the link using markdown syntax that VS Code recognizes as clickable
2. THE Hover_Provider SHALL display a relative file path as the link text when the file is within the workspace
3. WHEN the file is outside the workspace, THE Hover_Provider SHALL display the full file path as the link text
4. THE Hover_Provider SHALL use the `file://` URI scheme for the link target
