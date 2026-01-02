# Implementation Plan: SMCL Command Extraction

## Overview

This plan rewrites the cache generator to properly extract command names from SMCL help files. The current generator incorrectly uses file names as command names, missing commands like `replace` (in `generate.sthlp`) and `local`/`global` (in `macro.sthlp`).

## Tasks

- [x] 1. Create SMCL command extractor module
  - [x] 1.1 Create `src/command-database/smcl-extractor.ts` with interfaces and patterns
    - Define `ExtractedCommand` interface with name, min_abbreviation, syntax, description, source_file, is_primary
    - Define `ExtractionResult` interface with commands array and warnings array
    - Define regex patterns: VIEWERDIALOG_PATTERN, CMDAB_PATTERN, CMD_PATTERN, OPT_PATTERN, TITLE_PATTERN
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 1.2 Implement `extract_viewerdialog_commands()` function
    - Parse `{viewerdialog "name" "dialog name"}` patterns using VIEWERDIALOG_PATTERN
    - Return array of command names found
    - _Requirements: 1.1_
  - [x] 1.3 Implement `extract_cmdab_patterns()` function
    - Parse `{cmdab:abbr:full}` patterns to extract command name and min abbreviation
    - Parse `{opt abbr:full}` patterns similarly
    - Return array of {name, min_abbrev} objects
    - _Requirements: 2.1, 2.2, 2.4_
  - [x] 1.4 Implement `extract_syntax_section()` function
    - Locate `{marker syntax}` or `{title:Syntax}` section in SMCL content
    - Extract content until next `{marker}` or `{title:}` tag
    - Return the syntax section content as string
    - _Requirements: 3.1, 3.2_

- [x] 2. Implement multi-command extraction
  - [x] 2.1 Implement `extract_commands_from_file()` function
    - Read full file content (not just first 1KB)
    - Call extract_viewerdialog_commands() to find dialog commands
    - Call extract_syntax_section() then parse for {cmd:} and {cmdab:} patterns
    - Extract primary command from title using TITLE_PATTERN
    - Deduplicate command names using Set
    - Build ExtractedCommand entries with source_file and is_primary flags
    - Return ExtractionResult with commands and warnings
    - _Requirements: 1.2, 1.3, 4.1_
  - [x] 2.2 Write unit tests for known multi-command files
    - Test `generate.sthlp` → `generate`, `replace`
    - Test `drop.sthlp` → `drop`, `keep`
    - Test `macro.sthlp` → `local`, `global`, `tempvar`, `tempname`, `tempfile`
    - Test `by.sthlp` → `by`, `bysort`
    - Test `quietly.sthlp` → `quietly`, `noisily`
    - Test `if.sthlp` → `if`, `else`
    - Test `do.sthlp` → `do`, `run`
    - Test `preserve.sthlp` → `preserve`, `restore`
    - Test `encode.sthlp` → `encode`, `decode`
    - Test `destring.sthlp` → `destring`, `tostring`
    - Test `correlate.sthlp` → `correlate`, `pwcorr`
    - Test `cd.sthlp` → `cd`, `pwd`
    - Test `log.sthlp` → `log`, `cmdlog`
    - Test `sysdir.sthlp` → `sysdir`, `adopath`
    - _Requirements: 1.4, 5.1_

- [x] 3. Update cache generator
  - [x] 3.1 Refactor `scripts/generate-cache.ts` to use new extractor
    - Import extract_commands_from_file from smcl-extractor
    - Replace extract_command_name() with extract_commands_from_file()
    - Update extract_minimal_metadata() to return array of [name, CommandInfo] tuples
    - Handle multiple commands per file in the batch processing loop
    - _Requirements: 1.2, 1.3_
  - [x] 3.2 Add fundamental command fallback
    - Define FUNDAMENTAL_COMMANDS constant with core Stata commands:
      - Programming: local, global, tempvar, tempname, tempfile, if, else, while, foreach, forvalues
      - Prefix: by, bysort, quietly, noisily, capture
      - Data: generate, replace, drop, keep, preserve, restore, sort, gsort
      - File: do, run, use, save, clear
    - After SMCL extraction, check for missing fundamental commands
    - Add missing commands using metadata from BUILTIN_COMMANDS when available
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [x] 3.3 Add legacy command validation
    - Import BUILTIN_COMMANDS from src/commands/builtin-commands
    - After extraction, compare against all legacy command names
    - Log warnings for any missing legacy commands
    - _Requirements: 5.1, 5.2_

- [x] 4. Regenerate cache with new extractor
  - [x] 4.1 Run updated cache generator
    - Execute: `bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json`
    - Verify output contains `replace`, `keep`, `local`, `global`, `bysort`, `noisily`, etc.
    - _Requirements: 1.4, 5.1_
  - [x] 4.2 Verify legacy superset property
    - Run: `bun test tests/integration/command-database-superset.test.ts`
    - All 148 legacy commands should be present in the new cache
    - _Requirements: 5.1, 5.3_

- [x] 5. Add property tests for extraction
  - [x] 5.1 Write property test for abbreviation extraction
    - Generate random `{cmdab:X:Y}` patterns where X is 1-5 chars and Y is 1-10 chars
    - Verify extracted min_abbreviation equals length of X
    - **Property 2: Abbreviation Correctness**
    - **Validates: Requirements 2.1, 2.4**
  - [x] 5.2 Write property test for multi-command extraction
    - Generate mock SMCL content with N viewerdialog tags (N = 1-5)
    - Verify extractor returns at least N distinct command names
    - **Property 1: Multi-Command Extraction**
    - **Validates: Requirements 1.1, 1.2**

- [x] 6. Checkpoint - Verify all tests pass
  - Run `bun test` and ensure all tests pass
  - Verify superset validation test passes
  - Verify cache has all legacy commands plus newly extracted commands

## Notes

- The extractor must handle edge cases like commands without syntax sections
- Some commands may be documented in multiple files; use the primary file
- The `{opt}` tag is used for both options and commands; context determines which
- Property tests should use actual SMCL content from Stata help files when possible
- The existing `tests/integration/command-database-superset.test.ts` already validates the superset property
