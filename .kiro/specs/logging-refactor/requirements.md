---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document: Logging Refactor

## Introduction

The Stata LSP currently uses ad-hoc console logging throughout production code, which bypasses the LSP's proper logging system. Raw `console.*` calls in production code go to stdout/stderr instead of the LSP client's log channel, making logs inaccessible to users and difficult to manage. This feature introduces a centralized logging system that routes all production logs through the LSP client while maintaining backward compatibility with scripts and tests.

## Glossary

- **Logger**: A centralized logging service that routes messages to the LSP client's log channel
- **LSP Client**: The VS Code extension or other LSP client that receives log messages
- **Production Code**: Source files in `src/` directory (excludes scripts and tests)
- **Log Level**: Severity classification (debug, info, warn, error)
- **Log Channel**: The LSP client's designated output channel for receiving logs
- **Verbosity**: The minimum log level that will be output (e.g., "warn" means warn and error only)

## Requirements

### Requirement 1: Create Centralized Logger Service

**User Story:** As a developer, I want a centralized logging service, so that all production logs are routed consistently through the LSP client.

#### Acceptance Criteria

1. THE Logger SHALL provide methods for all standard log levels: debug, info, warn, error
2. WHEN the Logger is initialized, THE Logger SHALL accept a log channel callback function
3. WHEN a log message is emitted, THE Logger SHALL format it with timestamp and log level
4. WHEN no log channel is provided, THE Logger SHALL use console.debug as a fallback (for CLI/tests)
5. THE Logger SHALL be a singleton instance accessible throughout the application

### Requirement 2: Replace Production Console Calls

**User Story:** As a maintainer, I want all production code to use the centralized logger, so that logs are properly routed to the LSP client.

#### Acceptance Criteria

1. WHEN production code needs to log, THE code SHALL use the Logger instead of console.*
2. WHEN the Logger is used in src/indexer/index.ts, THE existing console.error/info/debug/warn calls SHALL be replaced
3. WHEN the Logger is used in src/comment-processor/comment-processor.ts, THE existing console.warn calls SHALL be replaced
4. WHEN the Logger is used in src/scope-resolver/index.ts, THE existing console.debug/warn calls SHALL be replaced
5. WHEN the Logger is used in src/utils/debounce-manager.ts, THE existing console.warn/error/debug calls SHALL be replaced
6. WHEN the Logger is used in src/providers/formatter.ts, THE existing console.warn calls SHALL be replaced

### Requirement 3: Preserve LSP Client Logging

**User Story:** As an LSP client, I want server.ts to continue using connection.console.log(), so that logs reach the client properly.

#### Acceptance Criteria

1. THE server.ts file SHALL continue using connection.console.log() for all logging
2. WHEN server.ts initializes the Logger, THE Logger SHALL be configured with connection.console.log as the log channel
3. WHEN other modules use the Logger, THE messages SHALL be routed through the same connection.console.log channel

### Requirement 4: Maintain Script and Test Logging

**User Story:** As a script user, I want scripts and tests to continue logging normally, so that CLI feedback and debugging remain functional.

#### Acceptance Criteria

1. WHEN scripts (generate-cache.ts, sync-grammar.ts, bump-version.ts) run, THE existing console.* calls SHALL remain unchanged
2. WHEN tests run, THE existing console.* calls in test files SHALL remain unchanged
3. THE Logger refactor SHALL NOT affect scripts or test files

### Requirement 5: Configure Verbosity Control

**User Story:** As a user, I want to control logging verbosity, so that I can reduce noise in production or enable debug logs when needed.

#### Acceptance Criteria

1. THE Logger SHALL support configurable verbosity levels: debug, info, warn, error
2. WHEN verbosity is set to "warn", THE Logger SHALL only output warn and error messages
3. WHEN verbosity is set to "debug", THE Logger SHALL output all messages
4. THE default verbosity level SHALL be "info" (output info, warn, error; suppress debug)
5. WHEN the Logger is initialized, THE verbosity level SHALL be configurable via initialization options

### Requirement 6: Maintain Backward Compatibility

**User Story:** As a developer, I want the logging refactor to be non-breaking, so that existing functionality continues to work.

#### Acceptance Criteria

1. WHEN the Logger is not initialized, THE application SHALL continue functioning with fallback logging
2. WHEN modules are imported before Logger initialization, THE modules SHALL use fallback logging until Logger is available
3. THE Logger initialization SHALL not require changes to module import order
4. WHEN existing code calls connection.console.log(), THE behavior SHALL remain unchanged

### Requirement 7: Error Handling in Logger

**User Story:** As a system, I want the Logger to handle errors gracefully, so that logging failures don't crash the application.

#### Acceptance Criteria

1. IF the log channel callback throws an error, THE Logger SHALL catch it and continue operation
2. IF a log message cannot be formatted, THE Logger SHALL output a fallback message
3. WHEN the Logger encounters an error, THE error SHALL be logged to console.error as a last resort

## Notes

- The Logger should follow the pattern used by the Python Language Server (verbose off by default, can be enabled)
- Verbosity should default to "info" to reduce noise in production
- The Logger should be initialized in server.ts during the initialized handler
- All production code should be updated to use the Logger, but scripts and tests are excluded
