# Implementation Plan: Frame Prefix Command Support

## Overview

This implementation adds proper support for the `frame` prefix command in the Stata LSP. The work involves updating the command database, fixing the cache, and enhancing the hover provider to recognize frame subcommands.

## Tasks

- [ ] 1. Add frame prefix command to builtin-commands.ts
  - Add `frame` to the `PREFIX_COMMANDS` array
  - Include all frame subcommands as options: create, change, copy, drop, rename, put, post, dir, reset
  - _Requirements: 1.4, 3.3_

- [ ] 2. Update command database cache
  - [ ] 2.1 Remove incorrect `frame` → `framework` abbreviation mappings from v18.json
    - Remove entries: `fra`, `fram`, `frame`, `framew`, `framewo`, `framewor` that map to `framework`
    - _Requirements: 1.3_
  - [ ] 2.2 Add `frame` command entry to v18.json cache
    - Add frame command with syntax and subcommand options
    - _Requirements: 1.4_

- [ ] 3. Enhance hover provider for subcommand recognition
  - [ ] 3.1 Add subcommand context detection in hover.ts
    - Implement `get_subcommand_context()` method to detect when cursor is on a subcommand
    - Check if the word before the current word is a prefix command with subcommands
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1_
  - [ ] 3.2 Add subcommand hover information
    - Implement `get_subcommand_hover()` method to return subcommand-specific hover info
    - Format hover content with full command name, syntax, and documentation link
    - _Requirements: 2.6, 3.2_
  - [ ] 3.3 Integrate subcommand hover into get_hover() flow
    - Add subcommand check before command lookup
    - Ensure subcommand interpretation takes precedence over standalone command
    - _Requirements: 2.6, 3.2_

- [ ] 4. Checkpoint - Verify basic functionality
  - Ensure frame command lookup returns frame, not framework
  - Ensure hover over frame subcommands works correctly
  - Ask the user if questions arise

- [ ] 5. Write property tests for frame command handling
  - [ ] 5.1 Write property test for frame command lookup
    - **Property 1: Frame Command Lookup Returns Frame, Not Framework**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
  - [ ] 5.2 Write property test for frame subcommand hover
    - **Property 2: Frame Subcommand Hover Returns Subcommand-Specific Info**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2**
  - [ ] 5.3 Write property test for parser AST correctness
    - **Property 3: Parser Produces Correct AST for Frame Commands**
    - **Validates: Requirements 4.1, 4.2**
  - [ ] 5.4 Write property test for existing prefix commands
    - **Property 4: Existing Prefix Commands Continue to Work**
    - **Validates: Requirements 4.3**

- [ ] 6. Write unit tests for frame command handling
  - [ ] 6.1 Write unit tests for command database
    - Test frame lookup returns frame command
    - Test framework is still accessible
    - Test frame command has expected subcommands
    - _Requirements: 1.3, 1.4_
  - [ ] 6.2 Write unit tests for hover provider
    - Test hover over `frame` returns frame info
    - Test hover over subcommands returns subcommand info
    - Test hover over standalone `create` returns create command info
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Run full test suite
  - Verify no regressions in existing functionality
  - Ensure all tests pass, ask the user if questions arise

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
