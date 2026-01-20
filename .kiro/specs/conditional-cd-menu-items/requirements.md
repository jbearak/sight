# Requirements Document

## Introduction

This feature adds conditional menu items to the Sight VS Code extension's "Send to Stata" toolbar menu. When the `sight.sendToStata.workingDirectory` setting is set to `"none"`, two new menu items will appear allowing users to quickly change Stata's working directory to either the workspace folder or the current file's folder before executing code. The default setting is `"lsp"`, so the CD menu items are hidden by default.

## Glossary

- **Working_Directory_Setting**: The VS Code configuration setting `sight.sendToStata.workingDirectory` that controls automatic directory changes before sending code to Stata. Valid values are `"lsp"` (default), `"none"`, `"file"`, or `"workspace"`.
- **Toolbar_Menu**: The "Send to Stata" submenu that appears in the editor title bar when editing Stata files.
- **Workspace_Folder**: The root folder of the currently open VS Code workspace.
- **File_Folder**: The directory containing the currently active Stata file.
- **CD_Command**: A Stata `cd` command that changes the current working directory.

## Requirements

### Requirement 1: Conditional Menu Item Visibility

**User Story:** As a Stata developer, I want to see CD menu options only when automatic directory changing is disabled, so that I can manually control when to change directories without cluttering the menu when automatic CD is already configured.

#### Acceptance Criteria

1. WHEN the Working_Directory_Setting is `"none"` THEN the Toolbar_Menu SHALL display the "CD into Workspace Folder" menu item
2. WHEN the Working_Directory_Setting is `"none"` THEN the Toolbar_Menu SHALL display the "CD into File Folder" menu item
3. WHEN the Working_Directory_Setting is `"file"` THEN the Toolbar_Menu SHALL NOT display the CD menu items
4. WHEN the Working_Directory_Setting is `"workspace"` THEN the Toolbar_Menu SHALL NOT display the CD menu items
5. WHEN the Working_Directory_Setting is `"lsp"` THEN the Toolbar_Menu SHALL NOT display the CD menu items
6. WHEN the Working_Directory_Setting changes from `"none"` to another value THEN the Toolbar_Menu SHALL immediately hide the CD menu items
7. WHEN the Working_Directory_Setting changes to `"none"` from another value THEN the Toolbar_Menu SHALL immediately show the CD menu items

### Requirement 2: CD into Workspace Folder Command

**User Story:** As a Stata developer, I want to quickly change Stata's working directory to my workspace folder, so that I can reference files using relative paths from the project root.

#### Acceptance Criteria

1. WHEN a user selects "CD into Workspace Folder" THEN the Extension SHALL send a `cd` command to Stata with the workspace folder path
2. WHEN a user selects "CD into Workspace Folder" and no workspace is open THEN the Extension SHALL display an error message indicating no workspace is available
3. WHEN the workspace folder path contains special characters (spaces, quotes) THEN the Extension SHALL properly escape the path in the CD_Command
4. THE "CD into Workspace Folder" command SHALL be available in both the main Toolbar_Menu and the Terminal submenu

### Requirement 3: CD into File Folder Command

**User Story:** As a Stata developer, I want to quickly change Stata's working directory to the folder containing my current file, so that I can reference sibling files using relative paths.

#### Acceptance Criteria

1. WHEN a user selects "CD into File Folder" THEN the Extension SHALL send a `cd` command to Stata with the current file's directory path
2. WHEN a user selects "CD into File Folder" and no file is open THEN the Extension SHALL display an error message indicating no file is active
3. WHEN the file folder path contains special characters (spaces, quotes) THEN the Extension SHALL properly escape the path in the CD_Command
4. THE "CD into File Folder" command SHALL be available in both the main Toolbar_Menu and the Terminal submenu

### Requirement 4: Menu Item Placement and Organization

**User Story:** As a Stata developer, I want the CD menu items to be logically organized within the existing menu structure, so that I can easily find and use them.

#### Acceptance Criteria

1. THE CD menu items SHALL appear in a dedicated group within the Toolbar_Menu, separate from the existing "do" and "include" command groups
2. THE CD menu items SHALL appear after the existing command groups but before the Terminal submenu
3. THE "CD into Workspace Folder" item SHALL appear before the "CD into File Folder" item
4. THE CD menu items in the Terminal submenu SHALL follow the same ordering as in the main menu

### Requirement 5: Context Awareness for When Clause

**User Story:** As a VS Code extension developer, I want the menu visibility to be controlled by VS Code's when clause system, so that the menu items respond dynamically to configuration changes.

#### Acceptance Criteria

1. THE Extension SHALL set a context variable to track when the Working_Directory_Setting is `"none"`
2. WHEN the extension activates THEN the Extension SHALL read the current Working_Directory_Setting and set the context variable accordingly
3. WHEN the Working_Directory_Setting configuration changes THEN the Extension SHALL update the context variable
4. THE menu item visibility SHALL be controlled by the context variable in the package.json when clauses
