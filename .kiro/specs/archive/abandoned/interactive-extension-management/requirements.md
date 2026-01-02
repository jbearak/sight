# Requirements Document

## Introduction

The setup.sh script currently automatically disables incompatible Stata extensions without user consent. This behavior should be improved to respect user choice and provide clear options for handling extension conflicts.

## Glossary

- **Setup_Script**: The setup.sh bash script that installs Sight LSP
- **Incompatible_Extension**: Any VS Code extension that conflicts with Sight's syntax highlighting (e.g., kylebarron.stata-enhanced)
- **Editor**: Any VS Code-compatible editor (code, code-insiders, codium, kiro, antigravity, cursor, windsurf)
- **User_Choice**: The user's selection from the presented options (1, 2, or 3)

## Requirements

### Requirement 1

**User Story:** As a user running setup.sh, I want to be asked before any extensions are disabled, so that I maintain control over my editor configuration.

#### Acceptance Criteria

1. WHEN the Setup_Script detects an Incompatible_Extension in an Editor, THE Setup_Script SHALL present options to the user before taking any action
2. WHEN the --yes flag is provided, THE Setup_Script SHALL automatically disable Incompatible_Extensions without prompting
3. WHEN no --yes flag is provided, THE Setup_Script SHALL wait for user input before proceeding
4. THE Setup_Script SHALL present exactly three numbered options for each detected conflict
5. THE Setup_Script SHALL re-prompt if the user enters an invalid choice (not 1, 2, or 3)

### Requirement 2

**User Story:** As a user with conflicting extensions, I want clear options for resolving the conflict, so that I can make an informed decision about my editor setup.

#### Acceptance Criteria

1. WHEN presenting options, THE Setup_Script SHALL display the extension name and editor name
2. THE Setup_Script SHALL offer option 1 to disable the Incompatible_Extension
3. THE Setup_Script SHALL offer option 2 to uninstall the Incompatible_Extension
4. THE Setup_Script SHALL offer option 3 to do nothing and keep the existing extension
5. THE Setup_Script SHALL clearly explain that option 3 means continuing to use the existing extension's syntax highlighting

### Requirement 3

**User Story:** As a user with multiple editors installed, I want to be prompted separately for each editor/extension combination, so that I can make different choices for different editors.

#### Acceptance Criteria

1. WHEN multiple Editors have Incompatible_Extensions, THE Setup_Script SHALL prompt for each Editor separately
2. WHEN processing multiple conflicts, THE Setup_Script SHALL handle each Editor/extension combination independently
3. THE Setup_Script SHALL continue processing remaining Editors even if the user chooses "do nothing" for one Editor
4. THE Setup_Script SHALL use a helper function to handle the prompting logic consistently

### Requirement 4

**User Story:** As a user, I want the setup script to handle my input validation gracefully, so that I don't accidentally make the wrong choice due to typos.

#### Acceptance Criteria

1. WHEN the user enters an invalid choice, THE Setup_Script SHALL display an error message
2. WHEN re-prompting after invalid input, THE Setup_Script SHALL show the same options again
3. THE Setup_Script SHALL only accept exactly "1", "2", or "3" as valid inputs
4. THE Setup_Script SHALL continue re-prompting until a valid choice is made
5. THE Setup_Script SHALL preserve the original prompt formatting when re-prompting

### Requirement 5

**User Story:** As a user running automated scripts, I want the --yes flag to work consistently, so that I can use setup.sh in CI/CD pipelines without manual intervention.

#### Acceptance Criteria

1. WHEN --yes or -y flag is provided, THE Setup_Script SHALL automatically choose option 1 (disable) for all conflicts
2. WHEN --yes or -y flag is provided, THE Setup_Script SHALL not display any prompts for extension conflicts
3. WHEN --yes or -y flag is provided, THE Setup_Script SHALL log what actions were taken automatically
4. THE Setup_Script SHALL recognize --yes or -y in any position in the argument list
5. THE Setup_Script SHALL maintain backward compatibility with existing automated usage