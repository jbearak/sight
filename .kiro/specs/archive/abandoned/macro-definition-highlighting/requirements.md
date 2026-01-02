# Requirements Document

## Introduction

This feature enhances the TextMate grammar for Stata to highlight macro names at their definition site, not just when they are dereferenced. Currently, macro dereferences like `` `fruit' `` and `$food` are highlighted, but the macro names in definition commands like `local fruit apple` or `global food fruit` are not highlighted. This creates an inconsistent visual experience and makes it harder to quickly identify where macros are defined.

## Glossary

- **TextMate_Grammar**: The JSON-based syntax highlighting definition used by VS Code and other editors to colorize source code
- **Macro_Definition**: A Stata command that creates a macro, including `local`, `global`, `tempvar`, `tempname`, and `tempfile`
- **Macro_Name**: The identifier following a macro definition command that names the macro being created
- **Macro_Dereference**: The syntax used to retrieve a macro's value, such as `` `name' `` for locals or `$name` for globals
- **Scope_Name**: The TextMate token classification that determines how text is styled (e.g., `variable.other.macro.local.stata`)

## Requirements

### Requirement 1: Local Macro Definition Highlighting

**User Story:** As a Stata developer, I want local macro names to be highlighted when defined, so that I can quickly identify where macros are created in my code.

#### Acceptance Criteria

1. WHEN a `local` command is used with a macro name, THE TextMate_Grammar SHALL highlight the macro name with a scope indicating it is a local macro definition
2. WHEN a `local` command uses abbreviated forms (`loc`, `loca`, `local`), THE TextMate_Grammar SHALL highlight the macro name identically to the full `local` command
3. WHEN a `local` command assigns a value with `=` (e.g., `local num = 4`), THE TextMate_Grammar SHALL highlight the macro name before the equals sign
4. WHEN a `local` command assigns a value without `=` (e.g., `local fruit apple`), THE TextMate_Grammar SHALL highlight the macro name after the command

### Requirement 2: Global Macro Definition Highlighting

**User Story:** As a Stata developer, I want global macro names to be highlighted when defined, so that I can distinguish global macro definitions from local ones.

#### Acceptance Criteria

1. WHEN a `global` command is used with a macro name, THE TextMate_Grammar SHALL highlight the macro name with a scope indicating it is a global macro definition
2. WHEN a `global` command uses abbreviated forms (`gl`, `glo`, `glob`, `globa`), THE TextMate_Grammar SHALL highlight the macro name identically to the full `global` command
3. WHEN a `global` command assigns a value with `=` (e.g., `global count = 10`), THE TextMate_Grammar SHALL highlight the macro name before the equals sign
4. WHEN a `global` command assigns a value without `=` (e.g., `global food fruit`), THE TextMate_Grammar SHALL highlight the macro name after the command

### Requirement 3: Temporary Name Definition Highlighting

**User Story:** As a Stata developer, I want temporary macro names to be highlighted when defined, so that I can easily identify temporary variables, names, and files in my code.

#### Acceptance Criteria

1. WHEN a `tempvar` command is used, THE TextMate_Grammar SHALL highlight all macro names following the command
2. WHEN a `tempname` command is used, THE TextMate_Grammar SHALL highlight all macro names following the command
3. WHEN a `tempfile` command is used, THE TextMate_Grammar SHALL highlight all macro names following the command
4. WHEN multiple names are provided to a temp command (e.g., `tempvar x y z`), THE TextMate_Grammar SHALL highlight all names

### Requirement 4: Scope Name Consistency

**User Story:** As a theme developer, I want macro definition scopes to follow TextMate conventions, so that themes can style macro definitions consistently.

#### Acceptance Criteria

1. THE TextMate_Grammar SHALL use scope names that follow the pattern `entity.name.variable.macro.{type}.stata` for macro definitions
2. THE TextMate_Grammar SHALL distinguish local macro definitions from global macro definitions via different scope names
3. THE TextMate_Grammar SHALL use scope names that allow themes to style definitions differently from dereferences if desired

### Requirement 5: Backward Compatibility

**User Story:** As an existing user, I want the grammar update to not break existing highlighting, so that my code continues to look correct.

#### Acceptance Criteria

1. WHEN macro dereferences are used (`` `name' `` or `$name`), THE TextMate_Grammar SHALL continue to highlight them as before
2. WHEN the `local` or `global` commands are used without a macro name, THE TextMate_Grammar SHALL continue to highlight the command keyword
3. THE TextMate_Grammar SHALL not introduce regressions in existing comment, string, or other syntax highlighting
