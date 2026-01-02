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

This feature corrects the handling of embedded language block endings in the Stata LSP. Currently, the LSP incorrectly expects `end python` to close Python blocks, but Stata actually requires just `end` for both `mata` and `python` blocks. Using `end python` in Stata results in a syntax error.

## Glossary

- **Lexer**: The component that tokenizes Stata source code into tokens
- **Parser**: The component that builds an AST from tokens
- **Context_Tracker**: The component that tracks language context (Stata/Mata/Python) for position-aware features
- **Embedded_Language_Block**: A block of code in Mata or Python within a Stata file
- **End_Delimiter**: The command that closes an embedded language block (should be `end` for both Mata and Python)

## Requirements

### Requirement 1: Lexer End Delimiter Recognition

**User Story:** As a developer, I want the lexer to correctly recognize `end` as the closing delimiter for both Mata and Python blocks, so that valid Stata code is tokenized correctly.

#### Acceptance Criteria

1. WHEN the Lexer encounters `end` inside a Python context, THE Lexer SHALL emit an END_PYTHON token
2. WHEN the Lexer encounters `end` inside a Mata context, THE Lexer SHALL emit an END_MATA token
3. WHEN the Lexer encounters `end python` inside a Python context, THE Lexer SHALL NOT treat it as a valid end delimiter
4. IF the Lexer encounters `end python` or `end mata`, THEN THE Lexer SHALL treat `end` as the block terminator and `python`/`mata` as a separate token (likely causing a syntax error in Python)

### Requirement 2: Parser End Delimiter Handling

**User Story:** As a developer, I want the parser to correctly parse embedded language blocks that end with just `end`, so that valid Stata code produces correct AST nodes.

#### Acceptance Criteria

1. WHEN parsing a Python block, THE Parser SHALL recognize `end` as the closing delimiter
2. WHEN parsing a Mata block, THE Parser SHALL recognize `end` as the closing delimiter
3. WHEN an embedded block ends with `end`, THE Parser SHALL set the `end_command` property to `end`

### Requirement 3: Context Tracker Validation

**User Story:** As a developer, I want the context tracker to correctly validate embedded language block structure using `end` as the delimiter, so that diagnostics are accurate.

#### Acceptance Criteria

1. WHEN validating a Python block, THE Context_Tracker SHALL expect `end` as the closing delimiter
2. WHEN validating a Mata block, THE Context_Tracker SHALL expect `end` as the closing delimiter
3. WHEN a Python block is closed with `end`, THE Context_Tracker SHALL NOT report an error
4. IF a user writes `end python`, THEN THE Context_Tracker SHALL report a diagnostic warning that `end python` is invalid syntax
5. WHEN generating error messages for unclosed blocks, THE Context_Tracker SHALL suggest using `end` (not `end python`)

### Requirement 4: Completion Provider Updates

**User Story:** As a developer, I want the completion provider to suggest `end` for closing both Mata and Python blocks, so that I write valid Stata code.

#### Acceptance Criteria

1. WHEN inside a Python block at a position where block-ending is appropriate, THE Completion_Provider SHALL suggest `end`
2. WHEN inside a Mata block at a position where block-ending is appropriate, THE Completion_Provider SHALL suggest `end`
3. THE Completion_Provider SHALL NOT suggest `end python` as a completion option

### Requirement 5: Hover Provider Updates

**User Story:** As a developer, I want hover information to correctly document that `end` closes both Mata and Python blocks, so that I understand the correct syntax.

#### Acceptance Criteria

1. WHEN hovering over `end` inside a Python block, THE Hover_Provider SHALL display documentation indicating `end` closes Python blocks
2. WHEN hovering over `end` inside a Mata block, THE Hover_Provider SHALL display documentation indicating `end` closes Mata blocks
3. THE Hover_Provider SHALL NOT document `end python` as valid syntax

### Requirement 6: Diagnostic Messages

**User Story:** As a developer, I want clear diagnostic messages when I incorrectly use `end python` or `end mata`, so that I can fix my code.

#### Acceptance Criteria

1. IF a user writes `end python` inside a Python block, THEN THE Diagnostics_Provider SHALL report a warning that `end python` is invalid and suggest using `end`
2. IF a user writes `end mata` inside a Mata block, THEN THE Diagnostics_Provider SHALL report a warning that `end mata` is invalid and suggest using `end`
3. WHEN an embedded block is unclosed, THE Diagnostics_Provider SHALL suggest adding `end` to close it
