# Implementation Plan: SMCL Subcommand Extraction Bug Fix

## Overview

This plan implements context-aware subcommand detection in the SMCL extractor to prevent subcommands from being extracted as standalone commands. The fix modifies `extract_cmdab_patterns()` to check for preceding prefix commands.

## Tasks

- [x] 1. Add PREFIX_COMMANDS constant and helper function
  - Add `PREFIX_COMMANDS` Set with the 15 known prefix commands to `src/command-database/smcl-extractor.ts`
  - Add `is_preceded_by_prefix_command()` helper function that checks if a match index is preceded by `{cmd:PREFIX}` pattern
  - Export `PREFIX_COMMANDS` for testing
  - _Requirements: 1.2_

- [x] 2. Modify extract_cmdab_patterns() for context awareness
  - [x] 2.1 Update the cmdab extraction loop to check preceding context
    - Before adding a command to results, call `is_preceded_by_prefix_command()`
    - Skip extraction if the pattern is preceded by a known prefix command
    - _Requirements: 1.1, 1.3_

  - [x] 2.2 Write property test for subcommand suppression
    - **Property 1: Subcommand Suppression**
    - Generate random prefix commands from PREFIX_COMMANDS and random subcommand names
    - Verify `{cmd:PREFIX} {cmdab:X:Y}` patterns do not extract `X+Y`
    - **Validates: Requirements 1.1**

  - [x] 2.3 Write property test for standalone command preservation
    - **Property 2: Standalone Command Preservation**
    - Generate random `{cmdab:X:Y}` patterns without preceding prefix commands
    - Verify they are extracted with correct min_abbreviation
    - **Validates: Requirements 1.3, 3.1**

- [x] 3. Remove "framework" from NON_COMMAND_TOKENS blocklist
  - Remove the "framework" entry from the `NON_COMMAND_TOKENS` Set
  - The subcommand detection now handles this case structurally
  - _Requirements: 2.1_

- [x] 4. Checkpoint - Verify core functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add unit tests for specific cases
  - [x] 5.1 Add unit test for sem_estat_framework.sthlp extraction
    - Create mock content matching sem_estat_framework.sthlp syntax section
    - Verify "framework" is not extracted as a standalone command
    - Verify "estat" is still extracted if present
    - _Requirements: 2.2, 2.3_

  - [x] 5.2 Add unit test for PREFIX_COMMANDS completeness
    - Verify all 15 prefix commands are in the set
    - _Requirements: 1.2_

  - [x] 5.3 Add unit test for whitespace handling
    - Test various whitespace patterns between `{cmd:PREFIX}` and `{cmdab:...}`
    - Verify newlines, multiple spaces, and tabs are handled
    - _Requirements: 1.1_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive testing
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The fix is backward-compatible - no changes to function signatures or return types
