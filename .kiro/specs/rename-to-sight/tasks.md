# Implementation Plan: Rename to Sight

## Overview

This implementation plan covers renaming the project from "stata-lsp" to "sight" across all package manifests, configuration, source code, and documentation.

## Tasks

- [ ] 1. Update package manifests
  - [ ] 1.1 Update root package.json
    - Change `name` from "stata-lsp" to "sight"
    - Change `bin` key from "stata-lsp" to "sight"
    - Update `description` to reference "Sight"
    - _Requirements: 1.1, 1.3_

  - [ ] 1.2 Update client/package.json
    - Change `name` from "stata-lsp-client" to "sight-client"
    - Change `displayName` to "Sight - Stata Language Server"
    - Update `repository.url` if needed
    - _Requirements: 1.2, 2.1, 2.4_

- [ ] 2. Update VS Code extension configuration keys
  - [ ] 2.1 Rename all configuration properties in client/package.json
    - Change all "stata-lsp.*" keys to "sight.*"
    - Update configuration title to "Sight Language Server"
    - _Requirements: 2.2, 3.1_

  - [ ] 2.2 Write property test for configuration key prefix
    - **Property 1: Configuration Key Consistency**
    - **Validates: Requirements 2.2, 3.1**

- [ ] 3. Update VS Code extension commands
  - [ ] 3.1 Rename all commands in client/package.json
    - Change "stata-lsp.resetDepthColors" to "sight.resetDepthColors"
    - _Requirements: 2.3_

  - [ ] 3.2 Update command registration in client/src/extension.ts
    - Update command ID in registerCommand call
    - Update output channel name to "Sight Language Server"
    - Update LanguageClient ID from "stata-lsp" to "sight"
    - _Requirements: 2.3, 4.2_

  - [ ] 3.3 Write property test for command identifier prefix
    - **Property 3: Command Identifier Consistency**
    - **Validates: Requirements 2.3**

- [ ] 4. Update server configuration handling
  - [ ] 4.1 Update src/server.ts
    - Change configuration section from "stata-lsp" to "sight"
    - Update comments referencing .stata-lsp.json to .sight.json
    - _Requirements: 3.2_

  - [ ] 4.2 Update src/server-handlers.ts
    - Change command names in executeCommandProvider
    - Update command handling in create_execute_command_handler
    - _Requirements: 2.3_

- [ ] 5. Update configuration file handling
  - [ ] 5.1 Update src/utils/workspace-config.ts
    - Change config file path from ".stata-lsp.json" to ".sight.json"
    - Update function documentation
    - _Requirements: 6.1, 6.2_

  - [ ] 5.2 Update src/providers/completion.ts
    - Change workspace marker from ".stata-lsp.json" to ".sight.json"
    - _Requirements: 6.1_

  - [ ] 5.3 Write property test for configuration file resolution
    - **Property 4: Configuration File Resolution**
    - **Validates: Requirements 6.1, 6.2**

- [ ] 6. Update diagnostic source attribution
  - [ ] 6.1 Update src/document-store.ts
    - Change all diagnostic `source` fields from "stata-lsp" to "sight"
    - _Requirements: 4.3_

  - [ ] 6.2 Update src/providers/diagnostics.ts
    - Change all diagnostic `source` fields from "stata-lsp" to "sight"
    - _Requirements: 4.3_

  - [ ] 6.3 Write property test for diagnostic source attribution
    - **Property 2: Diagnostic Source Attribution**
    - **Validates: Requirements 4.3**

- [ ] 7. Checkpoint - Verify core functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Update documentation
  - [ ] 8.1 Update README.md
    - Change title from "Stata Language Server (LSP)" to "Sight - Stata Language Server"
    - Update all "stata-lsp.*" configuration references to "sight.*"
    - Update ".stata-lsp.json" references to ".sight.json"
    - _Requirements: 5.1, 5.3_

  - [ ] 8.2 Update AGENTS.md
    - Update project name references
    - Update configuration file references
    - _Requirements: 5.2_

  - [ ] 8.3 Update GEMINI.md (if exists and is separate)
    - Same updates as AGENTS.md
    - _Requirements: 5.2_

- [ ] 9. Update existing tests
  - [ ] 9.1 Update test files that reference "stata-lsp"
    - Search for and update any hardcoded "stata-lsp" references in tests
    - Update any tests that check diagnostic source
    - _Requirements: 4.3_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The rename is purely cosmetic and does not affect internal data structures
