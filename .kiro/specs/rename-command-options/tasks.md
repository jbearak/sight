# Implementation Plan: Rename Command Options

## Overview

This implementation adds hardcoded options for the `rename` command to `builtin-commands.ts`. The work is minimal since the existing infrastructure already supports hardcoded options as a fallback.

## Tasks

- [x] 1. Add rename command options to builtin-commands.ts
  - [x] 1.1 Update the rename command entry with options array
    - Add 7 options: addnumber, renumber, sort, dryrun, upper, lower, proper
    - Set hasArgument: true for addnumber and renumber
    - Set hasArgument: false for sort, dryrun, upper, lower, proper
    - Use appropriate minimum abbreviations
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1_

- [x] 2. Write integration test for rename option completions
  - [x] 2.1 Create integration test verifying rename options appear in completions
    - Create a document with "rename *," content
    - Verify completions include upper and lower options
    - _Requirements: 1.2_

- [x] 3. Checkpoint - Verify implementation
  - Ensure all tests pass, ask the user if questions arise.
