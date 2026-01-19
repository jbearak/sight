# Requirements Document

## Introduction

This feature adds automatic cursor advancement when sending a single line to Stata. When users execute the "send to Stata" command for the current line (not a selection or entire file), VS Code should automatically move the cursor to the next line after execution. This behavior is controlled by a user setting, allowing users to enable or disable the auto-advance functionality based on their workflow preferences.

## Glossary

- **Cursor_Advancer**: The component responsible for moving the editor cursor to the next line after a single-line send operation
- **Send_Command_Handler**: The existing command handler in `commands.ts` that processes send-to-stata operations
- **Single_Line_Send**: A send operation where no selection exists and the user is sending the current line (statement mode without selection)
- **Statement_Bounds**: The start and end line indices of a detected Stata statement (may span multiple lines with `///` continuations)

## Requirements

### Requirement 1: Cursor Advancement After Single-Line Send

**User Story:** As a Stata developer, I want the cursor to automatically advance to the next line after sending the current line to Stata, so that I can quickly execute code line-by-line without manually moving the cursor.

#### Acceptance Criteria

1. WHEN a user sends a single line to Stata (no selection active) AND the cursor advance setting is enabled, THEN THE Cursor_Advancer SHALL move the cursor to the line immediately following the sent statement
2. WHEN a user sends a multi-line statement (with `///` continuations) AND the cursor advance setting is enabled, THEN THE Cursor_Advancer SHALL move the cursor to the line immediately following the last line of the statement
3. WHEN a user sends a selection to Stata, THEN THE Cursor_Advancer SHALL NOT move the cursor regardless of the setting
4. WHEN a user sends an entire file to Stata, THEN THE Cursor_Advancer SHALL NOT move the cursor regardless of the setting
5. WHEN the cursor is on the last line of the document AND a single-line send is executed, THEN THE Cursor_Advancer SHALL keep the cursor on the current line (no advancement)

### Requirement 2: Configuration Setting for Cursor Advance

**User Story:** As a Stata developer, I want to control whether the cursor automatically advances after sending a line, so that I can customize the behavior to match my preferred workflow.

#### Acceptance Criteria

1. THE Extension SHALL provide a configuration setting `sight.sendToStata.advanceCursorOnSend` of type boolean
2. THE Extension SHALL default the `sight.sendToStata.advanceCursorOnSend` setting to `true` (enabled)
3. WHEN the setting is set to `false`, THEN THE Cursor_Advancer SHALL NOT move the cursor after any send operation
4. WHEN the setting is changed, THEN THE Extension SHALL apply the new behavior immediately without requiring a restart

### Requirement 3: Cursor Positioning After Advancement

**User Story:** As a Stata developer, I want the cursor to be positioned at the beginning of the next line after advancement, so that I can immediately see and execute the next statement.

#### Acceptance Criteria

1. WHEN the cursor advances to the next line, THEN THE Cursor_Advancer SHALL position the cursor at column 0 (beginning of line)
2. WHEN the cursor advances, THEN THE Cursor_Advancer SHALL clear any existing selection
3. WHEN the cursor advances, THEN THE Cursor_Advancer SHALL ensure the new cursor position is visible in the editor viewport
