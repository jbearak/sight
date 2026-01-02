# Implementation Plan: SMCL Syntax Cleanup

## Overview

Remove the problematic `syntax` field from command metadata and update the completion provider to display options instead.

## Tasks

- [x] 1. Update type definitions to make syntax optional
  - [x] 1.1 Update `src/command-database/types.ts` - make `syntax` optional in `CommandInfo`
    - Change `syntax: string` to `syntax?: string`
    - _Requirements: 4.1, 4.2_
  - [x] 1.2 Update `src/types/index.ts` - make `syntax` optional in provider `CommandInfo`
    - Change `syntax: string` to `syntax?: string`
    - _Requirements: 4.1_

- [x] 2. Update SMCL extractor to stop extracting syntax
  - [x] 2.1 Update `src/command-database/smcl-extractor.ts`
    - Make `syntax` optional in `ExtractedCommand` interface
    - Remove `extract_syntax_for_command` entirely
    - Update extraction functions to not populate syntax field
    - _Requirements: 1.1, 1.3_

- [x] 3. Update command database to handle optional syntax
  - [x] 3.1 Update `src/command-database/index.ts`
    - Update `to_provider_command_info` to handle missing syntax
    - Update `register` method to handle optional syntax
    - _Requirements: 4.3_

- [x] 4. Update completion provider to show options instead of syntax
  - [x] 4.1 Update `src/providers/completion.ts`
    - Modify `create_command_completion` to build detail from options list
    - Remove syntax from documentation, use help link instead
    - Modify `create_abbreviation_completion` similarly
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 4.2 Write property test for completion detail shows options
    - **Property 1: Completion Detail Shows Options Not Syntax**
    - **Validates: Requirements 2.2, 2.3**

- [x] 5. Update cache generation script
  - [x] 5.1 Update `scripts/generate-cache.ts`
    - Remove syntax field from generated cache entries
    - Update fundamental commands fallback to not include syntax
    - _Requirements: 1.2_

- [x] 6. Update builtin-commands.ts
  - [x] 6.1 Update `src/commands/builtin-commands.ts`
    - Make syntax parameter optional in `builtin_command` helper
    - Update existing command definitions to not require syntax
    - _Requirements: 4.3_

- [x] 7. Regenerate command cache
  - [x] 7.1 Regenerate the v18.json cache file
    - Run `bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json --force`
    - Verify cache no longer contains syntax fields
    - _Requirements: 1.2_

- [x] 8. Checkpoint - Ensure all tests pass
  - Run `bun test` to verify no regressions
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The hover provider doesn't need changes since it already doesn't display syntax
- Backward compatibility is maintained by making syntax optional (old caches still work)
