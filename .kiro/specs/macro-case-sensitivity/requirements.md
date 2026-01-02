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

This specification addresses macro completion prefix filtering in the Stata LSP. Currently, when a user types a backtick followed by characters (e.g., `` `a ``), the completion provider returns all defined local macros instead of filtering to only those matching the typed prefix. This makes it harder to find the desired macro when many are defined.

The undefined macro diagnostic feature already exists and correctly uses case-sensitive matching. This spec focuses on improving the completion experience.

## Glossary

- **Local_Macro**: A macro defined with `local name value` syntax, referenced as `` `name' ``
- **Global_Macro**: A macro defined with `global name value` syntax, referenced as `$name` or `${name}`
- **Completion_Provider**: The LSP component that suggests completions as the user types
- **Prefix**: The partial text typed by the user after the backtick or dollar sign before requesting completions

## Requirements

### Requirement 1: Macro Completion Prefix Filtering

**User Story:** As a Stata developer, I want macro completions to filter based on what I've typed, so that I see only relevant suggestions.

#### Acceptance Criteria

1. WHEN a user types a backtick followed by a prefix (e.g., `` `a ``), THE Completion_Provider SHALL return local macros whose names start with that prefix (case-insensitive matching)
2. WHEN a user types a dollar sign followed by a prefix (e.g., `$A`), THE Completion_Provider SHALL return global macros whose names start with that prefix (case-insensitive matching)
3. WHEN a user types a backtick with no prefix (e.g., just `` ` ``), THE Completion_Provider SHALL return all defined local macros
4. WHEN a user types a dollar sign with no prefix (e.g., just `$`), THE Completion_Provider SHALL return all defined global macros
5. WHEN multiple macros match the prefix, THE Completion_Provider SHALL return all matching macros sorted alphabetically
6. WHEN no macros match the prefix, THE Completion_Provider SHALL return an empty list

### Requirement 2: Prefix Extraction

**User Story:** As a Stata developer, I want the LSP to correctly identify what I've typed so far, so that completions are accurate.

#### Acceptance Criteria

1. THE Completion_Provider SHALL extract the prefix from the text between the backtick and the cursor position for local macros
2. THE Completion_Provider SHALL extract the prefix from the text between the dollar sign (or `${`) and the cursor position for global macros
3. WHEN the cursor is immediately after the backtick or dollar sign, THE Completion_Provider SHALL treat the prefix as empty
