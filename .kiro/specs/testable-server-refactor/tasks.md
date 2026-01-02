# Implementation Plan: Testable Server Refactor

## Overview

This plan refactors the LSP server to separate handler logic from connection wiring, enabling unit testing of server handlers.

## Tasks

- [x] 1. Create server-handlers module
  - [x] 1.1 Create src/server-handlers.ts with HandlerDependencies interface
    - Define HandlerDependencies interface with all required providers and stores
    - Define ServerCapabilities interface for tracking client capabilities
    - Export default configuration constant
    - _Requirements: 2.1_
  - [x] 1.2 Implement initialize handler factory
    - Create create_initialize_handler function
    - Extract capability detection logic from server.ts
    - Return InitializeResult with server capabilities
    - _Requirements: 1.1, 1.2_
  - [x] 1.3 Implement initialized handler factory
    - Create create_initialized_handler function
    - Accept callback for post-initialization setup
    - _Requirements: 1.1, 1.2_
  - [x] 1.4 Implement completion handler factory
    - Create create_completion_handler function
    - Accept HandlerDependencies
    - Return completion items based on document state
    - _Requirements: 1.1, 1.2, 2.4_
  - [x] 1.5 Implement remaining handler factories
    - Create factories for: hover, definition, document_symbol, workspace_symbol
    - Create factories for: formatting, range_formatting
    - Create factories for: shutdown, exit
    - Create factory for: did_change_watched_files
    - _Requirements: 1.1, 1.2, 2.4_

- [x] 2. Refactor server.ts to use handler factories
  - [x] 2.1 Update server.ts imports and structure
    - Import handler factories from server-handlers.ts
    - Keep createConnection call in server.ts
    - Create HandlerDependencies object with real providers
    - _Requirements: 1.3, 4.1_
  - [x] 2.2 Wire handlers using factories
    - Replace inline handlers with factory-created handlers
    - Pass dependencies to each factory
    - Maintain same initialization sequence
    - _Requirements: 1.3, 4.2, 4.3_

- [x] 3. Update tests to use handler factories
  - [x] 3.1 Rewrite lsp-lifecycle.test.ts
    - Remove mock.module approach
    - Import handler factories directly
    - Create mock dependencies
    - Test initialize handler returns correct capabilities
    - Test shutdown handler completes without error
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Verify all tests pass
  - Run `bun test` and verify 0 failures, 0 errors, 0 skipped
  - Verify server still works with VS Code (manual test)
  - _Requirements: 3.4, 4.1_

## Notes

- The key insight is that `createConnection()` must only be called in server.ts, not in the handlers module
- Handler factories receive dependencies, making them testable with mocks
- The refactoring should be transparent to users - no behavior changes
