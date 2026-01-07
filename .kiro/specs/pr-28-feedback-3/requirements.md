# Requirements Document

## Introduction

This specification addresses additional feedback from PR 28, focusing on parser improvements for frame-prefixed commands, test infrastructure enhancements, and code quality improvements. The changes ensure proper handling of parenthesized varlist groups in frame-prefixed commands and improve test consistency across the codebase.

## Glossary

- **Frame_Prefixed_Command**: A Stata command that begins with a frame prefix (e.g., `frame myframe: command`)
- **Parenthesized_Varlist_Group**: A variable list enclosed in parentheses (e.g., `(x y z)` or `(xy)=m`)
- **Parser**: The component that converts tokens into an Abstract Syntax Tree (AST)
- **Formatter_Mode**: Either "source-preserving" or "ast" formatter implementation
- **Document_State**: Test helper that provides lexer/parser + ContextTracker wiring
- **Property_Test**: A test that validates properties across many generated inputs

## Requirements

### Requirement 1: Frame-Prefixed Command Parenthesized Varlist Support

**User Story:** As a Stata developer, I want frame-prefixed commands to correctly parse parenthesized varlist groups, so that complex variable expressions are handled properly.

#### Acceptance Criteria

1. WHEN parsing a frame-prefixed command with parenthesized varlist groups, THE Parser SHALL recognize LPAREN tokens in the varlist loop
2. WHEN encountering LPAREN in parseCommandBody's varlist loop, THE Parser SHALL consume and parse the parenthesized group using the same logic as parseCommand
3. WHEN a parenthesized group is parsed, THE Parser SHALL push the resulting group node into the varlist
4. WHEN continuing after a parenthesized group, THE Parser SHALL correctly parse subsequent "=" and expression tokens
5. THE Parser SHALL handle frame-prefixed commands like `frame myframe: command (xy)=m` without dropping the parenthesized group

### Requirement 2: Dual Formatter Mode Testing for Prefix Command Spacing

**User Story:** As a developer, I want prefix command spacing tests to validate both formatter implementations, so that formatting behavior is consistent across all modes.

#### Acceptance Criteria

1. WHEN running prefix command spacing property tests, THE Test_Suite SHALL exercise both source-preserving and AST formatter modes
2. WHEN testing Property 7 (Prefix Command Chain Spacing), THE Test SHALL use for_each_formatter_mode_property instead of direct fc.property
3. WHEN formatting in property tests, THE Test SHALL call formatWithMode(source, mode) for the current formatter mode
4. WHEN validating static examples, THE Test SHALL test both formatter modes using for_each_formatter_mode_property wrapper
5. THE Test SHALL maintain identical single-line and prefix-space assertions for both formatter modes

### Requirement 3: Shared Document State Helper Usage

**User Story:** As a test maintainer, I want tests to use shared document state helpers, so that test infrastructure remains consistent and maintainable.

#### Acceptance Criteria

1. WHEN tests need document state creation, THE Test SHALL use the shared create_document_state helper from tests/property/helpers
2. WHEN tests duplicate document state logic, THE Test SHALL be refactored to import and use shared helpers
3. THE Test_Suite SHALL avoid reimplementing lexer/parser + ContextTracker wiring in individual test files
4. WHEN shared helpers change, THE Tests SHALL automatically benefit from improvements without individual updates
5. THE Test_Infrastructure SHALL maintain a single source of truth for DocumentState construction

### Requirement 4: Frame Prefix Whitespace Handling

**User Story:** As a Stata developer, I want frame-prefixed commands to handle whitespace correctly after the colon, so that commands parse properly regardless of spacing.

#### Acceptance Criteria

1. WHEN parsing frame-prefixed commands with whitespace after the colon, THE Parser SHALL skip trivia tokens appropriately
2. WHEN encountering `frame myframe: quietly ...` with spaces, THE Parser SHALL not generate spurious "Expected command name" errors
3. WHEN checking for command tokens after frame prefix colon, THE Parser SHALL either call skipTrivia() or explicitly tolerate WHITESPACE tokens
4. THE Parser SHALL handle both direct frame statement paths and parseCommand special cases consistently
5. WHEN whitespace follows a frame prefix colon, THE Parser SHALL continue parsing the actual command correctly

### Requirement 5: Code Quality and Import Cleanup

**User Story:** As a code maintainer, I want unused imports removed and duplicate code eliminated, so that the codebase remains clean and maintainable.

#### Acceptance Criteria

1. WHEN imports are not used in a file, THE Code SHALL have those imports removed
2. WHEN test helpers are duplicated across files, THE Code SHALL be refactored to use shared implementations
3. THE Codebase SHALL maintain consistent import usage across all test files
4. WHEN shared helpers are available, THE Tests SHALL prefer them over local implementations
5. THE Code_Quality SHALL be improved by eliminating redundant implementations