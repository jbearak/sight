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

This feature addresses three related bugs in the LSP completion system:

1. **Completion display bug**: Variable completions don't have explicit `textEdit` and `filterText` properties, so VS Code's word detection can include non-word characters like parentheses in the completion display and filtering. When a user types `if (` and triggers completion, VS Code may display variable names with the preceding parenthesis included (e.g., `(p7_17_r)` instead of `p7_17_r`).

2. **Variable name validation bug**: The parser includes parenthesized groups in the varlist (e.g., for commands like `getmata (var1 var2)=matrix` or recode rules like `(6 7 8 = 6)`). While this is correct for parsing, the analyzer should validate that only clean identifier names are added to the symbol table as variables.

3. **Context detection bug**: The completion provider incorrectly suggests dataset variables in `if {}` block contexts. In Stata, dataset variables should only be suggested in command contexts (e.g., `generate x = y if varname`) but NOT in control flow block contexts (e.g., `if (condition) {}`).

## Glossary

- **Completion_Provider**: The LSP component that generates context-aware completion suggestions for Stata code
- **filterText**: An LSP completion item property that specifies the text used to filter the completion item when the user types
- **textEdit**: An LSP completion item property that specifies the range of text to replace and the new text to insert
- **Variable_Completion**: A completion item representing a Stata dataset variable (field) in the symbol table
- **Word_Prefix**: The alphanumeric text (matching pattern `[a-zA-Z_][a-zA-Z0-9_]*`) immediately before the cursor position
- **Symbol_Table**: The data structure that stores all defined symbols (variables, macros, programs, etc.) for a document
- **Command_Context**: A context where a Stata command is being typed, where dataset variables are valid (e.g., `summarize varname`, `generate x = y if varname`)
- **Block_Context**: A context inside a control flow block (e.g., `if (condition) {}`, `while (condition) {}`), where dataset variables are NOT valid as the condition

## Requirements

### Requirement 1: Variable Completion Text Edit

**User Story:** As a developer, I want variable completions to replace only the word I'm typing, so that surrounding syntax characters like parentheses are preserved.

#### Acceptance Criteria

1. WHEN a Variable_Completion is generated, THE Completion_Provider SHALL include a textEdit property with a range that starts at the beginning of the Word_Prefix
2. WHEN a Variable_Completion is generated, THE Completion_Provider SHALL include a textEdit property with a range that ends at the cursor position
3. WHEN a user types `if (` followed by a partial variable name, THE Completion_Provider SHALL compute a replacement range that does NOT include the parenthesis
4. IF the cursor is immediately after a non-word character with no partial word typed, THEN THE Completion_Provider SHALL use an empty replacement range at the cursor position

### Requirement 2: Scalar and Matrix Completion Text Edit

**User Story:** As a developer, I want scalar and matrix completions to replace only the word I'm typing, so that surrounding syntax characters are preserved.

#### Acceptance Criteria

1. WHEN a scalar completion is generated, THE Completion_Provider SHALL include a textEdit property with a range that starts at the beginning of the Word_Prefix
2. WHEN a matrix completion is generated, THE Completion_Provider SHALL include a textEdit property with a range that starts at the beginning of the Word_Prefix
3. WHEN a scalar or matrix completion is selected, THE Completion_Provider SHALL replace only the Word_Prefix portion of the text

### Requirement 3: Filter Text Consistency

**User Story:** As a developer, I want completions to filter correctly based on what I'm typing, not including surrounding punctuation.

#### Acceptance Criteria

1. WHEN a variable, scalar, or matrix completion is generated, THE Completion_Provider SHALL include a filterText property containing only the symbol name (without any surrounding punctuation)
2. WHEN a user types a partial variable name after a non-word character, THE Completion_Provider SHALL filter completions based only on the alphanumeric portion of the typed text

### Requirement 4: Variable Name Validation in Symbol Table

**User Story:** As a developer, I want the symbol table to contain only valid variable names, so that completions show clean identifiers without surrounding punctuation.

#### Acceptance Criteria

1. WHEN a variable is extracted from a command, THE Analyzer SHALL validate that the variable name matches the pattern `[a-zA-Z_][a-zA-Z0-9_]*`
2. IF a varlist item contains parentheses or other non-identifier characters, THEN THE Analyzer SHALL NOT add it to the Symbol_Table as a variable
3. WHEN processing commands like `generate`, `egen`, or `input`, THE Analyzer SHALL only add clean variable names to the Symbol_Table

### Requirement 5: Block Context Variable Suppression

**User Story:** As a developer, I want dataset variables to NOT be suggested in control flow block conditions, so that I only see relevant completions for the context.

#### Acceptance Criteria

1. WHEN the cursor is inside a control flow block condition (e.g., `if (|)`, `while (|)`), THE Completion_Provider SHALL NOT suggest dataset variables
2. WHEN the cursor is after a command's `if` qualifier (e.g., `summarize x if |`), THE Completion_Provider SHALL suggest dataset variables
3. THE Completion_Provider SHALL distinguish between block-level `if` statements and command-level `if` qualifiers based on syntax context
4. WHEN the cursor is inside a block condition, THE Completion_Provider SHALL suggest macros, scalars, and other expression-valid symbols instead of dataset variables
