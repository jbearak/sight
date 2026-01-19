# Requirements Document

## Introduction

This document defines the requirements for sending Stata code from VS Code to Stata for execution. The feature supports two target modes:
- **Stata application** (macOS): Uses AppleScript to send code to the Stata GUI app
- **Terminal sessions**: Sends code to VS Code's integrated terminal (works with SSH, multiple sessions, cross-platform)

This brings the send-to-Stata functionality from the sight-zed extension to VS Code, with improvements including unified terminal shortcuts, full statement detection for terminal mode, and an editor toolbar button.

## Glossary

- **Stata_GUI**: The Stata graphical application (StataMP, StataSE, StataIC, or Stata) running on macOS
- **Statement**: A single Stata command, which may span multiple lines when using continuation markers (`///`)
- **Continuation_Marker**: The `///` sequence at the end of a line indicating the statement continues on the next line
- **AppleScript**: macOS scripting language used to communicate with the Stata GUI application
- **DoCommandAsync**: The AppleScript command used to send code to Stata for execution
- **Temp_File**: A temporary `.do` file used to pass code to Stata
- **Terminal_Session**: A VS Code integrated terminal instance running Stata CLI
- **Do_Command**: Stata's `do` command which executes a do-file with isolated local macro scope
- **Include_Command**: Stata's `include` command which executes a do-file while preserving local macro scope
- **Run_Command**: Stata's `run` command which executes a do-file silently (no output)
- **Extension**: The VS Code Sight extension that provides Stata language support

## Requirements

### Requirement 1: Send Current Statement to Stata Application

**User Story:** As a Stata user on macOS, I want to send the current statement to the Stata GUI application, so that I can execute code without leaving VS Code.

#### Acceptance Criteria

1. WHEN text is selected, THE Extension SHALL send the selected text to Stata_GUI
2. WHEN no text is selected, THE Extension SHALL identify the current statement at the cursor position
3. WHEN the current line contains a Continuation_Marker (`///`), THE Extension SHALL include all continuation lines as part of the statement
4. WHEN the current line is a continuation of a previous line, THE Extension SHALL include the entire multi-line statement from its beginning
5. THE Extension SHALL write the statement to a Temp_File with `.do` extension
6. THE Extension SHALL send the `do "/path/to/temp.do"` command to Stata_GUI via AppleScript
7. THE Extension SHALL properly escape backslashes and double quotes for AppleScript

### Requirement 2: Send Entire File to Stata Application

**User Story:** As a Stata user on macOS, I want to send the entire file to the Stata GUI application, so that I can run complete do-files.

#### Acceptance Criteria

1. THE Extension SHALL save the file before sending (to ensure latest changes are executed)
2. THE Extension SHALL write the file contents to a Temp_File with `.do` extension
3. THE Extension SHALL send the `do "/path/to/temp.do"` command to Stata_GUI via AppleScript
4. THE Extension SHALL always use a Temp_File to prevent issues if the user edits the original file while Stata is executing

### Requirement 3: Include Mode for Stata Application

**User Story:** As a Stata user, I want to send code using `include` instead of `do`, so that local macros are preserved in the calling context for debugging.

#### Acceptance Criteria

1. THE Extension SHALL provide "Include Statement" command that uses `include` instead of `do`
2. THE Extension SHALL provide "Include File" command that uses `include` instead of `do`
3. WHEN using include mode, THE Extension SHALL preserve all other behavior (temp file creation, statement detection, etc.)

### Requirement 4: Do Upward Lines

**User Story:** As a Stata user, I want to execute all code from the beginning of the file up to and including the current line, so that I can run code incrementally from the top.

#### Acceptance Criteria

1. THE Extension SHALL provide "Do Upward Lines" command
2. WHEN invoked, THE Extension SHALL send all lines from line 1 to the current cursor line (inclusive)
3. THE Extension SHALL write the upward lines to a Temp_File and execute via `do` command
4. IF the cursor is on a continuation line, THE Extension SHALL include the complete statement

### Requirement 5: Do Downward Lines

**User Story:** As a Stata user, I want to execute all code from the current line to the end of the file, so that I can run the remainder of my code.

#### Acceptance Criteria

1. THE Extension SHALL provide "Do Downward Lines" command
2. WHEN invoked, THE Extension SHALL send all lines from the current cursor line to the end of the file
3. THE Extension SHALL write the downward lines to a Temp_File and execute via `do` command
4. IF the cursor is on a continuation line, THE Extension SHALL include the complete statement from its beginning

### Requirement 6: Send to Terminal Session

**User Story:** As a Stata user, I want to send code to a VS Code terminal running Stata, so that I can work with remote Stata sessions or multiple instances.

#### Acceptance Criteria

1. THE Extension SHALL provide commands to send statement/selection to Terminal_Session
2. THE Extension SHALL provide commands to send upward lines to Terminal_Session
3. THE Extension SHALL provide commands to send downward lines to Terminal_Session
4. THE Extension SHALL provide commands to send entire file to Terminal_Session
5. WHEN text is selected, THE Extension SHALL send the selected text
6. WHEN no text is selected, THE Extension SHALL detect and send the current statement (including continuation lines)
7. THE Extension SHALL write code to a Temp_File before sending to terminal (to support `///` continuations)
8. THE Extension SHALL send `do "/path/to/temp.do"` command to the active terminal
9. THE Extension SHALL send to the currently active terminal (user is responsible for launching Stata in their terminal)
10. THE Extension SHALL support include mode for terminal as well

### Requirement 7: Stata Application Detection

**User Story:** As a Stata user on macOS, I want the extension to automatically detect my installed Stata variant, so that I don't need to manually configure the application name.

#### Acceptance Criteria

1. THE Extension SHALL support configuring the Stata application name via `sight.sendToStata.stataApp` setting
2. WHEN no setting is configured, THE Extension SHALL auto-detect by checking `/Applications/Stata/` for StataMP, StataSE, StataIC, or Stata (in that order)
3. THE Extension SHALL use the first Stata variant found during auto-detection
4. IF no Stata installation is found AND no setting is configured, THEN THE Extension SHALL gracefully fail with a clear error message explaining how to install Stata or configure the setting

### Requirement 8: Statement Detection Logic

**User Story:** As a Stata user, I want accurate detection of multi-line statements, so that continuation lines are handled correctly.

#### Acceptance Criteria

1. THE Extension SHALL detect `///` at the end of a line (ignoring trailing whitespace) as a Continuation_Marker
2. WHEN on a continuation line, THE Extension SHALL search backwards to find the statement start
3. WHEN on a line with `///`, THE Extension SHALL search forwards to find all continuation lines
4. THE Extension SHALL handle nested or chained continuation markers correctly

### Requirement 9: Keyboard Shortcuts

**User Story:** As a Stata user, I want keyboard shortcuts to quickly send code to Stata, so that I can maintain my workflow without using menus.

#### Acceptance Criteria

1. THE Extension SHALL bind `cmd-enter` (macOS) / `ctrl-enter` (Windows/Linux) to "Send Statement to Stata" in `.do` files
2. THE Extension SHALL bind `shift-cmd-enter` / `shift-ctrl-enter` to "Send File to Stata" in `.do` files
3. THE Extension SHALL bind `opt-cmd-enter` / `alt-ctrl-enter` to "Include Statement" in `.do` files
4. THE Extension SHALL bind `opt-shift-cmd-enter` / `alt-shift-ctrl-enter` to "Include File" in `.do` files
5. THE Extension SHALL bind `opt-enter` / `alt-enter` to "Send to Terminal" in `.do` files
6. THE shortcuts SHALL work in `.do`, `.ado`, and `.mata` files

### Requirement 10: Editor Toolbar Button

**User Story:** As a Stata user, I want a toolbar button to access send-to-Stata commands, so that I can discover and use features without memorizing shortcuts.

#### Acceptance Criteria

1. THE Extension SHALL add a toolbar button to the editor title area for Stata files
2. WHEN clicked, THE toolbar button SHALL show a menu with all send options:
   - Do line or selection
   - Do upward lines
   - Do downward lines
   - Do whole file
   - Include line or selection
   - Include whole file
   - Terminal (submenu with: do line/selection, do upward, do downward, do file, include line/selection, include file)
3. THE toolbar button SHALL only appear for Stata files (`.do`, `.ado`, `.mata`)

### Requirement 11: Configuration Options

**User Story:** As a Stata user, I want to configure send-to-Stata behavior, so that I can customize it for my workflow.

#### Acceptance Criteria

1. THE Extension SHALL provide `sight.sendToStata.stataApp` setting to override Stata variant (string, macOS only)
2. THE Extension SHALL provide `sight.sendToStata.saveBeforeSend` setting to control auto-save behavior (default: true)
3. THE Extension SHALL provide `sight.sendToStata.workingDirectory` setting with options: "none" (default), "file", or "workspace"
4. WHEN `workingDirectory` is "file", THE Extension SHALL prepend `cd "{file_directory}"` to the temp file
5. WHEN `workingDirectory` is "workspace", THE Extension SHALL prepend `cd "{workspace_root}"` to the temp file
6. WHEN `workingDirectory` is "none", THE Extension SHALL not modify the working directory

### Requirement 12: Temporary File Management

**User Story:** As a Stata user, I want temporary files to be managed properly, so that they don't cause issues.

#### Acceptance Criteria

1. THE Extension SHALL create Temp_Files in the system temporary directory
2. THE Extension SHALL use unique filenames to avoid conflicts with concurrent executions
3. THE Extension SHALL NOT delete Temp_Files immediately (Stata needs time to read them)
4. THE Extension SHALL use `.do` extension for all temp files

### Requirement 13: Error Handling

**User Story:** As a Stata user, I want clear error messages when something goes wrong, so that I can troubleshoot issues.

#### Acceptance Criteria

1. IF Stata is not installed (macOS), THEN THE Extension SHALL display an error message with expected installation paths
2. IF the AppleScript command fails, THEN THE Extension SHALL report the error from osascript
3. IF no active terminal exists, THEN THE Extension SHALL display an error message instructing user to open a terminal with Stata
4. IF the file cannot be saved, THEN THE Extension SHALL report a file save error
5. IF the Temp_File cannot be created, THEN THE Extension SHALL report a temp file creation error

### Requirement 14: Cross-Platform Support

**User Story:** As a Stata user on Windows or Linux, I want to use terminal mode, so that I can send code to Stata even without GUI automation.

#### Acceptance Criteria

1. THE Extension SHALL support terminal mode on all platforms (macOS, Windows, Linux)
2. THE Extension SHALL only enable Stata application commands on macOS (AppleScript is macOS-only)
3. WHEN on Windows, THE Extension SHALL register application commands as stubs that display "Windows support coming soon" messages
4. WHEN on Linux, THE Extension SHALL show appropriate error messages when application mode commands are invoked
5. THE Extension SHALL hide application-mode toolbar menu items on non-macOS platforms
