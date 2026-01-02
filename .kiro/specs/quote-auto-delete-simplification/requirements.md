---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - restore-test-regime: [Related diagnostics spec]
  - comment-style-normalization: [Related diagnostics spec]
  - large-file-indexing-policy: [Related diagnostics spec]
---

# Requirements Document

## Introduction

This feature simplifies the quote auto-delete logic in the Stata VS Code extension. The current implementation is overly complex. This simplification uses two straightforward rules based solely on the character being deleted and the character immediately to its right—no nesting level tracking required.

The feature handles two Stata quoting constructs:
- Local macros: `` `macro' `` (backtick opens, apostrophe closes)
- Compound strings: `` `"string"' `` (backtick-quote opens, quote-apostrophe closes)

Note: VS Code's built-in `autoClosingPairs` in `language-configuration.json` handles standalone double quotes (`""`). This feature handles the Stata-specific backtick/apostrophe pairs and the double-quote cleanup within compound strings.

## Glossary

- **Auto_Delete_Handler**: The system component that detects deletion of opening delimiters and removes corresponding closing delimiters
- **Cursor_Position**: The position in the document after a deletion has occurred
- **Character_To_Right**: The character immediately after the cursor position following a deletion
- **Compound_String**: A Stata string delimited by `` `" `` and `` "' ``

## Requirements

### Requirement 1: Backtick Deletion Triggers Apostrophe Cleanup

**User Story:** As a Stata developer, I want the auto-inserted apostrophe to be deleted when I delete a backtick, so that I don't have orphaned closing delimiters.

#### Acceptance Criteria

1. WHEN a user deletes a backtick character AND the character immediately to the right of the cursor is an apostrophe, THEN the Auto_Delete_Handler SHALL delete that apostrophe
2. WHEN a user deletes a backtick character AND the character immediately to the right of the cursor is NOT an apostrophe, THEN the Auto_Delete_Handler SHALL NOT delete any characters

### Requirement 2: Apostrophe Deletion Has No Side Effects

**User Story:** As a Stata developer, I want apostrophe deletion to behave normally without any automatic cleanup, so that I have predictable editing behavior.

#### Acceptance Criteria

1. WHEN a user deletes an apostrophe character, THEN the Auto_Delete_Handler SHALL NOT delete any additional characters

### Requirement 3: Double Quote Deletion Triggers Double Quote Cleanup

**User Story:** As a Stata developer, I want the auto-inserted closing double quote to be deleted when I delete an opening double quote, so that I don't have orphaned closing delimiters.

#### Acceptance Criteria

1. WHEN a user deletes a double quote character AND the character immediately to the right of the cursor is a double quote, THEN the Auto_Delete_Handler SHALL delete that double quote
2. WHEN a user deletes a double quote character AND the character immediately to the right of the cursor is NOT a double quote, THEN the Auto_Delete_Handler SHALL NOT delete any characters

### Requirement 4: Compound String Cleanup Works Naturally

**User Story:** As a Stata developer, I want compound string delimiters (`` `" "' ``) to clean up correctly through repeated backspaces, so that I can easily undo auto-inserted compound strings.

#### Acceptance Criteria

1. WHEN a user has typed `` `"a`"b `` resulting in `` `"a`"b|"'"' `` (where | is cursor) AND the user deletes "b", THEN the Auto_Delete_Handler SHALL NOT delete any characters (letter deletion, not a delimiter)
2. WHEN the user then deletes the double quote (state: `` `"a`"|"'"' ``) THEN the Auto_Delete_Handler SHALL delete the double quote to the right (resulting in `` `"a`"|'"' ``)
3. WHEN the user then deletes the backtick (state: `` `"a|'"' ``) THEN the Auto_Delete_Handler SHALL delete the apostrophe to the right (resulting in `` `"a|"' ``)

### Requirement 5: Only Single Character Deletions Are Handled

**User Story:** As a Stata developer, I want the auto-delete feature to only apply to single character deletions, so that bulk deletions behave predictably.

#### Acceptance Criteria

1. WHEN a user deletes multiple characters at once (e.g., via selection delete), THEN the Auto_Delete_Handler SHALL NOT perform any automatic cleanup
2. THE Auto_Delete_Handler SHALL only process deletions where exactly one character was removed
