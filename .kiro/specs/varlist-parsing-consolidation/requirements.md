# Requirements Document

## Introduction

This document specifies requirements for consolidating the duplicated varlist/option parsing logic between `parseCommand` and `parseCommandBody` methods in the Stata parser. Currently, `parseCommand` contains ~100 lines of varlist, expression, qualifier, and option parsing code that duplicates the implementation in `parseCommandBody`. The goal is to have `parseCommand` delegate to `parseCommandBody` for standard commands, following the pattern already used by `parseFramePrefixedCommand`.

## Glossary

- **Parser**: The component (`src/parser/index.ts`) that builds an AST from tokens
- **parseCommand**: The main method for parsing Stata commands (~lines 760-970)
- **parseCommandBody**: A helper method for parsing command body including varlist, expression, qualifiers, and options (~lines 1060-1190)
- **parseFramePrefixedCommand**: A method that already delegates to parseCommandBody for frame-prefixed commands
- **Varlist**: A list of variable names, expressions, or parenthesized groups in a Stata command
- **CommandNode**: AST node representing a parsed command

## Requirements

### Requirement 1: Eliminate Duplicated Varlist/Option Parsing Logic

**User Story:** As a maintainer, I want varlist and option parsing logic to exist in a single location, so that bug fixes and enhancements only need to be made once.

#### Acceptance Criteria

1. WHEN `parseCommand` parses a standard command (not unab, args, or frame prefix), THE Parser SHALL delegate to `parseCommandBody` for varlist/option parsing
2. WHEN `parseCommand` handles special commands (unab, args), THE Parser SHALL continue using their dedicated parsing methods
3. WHEN `parseCommand` handles frame prefix syntax, THE Parser SHALL continue delegating to `parseFramePrefixedCommand`
4. THE Parser SHALL produce identical AST output for the same input before and after refactoring

### Requirement 2: Preserve All Existing Parsing Behavior

**User Story:** As a user, I want my Stata code to parse exactly the same way after the refactoring, so that my existing workflows are not disrupted.

#### Acceptance Criteria

1. FOR ALL valid Stata commands, parsing SHALL produce identical AST structures before and after refactoring
2. WHEN a command contains parenthesized groups in its varlist, THE Parser SHALL parse them correctly
3. WHEN a command contains wildcard operators (* or ?) in varlist position, THE Parser SHALL include them as valid tokens
4. WHEN a file command is parsed, THE Parser SHALL coalesce path tokens correctly
