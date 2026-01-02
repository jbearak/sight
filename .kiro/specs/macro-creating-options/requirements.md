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
This feature adds support for recognizing Stata commands that create local or global macros via `local()` and `global()` options. For example, `levelsof varname, local(macname)` creates a local macro as a side effect. The LSP should recognize these macros to avoid false "undefined macro" warnings and provide proper completion and navigation support.

## Glossary
- **Macro-creating option**: An option like `local(name)` or `global(name)` that causes a command to create a macro with the specified name.
- **Supported command**: Either (a) a command in the hardcoded allowlist, or (b) a user-defined program that has been detected to create macros via `local()`/`global()`.
- **Literal identifier**: An option argument that can be determined statically and matches the macro-name identifier form (no macro expansion, no quoting).
- **Analyzer**: The semantic analysis component that builds symbol tables and detects undefined references.
- **Symbol table**: Data structure storing all defined symbols (macros, variables, programs, etc.) in a file.

## Non-goals
- Do not attempt to evaluate dynamic macro names (e.g., `local(\`name')`, `local(${name})`, or other runtime-computed strings).
- Do not infer macro creation from arbitrary option names on arbitrary commands (avoid false positives).
- Do not model runtime control flow; recognition is purely syntactic/semantic and file-position based.

## Requirements

### Requirement 1: Option parsing and identifier rules
**User Story:** As a Stata developer, I want the LSP to correctly parse the macro name from option syntax, so that macro registration works reliably.

#### Acceptance Criteria
1. WHEN parsing a `local(name)` option, THE Analyzer SHALL extract `name` as the candidate macro identifier.
2. WHEN parsing a `global(name)` option, THE Analyzer SHALL extract `name` as the candidate macro identifier.
3. WHEN the option argument contains whitespace like `local( name )`, THE Analyzer SHALL trim whitespace and extract `name`.
4. WHEN the extracted argument is not a literal identifier (e.g., contains macro expansion such as ``\`...''`` / `$...`, quotes, whitespace, or other non-identifier characters), THE Analyzer SHALL skip registration.
5. WHEN the option uses an abbreviated form (e.g., `l(name)` for `local(name)`), THE Analyzer SHALL recognize the abbreviation only if the command/option metadata indicates it is valid for that specific supported command.

### Requirement 2: Hardcoded allowlist of built-in commands
**User Story:** As a maintainer, I want the set of built-in commands that support macro-creating options to be explicitly defined, so that we avoid false positives from commands that use `local()` for other purposes.

#### Acceptance Criteria
1. THE Analyzer SHALL maintain a hardcoded allowlist of commands known to create macros via `local()` or `global()` options.
2. THE allowlist SHALL initially include: `levelsof`, `glevelsof` (both support `local()` and `global()` options).
3. THE allowlist SHALL be easily extensible by adding entries to a single location in the codebase.

### Requirement 3: Recognize local() option on supported commands
**User Story:** As a Stata developer, I want the LSP to recognize when supported commands create local macros via `local()` options, so that I don't get false "undefined macro" warnings.

#### Acceptance Criteria
1. WHEN a supported command includes a `local(identifier)` option, THE Analyzer SHALL register a local macro with that identifier name in the symbol table.
2. WHEN the `local()` option contains a non-literal identifier (see Requirement 1), THE Analyzer SHALL skip registration.
3. WHEN a local macro is registered via a `local()` option, THE Analyzer SHALL set the definition location to the option argument span (the identifier inside `local(...)`); if that span is unavailable, it SHALL fall back to the command span.
4. WHEN a local macro created via `local()` is referenced after the command (in file position), THE Analyzer SHALL NOT report an undefined macro warning.
5. WHEN a `local(identifier)` macro name collides with an existing local macro name, THE Analyzer SHALL treat it as a redefinition at the later location.

### Requirement 4: Recognize global() option on supported commands
**User Story:** As a Stata developer, I want the LSP to recognize when supported commands create global macros via `global()` options, so that I don't get false "undefined macro" warnings.

#### Acceptance Criteria
1. WHEN a supported command includes a `global(identifier)` option, THE Analyzer SHALL register a global macro with that identifier name in the symbol table.
2. WHEN the `global()` option contains a non-literal identifier (see Requirement 1), THE Analyzer SHALL skip registration.
3. WHEN a global macro is registered via a `global()` option, THE Analyzer SHALL set the definition location to the option argument span (the identifier inside `global(...)`); if that span is unavailable, it SHALL fall back to the command span.
4. WHEN a global macro created via `global()` is referenced after the command (in file position), THE Analyzer SHALL NOT report an undefined macro warning.
5. WHEN a `global(identifier)` macro name collides with an existing global macro name, THE Analyzer SHALL treat it as a redefinition at the later location.

### Requirement 5: User-defined program detection (narrow, pattern-based)
**User Story:** As a Stata developer, I want the LSP to automatically detect when my user-defined programs create macros via `local()` or `global()` options, so that I get proper macro recognition without manual configuration.

#### Acceptance Criteria
1. WHEN a program definition contains `c_local \`local'` (where `local` is a parameter from the `syntax` command), THE Analyzer SHALL infer that the program creates a local macro via its `local()` option.
2. WHEN a program definition contains `global \`global'` (where `global` is a parameter from the `syntax` command), THE Analyzer SHALL infer that the program creates a global macro via its `global()` option.
3. WHEN a user-defined program with detected macro-creating behavior is called with a `local(name)` option, THE Analyzer SHALL register a local macro with that name.
4. WHEN a user-defined program with detected macro-creating behavior is called with a `global(name)` option, THE Analyzer SHALL register a global macro with that name.
5. THE detection SHALL work for programs defined in the current file.
6. THE detection SHOULD work for programs indexed from the workspace when the workspace index contains sufficient information to apply the detection patterns; otherwise it SHALL fall back to “unknown” (no registration).
7. Precedence: WHEN a token sequence could be interpreted as both a built-in command and a user-defined program of the same name, THE Analyzer SHALL treat it as a built-in command for the purposes of macro-creating option handling.
