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

This feature adds support for the Stata `gettoken` command in the LSP's semantic analyzer. The `gettoken` command extracts tokens from a string and stores them in local macros. Currently, the LSP does not recognize that `gettoken` creates local macros, leading to false "undefined local macro" warnings when these macros are referenced later in the code.

## Glossary

- **Analyzer**: The semantic analysis component (`src/analyzer/index.ts`) that builds symbol tables and detects undefined references
- **gettoken**: A Stata command that extracts the first token from a string and optionally stores the remainder
- **Local_Macro**: A macro scoped to the current do-file or program, referenced with backtick-quote syntax (`` `name' ``)
- **Symbol_Table**: Data structure tracking all defined symbols (macros, variables, programs) in a file

## Requirements

### Requirement 1: Basic gettoken Macro Creation

**User Story:** As a Stata developer, I want the LSP to recognize that `gettoken` creates local macros, so that I don't receive false "undefined local macro" warnings.

#### Acceptance Criteria

1. WHEN a `gettoken` command is encountered with syntax `gettoken macname1 : macname3`, THE Analyzer SHALL register `macname1` as a local macro in the symbol table
2. WHEN a `gettoken` command is encountered with syntax `gettoken macname1 macname2 : macname3`, THE Analyzer SHALL register both `macname1` and `macname2` as local macros in the symbol table
3. WHEN a local macro created by `gettoken` is referenced after the `gettoken` command, THE Analyzer SHALL NOT emit an "undefined local macro" warning
4. WHEN a local macro created by `gettoken` is referenced before the `gettoken` command, THE Analyzer SHALL emit an "undefined local macro" warning (forward reference detection)

### Requirement 2: gettoken Parsing

**User Story:** As a Stata developer, I want the LSP to correctly parse the `gettoken` command syntax, so that macro names are accurately extracted.

#### Acceptance Criteria

1. WHEN parsing `gettoken`, THE Analyzer SHALL identify the colon (`:`) as the separator between output macro names and the input macro name
2. WHEN parsing `gettoken macname1 : macname3`, THE Analyzer SHALL extract `macname1` as the first output macro
3. WHEN parsing `gettoken macname1 macname2 : macname3`, THE Analyzer SHALL extract `macname1` as the first output macro and `macname2` as the second output macro (remainder)
4. WHEN parsing `gettoken` with options (e.g., `parse()`, `quotes`), THE Analyzer SHALL still correctly extract the macro names before the options

### Requirement 3: Scope Handling

**User Story:** As a Stata developer, I want `gettoken`-created macros to respect proper scoping rules, so that they behave consistently with other local macros.

#### Acceptance Criteria

1. WHEN `gettoken` is used inside a program definition, THE Analyzer SHALL register the created macros in the program's local scope
2. WHEN `gettoken` is used at the do-file level, THE Analyzer SHALL register the created macros in the do-file's local scope
3. THE Analyzer SHALL track the definition position of `gettoken`-created macros for forward reference detection
