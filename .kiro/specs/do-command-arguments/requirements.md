---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - forward-scope-resolution: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies the requirements for correctly parsing `do`, `run`, and `include` commands in Stata when they include arguments passed to the callee script. Currently, the parser incorrectly treats all tokens after the command name as part of the file path, when in fact only the first argument is the file path and subsequent arguments are passed to the called script as positional locals (`\`1'`, `\`2'`, etc.).

## Glossary

- **Parser**: The component that builds an AST from lexer tokens
- **Analyzer**: The component that performs semantic analysis on the AST
- **Forward_Call**: A `do`, `run`, or `include` command that executes another Stata script
- **Script_Arguments**: Values passed to a called script that become positional local macros (`\`1'`, `\`2'`, etc.)
- **File_Path**: The path to the script being executed (first argument after the command)
- **Varlist**: The list of arguments parsed from a command

## Requirements

### Requirement 1: Correct File Path Extraction

**User Story:** As a developer using the Stata LSP, I want `do`, `run`, and `include` commands to correctly identify the file path, so that cross-file navigation and forward scope resolution work correctly.

#### Acceptance Criteria

1. WHEN a `do` command has a quoted file path followed by arguments (e.g., `do "wfs/survey.do" Cameroon 1978`), THE Analyzer SHALL extract only `"wfs/survey.do"` as the file path
2. WHEN a `do` command has an unquoted file path followed by arguments (e.g., `do survey.do Cameroon 1978`), THE Analyzer SHALL extract only `survey.do` as the file path
3. WHEN a `run` command has arguments after the file path, THE Analyzer SHALL extract only the first argument as the file path
4. WHEN an `include` command has arguments after the file path, THE Analyzer SHALL extract only the first argument as the file path
5. THE Parser SHALL continue to parse all arguments into the varlist for completeness

### Requirement 2: Quoted Path Handling

**User Story:** As a developer, I want quoted file paths with spaces to be correctly parsed, so that paths like `"Cote d'Ivoire"` work correctly.

#### Acceptance Criteria

1. WHEN a file path is enclosed in double quotes, THE Analyzer SHALL treat the entire quoted string as the file path
2. WHEN a file path is enclosed in single quotes, THE Analyzer SHALL treat the entire quoted string as the file path
3. WHEN a quoted file path contains spaces (e.g., `do "path with spaces/file.do"`), THE Analyzer SHALL preserve the spaces in the extracted path

### Requirement 3: Forward Scope Resolution

**User Story:** As a developer, I want forward scope resolution to work correctly with script arguments, so that symbols from called scripts are properly inherited.

#### Acceptance Criteria

1. WHEN resolving forward calls, THE Forward_Scope_Resolver SHALL use only the file path (not script arguments) to locate the target file
2. WHEN a `do` command includes script arguments, THE Forward_Scope_Resolver SHALL ignore the arguments when resolving the file path
3. IF the file path cannot be resolved, THEN THE Forward_Scope_Resolver SHALL report an appropriate diagnostic

### Requirement 4: Diagnostic Accuracy

**User Story:** As a developer, I want accurate diagnostics for file path issues, so that I can quickly identify and fix problems.

#### Acceptance Criteria

1. WHEN a file path in a `do` command cannot be resolved, THE Analyzer SHALL report a diagnostic for the file path only, not including script arguments
2. WHEN displaying the unresolved path in diagnostics, THE Analyzer SHALL show only the file path portion
