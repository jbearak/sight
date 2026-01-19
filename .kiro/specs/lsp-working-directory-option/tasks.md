# Implementation Plan: LSP Working Directory Option

## Overview

This implementation adds a fourth option "lsp" to the `sight.sendToStata.workingDirectory` setting, making it the new default. The feature enables the VS Code client extension to query the LSP server for the working directory determined from `@lsp-cd` directives or inherited from parent files.

## Tasks

- [x] 1. Implement LSP Server Handler
  - [x] 1.1 Add custom request handler for `sight/getWorkingDirectory`
    - Create `create_get_working_directory_handler` function in `src/server-handlers.ts`
    - Handler should wait for pending document updates via `wait_for_update`
    - Return `{ workingDirectory: string | null }` from `DocumentState.working_directory`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [x] 1.2 Wire up custom request in server factory
    - Register `sight/getWorkingDirectory` handler in `src/server-factory.ts`
    - Add handler to connection's `onRequest` for the custom method
    - _Requirements: 2.1_

  - [x] 1.3 Write property test for server response correctness
    - **Property 1: Server Response Correctness**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**

- [x] 2. Update Client Configuration
  - [x] 2.1 Add "lsp" enum value to package.json
    - Add "lsp" to `sight.sendToStata.workingDirectory` enum array
    - Change default from "none" to "lsp"
    - Add enumDescription for "lsp" option
    - Reorder enum to put "lsp" first
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Implement Client-Side LSP Integration
  - [x] 3.1 Update type definitions for working directory option
    - Update type in `client/src/send-to-stata/cd-context.ts` to include "lsp"
    - Update type in `client/src/send-to-stata/commands.ts` to include "lsp"
    - _Requirements: 1.1_

  - [x] 3.2 Add LSP client request function
    - Create function to send `sight/getWorkingDirectory` request
    - Handle errors gracefully and return null on failure
    - Access LanguageClient from extension context
    - _Requirements: 3.1, 3.4_

  - [x] 3.3 Update content preparation to handle "lsp" option
    - Modify `prepare_content_with_cd` to be async
    - Add "lsp" case that queries LSP server
    - Fall back to "none" behavior when LSP returns null or fails
    - Update `handle_send_command` to pass LanguageClient
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 Write property test for content transformation
    - **Property 2: Content Transformation Correctness**
    - **Validates: Requirements 3.2, 3.3**

  - [x] 3.5 Write property test for backward compatibility
    - **Property 3: Backward Compatibility**
    - **Validates: Requirements 1.4**

- [x] 4. Update CD Menu Visibility Logic
  - [x] 4.1 Update CD context for "lsp" option
    - Modify `compute_cd_menu_visible` in `cd-commands.ts` to handle "lsp"
    - For "lsp", default to hidden (same as "file"/"workspace")
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Integration Testing
  - [x] 6.1 Write integration test for end-to-end LSP request
    - Test server responds to `sight/getWorkingDirectory` request
    - Test with document containing `@lsp-cd` directive
    - _Requirements: 2.1, 2.4_

  - [x] 6.2 Write integration test for inheritance chain
    - Test working directory inheritance via `@lsp-done-by`
    - _Requirements: 2.5_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- The implementation leverages existing `DocumentState.working_directory` field
- No new data models are required on the server side
- The client needs access to the LanguageClient instance for LSP requests
