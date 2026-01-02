# Requirements Document

## Introduction

This feature adds diagnostic detection for stray tokens that appear after comparison expressions in `if` and `in` conditions. In Stata, conditions like `if (this == that oops)` or `if this == that oops` contain an unexpected token (`oops`) that would cause a runtime error. The LSP should catch these errors at edit time.

## Glossary

- **Condition_Parser**: The component that analyzes `if` and `in` qualifier expressions
- **Stray_Token**: An unexpected token appearing after a syntactically complete comparison expression
- **Comparison_Expression**: An expression using operators like `==`, `!=`, `<`, `>`, `<=`, `>=`, `~=`
- **Qualifier**: The `if` or `in` clause that filters observations in Stata commands

## Requirements

### Requirement 1: Detect Stray Tokens After Comparison in Parenthesized Conditions

**User Story:** As a Stata developer, I want the LSP to warn me when I have extra tokens after a comparison inside parentheses, so that I can fix syntax errors before running my code.

#### Acceptance Criteria

1. WHEN a parenthesized `if` condition contains a comparison expression followed by an unexpected identifier, THE Condition_Parser SHALL emit a diagnostic warning
2. WHEN the condition is `if (this == that oops)`, THE Condition_Parser SHALL identify `oops` as a Stray_Token
3. WHEN multiple stray tokens appear after a comparison (e.g., `if (x == y foo bar)`), THE Condition_Parser SHALL report the first unexpected token
4. WHEN the stray token is a valid Stata keyword used incorrectly (e.g., `if (x == y and)`), THE Condition_Parser SHALL still emit a diagnostic

### Requirement 2: Detect Stray Tokens After Comparison in Unparenthesized Conditions

**User Story:** As a Stata developer, I want the LSP to warn me about stray tokens in conditions without parentheses, so that I catch errors in common Stata syntax patterns.

#### Acceptance Criteria

1. WHEN an unparenthesized `if` condition contains a comparison followed by an unexpected token before the command body, THE Condition_Parser SHALL emit a diagnostic warning
2. WHEN the command is `replace x = y if this == that oops`, THE Condition_Parser SHALL identify `oops` as a Stray_Token
3. WHEN the stray token appears before a valid command continuation, THE Condition_Parser SHALL correctly identify the boundary

### Requirement 3: Distinguish Valid Compound Expressions from Stray Tokens

**User Story:** As a Stata developer, I want the LSP to correctly recognize valid compound expressions so that I don't get false positive warnings.

#### Acceptance Criteria

1. WHEN a condition uses logical operators (`&`, `|`), THE Condition_Parser SHALL NOT emit a stray token warning
2. WHEN a condition is `if (x == 1 & y == 2)`, THE Condition_Parser SHALL recognize this as valid
3. WHEN a condition is `if (x == 1 | y == 2)`, THE Condition_Parser SHALL recognize this as valid
4. WHEN a condition uses arithmetic in comparisons (e.g., `if (x + 1 == y)`), THE Condition_Parser SHALL NOT emit a warning
5. WHEN a condition uses function calls (e.g., `if (strlen(x) == 5)`), THE Condition_Parser SHALL NOT emit a warning

### Requirement 4: Handle Negation and Complex Expressions

**User Story:** As a Stata developer, I want the LSP to handle negated and complex expressions correctly, so that valid code isn't flagged.

#### Acceptance Criteria

1. WHEN a condition uses negation (`!` or `~`), THE Condition_Parser SHALL NOT emit a false positive
2. WHEN a condition is `if !(x == y)`, THE Condition_Parser SHALL recognize this as valid
3. WHEN a condition contains nested parentheses (e.g., `if ((x == 1) & (y == 2))`), THE Condition_Parser SHALL correctly parse without false positives

### Requirement 5: Provide Actionable Diagnostic Messages

**User Story:** As a Stata developer, I want clear error messages that help me understand and fix the problem.

#### Acceptance Criteria

1. WHEN a Stray_Token is detected, THE Condition_Parser SHALL include the unexpected token text in the diagnostic message
2. WHEN a Stray_Token is detected, THE Condition_Parser SHALL suggest possible fixes (e.g., "Did you mean to use '&' or '|'?")
3. WHEN a Stray_Token is detected, THE Condition_Parser SHALL highlight only the stray token, not the entire condition

### Requirement 6: Support All Comparison Operators

**User Story:** As a Stata developer, I want stray token detection to work with all Stata comparison operators.

#### Acceptance Criteria

1. THE Condition_Parser SHALL detect stray tokens after `==` comparisons
2. THE Condition_Parser SHALL detect stray tokens after `!=` and `~=` comparisons
3. THE Condition_Parser SHALL detect stray tokens after `<`, `>`, `<=`, `>=` comparisons
4. THE Condition_Parser SHALL detect stray tokens after string comparisons using these operators

### Requirement 7: Detect Split Numeric Literals

**User Story:** As a Stata developer, I want the LSP to catch cases where a numeric literal is accidentally split by whitespace, so that I can fix typos like `. 9` that should be `.9`.

#### Acceptance Criteria

1. WHEN a comparison's right-hand side is `.` followed by a numeric token (e.g., `z5 != . 9`), THE Condition_Parser SHALL emit a diagnostic warning suggesting `.9`
2. WHEN a comparison's right-hand side is `.` followed by a letter (e.g., `x != . a`), THE Condition_Parser SHALL emit a diagnostic warning suggesting `.a` (extended missing value)
3. WHEN a comparison's right-hand side is a number followed by `.` (e.g., `x != 9 .`), THE Condition_Parser SHALL emit a diagnostic warning suggesting `9.` or that `.` may be stray
4. WHEN a comparison's right-hand side is a letter followed by `.` (e.g., `x != a .`), THE Condition_Parser SHALL emit a diagnostic warning
5. WHEN the condition spans multiple lines with continuation (`///`), THE Condition_Parser SHALL still detect split literals
6. THE diagnostic message SHALL suggest that the user may have intended a single token

### Requirement 8: Handle Multi-line Conditions with Continuation

**User Story:** As a Stata developer, I want stray token detection to work correctly across line continuations.

#### Acceptance Criteria

1. WHEN a condition uses `///` continuation and spans multiple lines, THE Condition_Parser SHALL analyze the complete expression
2. WHEN a stray token appears after continuation (e.g., after `///` comment), THE Condition_Parser SHALL correctly identify it
3. THE following pattern SHALL be detected as containing a stray token:
   ```stata
   replace x = y if z1 == 0 & z2 == 0 & z3 == 0 & /// stuff
                       (x3 == 0 & z4 != 0 & z5 != . 9)
   ```
   where `. 9` contains the stray token `9` after the `.` operator/value
