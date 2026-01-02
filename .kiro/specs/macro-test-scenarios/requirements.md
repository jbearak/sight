---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - macro-case-sensitivity: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

## Introduction

This specification adds specific test scenarios to the Stata LSP test suite to ensure macro completion and undefined macro diagnostics work correctly. These tests verify the case-sensitive behavior of macros in Stata.

## Glossary

- **Local_Macro**: A macro defined with `local name value` syntax, referenced as `` `name' ``
- **Completion_Provider**: The LSP component that suggests completions as the user types
- **Diagnostics_Provider**: The LSP component that reports errors and warnings
- **Test_Suite**: The collection of automated tests that verify LSP behavior

## Requirements

### Requirement 1: Macro Completion Test Scenario

**User Story:** As a developer, I want a test that verifies macro completion suggests defined macros when typing a prefix, so that I can be confident the feature works correctly.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test where `local apple sauce` is defined, and typing `` `a `` suggests `apple`
2. THE Test_Suite SHALL include a test where `local apple sauce` is defined, and typing `` `A `` suggests `apple` (case-insensitive matching for completions)
3. THE Test_Suite SHALL include a test where multiple macros are defined (`apple`, `apricot`), and typing `` `ap `` suggests both

### Requirement 2: Undefined Macro Diagnostic Test Scenario

**User Story:** As a developer, I want a test that verifies the LSP warns on undefined macro references including case mismatches, so that I can be confident the diagnostic works correctly.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a test where `local apple sauce` is defined, and referencing `` `Apple' `` produces an undefined macro warning
2. THE Test_Suite SHALL include a test where `local apple sauce` is defined, and referencing `` `apple' `` does NOT produce a warning
3. THE Test_Suite SHALL include a test where no macro is defined, and referencing `` `fruit' `` produces an undefined macro warning
4. THE diagnostic message SHALL include the macro name as written in the reference
