# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the Stata lexer where `mata:` followed by a newline is incorrectly treated as a single-line inline expression instead of a multi-line block. Currently, the lexer emits `MATA_INLINE` for `mata:` regardless of whether it's followed by content on the same line or a newline. When `mata:` is followed by a newline, subsequent lines should be tokenized as Mata code until an `end` delimiter is encountered.

## Glossary

- **Lexer**: The component that tokenizes Stata source code into tokens
- **MATA_INLINE**: Token type for single-line Mata expressions (e.g., `mata: x = 5`)
- **MATA_START**: Token type for multi-line Mata block starts (e.g., `mata` followed by newline)
- **Mata_Context**: The language context pushed onto the context stack when entering a Mata block
- **Statement_Terminator**: A newline (in CR mode) or semicolon (in semicolon mode) that ends a statement

## Requirements

### Requirement 1: Detect mata: Followed by Newline as Block Start

**User Story:** As a developer, I want `mata:` followed by a newline (or only comments) to start a multi-line Mata block, so that subsequent lines are correctly tokenized as Mata code.

#### Acceptance Criteria

1. WHEN the Lexer encounters `mata:` followed immediately by a newline (after optional whitespace), THE Lexer SHALL emit a `MATA_START` token and push Mata context onto the context stack
2. WHEN the Lexer encounters `mata:` followed by non-whitespace, non-comment content on the same line, THE Lexer SHALL emit a `MATA_INLINE` token without pushing Mata context
3. WHEN the Lexer encounters `mata:` followed by only whitespace then a newline, THE Lexer SHALL treat it as a block start (same as criterion 1)
4. WHEN the Lexer encounters `mata:` followed by only a comment (e.g., `mata: // comment`), THE Lexer SHALL treat it as a block start (same as criterion 1)

### Requirement 2: Preserve Existing Inline Behavior

**User Story:** As a developer, I want single-line `mata:` expressions to continue working correctly, so that existing code is not broken.

#### Acceptance Criteria

1. WHEN the Lexer encounters `mata: expression` on a single line, THE Lexer SHALL emit a `MATA_INLINE` token
2. WHEN the Lexer encounters `mata: expression` followed by a newline, THE Lexer SHALL NOT push Mata context
3. WHEN the Lexer encounters `capture mata: expression`, THE Lexer SHALL emit a `MATA_INLINE` token for the `mata:` portion

### Requirement 3: Handle python: Consistently

**User Story:** As a developer, I want `python:` to behave consistently with `mata:`, so that both embedded languages follow the same rules.

#### Acceptance Criteria

1. WHEN the Lexer encounters `python:` followed immediately by a newline (after optional whitespace), THE Lexer SHALL emit a `PYTHON_START` token and push Python context onto the context stack
2. WHEN the Lexer encounters `python:` followed by non-whitespace, non-comment content on the same line, THE Lexer SHALL emit a `PYTHON_INLINE` token without pushing Python context
3. WHEN the Lexer encounters `python:` followed by only whitespace then a newline, THE Lexer SHALL treat it as a block start (same as criterion 1)
4. WHEN the Lexer encounters `python:` followed by only a comment (e.g., `python: // comment`), THE Lexer SHALL treat it as a block start (same as criterion 1)

### Requirement 4: Block Termination with end

**User Story:** As a developer, I want multi-line blocks started with `mata:` or `python:` to terminate correctly with `end`, so that I can write multi-line embedded code.

#### Acceptance Criteria

1. WHEN the Lexer is in Mata context (started by `mata:` followed by newline) and encounters `end` at a statement boundary, THE Lexer SHALL emit an `END_MATA` token and pop Mata context
2. WHEN the Lexer is in Python context (started by `python:` followed by newline) and encounters `end` at a statement boundary, THE Lexer SHALL emit an `END_PYTHON` token and pop Python context
3. WHEN the Lexer encounters `end` followed by other code (not at statement boundary), THE Lexer SHALL emit a `WORD` token and NOT pop context

### Requirement 5: Tokenize Embedded Content Correctly

**User Story:** As a developer, I want Mata/Python code inside blocks started with `mata:`/`python:` to be tokenized correctly, so that string literals and macro references are preserved.

#### Acceptance Criteria

1. WHEN the Lexer is in Mata context, THE Lexer SHALL tokenize strings, comments, and braces according to embedded language rules
2. WHEN the Lexer is in Mata context and encounters Stata string interpolation syntax (e.g., `` `macro' ``), THE Lexer SHALL tokenize it as a macro reference
3. WHEN the Lexer is in Python context, THE Lexer SHALL tokenize strings, comments, and braces according to embedded language rules

### Requirement 6: Enable Previously Skipped Test

**User Story:** As a developer, I want the previously skipped test in `ast-formatter-string-literal-preservation.prop.test.ts` to pass, so that the fix is validated.

#### Acceptance Criteria

1. WHEN the fix is complete, THE test case "should preserve embedded Mata block with string literals (lexer limitation)" SHALL be unskipped and pass
2. WHEN the Lexer tokenizes the test input `mata:\n    st_local("result", \`"\`macro'"')\n    printf("\`macro'")\nend`, THE Lexer SHALL correctly tokenize all Mata content including string literals with embedded macros
