# Requirements Document

## Introduction

This document specifies requirements for enhancing the Stata TextMate grammar to provide comprehensive syntax highlighting. The current grammar has significant gaps compared to the reference implementation (kylebarron/language-stata), missing highlighting for common commands like `do`, `gen`, `display`, `use`, `unab`, `list`, and `tab`. Additionally, the grammar lacks support for nested string/macro highlighting with depth-based color differentiation, and the README lacks documentation of colorization groups.

## Glossary

- **TextMate_Grammar**: The JSON-based syntax definition file (`stata.tmLanguage.json`) that defines tokenization rules for syntax highlighting
- **Scope_Name**: A hierarchical identifier (e.g., `keyword.control.stata`) that maps tokens to theme colors
- **Nesting_Depth**: The level of recursion when strings or macros contain other strings or macros
- **Compound_String**: A Stata string delimited by backtick-double-quote and double-quote-apostrophe (`` `" "' ``)
- **Local_Macro**: A Stata macro referenced with backtick-apostrophe syntax (`` `name' ``)
- **Global_Macro**: A Stata macro referenced with dollar sign syntax (`$name` or `${name}`)
- **Reference_Grammar**: The kylebarron/language-stata grammar used as the baseline for feature parity

## Requirements

### Requirement 1: Command Highlighting Parity

**User Story:** As a Stata developer, I want all common Stata commands to be highlighted, so that I can quickly identify commands in my code.

#### Acceptance Criteria

1. WHEN a user types a file execution command (`do`, `run`, `include`) THEN THE TextMate_Grammar SHALL highlight it as `keyword.control.flow.stata`
2. WHEN a user types a data generation command (`gen`, `generate`, `egen`) THEN THE TextMate_Grammar SHALL highlight it as `keyword.functions.data.stata`
3. WHEN a user types an output command (`display`, `di`, `list`, `li`, `l`) THEN THE TextMate_Grammar SHALL highlight it as `keyword.other.command.stata`
4. WHEN a user types a data loading command (`use`, `u`, `save`, `saveold`) THEN THE TextMate_Grammar SHALL highlight it as `keyword.functions.data.stata`
5. WHEN a user types a variable expansion command (`unab`, `unabbrev`) THEN THE TextMate_Grammar SHALL highlight it as `keyword.other.command.stata`
6. WHEN a user types a tabulation command (`tab`, `tabulate`, `tab1`, `tab2`) THEN THE TextMate_Grammar SHALL highlight it as `keyword.other.command.stata`
7. THE TextMate_Grammar SHALL support command abbreviations matching the Reference_Grammar patterns
8. FOR general built-in commands that don't fit specific categories THE TextMate_Grammar SHALL use `keyword.other.command.stata`

### Requirement 2: String Literal Highlighting After Commands

**User Story:** As a Stata developer, I want string literals following file commands to be highlighted, so that I can easily identify file paths in my code.

#### Acceptance Criteria

1. WHEN a string literal follows a `do` command THEN THE TextMate_Grammar SHALL highlight the string as `string.quoted.double.stata` or `string.quoted.compound.stata`
2. WHEN a string literal follows a `run` command THEN THE TextMate_Grammar SHALL highlight the string as `string.quoted.double.stata` or `string.quoted.compound.stata`
3. WHEN a string literal follows an `include` command THEN THE TextMate_Grammar SHALL highlight the string as `string.quoted.double.stata` or `string.quoted.compound.stata`
4. WHEN a string literal follows a `use` command THEN THE TextMate_Grammar SHALL highlight the string as `string.quoted.double.stata` or `string.quoted.compound.stata`

### Requirement 3: Nested String and Macro Depth Highlighting

**User Story:** As a Stata developer, I want nested strings and macros to be visually distinguished by nesting depth, so that I can understand complex macro expressions.

#### Acceptance Criteria

1. WHEN a Compound_String contains another Compound_String THEN THE TextMate_Grammar SHALL assign different scope names based on Nesting_Depth
2. WHEN a Local_Macro contains another Local_Macro THEN THE TextMate_Grammar SHALL assign different scope names based on Nesting_Depth
3. THE TextMate_Grammar SHALL support up to six levels of nesting depth for strings and macros (matching VS Code's native bracket pair colorization which uses 6 colors)
4. WHEN nesting exceeds six levels THEN THE TextMate_Grammar SHALL cycle back to the first depth scope
5. THE scope names for nested elements SHALL follow a pattern that allows themes to assign different shades (e.g., `string.quoted.compound.depth1.stata`, `string.quoted.compound.depth2.stata`)

### Requirement 4: Built-in Command Coverage

**User Story:** As a Stata developer, I want all built-in Stata commands to be highlighted, so that I have consistent syntax highlighting across my codebase.

#### Acceptance Criteria

1. THE TextMate_Grammar SHALL include all commands present in the Reference_Grammar's `commands-other` repository
2. THE TextMate_Grammar SHALL include all commands present in the Reference_Grammar's built-in commands list
3. WHEN a command has abbreviation variants THEN THE TextMate_Grammar SHALL highlight all valid abbreviations
4. THE TextMate_Grammar SHALL highlight popular add-on commands (`reghdfe`, `ivreghdfe`, `ivreg2`, `outreg`, `estout`, `esttab`, `estadd`, `estpost`, `gcollapse`, `gcontract`, `gegen`, `gisid`, `glevelsof`, `gquantiles`)
5. WHEN an add-on command is added to the TextMate_Grammar THEN the command SHALL also be added to the command database cache for completion lists

### Requirement 5: Function Highlighting

**User Story:** As a Stata developer, I want all built-in Stata functions to be highlighted, so that I can distinguish functions from commands and variables.

#### Acceptance Criteria

1. THE TextMate_Grammar SHALL highlight all built-in functions listed in the Reference_Grammar as `support.function.builtin.stata`
2. THE TextMate_Grammar SHALL highlight custom/user-defined functions as `support.function.custom.stata`
3. WHEN a function is followed by parentheses THEN THE TextMate_Grammar SHALL highlight the function name and parentheses appropriately

### Requirement 6: Macro Command Highlighting

**User Story:** As a Stata developer, I want macro definition and manipulation commands to be highlighted, so that I can easily identify macro operations.

#### Acceptance Criteria

1. WHEN a user types `local` or its abbreviations THEN THE TextMate_Grammar SHALL highlight it as `keyword.macro.stata`
2. WHEN a user types `global` or its abbreviations THEN THE TextMate_Grammar SHALL highlight it as `keyword.macro.stata`
3. WHEN a user types `tempvar`, `tempname`, or `tempfile` THEN THE TextMate_Grammar SHALL highlight it as `keyword.macro.stata`
4. WHEN a user types `macro drop` or `macro list` THEN THE TextMate_Grammar SHALL highlight it as `keyword.macro.stata`
5. THE TextMate_Grammar SHALL highlight macro extended functions (e.g., `: type`, `: format`, `: word count`) as `keyword.macro.extendedfcn.stata`

### Requirement 7: Control Flow Highlighting

**User Story:** As a Stata developer, I want control flow keywords to be highlighted distinctly, so that I can quickly identify program structure.

#### Acceptance Criteria

1. WHEN a user types conditional keywords (`if`, `else`, `else if`) THEN THE TextMate_Grammar SHALL highlight them as `keyword.control.conditional.stata`
2. WHEN a user types loop keywords (`foreach`, `forvalues`, `while`, `continue`) THEN THE TextMate_Grammar SHALL highlight them as `keyword.control.flow.stata`
3. WHEN a user types prefix commands (`by`, `bysort`, `quietly`, `noisily`, `capture`) THEN THE TextMate_Grammar SHALL highlight them appropriately

### Requirement 8: Program Definition Highlighting

**User Story:** As a Stata developer, I want program definitions to be highlighted with the program name distinguished, so that I can easily identify program boundaries.

#### Acceptance Criteria

1. WHEN a user types `program define` THEN THE TextMate_Grammar SHALL highlight `program` as `storage.type.function.stata` and the program name as `entity.name.function.stata`
2. WHEN a user types `program drop` or `program list` THEN THE TextMate_Grammar SHALL highlight appropriately
3. WHEN a user types `end` to close a program THEN THE TextMate_Grammar SHALL highlight it as `keyword.functions.data.stata`

### Requirement 9: Type Highlighting

**User Story:** As a Stata developer, I want data types to be highlighted, so that I can identify type declarations in variable definitions.

#### Acceptance Criteria

1. WHEN a user types a storage type (`byte`, `int`, `long`, `float`, `double`, `str1`-`str2045`, `strL`) THEN THE TextMate_Grammar SHALL highlight it as `support.type.stata`
2. WHEN a type appears in a `generate` or `egen` command THEN THE TextMate_Grammar SHALL highlight the type appropriately

### Requirement 10: Built-in Variable Highlighting

**User Story:** As a Stata developer, I want built-in system variables to be highlighted, so that I can distinguish them from user-defined variables.

#### Acceptance Criteria

1. WHEN a user types a built-in variable (`_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`) THEN THE TextMate_Grammar SHALL highlight it as `variable.object.stata`

### Requirement 11: Operator Highlighting

**User Story:** As a Stata developer, I want operators to be highlighted, so that I can easily identify expressions.

#### Acceptance Criteria

1. THE TextMate_Grammar SHALL highlight arithmetic operators (`+`, `-`, `*`, `/`, `^`)
2. THE TextMate_Grammar SHALL highlight comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`)
3. THE TextMate_Grammar SHALL highlight logical operators (`&`, `|`, `!`)
4. THE TextMate_Grammar SHALL highlight assignment operators (`=`)

### Requirement 12: Numeric Constants and Missing Values

**User Story:** As a Stata developer, I want numeric constants and missing values to be highlighted, so that I can identify literal values in my code.

#### Acceptance Criteria

1. THE TextMate_Grammar SHALL highlight integer literals as `constant.numeric.stata`
2. THE TextMate_Grammar SHALL highlight floating-point literals (including scientific notation) as `constant.numeric.stata`
3. THE TextMate_Grammar SHALL highlight the system missing value (`.`) as `constant.language.missing.stata`
4. THE TextMate_Grammar SHALL highlight extended missing values (`.a` through `.z`) as `constant.language.missing.stata`

### Requirement 13: Mata Block Highlighting

**User Story:** As a Stata developer, I want Mata code blocks to be highlighted with Mata-specific rules, so that I can distinguish Mata code from Stata code.

#### Acceptance Criteria

1. WHEN a user enters a Mata block (`mata:` to `end`) THEN THE TextMate_Grammar SHALL apply Mata-specific highlighting rules
2. THE TextMate_Grammar SHALL highlight Mata keywords (`version`, `pragma`, `if`, `else`, `for`, `while`, `do`, `break`, `continue`, `goto`, `return`)
3. THE TextMate_Grammar SHALL highlight Mata types (`transmorphic`, `string`, `numeric`, `real`, `complex`, `pointer`, `matrix`, `vector`, `rowvector`, `colvector`, `scalar`)

### Requirement 14: README Colorization Documentation

**User Story:** As a user of the Stata LSP, I want documentation of what syntax elements are colorized and under which groups, so that I can understand and customize my theme.

#### Acceptance Criteria

1. THE README SHALL include a "Syntax Highlighting" section documenting colorization groups
2. FOR EACH scope category THE README SHALL list the scope name followed by a colon and the elements that receive that scope
3. THE documentation SHALL cover at minimum: comments, strings, macros, keywords, commands, functions, types, operators, built-in variables, and missing values
4. THE documentation SHALL explain the nesting depth feature for strings and macros

### Requirement 15: Regex Function Highlighting

**User Story:** As a Stata developer, I want regex functions to be highlighted with their regex patterns distinguished, so that I can identify regex syntax within function calls.

#### Acceptance Criteria

1. WHEN a user types ASCII regex functions (`regexm`, `regexr`, `regexs`) THEN THE TextMate_Grammar SHALL highlight them appropriately
2. WHEN a user types Unicode regex functions (`ustrregexm`, `ustrregexrf`, `ustrregexra`, `ustrregexs`) THEN THE TextMate_Grammar SHALL highlight them appropriately

### Requirement 16: Subscript Highlighting

**User Story:** As a Stata developer, I want matrix and variable subscripts to be highlighted, so that I can identify indexing operations.

#### Acceptance Criteria

1. WHEN a user types subscript brackets (`[` and `]`) THEN THE TextMate_Grammar SHALL highlight them appropriately
2. THE TextMate_Grammar SHALL highlight content within subscripts with appropriate nested rules
