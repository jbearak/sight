---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

## Introduction

This feature extends the Stata parser to expand abbreviated command and prefix names to their canonical forms (e.g., `qui` → `quietly`, `reg` → `regress`, `gen` → `generate`). This improves consistency in the AST and enables better analysis, hover information, and documentation lookup.

## Glossary

- **Abbreviated_Command**: A shortened form of a Stata command (e.g., `reg`, `gen`, `qui`)
- **Canonical_Form**: The full, official name of a command (e.g., `regress`, `generate`, `quietly`)
- **Command_Dictionary**: A mapping from abbreviations to canonical forms
- **Prefix_Command**: Commands like `quietly`, `noisily`, `capture` that modify other commands
- **Minimum_Abbreviation**: The shortest valid abbreviation for a command (e.g., `reg` for `regress`)

## Requirements

### Requirement 1: Expand Command Abbreviations

**User Story:** As a developer reading Stata code, I want the LSP to show canonical command names, so that I can understand unfamiliar abbreviations.

#### Acceptance Criteria

1. WHEN parsing an Abbreviated_Command, THE Parser SHALL resolve it to its Canonical_Form
2. THE Parser SHALL store both the original text and Canonical_Form in the AST node
3. THE Parser SHALL use a Command_Dictionary containing standard Stata command abbreviations
4. WHEN an abbreviation is ambiguous, THE Parser SHALL select the most common interpretation or flag ambiguity

### Requirement 2: Expand Prefix Abbreviations

**User Story:** As a developer, I want prefix commands like `qui` and `cap` to be expanded, so that hover and documentation work correctly.

#### Acceptance Criteria

1. WHEN parsing `qui command`, THE Parser SHALL expand to `quietly` in the AST
2. WHEN parsing `cap command`, THE Parser SHALL expand to `capture` in the AST
3. WHEN parsing `n command` or `noi command`, THE Parser SHALL expand to `noisily` in the AST
4. THE Parser SHALL handle chained prefixes (e.g., `qui cap reg`) with each expanded

### Requirement 3: Preserve Original Text

**User Story:** As a developer, I want the LSP to preserve my original abbreviations in the source, so that formatting doesn't change my code style.

#### Acceptance Criteria

1. THE AST node SHALL store the original source text separately from the Canonical_Form
2. WHEN pretty-printing, THE Pretty_Printer SHALL use the original text by default
3. THE Pretty_Printer SHALL support an option to output Canonical_Forms instead of abbreviations
4. FOR ALL commands, parsing then pretty-printing with original-text mode SHALL produce identical output

### Requirement 4: Hover and Documentation

**User Story:** As a developer hovering over an abbreviated command, I want to see the full command name and documentation, so that I can learn what the command does.

#### Acceptance Criteria

1. WHEN hovering over an Abbreviated_Command, THE Hover_Provider SHALL display the Canonical_Form
2. THE Hover_Provider SHALL include a note showing the expansion (e.g., "`reg` → `regress`")
3. WHEN documentation is available, THE Hover_Provider SHALL link to documentation for the Canonical_Form
4. THE Completion_Provider SHALL show both abbreviated and canonical forms in suggestions

### Requirement 5: Command Dictionary Management

**User Story:** As a developer, I want the command dictionary to be comprehensive and maintainable.

#### Acceptance Criteria

1. THE Command_Dictionary SHALL include all standard Stata commands and their minimum abbreviations
2. THE Command_Dictionary SHALL include common statistical commands (regress, summarize, tabulate, etc.)
3. THE Command_Dictionary SHALL include data management commands (generate, replace, drop, keep, etc.)
4. THE Command_Dictionary SHALL be structured for easy updates and extensions
5. WHEN a command is not in the dictionary, THE Parser SHALL treat it as already canonical
