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

The Stata LSP incorrectly handles the `frame` prefix command. When hovering over `frame`, the LSP shows information for `framework` instead of the `frame` prefix command. Additionally, when hovering over subcommands like `create` in `frame create`, the LSP shows information for the standalone `create` command instead of recognizing it as a subcommand of `frame`. This document specifies requirements for correctly handling `frame` and other prefix commands with subcommands.

## Glossary

- **Prefix_Command**: A Stata command that precedes and modifies another command (e.g., `by`, `quietly`, `capture`, `frame`)
- **Subcommand**: A command that follows a prefix command and is specific to that prefix (e.g., `create` in `frame create`)
- **Command_Database**: The component that stores Stata command metadata and handles lookups
- **Hover_Provider**: The component that provides hover information for commands and symbols
- **Completion_Provider**: The component that provides completion suggestions
- **Abbreviation_Map**: A mapping from abbreviated command names to their full command names
- **Subcommand_Metadata**: Structured metadata for prefix command subcommands (distinct from options)

## Requirements

### Requirement 1: Frame Prefix Command Recognition

**User Story:** As an LSP user, I want the LSP to recognize `frame` as a distinct prefix command, so that I get correct hover information when hovering over `frame`.

#### Acceptance Criteria

1. WHEN hovering over `frame` in `frame create myframe` THE Hover_Provider SHALL display information about the `frame` prefix command
2. WHEN hovering over `frame` in `frame myframe { ... }` THE Hover_Provider SHALL display information about the `frame` prefix command
3. THE Command_Database SHALL NOT map `frame` to `framework` in the Abbreviation_Map
4. THE Command_Database SHALL contain a distinct entry for the `frame` prefix command with its syntax and subcommands

### Requirement 2: Frame Subcommand Recognition

**User Story:** As an LSP user, I want the LSP to recognize frame subcommands, so that I get correct hover information when hovering over subcommands like `create`, `change`, `drop`, etc.

#### Acceptance Criteria

1. WHEN hovering over `create` in `frame create myframe` THE Hover_Provider SHALL display information about `frame create` subcommand
2. WHEN hovering over `change` in `frame change myframe` THE Hover_Provider SHALL display information about `frame change` subcommand
3. WHEN hovering over `drop` in `frame drop myframe` THE Hover_Provider SHALL display information about `frame drop` subcommand
4. WHEN hovering over `copy` in `frame copy source dest` THE Hover_Provider SHALL display information about `frame copy` subcommand
5. WHEN hovering over `rename` in `frame rename old new` THE Hover_Provider SHALL display information about `frame rename` subcommand
6. THE Hover_Provider SHALL NOT display standalone command information for subcommands that follow `frame`

### Requirement 3: Other Prefix Commands with Subcommands

**User Story:** As an LSP user, I want the LSP to correctly handle all prefix commands that have subcommands, so that hover information is accurate across the language.

#### Acceptance Criteria

1. WHEN hovering over a subcommand that follows a prefix command THE Hover_Provider SHALL display information specific to that prefix-subcommand combination
2. IF a subcommand name matches a standalone command name THEN THE Hover_Provider SHALL prefer the prefix-subcommand interpretation when the subcommand follows a prefix command
3. THE Command_Database SHALL support storing subcommand metadata for prefix commands (distinct from options)

### Requirement 4: Preserve Existing Prefix Command Behavior

**User Story:** As an LSP user, I want existing prefix command functionality to continue working, so that parsing and completion are not affected.

#### Acceptance Criteria

1. WHEN parsing `frame myframe { ... }` THE Parser SHALL continue to produce a frame block node
2. WHEN parsing `frame create myframe` THE Parser SHALL produce a command node with `frame` as prefix
3. THE existing prefix command list (`by`, `quietly`, `capture`, etc.) SHALL continue to function correctly
4. WHEN completing after `frame ` THE Completion_Provider SHALL suggest frame subcommands
5. WHEN completing after a prefix command that has subcommands (e.g., `mi `) THE Completion_Provider SHALL suggest that command’s subcommands

