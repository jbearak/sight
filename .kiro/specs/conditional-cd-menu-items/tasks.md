# Implementation Plan: Conditional CD Menu Items

## Overview

This plan implements conditional "CD into Workspace Folder" and "CD into File Folder" menu items in the Sight VS Code extension. The implementation uses VS Code's context variable system to control menu visibility based on the `workingDirectory` setting.

## Tasks

- [ ] 1. Implement path escaping utility
  - [ ] 1.1 Create `escape_path_for_stata` function in `client/src/send-to-stata/cd-commands.ts`
    - Handle compound string syntax for paths with double quotes
    - Double backslashes for Windows path compatibility
    - Return object with escaped path and compound string flag
    - _Requirements: 2.3, 3.3_
  
  - [ ] 1.2 Write property test for path escaping
    - **Property 3: Path escaping correctness**
    - Generate random paths with special characters (quotes, backslashes, spaces)
    - Verify output is valid Stata syntax
    - **Validates: Requirements 2.3, 3.3**

- [ ] 2. Implement context variable management
  - [ ] 2.1 Create context initialization and update functions in `client/src/send-to-stata/cd-commands.ts`
    - `initialize_cd_context(context)` - read config and set initial context
    - `update_cd_context(value)` - update context when config changes
    - Context key: `sight.cdMenuVisible`
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [ ] 2.2 Write property test for context variable correctness
    - **Property 1: Context variable correctness**
    - For any workingDirectory value, context should be true iff value === 'none'
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.3**

- [ ] 3. Implement CD command handlers
  - [ ] 3.1 Create `get_target_directory` function
    - Handle 'workspace' type: get workspace folder path
    - Handle 'file' type: get active file's directory
    - Throw descriptive errors when workspace/file unavailable
    - _Requirements: 2.1, 2.2, 3.1, 3.2_
  
  - [ ] 3.2 Create `execute_cd_command` function
    - Get target directory based on type
    - Escape path using `escape_path_for_stata`
    - Generate cd command with proper string syntax
    - Send to Stata via temp file (app or terminal)
    - _Requirements: 2.1, 3.1_
  
  - [ ] 3.3 Write property test for CD command generation
    - **Property 2: CD command path correctness**
    - Generate random valid directory paths
    - Verify command format is `cd "path"` or `cd \`"path"'`
    - **Validates: Requirements 2.1, 3.1**

- [ ] 4. Checkpoint - Verify core logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Register commands and integrate with extension
  - [ ] 5.1 Create `register_cd_commands` function
    - Register `sight.cdWorkspace` command
    - Register `sight.cdFile` command
    - Register `sight.terminal.cdWorkspace` command
    - Register `sight.terminal.cdFile` command
    - _Requirements: 2.4, 3.4_
  
  - [ ] 5.2 Update `client/src/send-to-stata/index.ts` exports
    - Export `initialize_cd_context`
    - Export `register_cd_commands`
    - _Requirements: 5.2_
  
  - [ ] 5.3 Update `client/src/extension.ts` to initialize CD features
    - Call `initialize_cd_context(context)` during activation
    - Call `register_cd_commands(context)` during activation
    - Register configuration change listener for `sight.sendToStata.workingDirectory`
    - _Requirements: 5.2, 5.3_

- [ ] 6. Update package.json with commands and menus
  - [ ] 6.1 Add command definitions to `client/package.json`
    - `sight.cdWorkspace` - "Sight: CD into Workspace Folder"
    - `sight.cdFile` - "Sight: CD into File Folder"
    - `sight.terminal.cdWorkspace` - "Sight: Terminal - CD into Workspace Folder"
    - `sight.terminal.cdFile` - "Sight: Terminal - CD into File Folder"
    - _Requirements: 2.4, 3.4_
  
  - [ ] 6.2 Add menu items to `sight.sendToStata` submenu
    - Add CD items in group `3_cd` with `when: sight.cdMenuVisible && isMac`
    - Order: cdWorkspace before cdFile
    - _Requirements: 4.1, 4.2, 4.3, 1.1, 1.2_
  
  - [ ] 6.3 Add menu items to `sight.sendToStata.terminal` submenu
    - Add CD items in group `3_cd` with `when: sight.cdMenuVisible`
    - Same ordering as main menu
    - _Requirements: 4.4, 1.1, 1.2_

- [ ] 7. Final checkpoint - Verify complete integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- The implementation reuses existing `send_to_stata_app` and `send_to_terminal` functions
- Context variable updates happen synchronously via VS Code's `setContext` API
- Property tests use `fast-check` library following existing project patterns
