---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - command-database-cleanup: [Related completion spec]
  - option-extraction: [Related completion spec]
  - syntax-command-simplification: [Related completion spec]
---

# Requirements Document: Local vs. Global Macro Completion Filtering

## Introduction

This document specifies requirements to fix the macro completion filtering in the LSP. Currently, the completion provider incorrectly suggests local macros when the dollar sign (`$`) prefix is used, and incorrectly classifies local macros as globals in completion suggestions. The system should only suggest local macros when backtick (`` ` ``) is the prefix, and only suggest global macros when dollar sign (`$`) is the prefix.

## Glossary

- **Local_Macro**: A macro defined with the `local` keyword, dereferenced with backtick (`` ` ``) syntax
- **Global_Macro**: A macro defined with the `global` keyword, dereferenced with dollar sign (`$`) syntax
- **Macro_Prefix**: The character that precedes a macro name in code (backtick or dollar sign)
- **Completion_Provider**: The component that generates auto-complete suggestions based on cursor context
- **Symbol_Table**: The data structure that tracks defined macros and their scope (local or global)
- **Macro_Classification**: The process of determining whether a macro is local or global based on its definition

## Requirements

### Requirement 1: Filter Local Macros by Backtick Prefix

**User Story:** As a developer, I want the completion provider to only suggest local macros when I type a backtick, so that I don't see irrelevant suggestions.

#### Acceptance Criteria

1. WHEN the code contains `local apple green` and the user types `` `ap ``, THE Completion_Provider SHALL suggest apple
2. WHEN the code contains `global apple green` and the user types `` `ap ``, THE Completion_Provider SHALL NOT suggest apple
3. WHEN the code contains `local apple green` followed by `global apple green` and the user types `` `ap ``, THE Completion_Provider SHALL suggest apple (the local version)
4. WHEN the code contains `global apple green` followed by `local apple green` and the user types `` `ap ``, THE Completion_Provider SHALL suggest apple (the local version, regardless of definition order)
5. WHEN the user types a backtick (`` ` ``) followed by a prefix, THE Completion_Provider SHALL only suggest local macros that match the prefix
6. WHEN the user types a backtick (`` ` ``) followed by a prefix, THE Completion_Provider SHALL NOT suggest global macros

### Requirement 2: Filter Global Macros by Dollar Sign Prefix

**User Story:** As a developer, I want the completion provider to only suggest global macros when I type a dollar sign, so that I don't see irrelevant suggestions.

#### Acceptance Criteria

1. WHEN the code contains `global apple green` and the user types `$ap`, THE Completion_Provider SHALL suggest apple
2. WHEN the code contains `local apple green` and the user types `$ap`, THE Completion_Provider SHALL NOT suggest apple
3. WHEN the code contains `global apple green` and the user types `${ap`, THE Completion_Provider SHALL suggest apple
4. WHEN the code contains `local apple green` followed by `global apple green` and the user types `$ap`, THE Completion_Provider SHALL suggest apple (the global version)
5. WHEN the code contains `global apple green` followed by `local apple green` and the user types `$ap`, THE Completion_Provider SHALL suggest apple (the global version, regardless of definition order)
6. WHEN the user types a dollar sign (`$`) followed by a prefix, THE Completion_Provider SHALL only suggest global macros that match the prefix
7. WHEN the user types a dollar sign (`$`) followed by a prefix, THE Completion_Provider SHALL NOT suggest local macros

### Requirement 3: Correctly Classify Macros in Completion Items

**User Story:** As a developer, I want completion items to correctly identify whether a macro is local or global, so that I understand what I'm completing.

#### Acceptance Criteria

1. WHEN a local macro is suggested in a completion item, THE Completion_Provider SHALL label it as "local macro" in the detail field
2. WHEN a global macro is suggested in a completion item, THE Completion_Provider SHALL label it as "global macro" in the detail field
3. WHEN a local macro is defined with `local apple value`, THE Completion_Provider SHALL NOT label it as "global macro"
4. WHEN a global macro is defined with `global apple value`, THE Completion_Provider SHALL NOT label it as "local macro"

### Requirement 4: Handle Mixed Local and Global Definitions

**User Story:** As a developer, I want the completion provider to handle cases where both local and global macros with the same name exist, so that the correct one is suggested based on scope.

#### Acceptance Criteria

1. WHEN both a local and global macro with the same name exist, THE Completion_Provider SHALL suggest the local macro when the user types `` `name ``
2. WHEN both a local and global macro with the same name exist, THE Completion_Provider SHALL suggest the global macro when the user types `$name`
3. WHEN a local macro shadows a global macro with the same name, THE Completion_Provider SHALL respect the scope rules for each prefix type

### Requirement 5: Preserve Macro Scope Information in Symbol Table

**User Story:** As a developer, I want the symbol table to accurately track whether each macro is local or global, so that the completion provider can filter correctly.

#### Acceptance Criteria

1. WHEN a macro is defined with `local`, THE Symbol_Table SHALL mark it as a local macro
2. WHEN a macro is defined with `global`, THE Symbol_Table SHALL mark it as a global macro
3. WHEN the analyzer processes macro definitions, THE Symbol_Table SHALL preserve the scope classification
4. WHEN the completion provider queries the symbol table, THE Symbol_Table SHALL return scope information for each macro

</content>
</invoke>