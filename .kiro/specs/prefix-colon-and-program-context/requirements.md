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

This document specifies requirements for fixing two false positive diagnostic bugs in the Stata LSP parser:

1. The parser incorrectly interprets the word "program" as the `program` command when it appears inside parentheses (e.g., in `getmata (program survey level datasig)=aww_datasigs`)
2. The parser does not recognize prefix commands followed by a colon (e.g., `quietly:`, `capture:`, `noisily:`) as valid syntax

## Glossary

- **Parser**: The component that builds an Abstract Syntax Tree (AST) from tokens
- **Prefix_Command**: A Stata command that modifies the execution of another command (e.g., `quietly`, `capture`, `noisily`, `by`)
- **Colon_Prefix_Syntax**: The syntax where a prefix command is followed by a colon before the main command (e.g., `quietly: display "hello"`)
- **Parenthesized_Context**: Code that appears within parentheses, such as variable lists in commands like `getmata`
- **Statement_Keyword**: A word that typically starts a new statement (e.g., `program`, `local`, `global`, `if`, `foreach`)

## Requirements

### Requirement 1: Prefix Command Colon Syntax Support

**User Story:** As a Stata developer, I want the LSP to recognize prefix commands followed by a colon, so that I don't receive false positive "Expected command name" errors.

#### Acceptance Criteria

1. WHEN a prefix command (`quietly`, `qui`, `capture`, `cap`, `noisily`, `noi`) is followed by a colon, THE Parser SHALL consume the colon and continue parsing the subsequent command
2. WHEN `quietly:` is followed by a valid command, THE Parser SHALL parse it as a prefix command with the subsequent command
3. WHEN `capture:` is followed by a valid command, THE Parser SHALL parse it as a prefix command with the subsequent command
4. WHEN `noisily:` is followed by a valid command, THE Parser SHALL parse it as a prefix command with the subsequent command
5. WHEN abbreviated prefix commands (`qui:`, `cap:`, `noi:`) are followed by a valid command, THE Parser SHALL parse them as prefix commands with the subsequent command
6. WHEN multiple prefix commands with colons are chained (e.g., `quietly: capture: display`), THE Parser SHALL parse all prefixes correctly

### Requirement 2: Context-Aware Statement Keyword Detection

**User Story:** As a Stata developer, I want the LSP to correctly distinguish between statement keywords and regular identifiers based on position, so that I don't receive false positive errors when keywords appear as variable names or command arguments.

#### Acceptance Criteria

1. WHEN the word "program" appears as the first token of a statement (with no prefix commands), THE Parser SHALL interpret it as the `program` command
2. WHEN the word "program" appears after another command (e.g., `gen program = 1`, `getmata (program ...)`), THE Parser SHALL NOT interpret it as the `program` command
3. WHEN a variable is named "program" and used in commands like `gen`, `replace`, `rename`, THE Parser SHALL parse it as a regular identifier without errors
4. WHEN the `getmata` command contains a parenthesized variable list including the word "program", THE Parser SHALL parse it as a regular command without errors
5. WHEN other statement keywords (`local`, `global`, `if`, `foreach`, `forvalues`, `while`) appear as arguments to commands, THE Parser SHALL NOT interpret them as statement-starting keywords
6. IF a statement keyword appears after a command name, THEN THE Parser SHALL treat it as a regular identifier

### Requirement 3: Prefix Commands with Statement Keywords

**User Story:** As a Stata developer, I want the LSP to correctly parse commands like `capture program drop` where a statement keyword follows a prefix command, so that I don't receive false positive errors.

#### Acceptance Criteria

1. WHEN `capture program drop <name>` is parsed, THE Parser SHALL treat "program" as a command name (not a program definition), and parse the entire line as a prefixed command
2. WHEN `quietly program drop <name>` is parsed, THE Parser SHALL treat "program" as a command name and parse it as a prefixed command
3. WHEN any prefix command (`capture`, `quietly`, `noisily`, `cap`, `qui`, `noi`) precedes the word "program", THE Parser SHALL NOT interpret "program" as starting a program definition block
4. WHEN `capture program define <name>` is parsed, THE Parser SHALL treat it as a prefixed command (the `program define` command with capture prefix), not as a program definition block that captures errors
5. IF a prefix command is followed by a statement keyword, THEN THE Parser SHALL parse the statement keyword as a regular command name
