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

This document specifies requirements for fixing false positive diagnostics in the Stata LSP. The LSP currently emits several incorrect errors and warnings for valid Stata code patterns, specifically:

1. "Unclosed string literal" errors for valid compound quote strings containing single quotes (e.g., `"`custom_arg'"`)
2. "Undefined local macro" warnings for macros defined via the `args` command when the definition appears after the reference in the file (forward reference issue)
3. "Cannot read file" warnings for `do`/`run`/`include` commands that use macro references in the file path

## Glossary

- **Lexer**: The component that tokenizes Stata source code into tokens
- **Analyzer**: The component that performs semantic analysis and builds symbol tables
- **Forward_Scope_Resolver**: The component that resolves forward call directives and `do`/`run`/`include` commands
- **Compound_Quote_String**: A Stata string delimited by backtick-quote at start and quote-apostrophe at end (e.g., `` `"text"' ``)
- **Local_Macro_Reference**: A reference to a local macro using backtick-apostrophe syntax (e.g., `` `name' ``)
- **Args_Command**: The Stata `args` command that creates local macros from positional arguments
- **Macro_Path**: A file path in a `do`/`run`/`include` command that contains macro references

## Requirements

### Requirement 1: Inline Mata/Python Context Handling

**User Story:** As a Stata developer, I want the LSP to correctly handle inline Mata commands (e.g., `mata: expression`), so that code after inline Mata is parsed correctly as Stata code.

#### Acceptance Criteria

1. WHEN the Lexer encounters `mata:` (inline Mata), THE Lexer SHALL NOT push the Mata language context
2. WHEN the Lexer encounters `python:` (inline Python), THE Lexer SHALL NOT push the Python language context
3. WHEN code follows an inline Mata command on subsequent lines, THE Lexer SHALL parse it as Stata code
4. WHEN a full Mata block is used (starting with `mata` on its own line), THE Lexer SHALL push the Mata context until `end` is encountered
5. WHEN strings appear after an inline Mata command, THE Lexer SHALL parse them using Stata string rules (not Mata rules)

### Requirement 2: Args Command Macro Definition Recognition

**User Story:** As a Stata developer, I want the LSP to recognize that the `args` command defines local macros that are valid throughout the entire file scope, so that I don't see false "undefined local macro" warnings.

#### Acceptance Criteria

1. WHEN the Analyzer encounters an `args` command, THE Analyzer SHALL register all argument names as local macros
2. WHEN a local macro is defined via `args`, THE Analyzer SHALL treat the macro as defined from the start of the containing scope (file or program)
3. WHEN a local macro reference appears before the `args` command that defines it, THE Analyzer SHALL NOT emit an "undefined local macro" warning
4. WHEN a local macro is referenced that is not defined by any `args` command or other definition, THE Analyzer SHALL emit an "undefined local macro" warning

### Requirement 3: Macro Path Detection in Do/Run/Include Commands

**User Story:** As a Stata developer, I want the LSP to skip file existence checks for `do`/`run`/`include` commands that use macro references in the file path, so that I don't see false "cannot read file" warnings.

#### Acceptance Criteria

1. WHEN a `do`/`run`/`include` command contains a path with a local macro reference (backtick character), THE Forward_Scope_Resolver SHALL NOT emit a "cannot read file" diagnostic
2. WHEN a `do`/`run`/`include` command contains a path with a global macro reference (dollar sign character), THE Forward_Scope_Resolver SHALL NOT emit a "cannot read file" diagnostic
3. WHEN a `do`/`run`/`include` command contains a static path (no macro references), THE Forward_Scope_Resolver SHALL check file existence and emit diagnostics as appropriate
4. WHEN detecting macro references in paths, THE Analyzer SHALL check for the presence of backtick (`` ` ``) or dollar sign (`$`) characters in the raw path string
