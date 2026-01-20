# Requirements Document

## Introduction

This document specifies the requirements for adding Windows support to the VS Code extension's send-to-stata feature. Currently, the extension supports sending Stata code to the Stata GUI application on macOS using AppleScript. This feature will extend that capability to Windows using Win32 APIs for window management and keystroke simulation.

The implementation must integrate with the existing VS Code extension architecture in `client/src/send-to-stata/`, maintaining cross-platform code where possible (statement detection, temp files, terminal mode) while adding Windows-specific code for GUI application interaction.

## Glossary

- **Send_To_Stata_Module**: The VS Code extension module in `client/src/send-to-stata/` that handles sending Stata code to Stata for execution
- **Stata_GUI**: The Stata graphical application (StataMP, StataSE, StataBE, StataIC, or Stata variants)
- **Win32_API**: Windows native APIs for window management, clipboard operations, and keyboard input
- **Command_Window**: Stata's command input area, accessible via Ctrl+1 keyboard shortcut
- **Temp_Do_File**: A temporary `.do` file created to hold code for execution
- **Focus_Management**: The process of activating windows and managing keyboard focus between VS Code and Stata
- **Native_Executable**: A compiled binary (e.g., `.exe`) that can be bundled with the extension
- **FFI**: Foreign Function Interface - a mechanism to call native code from TypeScript/JavaScript

## Requirements

### Requirement 1: Windows Platform Detection

**User Story:** As a Windows user, I want the extension to detect my platform and use the appropriate method to send code to Stata, so that I can use the same commands as macOS users.

#### Acceptance Criteria

1. WHEN the extension runs on Windows AND the target is 'app', THE Send_To_Stata_Module SHALL use the Windows-specific implementation instead of showing an error
2. WHEN the extension runs on Windows AND the target is 'terminal', THE Send_To_Stata_Module SHALL continue using the existing cross-platform terminal implementation
3. THE Send_To_Stata_Module SHALL maintain the existing macOS AppleScript implementation unchanged

### Requirement 2: Stata Instance Detection on Windows

**User Story:** As a Windows user, I want the extension to find my running Stata instance automatically, so that I don't have to configure anything manually.

#### Acceptance Criteria

1. WHEN searching for Stata on Windows, THE Send_To_Stata_Module SHALL search for processes named StataMP, StataSE, StataBE, StataIC, Stata (and their -64 variants)
2. WHEN multiple Stata processes are running, THE Send_To_Stata_Module SHALL select the first one with a valid main window
3. WHEN no Stata process is found, THE Send_To_Stata_Module SHALL display an error message instructing the user to start Stata
4. THE Send_To_Stata_Module SHALL validate the Stata window by checking that the window title matches the pattern "Stata/MP", "Stata/SE", "Stata/BE", "Stata/IC", or "StataNow/*"
5. THE Send_To_Stata_Module SHALL exclude Stata Viewer windows from detection

### Requirement 3: Send Code to Stata GUI on Windows

**User Story:** As a Windows user, I want to send code from VS Code to the Stata GUI application, so that I can execute Stata commands without switching windows manually.

#### Acceptance Criteria

1. WHEN sending code to Stata on Windows, THE Send_To_Stata_Module SHALL write the code to a temporary `.do` file
2. WHEN sending code to Stata on Windows, THE Send_To_Stata_Module SHALL copy the `do` or `include` command to the clipboard
3. WHEN sending code to Stata on Windows, THE Send_To_Stata_Module SHALL activate the Stata window
4. WHEN sending code to Stata on Windows, THE Send_To_Stata_Module SHALL send Ctrl+1 to focus the Command_Window
5. WHEN sending code to Stata on Windows, THE Send_To_Stata_Module SHALL send Ctrl+V to paste the command
6. WHEN sending code to Stata on Windows, THE Send_To_Stata_Module SHALL send Enter to execute the command
7. IF the Stata window cannot be activated, THEN THE Send_To_Stata_Module SHALL display an error message

### Requirement 4: Support All Send Modes on Windows

**User Story:** As a Windows user, I want all the same send modes available on macOS, so that I have feature parity.

#### Acceptance Criteria

1. THE Send_To_Stata_Module SHALL support 'statement' mode on Windows (send current statement or selection)
2. THE Send_To_Stata_Module SHALL support 'upward' mode on Windows (send from line 1 to cursor)
3. THE Send_To_Stata_Module SHALL support 'downward' mode on Windows (send from cursor to end)
4. THE Send_To_Stata_Module SHALL support 'file' mode on Windows (send entire file)
5. THE Send_To_Stata_Module SHALL support both 'do' and 'include' commands on Windows

### Requirement 5: Focus Management on Windows

**User Story:** As a Windows user, I want control over whether focus returns to VS Code after sending code, so that I can choose my preferred workflow.

#### Acceptance Criteria

1. THE Send_To_Stata_Module SHALL return focus to VS Code by default after sending code on Windows
2. WHEN activating the Stata window, THE Send_To_Stata_Module SHALL restore the window if it is minimized
3. WHEN activating the Stata window, THE Send_To_Stata_Module SHALL use the Alt key trick to bypass Windows focus-stealing prevention
4. IF focus cannot be acquired after multiple attempts, THEN THE Send_To_Stata_Module SHALL display an error message suggesting the user check if Stata is running as Administrator

### Requirement 6: Path Escaping for Windows

**User Story:** As a Windows user, I want file paths to be properly escaped for Stata, so that paths with special characters work correctly.

#### Acceptance Criteria

1. WHEN formatting paths for Stata on Windows, THE Send_To_Stata_Module SHALL double all backslashes
2. WHEN a path contains double quotes, THE Send_To_Stata_Module SHALL use Stata's compound string syntax (`` `"path"' ``)
3. THE Send_To_Stata_Module SHALL use the existing `escape_path_for_stata` function which already handles Windows paths

### Requirement 7: Working Directory Support on Windows

**User Story:** As a Windows user, I want the working directory feature to work the same as on macOS, so that my scripts can use relative paths.

#### Acceptance Criteria

1. THE Send_To_Stata_Module SHALL support the 'lsp' working directory option on Windows
2. THE Send_To_Stata_Module SHALL support the 'file' working directory option on Windows
3. THE Send_To_Stata_Module SHALL support the 'workspace' working directory option on Windows
4. THE Send_To_Stata_Module SHALL support the 'none' working directory option on Windows
5. WHEN prepending a cd command on Windows, THE Send_To_Stata_Module SHALL use properly escaped Windows paths

### Requirement 8: Error Handling on Windows

**User Story:** As a Windows user, I want clear error messages when something goes wrong, so that I can troubleshoot issues.

#### Acceptance Criteria

1. IF Stata is not running, THEN THE Send_To_Stata_Module SHALL display "No running Stata instance found. Start Stata before sending code."
2. IF the Stata window cannot be activated, THEN THE Send_To_Stata_Module SHALL display an error mentioning focus-stealing prevention and Administrator mode
3. IF clipboard operations fail, THEN THE Send_To_Stata_Module SHALL display "Failed to set clipboard"
4. IF keystroke sending fails, THEN THE Send_To_Stata_Module SHALL display an error with the failure details

### Requirement 9: Implementation Approach Decision

**User Story:** As a maintainer, I want a clear decision on the implementation approach, so that the codebase remains maintainable.

#### Acceptance Criteria

1. THE design document SHALL evaluate both approaches: bundling a native executable vs. using FFI from TypeScript
2. THE design document SHALL document the trade-offs of each approach
3. THE design document SHALL recommend one approach with justification
4. IF the native executable approach is chosen, THEN THE Send_To_Stata_Module SHALL bundle the executable with the VS Code extension
5. IF the FFI approach is chosen, THEN THE Send_To_Stata_Module SHALL use a well-maintained FFI library

### Requirement 10: Cross-Platform Code Preservation

**User Story:** As a maintainer, I want to maximize code reuse between platforms, so that the codebase is easier to maintain.

#### Acceptance Criteria

1. THE Send_To_Stata_Module SHALL continue using the existing statement detection code on Windows
2. THE Send_To_Stata_Module SHALL continue using the existing temp file creation code on Windows
3. THE Send_To_Stata_Module SHALL continue using the existing terminal mode code on Windows
4. THE Send_To_Stata_Module SHALL continue using the existing cursor advancement code on Windows
5. THE Send_To_Stata_Module SHALL continue using the existing path escaping code on Windows

### Requirement 11: Configuration Compatibility

**User Story:** As a Windows user, I want the same configuration options as macOS users, so that I can customize my workflow.

#### Acceptance Criteria

1. THE Send_To_Stata_Module SHALL respect the `sight.sendToStata.saveBeforeSend` setting on Windows
2. THE Send_To_Stata_Module SHALL respect the `sight.sendToStata.advanceCursorOnSend` setting on Windows
3. THE Send_To_Stata_Module SHALL respect the `sight.sendToStata.workingDirectory` setting on Windows

### Requirement 12: On-Demand Executable Download

**User Story:** As a Windows user, I want the extension to automatically download the required executable on first use, so that the extension stays small and I only download what I need.

#### Acceptance Criteria

1. WHEN a Windows user triggers a send-to-stata app command for the first time, THE Send_To_Stata_Module SHALL check if the executable exists in the extension's global storage
2. IF the executable does not exist, THEN THE Send_To_Stata_Module SHALL prompt the user with a message explaining that Windows support for send-to-stata requires downloading a helper executable
3. IF the user accepts the download, THEN THE Send_To_Stata_Module SHALL show a progress indicator during download
4. THE Send_To_Stata_Module SHALL download the architecture-appropriate executable (x64 or arm64) from the zed-stata GitHub releases
5. THE Send_To_Stata_Module SHALL store the downloaded executable in VS Code's extension global storage directory
6. THE Send_To_Stata_Module SHALL verify the downloaded executable's integrity using a checksum
7. IF the download succeeds, THEN THE Send_To_Stata_Module SHALL show a success notification
8. IF the download fails, THEN THE Send_To_Stata_Module SHALL show an error message with troubleshooting guidance
9. IF the user declines the download, THEN THE Send_To_Stata_Module SHALL not execute the command and SHALL inform the user that Windows app mode requires the download

### Requirement 13: Executable Updates

**User Story:** As a Windows user, I want the extension to handle executable updates gracefully, so that I always have a working version.

#### Acceptance Criteria

1. THE Send_To_Stata_Module SHALL store a version identifier alongside the downloaded executable
2. WHEN the extension is updated, THE Send_To_Stata_Module SHALL check if a newer executable version is required
3. IF a newer version is required, THEN THE Send_To_Stata_Module SHALL prompt the user to download the update
4. THE Send_To_Stata_Module SHALL allow the user to continue using the existing executable if they decline the update (unless breaking changes require it)
