# Requirements Document

## Introduction

This feature adds information-level diagnostics to help users maintain consistent and readable indentation in their Stata code. The LSP will detect two types of indentation issues: (1) unnecessary indentation after comments, and (2) missing indentation inside control flow structures like `if`/`else` blocks, loops, and program definitions.

## Glossary

- **Indentation_Diagnostic_Provider**: The component that analyzes code structure and emits information-level diagnostics for indentation issues
- **Unnecessary_Indentation**: Code that is indented when it should not be, such as code following a comment that doesn't indicate a structural block
- **Missing_Indentation**: Code inside a control flow block (braces, loops, programs) that is not indented relative to its parent structure
- **Control_Flow_Block**: A code structure that should have its contents indented, including `if`/`else` with braces, `foreach`, `forvalues`, `while`, `program`, `mata`, and `python` blocks
- **Information_Diagnostic**: A non-error, non-warning diagnostic that provides style guidance without blocking execution

## Requirements

### Requirement 1: Detect Unnecessary Indentation After Comments

**User Story:** As a Stata developer, I want to be notified when I indent code after a comment that doesn't indicate a structural block, so that I can maintain consistent formatting.

#### Acceptance Criteria

1. WHEN a non-blank line follows a comment line AND the non-blank line has greater indentation than the comment AND the comment does not precede a control flow block, THEN THE Indentation_Diagnostic_Provider SHALL emit an information-level diagnostic indicating unnecessary indentation
2. WHEN a non-blank line follows a comment line AND the non-blank line has equal or lesser indentation than the comment, THEN THE Indentation_Diagnostic_Provider SHALL NOT emit a diagnostic
3. WHEN a comment precedes a control flow block opening (brace, loop keyword, program definition), THEN THE Indentation_Diagnostic_Provider SHALL NOT emit a diagnostic for indentation of the block contents

### Requirement 2: Detect Missing Indentation Inside Control Flow Blocks

**User Story:** As a Stata developer, I want to be notified when code inside control flow blocks is not indented, so that I can improve code readability.

#### Acceptance Criteria

1. WHEN code appears inside a brace-delimited block AND the code has equal or lesser indentation than the opening brace line, THEN THE Indentation_Diagnostic_Provider SHALL emit an information-level diagnostic indicating missing indentation
2. WHEN code appears inside a `foreach`, `forvalues`, or `while` loop body AND the code has equal or lesser indentation than the loop keyword line, THEN THE Indentation_Diagnostic_Provider SHALL emit an information-level diagnostic
3. WHEN code appears inside a `program` definition AND the code has equal or lesser indentation than the `program` keyword line, THEN THE Indentation_Diagnostic_Provider SHALL emit an information-level diagnostic
4. WHEN code inside a control flow block has greater indentation than the parent structure, THEN THE Indentation_Diagnostic_Provider SHALL NOT emit a missing indentation diagnostic
5. WHEN the opening brace appears on the same line as a control flow statement (e.g., `if condition {`), THEN THE Indentation_Diagnostic_Provider SHALL detect missing indentation for the block body

### Requirement 3: User Configuration

**User Story:** As a Stata developer, I want to enable or disable indentation diagnostics, so that I can customize the LSP behavior to my preferences.

#### Acceptance Criteria

1. THE Indentation_Diagnostic_Provider SHALL be enabled by default
2. WHEN the user sets `diagnostics.indentation` to `false` in configuration, THEN THE Indentation_Diagnostic_Provider SHALL NOT emit any indentation diagnostics
3. WHEN the user sets `diagnostics.indentation` to `true` in configuration, THEN THE Indentation_Diagnostic_Provider SHALL emit indentation diagnostics as specified

### Requirement 4: Diagnostic Message Clarity

**User Story:** As a Stata developer, I want clear diagnostic messages that explain the indentation issue and suggest how to fix it, so that I understand what to do.

#### Acceptance Criteria

1. WHEN an unnecessary indentation diagnostic is emitted, THEN THE Indentation_Diagnostic_Provider SHALL include a message indicating that the line appears unnecessarily indented
2. WHEN a missing indentation diagnostic is emitted, THEN THE Indentation_Diagnostic_Provider SHALL include a message indicating that the line should be indented inside the block
3. THE Indentation_Diagnostic_Provider SHALL set the diagnostic severity to Information (not Warning or Error)
4. WHEN an indentation diagnostic is emitted, THEN THE Indentation_Diagnostic_Provider SHALL suggest using the formatter to fix the issue

### Requirement 5: Embedded Language Block Exclusion

**User Story:** As a Stata developer, I want indentation diagnostics to ignore embedded language blocks, so that I don't receive false positives for Mata or Python code.

#### Acceptance Criteria

1. WHEN code appears inside a `mata` block, THEN THE Indentation_Diagnostic_Provider SHALL NOT emit indentation diagnostics for that code
2. WHEN code appears inside a `python` block, THEN THE Indentation_Diagnostic_Provider SHALL NOT emit indentation diagnostics for that code

### Requirement 6: Continuation Line Handling

**User Story:** As a Stata developer, I want indentation diagnostics to correctly handle continuation lines, so that I don't receive false positives for properly formatted multi-line statements.

#### Acceptance Criteria

1. WHEN a line is a continuation of a previous line (using `///` or `;` delimiter mode), THEN THE Indentation_Diagnostic_Provider SHALL NOT emit an unnecessary indentation diagnostic for that continuation
2. WHEN analyzing indentation inside blocks, THE Indentation_Diagnostic_Provider SHALL consider the logical statement structure rather than raw line positions

### Requirement 7: Documentation

**User Story:** As a Stata developer, I want documentation about the indentation diagnostics feature, so that I understand how to use and configure it.

#### Acceptance Criteria

1. THE README SHALL document the indentation diagnostics feature and its purpose
2. THE README SHALL document the `diagnostics.indentation` configuration option
3. THE README SHALL provide examples of the indentation issues detected
