---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - option-extraction: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

## Introduction

This feature adds hardcoded options for the Stata `rename` command to the LSP's built-in command database. The `rename` command supports several options that are not documented in the sthlp file but are available in Stata. These options include `addnumber`, `renumber`, `sort`, `dryrun`, `upper`, `lower`, and `proper`.

## Glossary

- **Builtin_Commands**: The hardcoded command database in `src/commands/builtin-commands.ts` containing metadata for common Stata commands
- **Option_Info**: A data structure representing a command option with name, minimum abbreviation, and argument flag
- **Completion_Provider**: The LSP component that provides auto-complete suggestions for commands and options
- **Command_Database**: The system that stores and retrieves Stata command metadata for LSP features

## Requirements

### Requirement 1: Add Rename Command Options

**User Story:** As a Stata developer, I want the LSP to suggest options for the `rename` command, so that I can discover and use available options without consulting external documentation.

#### Acceptance Criteria

1. THE Builtin_Commands SHALL include the following options for the `rename` command: `addnumber`, `renumber`, `sort`, `dryrun`, `upper`, `lower`, `proper`
2. WHEN a user types `rename *, ` THE Completion_Provider SHALL display options including `upper` and `lower`
3. THE Option_Info for `addnumber` SHALL indicate it accepts an argument (e.g., `addnumber(#)`)
4. THE Option_Info for `renumber` SHALL indicate it accepts an argument (e.g., `renumber(#)`)
5. THE Option_Info for `sort`, `dryrun`, `upper`, `lower`, and `proper` SHALL indicate they do not accept arguments

### Requirement 2: Option Abbreviations

**User Story:** As a Stata developer, I want to use abbreviated option names, so that I can type commands more efficiently.

#### Acceptance Criteria

1. THE Option_Info for each rename option SHALL specify an appropriate minimum abbreviation
2. WHEN a user types an abbreviated option name, THE Completion_Provider SHALL match and suggest the full option name

### Requirement 3: Cache Regeneration Resilience

**User Story:** As an LSP developer, I want hardcoded options to persist after cache regeneration, so that manually curated options are not lost when the command cache is rebuilt.

#### Acceptance Criteria

1. WHEN the cache generator runs, THE Cache_Generator SHALL preserve hardcoded options from Builtin_Commands for commands where SMCL extraction yields no options
2. WHEN SMCL extraction provides options for a command, THE Cache_Generator SHALL prefer SMCL-extracted options over hardcoded options
3. THE hardcoded options in Builtin_Commands SHALL serve as a fallback when SMCL files do not contain option information
