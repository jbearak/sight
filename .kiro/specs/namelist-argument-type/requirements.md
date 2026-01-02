---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - syntax-command-parsing: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

Extend the Stata LSP's syntax command parsing to recognize the `namelist` argument type. The `namelist` type is a valid Stata syntax argument that creates a local macro containing a list of names. Currently, the LSP does not recognize `namelist` as a valid argument type, causing false "Undefined local macro" warnings when code references the `namelist` local macro created by the `syntax` command.

## Glossary

- **Namelist**: A Stata syntax argument type that accepts a list of names (identifiers) and creates a local macro with the same name containing the parsed values
- **Syntax_Command**: The `syntax` statement inside a program that declares its interface
- **Implicit_Local**: Local macros automatically created by the `syntax` command (e.g., `varlist`, `if`, `in`, `namelist`, and option names)

## Requirements

### Requirement 1: Recognize Namelist Argument Type

**User Story:** As a developer writing Stata programs, I want the LSP to recognize `namelist` as a valid syntax argument type, so that I don't get false "undefined macro" warnings when using the `namelist` local macro.

#### Acceptance Criteria

1. WHEN parsing a `syntax` command containing `namelist`, THE Parser SHALL recognize it as a valid argument type and create an `ArgumentSpec` with type `namelist`.
2. WHEN parsing a `syntax` command containing `namelist(min=N max=M)`, THE Parser SHALL recognize the optional min/max constraints.
3. THE Parser SHALL handle `namelist` in both required and optional positions (e.g., `[namelist]`).
4. THE Analyzer SHALL register `namelist` as an implicit local macro in the program scope when a `syntax` command uses it.
5. THE Analyzer SHALL NOT report "Undefined Macro" diagnostics for references to `namelist` within the program body after the `syntax` command.

### Requirement 2: Type Definition Updates

**User Story:** As a developer, I want the type system to properly represent `namelist` as a valid argument type.

#### Acceptance Criteria

1. THE `ArgumentSpec.type` union in `src/types/index.ts` SHALL include `namelist` as a valid type.
2. THE valid argument types list in the analyzer SHALL include `namelist`.
3. THE standard argument types list in the parser SHALL include `namelist`.

### Requirement 3: Consistency with Existing Argument Types

**User Story:** As a developer, I want `namelist` to behave consistently with other argument types like `varlist`.

#### Acceptance Criteria

1. WHEN a `syntax` command uses `namelist`, THE implicit local macro SHALL be named `namelist` (matching the argument type name).
2. THE `namelist` argument type SHALL support the same optional bracket syntax as other argument types (e.g., `[namelist]`).
3. THE `namelist` argument type SHALL be included in completion suggestions when editing syntax commands.
