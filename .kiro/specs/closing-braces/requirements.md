# Requirements Document

## Introduction

This feature ensures that orphan closing braces (closing braces `}` that don't have a matching opening brace `{`) emit a diagnostic error. In Stata, a standalone `}` without a corresponding block to close is a syntax error. The LSP should detect this condition and report it as an error to help users catch this mistake before running their code.

Currently, the parser handles standalone opening braces (`{`) with an error diagnostic, but orphan closing braces fall through without any diagnostic. This creates an inconsistency where users are warned about misplaced opening braces but not about misplaced closing braces.

## Glossary

- **Orphan_Closing_Brace**: A closing brace `}` that does not close any block (if, else, foreach, forvalues, while, frame, or prefix command block)
- **Block_Statement**: A Stata construct that uses braces for grouping: `if { }`, `else { }`, `foreach { }`, `forvalues { }`, `while { }`, `frame name { }`, or prefix command blocks like `quietly { }`
- **Parser**: The component that builds the AST from tokens and detects structural issues
- **Diagnostics_Provider**: The component that reports errors and warnings to the user

## Requirements

### Requirement 1: Detect Orphan Closing Braces

**User Story:** As a Stata developer, I want the LSP to flag closing braces that don't close any block, so that I can fix syntax errors before running my code.

#### Acceptance Criteria

1. WHEN a closing brace `}` appears at the top level (not inside any block), THE Parser SHALL report an error diagnostic
2. WHEN a closing brace `}` correctly closes an if block, THE Parser SHALL NOT report an orphan brace error
3. WHEN a closing brace `}` correctly closes an else block, THE Parser SHALL NOT report an orphan brace error
4. WHEN a closing brace `}` correctly closes a foreach block, THE Parser SHALL NOT report an orphan brace error
5. WHEN a closing brace `}` correctly closes a forvalues block, THE Parser SHALL NOT report an orphan brace error
6. WHEN a closing brace `}` correctly closes a while block, THE Parser SHALL NOT report an orphan brace error
7. WHEN a closing brace `}` correctly closes a frame block, THE Parser SHALL NOT report an orphan brace error
8. WHEN a closing brace `}` correctly closes a prefix command block (e.g., `quietly { }`), THE Parser SHALL NOT report an orphan brace error

### Requirement 2: Error Message Clarity

**User Story:** As a Stata developer, I want clear error messages when I have orphan closing braces, so that I understand what went wrong.

#### Acceptance Criteria

1. WHEN an orphan closing brace is detected, THE Parser SHALL include a message indicating the brace has no matching opening brace
2. WHEN an orphan closing brace is detected, THE Parser SHALL report it with error severity (not warning)
3. WHEN an orphan closing brace is detected, THE Parser SHALL highlight the closing brace token in the diagnostic range

### Requirement 3: Multiple Orphan Braces

**User Story:** As a Stata developer, I want each orphan closing brace to be reported separately, so that I can fix all issues in my code.

#### Acceptance Criteria

1. WHEN multiple orphan closing braces appear in a document, THE Parser SHALL report a separate diagnostic for each orphan brace
2. WHEN orphan closing braces appear on different lines, THE Parser SHALL report each with its correct line number

### Requirement 4: Macro Brace Exclusion

**User Story:** As a Stata developer, I want macro braces (like `${name}`) to not be flagged as orphan braces, so that I don't get false positive errors.

#### Acceptance Criteria

1. WHEN a closing brace `}` is part of a global macro reference `${name}`, THE Parser SHALL NOT report an orphan brace error
2. WHEN a closing brace `}` is part of a local macro reference with braces, THE Parser SHALL NOT report an orphan brace error

### Requirement 5: Embedded Language Block Exclusion

**User Story:** As a Stata developer, I want closing braces inside embedded language blocks (Mata, Python) to not be flagged as orphan braces, so that I don't get false positive errors.

#### Acceptance Criteria

1. WHEN a closing brace `}` appears inside a Mata block, THE Parser SHALL NOT report an orphan brace error for Stata
2. WHEN a closing brace `}` appears inside a Python block, THE Parser SHALL NOT report an orphan brace error for Stata
3. WHEN a closing brace `}` closes a brace-style Mata block (`mata { ... }`), THE Parser SHALL NOT report an orphan brace error
4. WHEN a closing brace `}` closes a brace-style Python block (`python { ... }`), THE Parser SHALL NOT report an orphan brace error

### Requirement 6: String Literal Exclusion

**User Story:** As a Stata developer, I want closing braces inside string literals to not be flagged as orphan braces, so that I don't get false positive errors when my strings contain brace characters.

#### Acceptance Criteria

1. WHEN a closing brace `}` appears inside a double-quoted string (`"...}..."`), THE Parser SHALL NOT report an orphan brace error
2. WHEN a closing brace `}` appears inside a compound string (`` `"...}..."' ``), THE Parser SHALL NOT report an orphan brace error
3. WHEN a closing brace `}` appears inside a single-quoted string (`'...}...'`), THE Parser SHALL NOT report an orphan brace error
