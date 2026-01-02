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

The command database cache stores command metadata extracted from Stata SMCL help files. Currently, the `syntax` field contains raw SMCL markup tags (e.g., `{cmd:dotplot}`, `{varname}`, `{ifin}`, `{it:options}`) which are displayed in completions, making them unreadable.

Rather than attempting to clean up the SMCL markup, the simpler solution is to remove the syntax field entirely and display only the options list in both completions and hover.

## Glossary

- **SMCL**: Stata Markup and Control Language - the markup language used in Stata help files
- **SMCL_Extractor**: The module that parses SMCL help files and extracts command metadata
- **Command_Cache**: The JSON file storing pre-extracted command metadata for fast lookup
- **Syntax_Field**: The field in command metadata that describes the command's usage pattern
- **Hover_Provider**: The LSP provider that displays information when hovering over code elements
- **Completion_Provider**: The LSP provider that displays auto-complete suggestions

## Requirements

### Requirement 1: Remove Syntax Extraction from SMCL Extractor

**User Story:** As a maintainer, I want to simplify the command database by removing the problematic syntax field, so that we don't display unreadable SMCL markup.

#### Acceptance Criteria

1. THE SMCL_Extractor SHALL NOT extract or store the syntax field from help files
2. THE Command_Cache SHALL NOT include the syntax field for commands
3. THE `extract_syntax_for_command` function SHALL be removed or deprecated

### Requirement 2: Update Completion Provider Display

**User Story:** As a developer, I want completions to show useful information without SMCL markup, so that I can understand command options at a glance.

#### Acceptance Criteria

1. WHEN displaying a command completion, THE Completion_Provider SHALL show the command name as the label
2. WHEN displaying a command completion, THE Completion_Provider SHALL show the options list in the detail field (if options exist)
3. WHEN displaying a command completion, THE Completion_Provider SHALL NOT display the syntax field
4. IF a command has no options, THE Completion_Provider SHALL display a simple description or help link

### Requirement 3: Update Hover Provider Display

**User Story:** As a developer, I want hover information to be consistent with completions, showing command name and options.

#### Acceptance Criteria

1. WHEN hovering over a built-in command, THE Hover_Provider SHALL display the command name
2. WHEN hovering over a built-in command with options, THE Hover_Provider SHALL display the options list
3. THE Hover_Provider SHALL continue to display the help documentation link

### Requirement 4: Update Type Definitions

**User Story:** As a maintainer, I want the type definitions to reflect the removal of the syntax field.

#### Acceptance Criteria

1. THE CommandInfo type SHALL make the syntax field optional or remove it
2. THE CommandCache type SHALL be updated to reflect the change
3. ALL code that references the syntax field SHALL be updated or removed
