---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - option-extraction: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

Extend the Stata parser so the LSP understands the `syntax` command that appears
inside user-defined programs. The `syntax` declaration defines a program’s
interface; extracting it enables completions, hover info, and diagnostics when
users call custom programs.

## Glossary

- **Syntax_Command**: The `syntax` statement inside a program that declares its interface
- **Argument_Spec**: A specification for positional arguments (varlist, varname, anything, etc.)
- **Option_Spec**: A specification for named options with optional types and defaults
- **Program_Signature**: The extracted interface (arguments + options) from a syntax command
- **User_Program**: A program defined with `program define` in user code or .ado files
- **Implicit_Local**: Local macros automatically created by the `syntax` command (e.g., `varlist`, `if`, `in`, and option names)

## General Constraints

1. THE Parser SHALL only parse `syntax` statements within `program define … end` blocks; `syntax` statements outside programs are ignored.
2. THE Parser SHALL support both `#delimit cr` and `#delimit ;` forms and handle continued lines.
3. WHEN multiple `syntax` statements appear in a single program, THE Parser SHALL merge them in order of appearance, with later declarations overriding earlier ones for the same option name.
4. WHEN unknown tokens appear inside `syntax`, THE Parser SHALL produce a recoverable error that keeps program parsing intact.

## Requirements

### Requirement 1: Parse Syntax Command

**User Story:** As a developer writing Stata programs, I want the LSP to understand my `syntax` declarations, so that it can provide intelligent assistance when I call my programs.

#### Acceptance Criteria

1. WHEN parsing a `syntax` command inside a program, THE Parser SHALL create a specific `SyntaxNode` in the AST, distinct from generic `CommandNode`s.
2. WHEN a `syntax` command appears outside a program block, THE Parser SHALL treat it as a generic command, not extract a Program_Signature, and emit a diagnostic warning.
3. THE Parser SHALL extract the complete Argument_Spec in declared order.
4. WHEN parsing a `syntax` command with options, THE Parser SHALL extract each
   Option_Spec including required/optional markers.
5. THE Parser SHALL handle standard argument types: `varlist`, `varname`, `newvarname`,
   `anything`, `if`, `in`, `using`, `=exp`, and parentheses-delimited
   expressions.
6. THE Parser SHALL handle option modifiers: required (`*`), optional
   (brackets), with arguments (`(type)`), and clustered forms
   (e.g., `opt(real default(1))`).
7. THE Parser SHALL attach the resulting Program_Signature to the ProgramNode in
   the AST with source ranges for arguments and options.

### Requirement 2: Option Specification Parsing

**User Story:** As a developer, I want the LSP to understand my program's options including their types and defaults.

#### Acceptance Criteria

1. WHEN parsing `[Option]`, THE Parser SHALL recognize it as an optional boolean
   option with no argument.
2. WHEN parsing `Option(type)`, THE Parser SHALL record the argument type
   (`real`, `integer`, `string`, `varlist`, `name`, `filename`, etc.).
3. WHEN parsing `Option(type default)`, THE Parser SHALL extract the default
   literal and include it in the Program_Signature.
4. WHEN parsing `*`, THE Parser SHALL mark the signature as allowing arbitrary
   additional options.
5. THE Parser SHALL preserve the original option name casing to compute minimum
   unambiguous abbreviations (e.g., `MyOpt` ⇒ min abbrev `M`).
6. WHEN the same option name appears twice, THE Parser SHALL keep the last
   definition and emit a duplicate-option diagnostic.

### Requirement 3: Provide Completions for User Programs

**User Story:** As a developer calling a custom program, I want to see its options in autocomplete, so that I don't have to remember them.

#### Acceptance Criteria

1. WHEN typing options after a User_Program call, THE Completion_Provider SHALL
   suggest options from its Program_Signature filtered by partial abbreviation.
2. THE Completion_Provider SHALL show option descriptions derived from type
   (e.g., `real` → “numeric value”).
3. WHEN an option has an argument, THE Completion_Provider SHALL insert
   parentheses with a placeholder.
4. THE Completion_Provider SHALL visually differentiate required vs optional
   options and hide options already present in the call.

### Requirement 4: Hover Information

**User Story:** As a developer, I want to see a program's syntax when I hover over it, so that I know how to call it.

#### Acceptance Criteria

1. WHEN hovering over a User_Program name, THE Hover_Provider SHALL display its
   Program_Signature in Stata help-style formatting.
2. WHEN hovering over an option in a User_Program call, THE Hover_Provider SHALL
   show the option’s type, default (if any), and whether it is required.
3. WHEN hover data is unavailable (e.g., missing signature), THE Hover_Provider
   SHALL fail silently without throwing.

### Requirement 5: Handle Common Patterns

**User Story:** As a developer, I want the parser to handle real-world syntax patterns correctly.

#### Acceptance Criteria

1. THE Parser SHALL handle `syntax varlist [if] [in] [, options]` (common
   regression-style).
2. THE Parser SHALL handle `syntax anything [, options]` (flexible input) and 
   `syntax anything(name=...)` variants.
3. THE Parser SHALL handle `syntax [varlist] [if] [in] using ...`
   (file-based commands), capturing the `using` keyword and following filename requirement.
4. THE Parser SHALL handle `syntax newvarname = exp` (generate-style) and record
   the expression requirement.
5. WHEN syntax parsing fails, THE Parser SHALL fall back gracefully without
   corrupting the ProgramNode or downstream providers.

### Requirement 6: Diagnostics and Symbol Table Integration

**User Story:** As a developer, I want the LSP to implicitly define the local macros created by `syntax` so I don't get false "undefined macro" errors.

#### Acceptance Criteria

1. THE Analyzer SHALL emit diagnostics for duplicate options, unknown argument
   types, or mismatched delimiters inside `syntax`.
2. Diagnostics SHALL include source ranges pointing to the offending token.
3. Recoverable errors SHALL not prevent building a partial Program_Signature.
4. THE Analyzer SHALL register implicit local macros in the symbol table for every parsed argument element:
    - `varlist` → `local varlist`
    - `if` → `local if`
    - `in` → `local in`
    - `using` → `local using`
    - `anything` → `local anything` (or named equivalent)
    - Each option name → `local optionname`
5. THE Analyzer SHALL NOT report "Undefined Macro" diagnostics for macros defined via `syntax` in the current scope.
6. WHEN a user calls a program with multiple `syntax` commands, THE Analyzer SHALL validate the call against each syntax in order and emit a diagnostic only if the call is invalid under all syntaxes.

### Requirement 7: Scope and Visibility

**User Story:** As a developer, I rely on Stata's scoping rules, so I expect `syntax` variables to be local to the program.

#### Acceptance Criteria

1. THE Analyzer SHALL restrict the visibility of implicit local macros created by `syntax` to the body of the defining `program`.
2. Implicit locals SHALL NOT leak into the global scope or parent calling scopes.
3. Implicit locals SHALL exist independently of global macros with the same name (no masking or shadowing occurs).
4. If multiple `syntax` commands exist (e.g. in different execution paths), their combined effect on the scope SHALL be handled such that macros are available in the code following them.

### Non-Functional Requirements

**User Story:** As a system architect, I want the syntax parsing feature to maintain performance and have comprehensive test coverage.

#### Acceptance Criteria

1. THE Parser SHALL not increase end-to-end document parse time by more than 5% on the current test corpus.
2. THE Development_Team SHALL add unit tests for lexer/parser coverage of all acceptance cases.
3. THE Development_Team SHALL add integration tests for completion and hover providers using parsed signatures.
