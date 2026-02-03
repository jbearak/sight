# Requirements Document

## Introduction

This document specifies the requirements for fixing the SMCL option extraction bug where options using hyperlinked argument syntax are not being extracted. The SMCL parser in `src/command-database/smcl-extractor.ts` fails to extract options that use SMCL's hyperlinked argument syntax like `{opth vce:(regress##vcetype:vcetype)}`, causing many command options to be missing from the command database.

## Glossary

- **SMCL**: Stata Markup Control Language - the markup language used in Stata help files
- **Option_Parser**: The `parse_option_pattern()` function in `smcl-extractor.ts` that extracts option metadata from SMCL patterns
- **Hyperlinked_Argument**: An argument type in SMCL that includes a help link reference in the format `(topic:display)` where `topic` is the help topic and `display` is the displayed text
- **Option_Pattern**: An SMCL tag like `{opt}` or `{opth}` that defines a command option
- **Argument_Type**: The type specification inside parentheses that indicates what kind of value an option accepts

## Requirements

### Requirement 1: Parse Hyperlinked Option Arguments

**User Story:** As a developer using the LSP, I want the command database to include all options from Stata help files, so that I get complete autocomplete suggestions for command options.

#### Acceptance Criteria

1. WHEN the Option_Parser encounters `{opth name:(topic:display)}` pattern, THE Option_Parser SHALL extract the option with name equal to "name" and has_argument set to true
2. WHEN the Option_Parser encounters `{opth abbrev:rest:(topic:display)}` pattern, THE Option_Parser SHALL extract the option with name equal to "abbrev" + "rest", min_abbreviation equal to length of "abbrev", and has_argument set to true
3. WHEN the Option_Parser encounters `{opt name:(topic:display)}` pattern, THE Option_Parser SHALL extract the option with name equal to "name" and has_argument set to true
4. WHEN the Option_Parser encounters `{opt abbrev:rest:(topic:display)}` pattern, THE Option_Parser SHALL extract the option with name equal to "abbrev" + "rest", min_abbreviation equal to length of "abbrev", and has_argument set to true

### Requirement 2: Preserve Existing Pattern Support

**User Story:** As a developer, I want existing option extraction patterns to continue working, so that the fix doesn't break any currently working functionality.

#### Acceptance Criteria

1. WHEN the Option_Parser encounters `{opt name}` pattern, THE Option_Parser SHALL continue to extract the option correctly
2. WHEN the Option_Parser encounters `{opt abbrev:rest}` pattern, THE Option_Parser SHALL continue to extract the option correctly
3. WHEN the Option_Parser encounters `{opt name(argtype)}` pattern, THE Option_Parser SHALL continue to extract the option correctly
4. WHEN the Option_Parser encounters `{opt abbrev:rest(argtype)}` pattern, THE Option_Parser SHALL continue to extract the option correctly
5. WHEN the Option_Parser encounters `{opth name(argtype)}` pattern, THE Option_Parser SHALL continue to extract the option correctly
6. WHEN the Option_Parser encounters `{opth abbrev:rest(argtype)}` pattern, THE Option_Parser SHALL continue to extract the option correctly

### Requirement 3: Extract VCE Option from Regress

**User Story:** As a Stata developer, I want the `vce` option to appear in autocomplete for the `regress` command, so that I can easily discover and use variance-covariance estimation options.

#### Acceptance Criteria

1. WHEN extracting options from `regress.sthlp`, THE Option_Parser SHALL extract the `vce` option
2. WHEN the `vce` option is extracted, THE Option_Parser SHALL set has_argument to true
3. WHEN regenerating the command cache, THE cache SHALL include the `vce` option for the `regress` command

### Requirement 4: Handle Complex Hyperlinked Arguments

**User Story:** As a developer, I want the parser to handle various hyperlinked argument formats, so that all options are extracted regardless of the specific help link format used.

#### Acceptance Criteria

1. WHEN the argument contains a simple topic reference like `(varlist:groupvar)`, THE Option_Parser SHALL extract the option correctly
2. WHEN the argument contains a section reference like `(regress##vcetype:vcetype)`, THE Option_Parser SHALL extract the option correctly
3. WHEN the argument contains nested colons in the topic like `(exp_list:exp)`, THE Option_Parser SHALL extract the option correctly
