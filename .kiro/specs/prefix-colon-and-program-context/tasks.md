# Implementation Plan: Prefix Colon and Program Context Fixes

## Overview

This implementation fixes three related parser bugs by modifying the statement dispatch logic to check for prefix commands before checking for statement keywords, and by extending colon handling to all prefix commands.

## Tasks

- [x] 1. Modify parseStatement to check for prefix commands first
  - [x] 1.1 Add prefix command check before statement keyword checks
    - In `parseStatement()`, before checking `checkWord('program')`, check if current token is a prefix command
    - If it is a prefix command, delegate to `parseCommand()` instead of checking for statement keywords
    - This ensures `capture program drop` is parsed as a prefixed command, not a program definition
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 1.2 Write unit tests for prefix commands followed by statement keywords
    - Test `capture program drop myprogram` parses without error
    - Test `quietly program drop myprogram` parses without error
    - Test `capture program define myprogram` parses as prefixed command
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 2. Extend colon handling to all prefix commands
  - [x] 2.1 Modify parseCommand to consume colon after any prefix command
    - In the prefix command parsing loop, after adding a prefix to the list, check for COLON token
    - If COLON is present, consume it (currently only done for `by` prefix)
    - This enables `quietly:`, `capture:`, `noisily:` syntax
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Write unit tests for prefix commands with colons
    - Test `quietly: display "hello"` parses without error
    - Test `capture: gen x = 1` parses without error
    - Test `noisily: display "test"` parses without error
    - Test abbreviated forms: `qui:`, `cap:`, `noi:`
    - Test chained prefixes: `quietly: capture: display "test"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 3. Checkpoint - Verify basic functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Write property-based tests
  - [x] 4.1 Write property test for prefix commands with colons
    - **Property 1: Prefix commands with colons parse without errors**
    - Generate random prefix commands with colons followed by valid commands
    - Verify parsing produces no errors and correctly identifies prefix and command
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x] 4.2 Write property test for statement keywords after command names
    - **Property 2: Statement keywords after command names are treated as identifiers**
    - Generate random commands with statement keywords as arguments
    - Verify parsing does not interpret keywords as statement starters
    - **Validates: Requirements 2.2, 2.5, 2.6**

  - [x] 4.3 Write property test for prefix commands followed by statement keywords
    - **Property 3: Prefix commands followed by statement keywords parse as regular commands**
    - Generate random prefix commands followed by statement keywords
    - Verify parsing treats keyword as command name, not statement starter
    - **Validates: Requirements 3.3, 3.5**

- [x] 5. Add regression tests for specific bug cases
  - [x] 5.1 Add test for getmata with program in variable list
    - Test `getmata (program survey level datasig)=aww_datasigs` parses without error
    - Verify no "Expected define after program" error
    - _Requirements: 2.4_

  - [x] 5.2 Add test for gen/replace with program as variable name
    - Test `gen program = 1` parses without error
    - Test `replace program = 2` parses without error
    - _Requirements: 2.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
