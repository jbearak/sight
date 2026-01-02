# Requirements Document

## Introduction

This feature adds an installation process for the Sight LSP binary, enabling users to install it to a standard location (`~/bin`) so it can be referenced by name (`sight`) rather than a platform-specific path. This builds on the standalone-binary-distribution feature and makes the LSP usable across projects without hardcoding paths.

## Glossary

- **Sight_Binary**: The compiled native executable for the Sight LSP server
- **Install_Script**: A script that copies the appropriate platform binary to the user's PATH
- **User_Bin**: The `~/bin` directory, a common location for user-installed executables
- **PATH**: The environment variable listing directories where the shell searches for executables
- **Platform_Detection**: Automatic detection of the current operating system and architecture

## Requirements

### Requirement 1: Installation Script

**User Story:** As a developer, I want a simple command to install the Sight binary to my PATH, so that I can use it from any project.

#### Acceptance Criteria

1. WHEN a user runs `bun run install`, THE Install_Script SHALL copy the appropriate platform binary to `~/bin/sight-language-server`
2. WHEN the Install_Script runs, THE Install_Script SHALL detect the current platform (darwin/linux/windows) and architecture (arm64/x64)
3. WHEN the target binary does not exist for the current platform, THE Install_Script SHALL display an error message suggesting to run `bun run build:current` first
4. WHEN `~/bin` does not exist, THE Install_Script SHALL create it
5. WHEN the installation succeeds, THE Install_Script SHALL display a success message with PATH setup instructions if needed

### Requirement 2: Current Platform Build

**User Story:** As a developer, I want to build only the binary for my current platform, so that I can quickly test and install without building all platforms.

#### Acceptance Criteria

1. WHEN a user runs `bun run build:current`, THE Build_System SHALL build only the binary for the current platform and architecture
2. THE Build_System SHALL detect the current platform using `process.platform` and `process.arch`
3. WHEN the build completes, THE Build_System SHALL display the path to the built binary

### Requirement 3: Portable LSP Configuration

**User Story:** As a developer, I want the `lsp.json` to use a portable binary reference, so that it works on any machine with Sight installed.

#### Acceptance Criteria

1. THE LSP_Config SHALL reference the binary as `"sight-language-server"` (relying on PATH) rather than a platform-specific path
2. WHEN Kiro CLI loads the LSP_Config, THE LSP_Config SHALL work if `sight-language-server` is in the user's PATH
3. THE Repository SHALL include documentation explaining that users need to install the binary or add `~/bin` to PATH

### Requirement 4: Uninstallation

**User Story:** As a developer, I want to be able to uninstall the Sight binary, so that I can clean up when no longer needed.

#### Acceptance Criteria

1. WHEN a user runs `bun run uninstall`, THE Uninstall_Script SHALL remove `~/bin/sight-language-server` if it exists
2. WHEN the binary does not exist, THE Uninstall_Script SHALL display a message indicating nothing to uninstall
3. WHEN the uninstallation succeeds, THE Uninstall_Script SHALL display a success message

### Requirement 5: PATH Verification

**User Story:** As a developer, I want the installation to verify my PATH setup, so that I know if additional configuration is needed.

#### Acceptance Criteria

1. WHEN the installation completes, THE Install_Script SHALL check if `~/bin` is in the user's PATH
2. IF `~/bin` is not in PATH, THE Install_Script SHALL display instructions for adding it to the shell configuration
3. THE Install_Script SHALL provide instructions for common shells (bash, zsh, fish)
