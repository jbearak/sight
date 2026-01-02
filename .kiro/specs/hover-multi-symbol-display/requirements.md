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

This feature enhances the hover provider to display information for all matching symbol types when a word matches multiple symbols (e.g., a local macro and a scalar with the same name). Additionally, it extends variable hover support to show definition location with clickable source file links, consistent with how other symbols are displayed.

Currently, the hover provider uses a precedence-based approach where only the first matching symbol type is shown. This can hide useful information when the same identifier is used for different symbol types. The enhancement will display all matches under separate headings, providing complete visibility into all definitions.

## Glossary

- **Hover_Provider**: The LSP component that generates hover information when users hover over identifiers in Stata code
- **Symbol_Table**: The data structure containing all defined symbols (programs, macros, variables, scalars, matrices)
- **Multi_Symbol_Match**: A situation where the same identifier name exists in multiple symbol categories
- **Source_Link**: A clickable markdown link that opens the file where a symbol is defined
- **Resolved_Scope**: The combined symbol table from cross-file directive resolution

## Requirements

### Requirement 1: Multi-Symbol Display

**User Story:** As a developer, I want to see all symbol definitions when hovering over an identifier that matches multiple symbol types, so that I can understand all the ways that identifier is used.

#### Acceptance Criteria

1. WHEN a user hovers over an identifier that matches symbols in multiple categories (local macro, global macro, program, scalar, matrix, variable), THE Hover_Provider SHALL display information for all matching symbols
2. WHEN displaying multiple symbol matches, THE Hover_Provider SHALL separate each symbol type with a markdown heading indicating the symbol category
3. WHEN displaying multiple symbol matches, THE Hover_Provider SHALL maintain a consistent order: Local Macro, Global Macro, Program, Scalar, Matrix, Variable
4. WHEN only one symbol type matches, THE Hover_Provider SHALL display that single match without section headings (preserving current behavior)
5. WHEN no symbols match, THE Hover_Provider SHALL fall back to command database lookup (preserving current behavior)

### Requirement 2: Variable Hover Enhancement

**User Story:** As a developer, I want to see the source file location when hovering over a variable, so that I can navigate to where the variable was defined.

#### Acceptance Criteria

1. WHEN a user hovers over a variable, THE Hover_Provider SHALL display the variable name, type, label, and source command
2. WHEN a variable has a sourceUri different from the current file, THE Hover_Provider SHALL display a clickable markdown link to the source file
3. WHEN a variable has a definition_line, THE Hover_Provider SHALL include the line number in the source information
4. WHEN a variable is defined in the current file, THE Hover_Provider SHALL display "this file" instead of a link
5. WHEN workspace_root is available, THE Hover_Provider SHALL display relative paths for files within the workspace

### Requirement 3: Cross-File Variable Resolution

**User Story:** As a developer, I want variable hover to work with cross-file scope resolution, so that I can see variable definitions from parent files linked via directives and from workspace-indexed files.

#### Acceptance Criteria

1. WHEN resolved_scope is available and contains a matching variable, THE Hover_Provider SHALL use the resolved_scope variable information and display a clickable link to the source file
2. WHEN resolved_scope is not available but document.symbols contains a matching variable, THE Hover_Provider SHALL use the document.symbols variable information
3. WHEN neither resolved_scope nor document.symbols contain the variable but workspace_symbols does, THE Hover_Provider SHALL use the workspace_symbols variable information and display a clickable link to the source file
4. THE Hover_Provider SHALL check resolved_scope first, then document.symbols, then workspace_symbols for variable lookup (consistent with other symbol types)

### Requirement 4: Consistent Source Link Formatting

**User Story:** As a developer, I want all symbol types to display source links in a consistent format, so that the hover information is predictable and easy to read.

#### Acceptance Criteria

1. THE Hover_Provider SHALL use the same source link formatting for variables as it does for macros, programs, scalars, and matrices
2. WHEN formatting source links, THE Hover_Provider SHALL escape markdown special characters in file paths
3. WHEN a symbol's sourceUri is a file:// URI, THE Hover_Provider SHALL convert it to a clickable markdown link
4. WHEN a symbol's sourceUri is a non-file URI, THE Hover_Provider SHALL display it as plain text in backticks
