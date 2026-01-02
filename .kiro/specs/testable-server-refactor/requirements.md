---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document

## Introduction

This specification addresses refactoring the LSP server (`src/server.ts`) to separate handler logic from connection wiring, enabling unit testing of server handlers without requiring a real LSP connection.

## Glossary

- **Server_Handlers**: The module containing LSP handler logic (initialize, completion, hover, etc.)
- **Server_Entry**: The entry point that creates the connection and wires handlers
- **Connection**: The LSP connection object from vscode-languageserver
- **Handler_Dependencies**: The providers and stores that handlers need to function

## Requirements

### Requirement 1: Extract Handler Logic

**User Story:** As a developer, I want handler logic separated from connection wiring, so that I can test handlers in isolation.

#### Acceptance Criteria

1. THE Server_Handlers module SHALL export factory functions for each LSP handler
2. WHEN a handler factory is called with dependencies, THE Server_Handlers SHALL return a handler function
3. THE Server_Entry SHALL import handler factories and wire them to the connection
4. THE Server_Handlers SHALL NOT directly call `createConnection`

### Requirement 2: Dependency Injection for Handlers

**User Story:** As a developer, I want handlers to receive dependencies via injection, so that I can provide mock dependencies in tests.

#### Acceptance Criteria

1. THE Handler_Dependencies interface SHALL define all required dependencies (providers, stores, config)
2. WHEN creating handlers, THE Server_Entry SHALL pass real dependencies
3. WHEN testing handlers, THE Test_Suite SHALL pass mock dependencies
4. THE Server_Handlers SHALL NOT create provider instances directly

### Requirement 3: Enable LSP Lifecycle Tests

**User Story:** As a developer, I want to test server initialization and shutdown, so that I can verify correct LSP capabilities.

#### Acceptance Criteria

1. THE Test_Suite SHALL be able to call the initialize handler with mock params
2. THE Test_Suite SHALL verify the returned capabilities match expected values
3. THE Test_Suite SHALL be able to call the shutdown handler
4. THE Test_Suite SHALL run without unhandled errors or skipped tests

### Requirement 4: Maintain Backward Compatibility

**User Story:** As a user, I want the server to work exactly as before, so that my editor integration is not broken.

#### Acceptance Criteria

1. THE Server_Entry SHALL produce identical LSP behavior to the original server
2. THE Server_Entry SHALL handle all existing LSP methods (completion, hover, definition, etc.)
3. THE Server_Entry SHALL maintain the same initialization sequence
