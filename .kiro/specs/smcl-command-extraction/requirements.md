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
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

**⚠️ REQUIREMENTS SUPERSEDED**

The requirements in this specification have been superseded by incompatible changes implemented in smcl-syntax-cleanup. The approach evolved from extracting comprehensive command syntax patterns and documentation from SMCL files to minimal extraction only, specifically removing syntax extraction and documentation parsing.

**Original requirements below are preserved for historical reference only.**

## Introduction

This document specifies requirements for properly extracting Stata command names from SMCL help files. The current cache generator incorrectly uses help file names as command names, but Stata help files often document multiple commands (e.g., `generate.sthlp` documents both `generate` and `replace`). This leads to missing commands in the database.

## Glossary

- **SMCL**: Stata Markup and Control Language - the markup format used in Stata help files
- **Help_File**: A `.sthlp` file containing SMCL-formatted documentation for one or more commands
- **Command_Name**: The actual name of a Stata command as typed by users
- **Abbreviation**: The minimum prefix that uniquely identifies a command (e.g., `gen` for `generate`)
- **Cache_Generator**: The script that extracts command metadata from help files into JSON cache
- **Viewerdialog**: SMCL tag `{viewerdialog}` that indicates a command has a dialog interface

## Requirements

### Requirement 1: Multi-Command Help File Parsing

**User Story:** As a developer, I want the cache generator to extract all commands documented in a help file, so that commands like `replace` (documented in `generate.sthlp`) are included in the database.

#### Acceptance Criteria

1. WHEN a Help_File contains multiple `{viewerdialog}` tags, THE Cache_Generator SHALL extract each Command_Name
2. WHEN a Help_File Syntax section contains multiple `{cmd:}` or `{cmdab:}` tags, THE Cache_Generator SHALL extract each Command_Name
3. THE Cache_Generator SHALL associate each extracted Command_Name with the Help_File description and syntax
4. WHEN parsing `generate.sthlp`, THE Cache_Generator SHALL extract both `generate` and `replace` commands

### Requirement 2: Abbreviation Pattern Extraction

**User Story:** As a developer, I want the cache generator to correctly extract command abbreviations from SMCL markup, so that abbreviation expansion works correctly.

#### Acceptance Criteria

1. WHEN a Command_Name uses `{cmdab:abbr:full}` syntax, THE Cache_Generator SHALL extract the minimum Abbreviation
2. WHEN a Command_Name uses `{opt abbr:full}` syntax, THE Cache_Generator SHALL extract the minimum Abbreviation
3. WHEN a Command_Name uses `{cmd:cmdname}` without abbreviation syntax, THE Cache_Generator SHALL use the full name as minimum Abbreviation
4. THE Cache_Generator SHALL extract Abbreviation lengths that match Stata's documented minimum abbreviation

### Requirement 3: Syntax Section Parsing

**User Story:** As a developer, I want the cache generator to extract command syntax patterns from the Syntax section, so that users see accurate syntax help.

#### Acceptance Criteria

1. THE Cache_Generator SHALL locate the `{marker syntax}` or `{title:Syntax}` section in Help_Files
2. WHEN multiple command syntaxes exist in the Syntax section, THE Cache_Generator SHALL extract each syntax pattern
3. THE Cache_Generator SHALL preserve the command structure including required and optional arguments in extracted syntax
4. WHEN a syntax line contains `{ifin}`, `{dtype}`, or similar SMCL placeholders, THE Cache_Generator SHALL preserve them

### Requirement 4: Command-to-Help-File Mapping

**User Story:** As a developer, I want to know which help file documents each command, so that hover providers can show the correct help content.

#### Acceptance Criteria

1. THE Cache_Generator SHALL store the source Help_File path for each extracted Command_Name
2. WHEN a Command_Name is documented in multiple Help_Files, THE Cache_Generator SHALL use the primary Help_File
3. THE Cache_Generator SHALL produce mappings that enable the hover provider to load full help content on demand

### Requirement 5: Legacy Command Coverage

**User Story:** As a developer, I want the new cache to include all commands from the legacy database, so that no functionality is lost.

#### Acceptance Criteria

1. THE Cache_Generator output SHALL be a superset of the legacy BUILTIN_COMMANDS
2. WHEN a legacy Command_Name is not found in Help_Files, THE Cache_Generator SHALL log a warning
3. THE Cache_Generator SHALL produce output where all 148 legacy commands exist in the generated cache

### Requirement 6: SMCL Tag Recognition

**User Story:** As a developer, I want the parser to recognize all relevant SMCL tags for command extraction, so that no commands are missed.

#### Acceptance Criteria

1. THE Cache_Generator SHALL recognize `{cmd:name}` SMCL tags for Command_Names
2. THE Cache_Generator SHALL recognize `{cmdab:abbr:full}` SMCL tags for abbreviated commands
3. THE Cache_Generator SHALL recognize `{opt abbr:full}` SMCL tags for options that are also commands
4. THE Cache_Generator SHALL recognize `{viewerdialog "name" "dialog name"}` SMCL tags for Viewerdialog-enabled commands
5. THE Cache_Generator SHALL recognize `{p2col:{bf:[X] name}}` SMCL title patterns for primary commands

### Requirement 7: Fundamental Command Fallback

**User Story:** As a developer, I want fundamental Stata commands to always be in the cache, so that users always get completions for essential commands even if help file parsing has gaps.

#### Acceptance Criteria

1. THE Cache_Generator SHALL include a hardcoded list of fundamental commands as a fallback
2. THE Cache_Generator SHALL include programming constructs in the fundamental commands list: `local`, `global`, `if`, `else`, `while`, `foreach`, `forvalues`
3. THE Cache_Generator SHALL include prefix commands in the fundamental commands list: `by`, `bysort`, `quietly`, `noisily`, `capture`
4. THE Cache_Generator SHALL include core data manipulation commands in the fundamental commands list: `generate`, `replace`, `drop`, `keep`, `sort`
5. WHEN a fundamental Command_Name is not extracted from Help_Files, THE Cache_Generator SHALL add it from the fallback list
6. THE Cache_Generator SHALL use metadata from the legacy BUILTIN_COMMANDS for fallback commands when available
