# Requirements Document

## Introduction

This feature fixes the parser to correctly handle commands that use assignment expression syntax: `command [type] newvar = expression [, options]`. Currently, the parser incorrectly treats the `=` operator as a statement boundary, causing parse errors for valid commands like `egen max_bidx = max(bidx), by(id)`. This pattern is used by built-in commands (`egen`, `gen`, `replace`) and can also be used by user-defined programs.

## Glossary

- **Assignment_Expression**: A command syntax pattern where a variable is assigned the result of an expression using `=`
- **Expression_Context**: The parsing context after `=` where the parser should consume tokens as part of an expression until a comma or statement terminator
- **Function_Call**: A function invocation pattern `fcn(arguments)` that can appear in expressions

## Requirements

### Requirement 1: Parse Assignment Expression Syntax

**User Story:** As a developer writing Stata code, I want the parser to correctly recognize commands with `newvar = expression` syntax, so that I don't see false parse errors.

#### Acceptance Criteria

1. WHEN parsing `command newvar = expr`, THE Parser SHALL recognize this as a single command
2. WHEN parsing `command newvar = fcn(args)`, THE Parser SHALL include the function call as part of the expression
3. WHEN parsing `command newvar = expr, option(args)`, THE Parser SHALL correctly separate the expression from options
4. THE Parser SHALL NOT emit "Expected command name" errors for valid assignment syntax
5. THE Parser SHALL handle the `=` operator as part of the command, not as a statement boundary

### Requirement 2: Handle Expression Tokens

**User Story:** As a developer, I want the parser to correctly consume all tokens that are part of an expression after `=`.

#### Acceptance Criteria

1. WHEN parsing `command x = a + b`, THE Parser SHALL include operators in the expression
2. WHEN parsing `command x = fcn(a, b)`, THE Parser SHALL handle commas inside parentheses as function arguments, not option separators
3. WHEN parsing `command x = a * b`, THE Parser SHALL handle `*` as multiplication, not as a comment
4. WHEN parsing `command x = (a + b) / c`, THE Parser SHALL handle nested parentheses
5. THE Parser SHALL stop expression parsing at a comma outside parentheses (option separator) or statement terminator

### Requirement 3: Preserve Variable Extraction

**User Story:** As a developer, I want the analyzer to correctly extract variable names from assignment commands.

#### Acceptance Criteria

1. WHEN analyzing `egen newvar = fcn(args)`, THE Analyzer SHALL register `newvar` as a variable
2. WHEN analyzing `gen newvar = expr`, THE Analyzer SHALL continue to extract `newvar` correctly
3. WHEN analyzing `replace var = expr`, THE Analyzer SHALL continue to work as before

### Requirement 4: Handle Edge Cases

**User Story:** As a developer, I want the parser to handle edge cases in assignment expression syntax.

#### Acceptance Criteria

1. WHEN parsing `command type newvar = expr`, THE Parser SHALL handle optional type specifications
2. WHEN parsing `command x = .`, THE Parser SHALL handle missing value assignment
3. WHEN parsing `command x = ""`, THE Parser SHALL handle string expressions
4. IF the expression is malformed, THEN THE Parser SHALL report appropriate errors without cascading failures
