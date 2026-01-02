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

This spec documents a behavior change to the completion provider that enables automatic option completions immediately after typing a comma, without requiring the user to manually trigger completions (Ctrl+Space). Previously, empty prefix after comma returned no completions, which was inconsistent with user expectations.

## Glossary

- **Completion_Provider**: The LSP component that provides auto-complete suggestions
- **Trigger_Character**: A character that automatically invokes the completion provider when typed
- **Option_Context**: The completion context detected when the cursor is after a comma in a command (e.g., `regress y x, |`)
- **Option_Prefix**: The text typed after the comma that filters available options

## Requirements

### Requirement 1: Comma as Trigger Character

**User Story:** As a Stata developer, I want completions to appear automatically after typing a comma, so that I can quickly see available command options without manually triggering completions.

#### Acceptance Criteria

1. WHEN a user types a comma after command arguments, THE Completion_Provider SHALL automatically trigger and display available options
2. THE LSP Server SHALL include comma (`,`) in the list of completion trigger characters

### Requirement 2: Space as Trigger Character

**User Story:** As a Stata developer, I want completions to appear after typing a space following a comma, so that I can see options even if I add whitespace before typing.

#### Acceptance Criteria

1. WHEN a user types a space after a comma in option context, THE Completion_Provider SHALL automatically trigger and display available options
2. THE LSP Server SHALL include space (` `) in the list of completion trigger characters

### Requirement 3: Empty Option Prefix Returns All Options

**User Story:** As a Stata developer, I want to see all available options immediately after typing a comma, so that I can browse what options are available for a command.

#### Acceptance Criteria

1. WHEN the cursor is in option context with an empty prefix (immediately after comma or comma+space), THE Completion_Provider SHALL return all available options for the command
2. WHEN the cursor is in option context with a non-empty prefix, THE Completion_Provider SHALL filter options to those matching the prefix

### Requirement 4: Trigger Characters List

**User Story:** As an LSP client, I need to know which characters trigger completions, so that I can invoke the completion provider at the right times.

#### Acceptance Criteria

1. THE LSP Server SHALL report the following trigger characters in its capabilities: `:`, `` ` ``, `"`, `$`, `{`, `,`, ` `
