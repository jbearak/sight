# Implementation Plan: Send to Stata

## Overview

This implementation plan breaks down the send-to-Stata feature into discrete coding tasks. The feature is implemented entirely in TypeScript within the VS Code extension (`client/`), with no external shell scripts required.

## Tasks

- [x] 1. Create send-to-stata module structure
  - Create `client/src/send-to-stata/` directory
  - Create `index.ts` barrel export file
  - _Requirements: Architecture setup_

- [x] 2. Implement statement detector
  - [x] 2.1 Create `statement-detector.ts` with continuation marker detection
    - Implement `ends_with_continuation(line: string): boolean`
    - Implement `detect_statement(document, line): StatementBounds`
    - Implement `get_statement_text(document, bounds): string`
    - _Requirements: 1.2, 1.3, 1.4, 8.1, 8.2, 8.3, 8.4_
  
  - [x] 2.2 Write property test for statement detection
    - **Property 1: Statement Detection with Continuations**
    - **Validates: Requirements 1.2, 1.3, 1.4, 8.1, 8.2, 8.3, 8.4**

- [x] 3. Implement temp file manager
  - [x] 3.1 Create `temp-file.ts` with temp file creation
    - Implement `get_temp_dir(): string` - returns `os.tmpdir()`
    - Implement `create_temp_file(content: string): Promise<string>` - creates files named `stata_send_<32-hex-chars>.do` using 16 random bytes from `crypto.randomBytes()`
    - _Requirements: 1.5, 12.1, 12.2, 12.4_
  
  - [x] 3.2 Write property test for temp file creation
    - **Property 2: Temp File Creation**
    - **Validates: Requirements 1.5, 12.1, 12.2, 12.4**

- [x] 4. Implement Stata app detector (macOS)
  - [x] 4.1 Create `stata-detector.ts` with variant detection
    - Implement `detect_stata_app(): Promise<StataVariant | null>`
    - Implement `clear_stata_cache(): void`
    - Check setting first, then auto-detect from `/Applications/Stata/`
    - Cache result for subsequent calls
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [x] 4.2 Write property test for Stata detection order
    - **Property 7: Stata Variant Detection Order**
    - **Validates: Requirements 7.2, 7.3**

- [x] 5. Implement AppleScript executor (macOS)
  - [x] 5.1 Create `applescript.ts` with AppleScript execution
    - Implement `escape_for_applescript(path: string): string`
    - Implement `send_to_stata_app(stata_app, command, temp_file_path): Promise<void>`
    - Use `child_process.exec` with `osascript`
    - _Requirements: 1.6, 1.7, 3.3_
  
  - [x] 5.2 Write property test for AppleScript path escaping
    - **Property 3: AppleScript Path Escaping**
    - **Validates: Requirements 1.7**
  
  - [x] 5.3 Write property test for AppleScript command generation
    - **Property 4: AppleScript Command Generation**
    - **Validates: Requirements 1.6, 3.3**

- [x] 6. Implement terminal sender
  - [x] 6.1 Create `terminal.ts` with terminal sending
    - Implement `send_to_terminal(command, temp_file_path): Promise<void>`
    - Use `vscode.window.activeTerminal.sendText()`
    - Throw error if no active terminal
    - _Requirements: 6.7, 6.8, 6.9_

- [x] 7. Checkpoint - Core modules complete
  - Ensure all core modules compile without errors
  - Ensure all tests pass, ask the user if questions arise

- [x] 8. Implement upward/downward line extraction
  - [x] 8.1 Add upward/downward extraction to statement detector
    - Implement `get_upward_bounds(document, line): StatementBounds`
    - Implement `get_downward_bounds(document, line): StatementBounds`
    - Handle continuation lines at boundaries
    - _Requirements: 4.2, 4.4, 5.2, 5.4_
  
  - [x] 8.2 Write property test for upward line extraction
    - **Property 5: Upward Line Extraction**
    - **Validates: Requirements 4.2, 4.4**
  
  - [x] 8.3 Write property test for downward line extraction
    - **Property 6: Downward Line Extraction**
    - **Validates: Requirements 5.2, 5.4**

- [x] 9. Implement command handlers
  - [x] 9.1 Create `commands.ts` with command registration
    - Implement `register_send_to_stata_commands(context): void`
    - Register all application mode commands (macOS)
    - Register all terminal mode commands (cross-platform)
    - Handle platform detection for application commands
    - _Requirements: 1.1, 2.1, 3.1, 3.2, 4.1, 5.1, 6.1-6.6, 13.1-13.5, 14.1-14.5_

- [x] 10. Register commands in extension
  - [x] 10.1 Update `extension.ts` to register send-to-stata commands
    - Import and call `register_send_to_stata_commands(context)`
    - _Requirements: Integration_

- [x] 11. Add keybindings to package.json
  - [x] 11.1 Add keybinding contributions to `client/package.json`
    - `cmd-enter` / `ctrl-enter` → `sight.doLineOrSelection`
    - `shift-cmd-enter` / `shift-ctrl-enter` → `sight.doFile`
    - `alt-cmd-enter` / `alt-ctrl-enter` → `sight.includeLineOrSelection`
    - `alt-shift-cmd-enter` / `alt-shift-ctrl-enter` → `sight.includeFile`
    - `alt-enter` → `sight.terminal.doLineOrSelection`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 12. Add toolbar button and menu to package.json
  - [x] 12.1 Add menu contributions to `client/package.json`
    - Add `sight.sendToStata` submenu to editor/title
    - Add application mode commands (with `isMac` when clause)
    - Add terminal submenu with terminal commands
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 13. Add configuration options to package.json
  - [x] 13.1 Add configuration contributions to `client/package.json`
    - Add `sight.sendToStata.stataApp` setting (string)
    - Add `sight.sendToStata.saveBeforeSend` setting (boolean, default: true)
    - Add `sight.sendToStata.workingDirectory` setting (enum: "none", "file", "workspace", default: "none")
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 14. Implement working directory handling
  - [x] 14.1 Update temp file creation to support working directory prefix
    - Implement `prepare_content_with_cd(content, document, config): string`
    - Prepend `cd` command when workingDirectory is "file" or "workspace"
    - _Requirements: 11.4, 11.5, 11.6_

- [x] 15. Checkpoint - Feature complete
  - Ensure all tests pass, ask the user if questions arise
  - Verify keybindings work in Stata files
  - Verify toolbar button appears for Stata files

- [x] 16. Write unit tests for edge cases
  - [x] 16.1 Write unit tests for statement detector
    - Test single-line statements
    - Test multi-line statements with cursor on different lines
    - Test chained continuations
    - Test `///` with trailing whitespace
    - _Requirements: 8.1, 8.4_
  
  - [x] 16.2 Write unit tests for AppleScript escaping
    - Test paths with spaces, backslashes, quotes
    - _Requirements: 1.7_
  
  - [x] 16.3 Write unit tests for Stata detection
    - Test with setting configured
    - Test auto-detection order
    - Test no Stata found
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  
  - [x] 16.4 Write unit tests for working directory handling
    - Test with workingDirectory = "none"
    - Test with workingDirectory = "file"
    - Test with workingDirectory = "workspace"
    - Test paths with quotes
    - _Requirements: 11.4, 11.5, 11.6_

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation is entirely in TypeScript within the VS Code extension
- No external shell scripts are required (unlike sight-zed)
