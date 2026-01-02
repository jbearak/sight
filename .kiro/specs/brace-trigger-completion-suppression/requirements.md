# Requirements Document

## Introduction

This feature addresses an issue where typing an opening brace `{` in a control flow context (e.g., `if (fruit) {`) triggers unwanted completion suggestions. The `{` character is a trigger character for global macro braced form completions (`${name}`), but when used in non-macro contexts like control flow blocks, it should not trigger completions.

## Glossary

- **Completion_Provider**: The LSP component that generates auto-complete suggestions
- **Trigger_Character**: A character that automatically invokes completion when typed
- **Macro_Context**: A position in the document where a macro reference is being typed
- **Global_Macro_Braced_Form**: A global macro reference using braces: `${name}`
- **Control_Flow_Brace**: An opening brace used for control flow blocks (if, foreach, forvalues, while, program, etc.)

## Requirements

### Requirement 1: Suppress Completions for Non-Macro Brace Triggers

**User Story:** As a developer, I want to type opening braces for control flow blocks without triggering unwanted completions, so that I can press Enter to get a new line instead of accepting a completion.

#### Acceptance Criteria

1. WHEN the trigger character is `{` AND the cursor is NOT in a global macro braced context (no `$` immediately before the `{`), THE Completion_Provider SHALL return an empty completion list
2. WHEN the trigger character is `{` AND the cursor IS in a global macro braced context (e.g., `${|`), THE Completion_Provider SHALL return global macro completions
3. WHEN the trigger character is `{` AND the text before cursor ends with `${`, THE Completion_Provider SHALL detect this as a global macro braced context
4. WHEN the trigger character is `{` AND the text before cursor does NOT contain `$` immediately before the `{`, THE Completion_Provider SHALL NOT return variable, command, or other non-macro completions

### Requirement 2: Preserve Existing Macro Completion Behavior

**User Story:** As a developer, I want global macro braced form completions to continue working correctly, so that I can efficiently type macro references.

#### Acceptance Criteria

1. WHEN typing `${` and the trigger character is `{`, THE Completion_Provider SHALL return global macro completions
2. WHEN typing `${na` (partial macro name), THE Completion_Provider SHALL return filtered global macro completions matching the prefix
3. WHEN the cursor is inside `${...}` (between braces), THE Completion_Provider SHALL continue to provide macro completions
