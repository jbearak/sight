---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - forward-scope-resolution: [Core dependency]
  - called-from-directive: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies requirements for fixing a bug in the Stata LSP parser where quoted paths in `do`, `run`, and `include` commands are not captured in the command's varlist. This prevents the `@lsp-working-directory` directive from functioning correctly with quoted file paths, which is the standard way to specify paths containing spaces or special characters in Stata.

## Glossary

- **Parser**: The `StataParser` class in `src/parser/index.ts` that converts tokens into an AST
- **Varlist**: The list of arguments/identifiers following a command name, stored in `CommandNode.varlist`
- **STRING Token**: A token type representing quoted strings (simple `"..."` or compound `` `"..."' ``)
- **Forward_Scope_Resolver**: The component that resolves `do`/`run`/`include` commands to extract symbols from called files
- **Working_Directory_Directive**: The `@lsp-working-directory` directive that specifies path resolution context

## Requirements

### Requirement 1: Parse Quoted Paths in Command Varlist

**User Story:** As a Stata developer, I want the LSP to recognize quoted file paths in `do`, `run`, and `include` commands, so that path resolution works correctly for files with spaces or special characters.

#### Acceptance Criteria

1. WHEN a command contains a STRING token after the command name, THE Parser SHALL include it in the command's varlist
2. WHEN a `do` command uses a quoted path like `do "path/to/file.do"`, THE Parser SHALL capture `"path/to/file.do"` in the varlist
3. WHEN a `run` command uses a quoted path like `run "scripts/helper.do"`, THE Parser SHALL capture `"scripts/helper.do"` in the varlist
4. WHEN a `include` command uses a quoted path like `include "lib/utils.do"`, THE Parser SHALL capture `"lib/utils.do"` in the varlist
5. WHEN a command contains both unquoted and quoted arguments, THE Parser SHALL capture all arguments in order

### Requirement 2: Handle Compound Quoted Strings

**User Story:** As a Stata developer, I want the LSP to handle compound quoted strings (`` `"..."' ``) in file paths, so that I can use Stata's standard quoting conventions.

#### Acceptance Criteria

1. WHEN a command contains a compound quoted STRING token, THE Parser SHALL include it in the varlist
2. WHEN a `do` command uses compound quotes like `` do `"path with spaces/file.do"' ``, THE Parser SHALL capture the path in the varlist

### Requirement 3: Preserve Existing Behavior

**User Story:** As a Stata developer, I want the parser to continue working correctly for all existing command patterns, so that no regressions are introduced.

#### Acceptance Criteria

1. WHEN a command uses unquoted paths like `do myfile.do`, THE Parser SHALL continue to capture them in the varlist
2. WHEN a command uses macro references in paths, THE Parser SHALL continue to capture them in the varlist
3. WHEN a command has options after a comma, THE Parser SHALL correctly separate varlist from options
4. WHEN a command has no arguments, THE Parser SHALL produce an empty varlist

### Requirement 4: Integration with Forward Scope Resolution

**User Story:** As a Stata developer, I want the `@lsp-working-directory` directive to work with quoted paths, so that I can use the directive with my existing codebase.

#### Acceptance Criteria

1. WHEN a `do` command has a quoted path and `@lsp-working-directory` is set, THE Forward_Scope_Resolver SHALL resolve the path relative to the working directory
2. WHEN the resolved path exists, THE Forward_Scope_Resolver SHALL extract symbols from the target file
3. WHEN the resolved path does not exist, THE Forward_Scope_Resolver SHALL emit an appropriate diagnostic

### Requirement 5: Update Working Directory Spec Documentation

**User Story:** As a maintainer, I want the working directory spec to document that this bug was discovered and fixed, so that the implementation history is clear.

#### Acceptance Criteria

1. THE tasks.md file for `called-from-directive` spec SHALL be updated to note that this follow-up spec addresses a parser bug discovered during testing
