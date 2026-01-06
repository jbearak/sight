# Requirements Document

## Introduction

The AST formatter (PrettyPrinter) has critical bugs in handling colons, commas, and varlists. It incorrectly adds newlines instead of spaces after colons in prefix commands, drops varlists and adds newlines after commas before options, and drops colons entirely in colon qualifiers. This results in syntactically invalid Stata code. For example:
- `capture frame this: that` becomes `capture frame this\nthat` (newline after colon instead of space)
- `frame bh: unab raw_vars_bh _all` becomes `frame bh\nunab raw_vars_bh _all` (newline after colon instead of space)
- `rename *, lower` becomes `rename\nlower` (varlist `*` dropped, newline after command instead of `, lower`)
- `unab merp: _all` becomes `unab merp _all` (colon dropped entirely)

These bugs make the AST formatter produce invalid output that cannot be executed by Stata.

## Glossary

- **AST_Formatter**: The PrettyPrinter class that converts AST nodes back to Stata source code
- **Prefix_Command**: A command that modifies the execution of another command (e.g., `capture`, `quietly`, `noisily`)
- **Frame_Prefix**: The `frame` command used as a prefix to execute commands in a specific data frame context
- **Prefix_Colon**: The colon (`:`) that separates a prefix command from the main command
- **Command_Name**: The name of a Stata command
- **Command_Arguments**: The arguments, options, and qualifiers that follow a command name
- **Token_Spacing**: The whitespace characters between adjacent tokens in source code
- **Varlist**: A list of variable names passed to a command
- **Option**: A command option, typically following a comma
- **Colon_Qualifier**: A colon used in commands like `unab` to separate the variable name from the expansion specification

## Requirements

### Requirement 1: Prevent Newlines After Prefix Colons

**User Story:** As a developer, I want the AST formatter to add a space (not a newline) after prefix command colons, so that the prefix and main command remain on the same line.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs `capture frame this: that` THEN the AST_Formatter SHALL produce `capture frame this: that` on a single line with a space after the colon
2. WHEN the AST_Formatter outputs `frame bh: unab raw_vars_bh _all` THEN the AST_Formatter SHALL produce `frame bh: unab raw_vars_bh _all` on a single line with a space after the colon
3. WHEN the AST_Formatter outputs any prefix command with a colon THEN the AST_Formatter SHALL NOT insert a newline after the colon

### Requirement 2: Preserve Colon Qualifiers

**User Story:** As a developer, I want the AST formatter to preserve colons used as qualifiers in commands, so that commands like `unab` maintain correct syntax.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs `unab merp: _all` THEN the AST_Formatter SHALL produce `unab merp: _all` with the colon preserved (not dropped)
2. WHEN the AST_Formatter outputs a command with a colon qualifier THEN the AST_Formatter SHALL include the colon in the output
3. WHEN the AST_Formatter outputs a command with a colon qualifier THEN the AST_Formatter SHALL add a space after the colon

### Requirement 3: Prevent Newlines After Commas and Preserve Varlists

**User Story:** As a developer, I want the AST formatter to keep options on the same line as the command and preserve varlists, so that option syntax is correct.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs `rename *, lower` THEN the AST_Formatter SHALL produce `rename *, lower` on a single line with the varlist `*` preserved
2. WHEN the AST_Formatter outputs a command with a varlist and options THEN the AST_Formatter SHALL include the varlist before the comma
3. WHEN the AST_Formatter outputs a command with options after a comma THEN the AST_Formatter SHALL add `, ` (comma followed by space) before the options without inserting a newline

### Requirement 4: Varlist Preservation

**User Story:** As a developer, I want the AST formatter to preserve varlists in commands, so that variable specifications are not lost.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs `rename *, lower` THEN the AST_Formatter SHALL include the varlist `*` in the output
2. WHEN the AST_Formatter outputs a command with a varlist THEN the AST_Formatter SHALL add a space between the command name and the varlist
3. WHEN the AST_Formatter outputs a varlist with multiple variables THEN the AST_Formatter SHALL add spaces between variable names

### Requirement 5: Frame Prefix Spacing

**User Story:** As a developer, I want the AST formatter to properly space frame prefix commands, so that frame context execution syntax is correct.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs `capture frame this: that` THEN the AST_Formatter SHALL add spaces between `capture`, `frame`, and `this`
2. WHEN the AST_Formatter outputs `frame bh: unab raw_vars_bh _all` THEN the AST_Formatter SHALL add a space between `frame` and `bh`
3. WHEN the AST_Formatter outputs a frame prefix with a colon THEN the AST_Formatter SHALL add a space after the colon before the main command

### Requirement 6: Statement Terminator Control

**User Story:** As a developer, I want the AST formatter to only add statement terminators at the end of complete statements, so that commands are not split across lines.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a prefix command with a colon THEN the AST_Formatter SHALL NOT add a statement terminator after the colon
2. WHEN the AST_Formatter outputs a command with options THEN the AST_Formatter SHALL NOT add a statement terminator after the comma
3. WHEN the AST_Formatter outputs a complete command THEN the AST_Formatter SHALL add a statement terminator only at the end of the command

### Requirement 7: Prefix Command Chain Spacing

**User Story:** As a developer, I want the AST formatter to handle complex prefix command chains correctly, so that nested prefix constructs maintain proper spacing.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs multiple prefix commands in sequence THEN the AST_Formatter SHALL add spaces between each prefix command
2. WHEN the AST_Formatter outputs `capture frame name: command` THEN the AST_Formatter SHALL produce `capture frame name: command` with spaces after `capture`, after `frame`, and after the colon on a single line
3. WHEN the AST_Formatter outputs prefix commands with subcommands and colons THEN the AST_Formatter SHALL maintain spacing at all token boundaries without inserting newlines

### Requirement 8: Round-Trip Consistency

**User Story:** As a developer, I want the AST formatter to produce output that can be parsed back to an equivalent AST, so that formatting is semantically preserving.

#### Acceptance Criteria

1. FOR ALL valid Stata commands with prefix commands, formatting then parsing SHALL produce an AST equivalent to the original
2. FOR ALL commands with colons, formatting then parsing SHALL preserve the colon's role (prefix separator vs qualifier)
3. FOR ALL commands with options, formatting then parsing SHALL preserve the option structure

### Requirement 9: Edge Case Handling

**User Story:** As a developer, I want the AST formatter to handle edge cases correctly, so that unusual but valid syntax is formatted properly.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a command with no arguments THEN the AST_Formatter SHALL NOT add trailing spaces
2. WHEN the AST_Formatter outputs a command with only options (no varlist) THEN the AST_Formatter SHALL still include the comma and space before options
3. WHEN the AST_Formatter outputs empty varlists or option lists THEN the AST_Formatter SHALL handle them without adding spurious spaces or newlines

### Requirement 10: Command Structure Recognition

**User Story:** As a developer, I want the AST formatter to correctly recognize command structure, so that spacing rules are applied appropriately.

#### Acceptance Criteria

1. WHEN the AST_Formatter processes a CommandNode with prefix field THEN the AST_Formatter SHALL recognize it as having prefix commands
2. WHEN the AST_Formatter processes prefix commands with colons THEN the AST_Formatter SHALL detect the colon and apply space (not newline) after it
3. WHEN the AST_Formatter processes commands with options THEN the AST_Formatter SHALL detect the comma and apply `, ` (comma space) before options on the same line

### Requirement 11: Wildcard Pattern Preservation

**User Story:** As a developer, I want the AST formatter to preserve wildcard patterns without adding spaces, so that variable name patterns remain syntactically correct.

#### Acceptance Criteria

1. WHEN the AST_Formatter outputs a varlist item containing a wildcard pattern (e.g., `var*`, `old?`, `_*`) THEN the AST_Formatter SHALL NOT insert a space between the variable name and the wildcard character
2. WHEN the AST_Formatter outputs adjacent varlist items where one ends with a wildcard THEN the AST_Formatter SHALL add a space between the items (e.g., `var* other` not `var*other`)
3. WHEN the AST_Formatter outputs a varlist with multiple wildcard patterns THEN the AST_Formatter SHALL preserve each pattern without internal spaces (e.g., `old* new*` not `old * new *`)
