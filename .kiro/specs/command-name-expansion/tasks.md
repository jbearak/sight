# Implementation Plan: Command Name Expansion

## Overview

Wire the existing `CommandDatabase.expand_abbreviation()` to the parser so abbreviated commands are expanded in the `fullName` field.

## Tasks

- [ ] 1. Create command database factory
  - [ ] 1.1 Add `create_default_command_database()` function in `src/commands/index.ts`
    - Import and register all BUILTIN_COMMANDS
    - Export the factory function
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 2. Inject command database into parser
  - [ ] 2.1 Add `command_db` field to `StataParser` class
    - Accept optional `CommandDatabase` in constructor
    - Default to `create_default_command_database()` if not provided
    - _Requirements: 1.3_
  - [ ] 2.2 Add `expand_command_name()` helper method
    - Call `command_db.expand_abbreviation()`
    - Return canonical name if single match, original if ambiguous/unknown
    - _Requirements: 1.1, 1.4, 5.5_

- [ ] 3. Wire expansion to command parsing
  - [ ] 3.1 Update `parseCommand()` to set `fullName` using expansion
    - Call `expand_command_name()` for command name
    - _Requirements: 1.1, 1.2_
  - [ ] 3.2 Update prefix parsing to set `fullName` using expansion
    - Call `expand_command_name()` for prefix names (qui, cap, etc.)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ] 3.3 Write property test for abbreviation expansion
    - **Property 1: Abbreviation Expansion**
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1**
  - [ ] 3.4 Write property test for unknown commands unchanged
    - **Property 3: Unknown Commands Unchanged**
    - **Validates: Requirements 5.5**

- [ ] 4. Checkpoint - Ensure parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Verify round-trip preservation
  - [ ] 5.1 Confirm pretty printer uses `name` field (not `fullName`)
    - Check `printCommand()` and `printPrefix()` methods
    - _Requirements: 3.2_
  - [ ] 5.2 Write property test for round-trip preservation
    - **Property 2: Round-trip Preservation**
    - **Validates: Requirements 3.2, 3.4**

- [ ] 6. Update hover provider (optional enhancement)
  - [ ] 6.1 Show expansion in hover when name != fullName
    - Display "`reg` → `regress`" in hover tooltip
    - _Requirements: 4.1, 4.2_

- [ ] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The `CommandDatabase` and `builtin-commands.ts` already exist with 100+ commands
- Pretty printer already uses `name` field, so round-trip should work automatically
- Hover enhancement (task 6) is optional but improves UX
