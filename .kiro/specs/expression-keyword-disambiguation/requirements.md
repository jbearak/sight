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

This specification addresses false positive diagnostics in the Stata LSP when parsing files that use Stata keywords as variable names within expressions. The LSP incorrectly interprets variable names like `program` as the start of new statements when they appear in expression contexts (e.g., `count if program == "x"`), causing parse errors and cascading undefined macro warnings.

## Glossary

- **Expression_Context**: A position in Stata code where an expression is expected, such as after `if`, `while`, or `=` in commands like `count if expr`, `replace x = expr`, or `gen y = expr`
- **Keyword_Variable**: A Stata variable whose name matches a Stata keyword (e.g., `program`, `local`, `if`, `while`)
- **Statement_Context**: A position in Stata code where a new statement/command is expected, typically at the start of a line or after a statement terminator
- **Parser**: The component that builds AST from tokens
- **Varlist_Parsing**: The parser's process of collecting variable names and expressions as arguments to commands

## Requirements

### Requirement 1: Keyword Variables in Expression Context

**User Story:** As a Stata developer, I want to use variables named after Stata keywords (like `program`) in expressions, so that I can work with datasets that have such variable names without false parse errors.

#### Acceptance Criteria

1. WHEN a variable named `program` appears after a comparison operator (e.g., `& program ==`), THE Parser SHALL treat it as a variable reference, not as the start of a `program define` statement
2. WHEN a variable named `program` appears in an `if` expression (e.g., `count if program == "x"`), THE Parser SHALL include it in the expression, not parse it as a new statement
3. WHEN parsing a command with an `if` qualifier (e.g., `count if`, `drop if`, `replace if`), THE Parser SHALL consume the entire expression until the statement terminator or comma
4. WHEN a keyword appears after an operator (`==`, `!=`, `&`, `|`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`), THE Parser SHALL treat it as an operand, not as a statement keyword
5. IF the parser encounters a keyword in expression context, THEN THE Parser SHALL NOT emit "Expected 'define' after 'program'" or similar errors

### Requirement 2: Expression Continuation After Operators

**User Story:** As a Stata developer, I want expressions to be fully parsed including all operators and operands, so that complex conditions like `_merge == 1 & program == "x"` are correctly understood.

#### Acceptance Criteria

1. WHEN an expression contains the `&` operator, THE Parser SHALL continue parsing the expression after the operator
2. WHEN an expression contains the `|` operator, THE Parser SHALL continue parsing the expression after the operator
3. WHEN an expression contains comparison operators (`==`, `!=`, `<`, `>`, `<=`, `>=`), THE Parser SHALL continue parsing the expression after the operator
4. THE Parser SHALL correctly handle chained conditions (e.g., `a == 1 & b == 2 & c == 3`)
5. THE Parser SHALL correctly handle parenthesized sub-expressions within conditions

### Requirement 3: Command If-Qualifier Recognition

**User Story:** As a Stata developer, I want commands with `if` qualifiers to be parsed correctly, so that filtering expressions work without errors.

#### Acceptance Criteria

1. WHEN a command is followed by `if` (e.g., `count if`, `drop if`, `list if`), THE Parser SHALL recognize this as an if-qualifier, not a separate if-statement
2. WHEN parsing an if-qualifier, THE Parser SHALL consume all tokens until the statement terminator, comma, or in-qualifier
3. WHEN an if-qualifier contains keywords as variable names, THE Parser SHALL treat them as variables within the expression
4. THE Parser SHALL distinguish between `if` as a control flow statement and `if` as a command qualifier based on context
