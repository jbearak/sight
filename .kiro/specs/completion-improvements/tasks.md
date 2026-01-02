# Implementation Plan: Completion Improvements

## Overview

This plan implements fixes for duplicate commands, removes descriptions from the cache, reduces completion trigger aggressiveness, and adds priority-based command ordering.

## Tasks

- [x] 1. Update trigger characters in LSP server
  - [x] 1.1 Modify `create_initialize_handler` in `src/server-handlers.ts`
    - Change triggerCharacters from `['.', ':', ',', '\n', '\`', '"']` to `[':', '\`', '"', '$']`
    - _Requirements: 3.6, 6.1, 6.2_
  - [x] 1.2 Update LSP lifecycle test to expect new trigger characters
    - _Requirements: 6.1, 6.2_

- [x] 2. Create priority tier constants
  - [x] 2.1 Create `src/command-database/priority-tiers.ts`
    - Define `TIER_1_COMMANDS` Set with all Tier 1 command names
    - Define `TIER_2_COMMANDS` Set with all Tier 2 command names
    - Export `get_command_priority(name: string): 1 | 2 | 3` function
    - _Requirements: 5.3_
  - [x] 2.2 Write unit tests for priority tier assignment
    - Test specific commands are in correct tiers
    - Test unknown commands default to Tier 3
    - _Requirements: 5.3_

- [x] 3. Update command database types and loading
  - [x] 3.1 Update `src/command-database/types.ts`
    - Remove `description` field from `CommandInfo`
    - Remove `description` field from `OptionInfo`
    - Add optional `priority?: 1 | 2 | 3` field to `CommandInfo`
    - _Requirements: 2.1, 2.2_
  - [x] 3.2 Update `src/command-database/index.ts`
    - Modify `to_provider_command_info` to not include description
    - Add priority assignment using `get_command_priority`
    - _Requirements: 2.1, 2.2, 5.3_
  - [x] 3.3 Write property test for required fields preserved
    - **Property 3: Required Fields Preserved**
    - **Validates: Requirements 2.5**

- [x] 4. Checkpoint - Verify database changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update completion provider for empty prefix handling
  - [x] 5.1 Modify `get_command_completions` in `src/providers/completion.ts`
    - Add early return for empty prefix
    - _Requirements: 3.1, 3.2_
  - [x] 5.2 Modify `get_option_completions` to check for empty prefix after comma
    - Add helper to get option prefix at position
    - Return empty if prefix is empty
    - _Requirements: 3.7_
  - [x] 5.3 Write property test for empty prefix returns empty completions
    - **Property 4: Empty Prefix Returns Empty Completions**
    - **Validates: Requirements 3.1, 3.2, 3.7, 6.4**

- [x] 6. Remove duplicate abbreviation completions
  - [x] 6.1 Modify `get_command_completions` in `src/providers/completion.ts`
    - Remove the block that adds separate abbreviation completion items
    - _Requirements: 1.2_
  - [x] 6.2 Modify `get_option_completions` to not add abbreviation duplicates
    - Remove the block that adds separate option abbreviation items
    - _Requirements: 1.2_
  - [x] 6.3 Write property test for no duplicates
    - **Property 1: No Duplicate Commands in Completions**
    - **Validates: Requirements 1.1, 1.2**

- [x] 7. Checkpoint - Verify completion changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement priority-based sorting
  - [x] 8.1 Update `CompletionRankingFactors` type in `src/types/index.ts`
    - Add `command_priority?: 1 | 2 | 3` field
    - _Requirements: 5.2_
  - [x] 8.2 Update `compute_ranking_key` in `src/providers/completion.ts`
    - Incorporate command_priority into sort key for built-in commands
    - Tier 1 commands should sort before Tier 2, Tier 2 before Tier 3
    - _Requirements: 5.2, 5.4_
  - [x] 8.3 Update `get_command_completions` to pass priority to ranking factors
    - Get priority from command database
    - Include in CompletionRankingFactors
    - _Requirements: 5.2_
  - [x] 8.4 Write property test for priority ordering
    - **Property 7: Priority Tier Ordering**
    - **Validates: Requirements 5.2, 5.4**
  - [x] 8.5 Write property test for user programs ranking
    - **Property 6: User Programs Rank Above Built-ins**
    - **Validates: Requirements 5.1**

- [x] 9. Remove descriptions from completion items
  - [x] 9.1 Update `create_command_completion` in `src/providers/completion.ts`
    - Remove description from detail field
    - Keep only essential info (syntax, category)
    - _Requirements: 2.3_
  - [x] 9.2 Update option completion creation to not include description
    - _Requirements: 2.4_
  - [x] 9.3 Write property test for no descriptions
    - **Property 2: No Descriptions in Completion Items**
    - **Validates: Requirements 2.3, 2.4**

- [x] 10. Regenerate command cache without descriptions
  - [x] 10.1 Update `scripts/generate-cache.ts`
    - Remove description extraction for commands
    - Remove description extraction for options
    - Add priority field based on tier lookup
    - _Requirements: 2.1, 2.2_
  - [x] 10.2 Regenerate `src/command-database/caches/v18.json`
    - Run: `bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json`
    - _Requirements: 2.1, 2.2_
  - [x] 10.3 Regenerate test cache
    - Run: `bun scripts/generate-cache.ts 18 src/command-database/caches/test.json 50`
    - _Requirements: 2.1, 2.2_

- [x] 11. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Run full test suite: `bun test`

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
