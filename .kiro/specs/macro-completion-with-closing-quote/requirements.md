---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies the behavior for macro completion when the cursor is inside a macro reference. This covers both local macros (`` `name' ``) and global macros (`$name` or `${name}`). The goal is to ensure completions appear in all common editing scenarios, including when the user is editing anywhere within an existing reference (e.g., snippet-inserted), or typing a new reference.

## Glossary

- **Local_Macro_Reference**: A Stata local macro reference delimited by backtick and apostrophe: `` `name' ``
- **Global_Macro_Reference**: A Stata global macro reference in the form `$name` or `${name}`
- **Completion_Provider**: The LSP component that generates auto-complete suggestions
- **Macro_Context**: A detected state indicating the user is typing inside a macro reference
- **Macro_Identifier_Char**: An ASCII letter, digit, or underscore: `[A-Za-z0-9_]` (hyphen `-` is not included)
- **Macro_Identifier**: One or more `Macro_Identifier_Char` characters
- **Replacement_Range**: The range of text inside the macro reference that a completion replaces (may be empty)
- **Prefix**: The current `Macro_Identifier` text in `Replacement_Range` used to filter completion suggestions

## Requirements

### Requirement 1: Detect Local Macro Context

**User Story:** As a developer, I want macro completions to appear when I'm editing inside a local macro reference, so that I can easily select the correct macro name.

#### Acceptance Criteria

1. WHEN completion is invoked and the cursor is inside a local macro reference (strictly between a backtick `` ` `` and the closing apostrophe `'`, if present), THE Completion_Provider SHALL detect this as a local `Macro_Context`
2. WHEN completion is invoked and the cursor is in an empty local macro reference (`` `|' ``), THE Completion_Provider SHALL detect this as a local `Macro_Context`
3. WHEN completion is invoked and the cursor is after the closing apostrophe (e.g., `` `name'| ``), THE Completion_Provider SHALL NOT detect a local `Macro_Context`
4. WHEN completion is invoked in a string literal and the cursor is immediately after a backtick, THE Completion_Provider SHALL return local macro completions
5. WHEN completion is invoked in a string literal and the cursor is in an empty local macro reference (`` `|' ``), THE Completion_Provider SHALL return local macro completions
6. WHEN completion is invoked in a string literal and the text between the backtick and the cursor contains at least one `Macro_Identifier_Char`, THE Completion_Provider SHALL return local macro completions
7. WHEN the backtick trigger character is typed outside comments, THE Completion_Provider SHALL return local macro completions

### Requirement 2: Detect Global Macro Context

**User Story:** As a developer, I want macro completions to appear when I'm typing a global macro reference, so that I can easily select the correct macro name.

#### Acceptance Criteria

1. WHEN completion is invoked and the cursor is inside a global macro reference after `$` (unbraced form), THE Completion_Provider SHALL detect this as a global `Macro_Context`
2. WHEN completion is invoked and the cursor is inside a global macro reference after `${` and before the corresponding `}` (if present), THE Completion_Provider SHALL detect this as a global `Macro_Context`
3. WHEN completion is invoked and the cursor is immediately after `${` (empty braced form, `${|`), THE Completion_Provider SHALL return global macro completions
4. WHEN completion is invoked and the cursor is after the closing `}` (e.g., `${name}|`), THE Completion_Provider SHALL NOT detect a global `Macro_Context`
5. WHEN the dollar sign trigger character is typed, THE Completion_Provider SHALL return global macro completions

### Requirement 3: Macro Completions and Comment Context

**User Story:** As a developer, I want macro completions to be available in code-like contexts (including strings and embedded language blocks) but not in comments, so that I don't get noisy suggestions while writing comments.

#### Acceptance Criteria

1. WHEN completion is invoked and the cursor is in a comment, THE Completion_Provider SHALL NOT return macro completions
2. WHEN completion is invoked and the cursor is in an embedded Mata or Python block and the cursor is in a comment, THE Completion_Provider SHALL NOT return macro completions
3. WHEN completion is invoked and the cursor is in a string literal, THE Completion_Provider SHALL return macro completions if `Macro_Context` is detected
4. WHEN completion is invoked and the cursor is in an embedded Mata or Python block, THE Completion_Provider SHALL return macro completions if `Macro_Context` is detected

### Requirement 4: Compute Replacement Range and Prefix (Local)

**User Story:** As a developer, I want the completion list to filter based on what I've typed inside the local macro reference and replace the correct portion of text, so that completion works anywhere within the macro name.

#### Acceptance Criteria

1. WHEN in a local `Macro_Context`, THE Completion_Provider SHALL compute `Replacement_Range` as the maximal contiguous span of `Macro_Identifier_Char` characters surrounding the cursor, restricted to the contents of the local macro reference and bounded by any non-`Macro_Identifier_Char` characters (e.g., whitespace)
2. WHEN in a local `Macro_Context`, THE Completion_Provider SHALL set `Prefix` to the exact text contained in `Replacement_Range` (empty string if `Replacement_Range` is empty)
3. WHEN the local macro reference contains non-`Macro_Identifier_Char` characters before the closing apostrophe (e.g., `` `foo bar' `` or `` `apple.sauce' ``), THE Completion_Provider SHALL treat the first such character as ending the macro name and SHALL NOT replace any text after it; this is invalid macro syntax and SHOULD be reported by diagnostics as an error covering the full macro reference span with a message like "invalid character in macro name"

### Requirement 5: Compute Replacement Range and Prefix (Global)

**User Story:** As a developer, I want the completion list to filter based on what I've typed in the global macro reference and replace the correct portion of text, so that completion works anywhere within the macro name.

#### Acceptance Criteria

1. WHEN in a global `Macro_Context` for braced form, THE Completion_Provider SHALL compute `Replacement_Range` as the maximal contiguous span of `Macro_Identifier_Char` characters surrounding the cursor, restricted to the contents between `{` and `}` (if present) and bounded by any non-`Macro_Identifier_Char` characters (e.g., whitespace)
2. WHEN in a global `Macro_Context` for unbraced form, THE Completion_Provider SHALL compute `Replacement_Range` as the maximal contiguous span of `Macro_Identifier_Char` characters surrounding the cursor, restricted to the macro name portion after `$` and bounded by any non-`Macro_Identifier_Char` characters (e.g., whitespace)
3. WHEN in a global `Macro_Context`, THE Completion_Provider SHALL set `Prefix` to the exact text contained in `Replacement_Range` (empty string if `Replacement_Range` is empty)
4. WHEN the global macro reference contains a non-`Macro_Identifier_Char` character after `$` (e.g., `$ foo` or `$apple.sauce`), THE Completion_Provider SHALL treat the first such character as ending the macro name and SHALL NOT replace any text after it; the non-identifier suffix is outside the macro name
5. WHEN the braced global macro reference contains a non-`Macro_Identifier_Char` character before the closing `}` (e.g., `${apple.sauce}`), THE Completion_Provider SHALL treat the first such character as ending the macro name and SHALL NOT replace any text after it; this is invalid macro syntax and SHOULD be reported by diagnostics as an error covering the full macro reference span with a message like "invalid character in macro name"

### Requirement 6: Filter Completions by Prefix

**User Story:** As a developer, I want only matching macros to appear in the completion list, so that I can quickly find the macro I need.

#### Acceptance Criteria

1. WHEN `Prefix` is non-empty, THE Completion_Provider SHALL return only macros whose names start with `Prefix` (case-insensitive)
2. WHEN `Prefix` is empty, THE Completion_Provider SHALL return all available macros of the relevant kind in scope (locals for local `Macro_Context`, globals for global `Macro_Context`)
3. WHEN no macros match `Prefix`, THE Completion_Provider SHALL return an empty list

### Requirement 7: Include Appropriate Suffix in Insert Text

**User Story:** As a developer, I want selecting a macro completion to insert a valid macro reference without duplicating closing characters, so that I get valid syntax.

#### Acceptance Criteria

1. WHEN a local macro completion is selected, THE Completion_Provider SHALL replace `Replacement_Range` with the selected macro name
2. WHEN a local macro completion is selected and there is NOT an apostrophe immediately after the end of the insertion within the local macro reference, THE Completion_Provider SHALL append a closing apostrophe `'`
3. WHEN a local macro completion is selected and there IS an apostrophe immediately after the end of the insertion within the local macro reference, THE Completion_Provider SHALL NOT append an additional apostrophe
4. WHEN a global macro completion is selected (unbraced `$name` form), THE Completion_Provider SHALL replace `Replacement_Range` with the selected macro name and SHALL NOT append additional characters
5. WHEN a global macro completion is selected (braced `${name}` form), THE Completion_Provider SHALL replace `Replacement_Range` with the selected macro name
6. WHEN a global macro completion is selected in braced form and there is NOT a `}` immediately after the end of the insertion within the global macro reference, THE Completion_Provider SHALL append a closing brace `}`
7. WHEN a global macro completion is selected in braced form and there IS a `}` immediately after the end of the insertion within the global macro reference, THE Completion_Provider SHALL NOT append an additional `}`
