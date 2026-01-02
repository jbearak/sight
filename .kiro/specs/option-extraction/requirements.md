---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Requirements superseded by smcl-syntax-cleanup due to incompatible changes
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Superseded
Superseded By: smcl-syntax-cleanup
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
  - embedded-language-detection: [Related completion spec]
---

# Requirements Document

**⚠️ REQUIREMENTS SUPERSEDED**

The requirements in this specification have been superseded by incompatible changes implemented in smcl-syntax-cleanup. The approach evolved from extracting comprehensive documentation and descriptions from SMCL files to minimal extraction only, specifically removing syntax extraction and documentation parsing.

**Original requirements below are preserved for historical reference only.**

## Introduction

This feature adds option extraction to the Stata LSP command cache generation system. Currently, the cache generation extracts command names, syntax patterns, descriptions, and abbreviations from Stata's SMCL help files (.sthlp), but it does not extract command options. This omission means the LSP cannot provide option completions when users type a comma after a command (e.g., `regress y x, `).

Options in Stata help files are documented using SMCL markup patterns like `{opt d:etail}` (option with abbreviation) and `{opt level(#)}` (option with argument). This feature will parse these patterns and include option metadata in the command cache.

Note: Some sthlp files document multiple commands (e.g., `generate.sthlp` documents both `generate` and `replace`). The extractor must handle these multi-command files and associate options with the correct commands.

## Glossary

- **SMCL**: Stata Markup and Control Language - the markup format used in Stata help files
- **sthlp**: File extension for Stata help files containing SMCL content
- **Option**: A command modifier that follows a comma in Stata syntax (e.g., `detail` in `summarize, detail`)
- **Option_Abbreviation**: The minimum characters needed to uniquely identify an option (e.g., `d` for `detail`)
- **Option_Argument**: A value that some options accept (e.g., `#` in `level(#)` or `varname` in `absorb(varname)`)
- **Extractor**: The module that parses SMCL content to extract command and option metadata
- **Command_Cache**: The JSON file containing pre-extracted command metadata for fast LSP startup
- **synopt**: SMCL tag used to document options in a syntax table
- **Multi_Command_File**: A sthlp file that documents more than one command (e.g., generate.sthlp documents both `generate` and `replace`)

## Requirements

### Requirement 1: Parse Option Patterns from SMCL

**User Story:** As an LSP developer, I want the extractor to parse option patterns from SMCL help files, so that option metadata is available for completion suggestions.

#### Acceptance Criteria

1. WHEN the Extractor encounters `{opt abbrev:rest}` pattern, THE Extractor SHALL extract the full option name as `abbrevrest` and minimum abbreviation length as the length of `abbrev`
2. WHEN the Extractor encounters `{opt name}` pattern without colon, THE Extractor SHALL extract the option name with minimum abbreviation equal to full name length
3. WHEN the Extractor encounters `{opt name(argtype)}` pattern, THE Extractor SHALL extract the option name and mark it as having an argument of type `argtype`
4. WHEN the Extractor encounters `{opth name(argtype)}` pattern, THE Extractor SHALL extract the option name and mark it as having an argument (opth indicates hyperlinked argument type)
5. WHEN the Extractor encounters `{synopt:{opt ...}}` wrapper, THE Extractor SHALL extract the option from the inner `{opt}` tag
6. WHEN the Extractor encounters option description text after the option tag, THE Extractor SHALL extract the description up to `{p_end}` or end of line

### Requirement 2: Extract Options Section from Help Files

**User Story:** As an LSP developer, I want the extractor to locate and parse the Options section of help files, so that only actual command options are extracted (not stored results or other synopt uses).

#### Acceptance Criteria

1. WHEN parsing a help file, THE Extractor SHALL locate the Options section using `{marker options}` or `{title:Options}` markers
2. WHEN an Options section is found, THE Extractor SHALL extract options only from content between the Options marker and the next section marker
3. WHEN no Options section is found, THE Extractor SHALL return an empty options array for that command
4. WHEN the Options section contains `{dlgtab:...}` subsection markers, THE Extractor SHALL continue extracting options across all subsections

### Requirement 3: Handle Multi-Command Help Files

**User Story:** As an LSP developer, I want the extractor to correctly handle help files that document multiple commands, so that options are associated with the correct commands.

#### Acceptance Criteria

1. WHEN a help file documents multiple commands, THE Extractor SHALL identify all commands in the file
2. WHEN options are shared across all commands in a multi-command file, THE Extractor SHALL associate those options with each command
3. WHEN a help file has command-specific option sections, THE Extractor SHALL associate options with the appropriate command
4. WHEN extracting from a multi-command file, THE Extractor SHALL return an array of commands each with their own options array

### Requirement 4: Store Options in Command Cache

**User Story:** As an LSP developer, I want options stored in the command cache, so that they are available at LSP runtime without re-parsing help files.

#### Acceptance Criteria

1. THE Command_Cache format SHALL include an `options` array field for each command
2. WHEN storing an option, THE Command_Cache SHALL include: name, min_abbreviation (number), description, and has_argument (boolean)
3. WHEN loading the cache, THE Command_Database SHALL make options available through the existing provider interface
4. WHEN converting cache format to provider format, THE Command_Database SHALL map cache option fields to the existing `OptionInfo` interface

### Requirement 5: Handle Edge Cases in Option Parsing

**User Story:** As an LSP developer, I want the extractor to handle edge cases gracefully, so that malformed or unusual option patterns don't cause extraction failures.

#### Acceptance Criteria

1. WHEN an option pattern is malformed or incomplete, THE Extractor SHALL skip that option and continue processing
2. WHEN duplicate option names are encountered in the same command, THE Extractor SHALL keep only the first occurrence
3. WHEN option description contains SMCL tags, THE Extractor SHALL strip tags and return plain text description
4. WHEN option description spans multiple lines, THE Extractor SHALL concatenate lines and normalize whitespace
5. WHEN an option name contains only the abbreviation part (no colon), THE Extractor SHALL treat the full text as both name and minimum abbreviation

### Requirement 6: Clean Cache Format (No Backward Compatibility)

**User Story:** As an LSP developer, I want a clean cache format that includes options, so that the codebase is simple and maintainable.

#### Acceptance Criteria

1. THE Command_Cache format SHALL require the options field (not optional)
2. THE Command_Database SHALL expect all caches to include options
3. WHEN regenerating caches, THE Cache_Generator SHALL produce the new format with options included
4. THE old cache format without options SHALL NOT be supported

### Requirement 7: Integrate Hardcoded Command Options

**User Story:** As an LSP developer, I want hardcoded command options from builtin-commands.ts to be used when SMCL extraction doesn't provide options, so that fundamental commands always have option completions available.

#### Acceptance Criteria

1. WHEN the Cache_Generator adds a fundamental command from BUILTIN_COMMANDS, THE Cache_Generator SHALL include the options from BUILTIN_COMMANDS
2. WHEN SMCL extraction provides options for a command, THE Cache_Generator SHALL prefer the SMCL-extracted options over hardcoded options
3. WHEN SMCL extraction provides no options but BUILTIN_COMMANDS has options, THE Cache_Generator SHALL use the BUILTIN_COMMANDS options
4. THE Cache_Generator SHALL convert BUILTIN_COMMANDS OptionInfo format (minAbbreviation as string) to cache format (min_abbreviation as number)

### Requirement 8: Option Extraction Round-Trip

**User Story:** As an LSP developer, I want to verify that extracted options can be serialized and deserialized correctly, so that the cache accurately represents the source data.

#### Acceptance Criteria

1. FOR ALL valid option patterns, extracting then serializing then deserializing SHALL produce equivalent option metadata
2. FOR ALL commands with options, the extracted option count SHALL be greater than zero when the help file documents options
