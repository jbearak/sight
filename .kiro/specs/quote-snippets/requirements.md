---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - None
Status: Active
Related Specs:
  - None
---

# Requirements Document

## Introduction

This feature addresses broken auto-closing pair behavior for nested Stata string and macro syntax in VS Code. Stata has unique quoting conventions where local macros use `` `name' ``, global macros use `${name}`, and compound strings use `` `"text"' ``. These can be nested (e.g., `` ``nested'' `` or `` `"`"nested"'"' ``), and the current auto-closing configuration doesn't handle nesting correctly.

## Glossary

- **Auto_Closing_Pair**: A VS Code language configuration feature that automatically inserts a closing character when an opening character is typed
- **Local_Macro**: A Stata macro referenced with backtick-apostrophe syntax: `` `name' ``
- **Global_Macro**: A Stata macro referenced with dollar-brace syntax: `${name}`
- **Compound_String**: A Stata string literal using backtick-quote syntax: `` `"text"' ``
- **Nested_Macro**: A macro reference inside another macro or string, requiring doubled delimiters
- **Nested_Compound_String**: A compound string inside another compound string, requiring doubled delimiters

## Requirements

### Requirement 1: Non-Nested Local Macro Auto-Closing

**User Story:** As a Stata developer, I want typing a backtick to auto-insert an apostrophe, so that I can quickly write local macro references.

#### Acceptance Criteria

1. WHEN a user types a single backtick (`` ` ``) THEN the Auto_Closing_Pair SHALL insert an apostrophe (`'`) and position the cursor between them
2. THE resulting text SHALL be `` `|' `` where `|` represents cursor position

### Requirement 2: Non-Nested Global Macro Auto-Closing

**User Story:** As a Stata developer, I want typing `${` to auto-insert `}`, so that I can quickly write global macro references.

#### Acceptance Criteria

1. WHEN a user types `${` THEN the Auto_Closing_Pair SHALL insert `}` and position the cursor between them
2. THE resulting text SHALL be `${|}` where `|` represents cursor position

### Requirement 3: Nested Local Macro Auto-Closing

**User Story:** As a Stata developer, I want typing double backticks to auto-insert double apostrophes, so that I can write nested macro references.

#### Acceptance Criteria

1. WHEN a user types double backticks (```` `` ````) THEN the Auto_Closing_Pair SHALL insert double apostrophes (`''`) and position the cursor between them
2. THE resulting text SHALL be ```` ``|'' ```` where `|` represents cursor position

### Requirement 4: Nested Global Macro Auto-Closing

**User Story:** As a Stata developer, I want typing `${{` to auto-insert `}}`, so that I can write nested global macro references.

#### Acceptance Criteria

1. WHEN a user types `${{` THEN the Auto_Closing_Pair SHALL insert `}}` and position the cursor between them
2. THE resulting text SHALL be `${{|}}` where `|` represents cursor position

### Requirement 5: Non-Nested Compound String Auto-Closing

**User Story:** As a Stata developer, I want typing `` `" `` to auto-insert `"'`, so that I can quickly write compound strings.

#### Acceptance Criteria

1. WHEN a user types `` `" `` THEN the Auto_Closing_Pair SHALL insert `"'` and position the cursor between them
2. THE resulting text SHALL be `` `"|"' `` where `|` represents cursor position

### Requirement 6: Nested Compound String Auto-Closing

**User Story:** As a Stata developer, I want typing `` `"`" `` to auto-insert `"'"'`, so that I can write nested compound strings.

#### Acceptance Criteria

1. WHEN a user types `` `"`" `` (opening a nested compound string inside a compound string) THEN the Auto_Closing_Pair SHALL insert `"'"'` and position the cursor correctly
2. THE resulting text SHALL be `` `"`"|"'"' `` where `|` represents cursor position
3. IF the current behavior produces `` `"`"|' `` THEN this is a defect that SHALL be corrected

### Requirement 7: Local Macro Inside Compound String Auto-Closing

**User Story:** As a Stata developer, I want typing a backtick inside a compound string to properly close both the macro and maintain the compound string closure.

#### Acceptance Criteria

1. WHEN a user types `` `"` `` (starting a local macro inside a compound string) THEN the Auto_Closing_Pair SHALL insert `'"'` to close both the macro and the compound string
2. THE resulting text SHALL be `` `"`|'"' `` where `|` represents cursor position
3. IF the current behavior produces `` `"`|"' `` (macro not closed) THEN this is a defect that SHALL be corrected

### Requirement 8: Local Macro Inside Double-Quoted String Auto-Closing

**User Story:** As a Stata developer, I want typing a backtick inside a double-quoted string to properly close the macro while maintaining the string closure.

#### Acceptance Criteria

1. WHEN a user types `` "` `` (starting a local macro inside a double-quoted string) THEN the Auto_Closing_Pair SHALL insert `'"` to close both the macro and the string
2. THE resulting text SHALL be `` "`|'" `` where `|` represents cursor position
3. IF the current behavior produces `` "`|" `` (macro not closed) THEN this is a defect that SHALL be corrected

### Requirement 9: Preserve Existing Working Behavior

**User Story:** As a Stata developer, I want all currently working auto-closing behaviors to continue working after any changes.

#### Acceptance Criteria

1. THE Auto_Closing_Pair for curly braces `{` → `}` SHALL continue to work
2. THE Auto_Closing_Pair for square brackets `[` → `]` SHALL continue to work
3. THE Auto_Closing_Pair for parentheses `(` → `)` SHALL continue to work
4. THE Auto_Closing_Pair for double quotes `"` → `"` SHALL continue to work
5. WHEN changes are made to fix nesting issues THEN existing non-nested behaviors SHALL NOT regress

### Requirement 10: Skip-Over Behavior for Closing Characters

**User Story:** As a Stata developer, I want typing a closing character to skip over an existing auto-inserted closing character, so that I don't end up with duplicate closing characters.

#### Acceptance Criteria

1. WHEN a user types an apostrophe (`'`) and the cursor is immediately before an existing apostrophe THEN the system SHALL skip over the existing apostrophe instead of inserting a duplicate
2. WHEN a user types a double quote (`"`) and the cursor is immediately before an existing double quote THEN the system SHALL skip over the existing double quote instead of inserting a duplicate
3. WHEN a user types an apostrophe (`'`) and the cursor is immediately before `"'` (compound string close) THEN the system SHALL skip over both characters to close the compound string
4. THE resulting cursor position SHALL be immediately after the skipped character(s)
