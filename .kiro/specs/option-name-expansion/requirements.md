---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - command-name-expansion: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

## Introduction

This feature extends the Stata parser to expand abbreviated option names to their canonical forms when parsing command options (e.g., `rob` → `robust`, `det` → `detail`). This improves consistency in the AST and enables better analysis, hover information, and completion.

## Glossary

- **Abbreviated_Option**: A shortened form of a command option (e.g., `rob`, `det`, `noc`)
- **Canonical_Option**: The full, official name of an option (e.g., `robust`, `detail`, `noconstant`)
- **Option_Dictionary**: A mapping from option abbreviations to canonical forms, potentially command-specific
- **Option_Context**: The command context that determines valid options and their abbreviations
- **Minimum_Abbreviation**: The shortest valid abbreviation for an option

## Requirements

### Requirement 1: Expand Option Abbreviations

**User Story:** As a developer reading Stata code, I want the LSP to show canonical option names, so that I can understand unfamiliar abbreviations.

#### Acceptance Criteria

1. WHEN parsing an Abbreviated_Option, THE Parser SHALL resolve it to its Canonical_Option
2. THE Parser SHALL store both the original text and Canonical_Option in the AST node
3. THE Parser SHALL use Option_Context to determine valid expansions for each command
4. WHEN an abbreviation is ambiguous within a command, THE Parser SHALL select the most common interpretation or flag ambiguity

### Requirement 2: Command-Specific Option Resolution

**User Story:** As a developer, I want option expansion to be context-aware, so that `det` expands correctly for different commands.

#### Acceptance Criteria

1. THE Option_Dictionary SHALL support command-specific option mappings
2. WHEN the same abbreviation maps to different options for different commands, THE Parser SHALL use Option_Context to resolve correctly
3. THE Parser SHALL support common options that apply across many commands (e.g., `if`, `in`, `by`)
4. WHEN a command is unknown, THE Parser SHALL use a default set of common option expansions

### Requirement 3: Preserve Original Text

**User Story:** As a developer, I want the LSP to preserve my original option abbreviations in the source, so that formatting doesn't change my code style.

#### Acceptance Criteria

1. THE AST node SHALL store the original option text separately from the Canonical_Option
2. WHEN pretty-printing, THE Pretty_Printer SHALL use the original text by default
3. THE Pretty_Printer SHALL support an option to output Canonical_Options instead of abbreviations
4. FOR ALL options, parsing then pretty-printing with original-text mode SHALL produce identical output

### Requirement 4: Hover and Documentation

**User Story:** As a developer hovering over an abbreviated option, I want to see the full option name, so that I can understand what it does.

#### Acceptance Criteria

1. WHEN hovering over an Abbreviated_Option, THE Hover_Provider SHALL display the Canonical_Option
2. THE Hover_Provider SHALL include a note showing the expansion (e.g., "`rob` → `robust`")
3. WHEN documentation is available for the option, THE Hover_Provider SHALL display it
4. THE Completion_Provider SHALL show both abbreviated and canonical forms in option suggestions

### Requirement 5: Option Dictionary Management

**User Story:** As a developer, I want the option dictionary to be comprehensive and maintainable.

#### Acceptance Criteria

1. THE Option_Dictionary SHALL include common statistical options (robust, cluster, vce, level, etc.)
2. THE Option_Dictionary SHALL include common output options (detail, nolog, notable, etc.)
3. THE Option_Dictionary SHALL include common estimation options (noconstant, hascons, etc.)
4. THE Option_Dictionary SHALL be structured for easy updates and command-specific extensions
5. WHEN an option is not in the dictionary, THE Parser SHALL treat it as already canonical
