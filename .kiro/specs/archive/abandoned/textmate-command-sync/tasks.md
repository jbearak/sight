# Implementation Plan: TextMate Command Sync

## Overview

This implementation creates a grammar synchronization module that automatically updates the TextMate grammar's command patterns when the command database cache is regenerated. The module is integrated into the existing `generate-cache.ts` script.

## Tasks

- [x] 1. Create grammar sync module with core types and interfaces
  - Create `scripts/sync-grammar.ts` with type definitions
  - Define `CommandCategory`, `CategorizedCommand`, `GeneratedPattern`, `SyncResult` types
  - Define `EXCLUDED_COMMANDS` and `KEYWORDS` constants
  - Define `CATEGORY_SCOPES` mapping
  - _Requirements: 4.4, 5.4_

- [x] 2. Implement pattern generation functions
  - [x] 2.1 Implement `generate_command_pattern` for single command with abbreviation support
    - Handle commands where min_abbrev == name.length (no optional groups)
    - Handle commands where min_abbrev < name.length (with optional groups)
    - Escape regex special characters in command names
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 2.2 Write property test for abbreviation pattern correctness
    - **Property 2: Abbreviation pattern correctness**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [x] 2.3 Implement `validate_pattern` to check regex syntax
    - Attempt to compile pattern as RegExp
    - Return true if valid, throw Error if invalid
    - _Requirements: 6.1_

- [x] 3. Implement category merger
  - [x] 3.1 Implement `load_builtin_categories` to extract categories from BUILTIN_COMMANDS
    - Import BUILTIN_COMMANDS from builtin-commands.ts
    - Build Map<string, CommandCategory> from command name to category
    - _Requirements: 4.1_
  - [x] 3.2 Implement `merge_categories` to assign categories to database commands
    - Commands in builtin-commands get their category
    - Commands not in builtin-commands get 'other' category
    - _Requirements: 4.2, 4.3_
  - [x] 3.3 Write property test for category assignment correctness
    - **Property 3: Category assignment correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 4. Implement pattern generator for multiple commands
  - [x] 4.1 Implement `generate_category_pattern` for a list of commands
    - Filter out excluded commands
    - Generate pattern for each command
    - Join with `|` and wrap with word boundaries `\\b(...)`
    - _Requirements: 1.3, 5.1_
  - [x] 4.2 Implement `generate_patterns` to create patterns grouped by category
    - Group commands by category
    - Generate pattern for each category with appropriate scope
    - Return GeneratedPatterns with statistics
    - _Requirements: 1.1, 1.2, 4.2_
  - [x] 4.3 Write property test for pattern generation completeness
    - **Property 1: Pattern generation completeness**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [x] 4.4 Write property test for excluded commands filtering
    - **Property 4: Excluded commands filtering**
    - **Validates: Requirements 5.1**
  - [x] 4.5 Write property test for generated pattern validity
    - **Property 5: Generated pattern validity**
    - **Validates: Requirements 6.1**

- [x] 5. Implement grammar updater
  - [x] 5.1 Implement `load_grammar` to read and parse TextMate grammar file
    - Read JSON file from path
    - Validate structure has required fields
    - Throw error if file doesn't exist or is invalid
    - _Requirements: 3.3_
  - [x] 5.2 Implement `update_commands_patterns` to replace commands repository entry
    - Create pattern entries for each category
    - Preserve all other repository entries unchanged
    - _Requirements: 3.1, 3.2_
  - [x] 5.3 Implement `update_keywords_pattern` to add mata/python to keywords
    - Parse existing keywords pattern
    - Add mata, python if not present
    - Regenerate pattern string
    - _Requirements: 5.2, 5.3_
  - [x] 5.4 Implement `write_grammar` to write formatted JSON
    - Write with 4-space indentation to match existing format
    - _Requirements: 1.4_
  - [x] 5.5 Write property test for grammar structure preservation
    - **Property 6: Grammar structure preservation**
    - **Validates: Requirements 3.1, 3.2**

- [x] 6. Implement main sync function and CLI
  - [x] 6.1 Implement `sync_grammar` main function
    - Load builtin categories
    - Extract commands from cache
    - Merge categories
    - Generate patterns
    - Update grammar
    - Return SyncResult
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 6.2 Add standalone CLI for testing
    - Parse command-line arguments
    - Load cache from file
    - Call sync_grammar
    - Report results
    - _Requirements: 7.4_

- [x] 7. Integrate with generate-cache.ts
  - [x] 7.1 Import sync_grammar module in generate-cache.ts
    - Add import statement
    - _Requirements: 7.1_
  - [x] 7.2 Call sync_grammar after cache generation
    - Call sync_grammar with generated cache
    - Report sync results
    - Continue even if sync fails (with warning)
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Checkpoint - Verify integration
  - Run `bun scripts/generate-cache.ts 18` with test cache
  - Verify both cache and grammar are updated
  - Verify grammar has correct command patterns
  - Verify mata/python are in keywords
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All property tests are required for comprehensive testing
- Each property test references a specific property from the design document
- The sync module is designed to be importable for both integration and standalone use
- Grammar file path defaults to `client/syntaxes/stata.tmLanguage.json`
