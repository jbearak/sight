# Requirements Document

## Introduction

This feature adds extension conflict detection to the Sight VS Code client extension. When users have multiple Stata-related extensions installed, they may experience syntax highlighting conflicts, duplicate language features, or unexpected behavior. This feature detects conflicting extensions at activation time and provides users with clear guidance on how to resolve the conflicts.

## Glossary

- **Conflict_Detector**: The module responsible for scanning installed VS Code extensions and identifying those that may conflict with Sight
- **Conflicting_Extension**: Any VS Code extension (other than Sight) that contributes the 'stata' language ID or registers file extensions like `.do`, `.ado`, `.mata`
- **Extension_Context**: The VS Code ExtensionContext object that provides access to global state and subscriptions
- **Global_State**: VS Code's persistent storage mechanism for extension data that survives restarts
- **Status_Bar_Item**: A VS Code status bar element that displays conflict warnings

## Requirements

### Requirement 1: Detect Conflicting Extensions

**User Story:** As a user, I want Sight to automatically detect other Stata extensions when it activates, so that I am aware of potential conflicts that could affect my editing experience.

#### Acceptance Criteria

1. WHEN the Sight extension activates, THE Conflict_Detector SHALL scan all installed extensions for potential conflicts
2. THE Conflict_Detector SHALL identify extensions as conflicting IF they contribute the 'stata' language ID
3. THE Conflict_Detector SHALL identify extensions as conflicting IF they register any of the file extensions: `.do`, `.ado`, or `.mata`
4. THE Conflict_Detector SHALL exclude the Sight extension itself from the conflict list
5. THE Conflict_Detector SHALL return a list of conflicting extension identifiers and display names

### Requirement 2: Show One-Time Warning Notification

**User Story:** As a user, I want to see a warning notification when conflicts are detected for the first time, so that I can take action without being repeatedly bothered.

#### Acceptance Criteria

1. WHEN conflicts are detected AND the user has not previously dismissed the warning, THE Conflict_Detector SHALL display a warning notification
2. THE warning notification SHALL list the names of conflicting extensions
3. THE warning notification SHALL provide four action buttons: "Disable Other Extension(s)", "Uninstall Other Extension(s)", "Learn More", and "Dismiss"
4. WHEN the user clicks "Disable Other Extension(s)", THE Conflict_Detector SHALL open the VS Code Extensions view filtered to installed extensions
5. WHEN the user clicks "Uninstall Other Extension(s)", THE Conflict_Detector SHALL open the VS Code Extensions view filtered to installed extensions
6. WHEN the user clicks "Learn More", THE Conflict_Detector SHALL open the Sight documentation URL in the default browser
7. WHEN the user clicks "Dismiss" OR closes the notification, THE Conflict_Detector SHALL record that the warning has been shown using Global_State
8. THE Conflict_Detector SHALL NOT show the warning notification on subsequent activations after the user has dismissed it

### Requirement 3: Display Status Bar Conflict Indicator

**User Story:** As a user, I want to see a persistent status bar indicator when conflicts exist and I'm working on Stata files, so that I have a visual reminder and quick access to conflict information.

#### Acceptance Criteria

1. WHEN conflicts are detected AND a Stata file is open in the active editor, THE Conflict_Detector SHALL display a Status_Bar_Item with a warning icon and text "Stata: Conflict"
2. THE Status_Bar_Item SHALL include a tooltip listing the conflicting extension names
3. WHEN the user clicks the Status_Bar_Item, THE Conflict_Detector SHALL display the conflict help information
4. WHEN no conflicts are detected, THE Conflict_Detector SHALL NOT display the Status_Bar_Item
5. WHEN no Stata file is open in the active editor, THE Conflict_Detector SHALL hide the Status_Bar_Item
6. THE Status_Bar_Item SHALL be positioned on the right side of the status bar
7. WHEN the active editor changes to a Stata file AND conflicts exist, THE Conflict_Detector SHALL show the Status_Bar_Item
8. WHEN the active editor changes away from a Stata file, THE Conflict_Detector SHALL hide the Status_Bar_Item


