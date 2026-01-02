---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - command-metadata-system: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies requirements for completing the command database integration in the Stata LSP. The new command database system was partially implemented but not fully integrated - the cache has only 50 commands (should be thousands), there are TypeScript errors in the server, and verification is needed that all consumers use the new database.

## Glossary

- **Command_Database**: The new command metadata system in `src/command-database/` that loads from JSON cache files
- **Legacy_Database**: The old command database in `src/commands/` with hardcoded builtin commands
- **Cache_File**: Pre-generated JSON file containing command metadata extracted from Stata help files
- **Provider**: LSP feature implementation (completion, hover, etc.) that consumes command metadata

## Requirements

### Requirement 1: Complete Cache Generation

**User Story:** As a developer, I want the command cache to contain all Stata commands, so that users get completions for every valid command.

#### Acceptance Criteria

1. WHEN the cache is generated, THE Cache_Generator SHALL extract metadata from all available Stata help files
2. THE Cache_File SHALL contain at minimum every command present in the Legacy_Database
3. WHEN comparing cache size, THE Command_Database SHALL have more commands than the Legacy_Database (thousands vs ~100)

### Requirement 2: Legacy Database Superset Validation

**User Story:** As a developer, I want automated validation that the new database is a superset of the legacy database, so that no commands are lost in the migration.

#### Acceptance Criteria

1. THE System SHALL include a test that verifies every command in Legacy_Database exists in Command_Database
2. WHEN a command exists in Legacy_Database but not Command_Database, THE Test SHALL fail with a clear error message listing missing commands
3. THE Validation SHALL run as part of the standard test suite

### Requirement 3: Fix TypeScript Compilation Errors

**User Story:** As a developer, I want the codebase to compile without TypeScript errors, so that the build process succeeds.

#### Acceptance Criteria

1. THE Server SHALL compile without TypeScript errors
2. IF the `onDidSave` handler is not supported, THEN THE Server SHALL remove or fix the handler
3. IF the `saveOptions` capability is not supported, THEN THE Server_Handlers SHALL remove or fix the capability

### Requirement 4: Provider Integration Verification

**User Story:** As a developer, I want all providers to use the new command database, so that the legacy database can be deprecated.

#### Acceptance Criteria

1. THE Completion_Provider SHALL import CommandDatabase from `../command-database`
2. THE Hover_Provider SHALL import CommandDatabase from `../command-database`
3. THE Server SHALL import command_database from `./command-database`
4. THE Server SHALL NOT import from `./commands` except for validation tests
5. WHEN the LSP initializes, THE Server SHALL load the command cache and log the number of commands loaded

### Requirement 5: Runtime Cache Loading

**User Story:** As a developer, I want the cache to load reliably at runtime, so that users always have command completions.

#### Acceptance Criteria

1. WHEN the server starts, THE Server SHALL attempt to load the v18 cache file
2. IF the cache file is missing, THEN THE Server SHALL log a warning
3. THE Build_Process SHALL copy cache files from `src/command-database/caches/` to `dist/command-database/caches/`
4. WHEN cache loading succeeds, THE Server SHALL log the Stata version and command count

### Requirement 6: Cache Size Monotonicity

**User Story:** As a developer, I want the cache generation to never decrease the number of commands, so that we don't accidentally lose command coverage.

#### Acceptance Criteria

1. WHEN the cache generator runs, THE Generator SHALL compare the new command count to the existing cache
2. IF the new cache has fewer commands than the existing cache, THEN THE Generator SHALL fail with an error
3. THE Generator SHALL report the command count difference (added commands) when successful
4. THE Generator MAY include a `--force` flag to override the monotonicity check when intentionally removing commands
