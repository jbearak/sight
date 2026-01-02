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

This feature enables the completion menu to display command options after typing a comma in Stata commands. Currently, the LSP returns an empty completion list when the cursor is in option context (after a comma). For example, `merge 1:m foo using bar, k` shows no completions even though `merge` has options like `keep`, `keepusing`, etc. Additionally, the hover provider incorrectly treats text after the comma as a command name. This change will show available options for the detected command when in option context and fix hover behavior.

## Glossary

- **Completion_Provider**: The LSP component that generates context-aware completion suggestions for Stata code
- **Hover_Provider**: The LSP component that displays documentation when hovering over code elements
- **Option_Context**: The context detected when the cursor is positioned after a comma in a command line
- **Command_Database**: The database containing Stata command metadata including available options for each command

## Requirements

### Requirement 1: Show Options After Comma

**User Story:** As a Stata developer, I want to see available command options after typing a comma, so that I can discover and select options without needing to remember their names.

#### Acceptance Criteria

1. WHEN the cursor is positioned after a comma in a command line, THE Completion_Provider SHALL return all available options for the detected command
2. WHEN no command can be detected from the line, THE Completion_Provider SHALL return an empty completion list
3. THE Completion_Provider SHALL rely on the client (VS Code) to filter options based on user input

### Requirement 2: Correct Command Detection for Options

**User Story:** As a Stata developer, I want the LSP to correctly identify the command when I'm typing options, so that I see the right options for commands like `merge`.

#### Acceptance Criteria

1. WHEN the command line contains a colon (e.g., `merge 1:m`), THE Completion_Provider SHALL correctly extract the command name as `merge`
2. WHEN the command has prefix commands (e.g., `quietly merge`), THE Completion_Provider SHALL correctly identify the main command
3. WHEN the command uses an abbreviation, THE Completion_Provider SHALL expand it to find options in the database

### Requirement 3: Hover Provider Option Context Awareness

**User Story:** As a Stata developer, I want the hover provider to recognize when I'm hovering over an option (not a command), so that I see relevant hover information.

#### Acceptance Criteria

1. WHEN hovering over text after a comma in a command line, THE Hover_Provider SHALL NOT display command documentation for that text
2. WHEN hovering over a recognized option name after a comma, THE Hover_Provider SHALL display the option's documentation from the command database
3. WHEN hovering over an unrecognized option name after a comma, THE Hover_Provider SHALL display no hover information
