# Requirements Document

## Introduction

The Stata LSP extension uses two separate sources for command knowledge: a comprehensive command database cache (generated from Stata's help system) and a manually-maintained TextMate grammar file for syntax highlighting. These sources are currently disconnected, leading to inconsistencies where commands recognized by the LSP are not highlighted in the editor. This feature will synchronize the TextMate grammar's command list with the command database to ensure consistent syntax highlighting.

## Glossary

- **TextMate_Grammar**: A JSON file (`stata.tmLanguage.json`) that defines syntax highlighting rules for VS Code. It uses regex patterns to identify and colorize language constructs.
- **Command_Database**: A JSON cache file containing Stata command metadata (names, syntax, descriptions, abbreviations) generated from Stata's help system.
- **Command_Pattern**: The regex pattern in the TextMate grammar that matches Stata commands for syntax highlighting.
- **Generator_Script**: A TypeScript script that reads the command database and produces an updated TextMate grammar file.
- **Min_Abbreviation**: The minimum number of characters required to uniquely identify a Stata command (e.g., "gen" for "generate").

## Requirements

### Requirement 1: Generate Command Pattern from Database

**User Story:** As a developer, I want the TextMate grammar's command list to be generated from the command database, so that syntax highlighting stays consistent with LSP command recognition.

#### Acceptance Criteria

1. WHEN the Generator_Script is executed, THE Generator_Script SHALL read all command names from the Command_Database cache file.
2. WHEN the Generator_Script reads commands, THE Generator_Script SHALL include both full command names and their minimum abbreviations in the generated pattern.
3. WHEN the Generator_Script generates the Command_Pattern, THE Generator_Script SHALL produce a valid regex that matches all commands at word boundaries.
4. WHEN the Generator_Script completes, THE Generator_Script SHALL write an updated TextMate_Grammar file with the new Command_Pattern.

### Requirement 2: Handle Command Abbreviations

**User Story:** As a Stata user, I want abbreviated commands to be highlighted correctly, so that my code is readable regardless of whether I use full or abbreviated command names.

#### Acceptance Criteria

1. WHEN a command has a Min_Abbreviation shorter than its full name, THE Generator_Script SHALL generate a regex pattern that matches all valid abbreviation lengths.
2. WHEN generating abbreviation patterns, THE Generator_Script SHALL use regex optional groups to match variable-length abbreviations (e.g., `gen(erate)?` for "generate").
3. WHEN a command's Min_Abbreviation equals its full name length, THE Generator_Script SHALL include only the full command name without optional groups.

### Requirement 3: Preserve Grammar Structure

**User Story:** As a developer, I want the generator to preserve the existing TextMate grammar structure, so that other syntax rules (comments, strings, macros) remain intact.

#### Acceptance Criteria

1. WHEN updating the TextMate_Grammar, THE Generator_Script SHALL preserve all non-command patterns (comments, strings, macros, keywords, numbers).
2. WHEN updating the TextMate_Grammar, THE Generator_Script SHALL only modify the commands pattern within the repository.
3. WHEN the TextMate_Grammar file does not exist, THE Generator_Script SHALL report an error and exit without creating a new file.

### Requirement 4: Categorize Common Commands

**User Story:** As a Stata user, I want common commands to have distinct highlighting by category, so that I can visually distinguish between data manipulation, statistics, and programming commands.

#### Acceptance Criteria

1. WHEN generating patterns, THE Generator_Script SHALL read category information from the builtin-commands module for commands that have categories defined.
2. WHEN a command has a category, THE Generator_Script SHALL place it in a category-specific pattern with an appropriate TextMate scope.
3. WHEN a command has no category (from database only), THE Generator_Script SHALL place it in the default commands pattern with scope `support.function.stata`.
4. THE Generator_Script SHALL map command categories to TextMate scopes as follows: data_manipulation → `support.function.data.stata`, statistics → `support.function.stats.stata`, regression → `support.function.stats.stata`, programming → `keyword.control.stata`, file_io → `support.function.io.stata`.

### Requirement 5: Handle Special Commands

**User Story:** As a developer, I want special commands like `mata` and `python` to be handled correctly, so that embedded language blocks are properly recognized.

#### Acceptance Criteria

1. WHEN generating command patterns, THE Generator_Script SHALL exclude commands that are handled specially by the lexer (mata, python, end).
2. WHEN a command is excluded from the commands pattern, THE Generator_Script SHALL ensure it is present in the keywords pattern.
3. THE Generator_Script SHALL add `mata` and `python` to the keywords pattern if not already present.
4. THE Generator_Script SHALL maintain a configurable list of excluded commands.

### Requirement 6: Validate Generated Output

**User Story:** As a developer, I want the generator to validate its output, so that I can be confident the generated grammar is syntactically correct.

#### Acceptance Criteria

1. WHEN the Generator_Script generates a regex pattern, THE Generator_Script SHALL validate that the pattern is syntactically correct.
2. IF the generated pattern is invalid, THEN THE Generator_Script SHALL report the error and exit without modifying the TextMate_Grammar file.
3. WHEN the Generator_Script completes successfully, THE Generator_Script SHALL report the number of commands included in the generated pattern.

### Requirement 7: Automatic Integration with Cache Generation

**User Story:** As a developer, I want the grammar to be automatically updated when I regenerate the command cache, so that I don't accidentally have mismatched AST and syntax highlighting.

#### Acceptance Criteria

1. WHEN the cache generation script completes successfully, THE script SHALL automatically trigger the grammar sync.
2. WHEN the grammar sync completes, THE script SHALL report the number of commands and categories updated.
3. IF the grammar sync fails, THEN THE script SHALL report the error but still complete the cache generation.
4. THE grammar sync module SHALL be importable and callable from other scripts for standalone use.
